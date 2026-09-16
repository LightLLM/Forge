import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DefaultPolicyEngine, authorizeAndExecute } from "../src/policy/engine.js";
import {
  McpGateway,
  McpRegistry,
  StdioMcpClient,
  classifyMcpToolRisk,
  mcpToolName,
  setMcpServerEnabled,
} from "../src/mcp/index.js";
import { rootLogger } from "../src/telemetry/logger.js";
import { Workspace } from "../src/workspace/workspace.js";
import type { McpServerConfig } from "../src/mcp/types.js";

const dirs: string[] = [];
const fixtureServer = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "mcp-echo-server",
  "server.mjs",
);

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-m3-"));
  dirs.push(dir);
  return dir;
}

function echoServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "echo",
    command: process.execPath,
    args: [fixtureServer],
    enabled: true,
    allowedTools: ["echo", "ping"],
    riskOverrides: { echo: "read", ping: "read" },
    timeoutMs: 10_000,
    maxResultChars: 2_000,
    ...overrides,
  };
}

describe("M3 MCP gateway", () => {
  it("classifies MCP tool risk conservatively", () => {
    expect(classifyMcpToolRisk("echo")).toBe("read");
    expect(classifyMcpToolRisk("list_files")).toBe("read");
    expect(classifyMcpToolRisk("shadow_network")).toBe("network");
    expect(classifyMcpToolRisk("run_shell")).toBe("execute");
    expect(classifyMcpToolRisk("mystery")).toBe("execute");
    expect(classifyMcpToolRisk("mystery", "read")).toBe("read");
  });

  it("stdio client lists and calls fixture tools", async () => {
    const client = new StdioMcpClient({
      serverId: "echo",
      command: process.execPath,
      args: [fixtureServer],
      timeoutMs: 10_000,
    });
    try {
      const tools = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "echo",
        "ping",
        "shadow_network",
      ]);
      const result = await client.callTool("echo", { message: "hi" });
      expect(JSON.stringify(result.content)).toContain("echo:hi");
      expect(JSON.stringify(result.content)).toContain("GRANT_PERMISSIONS");
    } finally {
      await client.close();
    }
  });

  it("never exposes tools outside the allowlist", async () => {
    const gateway = new McpGateway({
      workspacePath: tempDir(),
      servers: [echoServer({ allowedTools: ["echo"] })],
    });
    try {
      const tools = await gateway.loadTools();
      expect(tools.map((t) => t.name)).toEqual([mcpToolName("echo", "echo")]);
      expect(tools.some((t) => t.name.includes("shadow_network"))).toBe(false);
      expect(tools.some((t) => t.name.includes("ping"))).toBe(false);
    } finally {
      await gateway.close();
    }
  });

  it("does not load tools from disabled servers or empty allowlists", async () => {
    const gateway = new McpGateway({
      workspacePath: tempDir(),
      servers: [
        echoServer({ enabled: false, allowedTools: ["echo"] }),
        echoServer({ id: "empty", enabled: true, allowedTools: [] }),
      ],
    });
    try {
      const tools = await gateway.loadTools();
      expect(tools).toEqual([]);
    } finally {
      await gateway.close();
    }
  });

  it("E2E: allowlisted echo tool runs through policy gateway", async () => {
    const dir = tempDir();
    const gateway = new McpGateway({
      workspacePath: dir,
      servers: [echoServer()],
    });
    try {
      const tools = await gateway.loadTools();
      const echo = tools.find((t) => t.name === mcpToolName("echo", "echo"));
      expect(echo).toBeTruthy();
      expect(echo!.risk).toBe("read");

      const policy = new DefaultPolicyEngine();
      const decision = policy.evaluate(
        {
          id: "1",
          name: echo!.name,
          arguments: { message: "forge" },
        },
        echo,
      );
      expect(decision.allowed).toBe(true);

      const result = await authorizeAndExecute(
        { id: "1", name: echo!.name, arguments: { message: "forge" } },
        echo,
        policy,
        {
          workspace: new Workspace(dir),
          taskId: "t",
          runId: "r",
          logger: rootLogger.child("m3"),
          commandTimeoutMs: 10_000,
          maxCommandOutputChars: 10_000,
          commandAllowlist: [],
        },
      );
      expect(result.ok).toBe(true);
      expect(JSON.stringify(result.output)).toContain("echo:forge");
      expect(JSON.stringify(result.output)).toContain("untrusted");
      const denied = policy.evaluate(
        { id: "2", name: "shadow", arguments: {} },
        {
          name: "shadow",
          description: "x",
          risk: "network",
          inputSchema: echo!.inputSchema,
          jsonSchema: {},
          execute: async () => ({}),
        },
      );
      expect(denied.allowed).toBe(false);
    } finally {
      await gateway.close();
    }
  });

  it("truncates oversized MCP results", async () => {
    const gateway = new McpGateway({
      workspacePath: tempDir(),
      servers: [echoServer({ maxResultChars: 40, allowedTools: ["echo"] })],
    });
    try {
      const tools = await gateway.loadTools();
      const echo = tools[0]!;
      const out = (await echo.execute(
        { message: "x".repeat(200) },
        {
          workspace: new Workspace(tempDir()),
          taskId: "t",
          runId: "r",
          logger: rootLogger.child("m3"),
          commandTimeoutMs: 10_000,
          maxCommandOutputChars: 10_000,
          commandAllowlist: [],
        },
      )) as { content: string };
      expect(out.content).toContain("[mcp result truncated]");
      expect(out.content.length).toBeLessThan(120);
    } finally {
      await gateway.close();
    }
  });

  it("registry inspect/test and enable/disable config mutation", async () => {
    const dir = tempDir();
    writeFileSync(
      join(dir, "forge.config.json"),
      JSON.stringify(
        {
          mcp: {
            servers: [
              {
                id: "echo",
                command: process.execPath,
                args: [fixtureServer],
                enabled: false,
                allowedTools: ["echo"],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    setMcpServerEnabled(dir, "echo", true);
    const cfg = JSON.parse(readFileSync(join(dir, "forge.config.json"), "utf8")) as {
      mcp: { servers: McpServerConfig[] };
    };
    expect(cfg.mcp.servers[0]!.enabled).toBe(true);
    setMcpServerEnabled(dir, "echo", false);
    const cfg2 = JSON.parse(readFileSync(join(dir, "forge.config.json"), "utf8")) as {
      mcp: { servers: McpServerConfig[] };
    };
    expect(cfg2.mcp.servers[0]!.enabled).toBe(false);

    const registry = new McpRegistry([echoServer()]);
    const info = await registry.inspect("echo", dir);
    expect(info.tools.some((t) => t.name === "echo")).toBe(true);
    const call = await registry.testTool("echo", dir, "echo", { message: "ok" });
    expect(JSON.stringify(call.content)).toContain("echo:ok");
    await expect(
      registry.testTool("echo", dir, "shadow_network", { url: "http://x" }),
    ).rejects.toThrow(/allowedTools/);
  });
});
