import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { McpServerConfig } from "./types.js";
import { StdioMcpClient } from "./stdio-client.js";

export class McpRegistry {
  constructor(private readonly servers: McpServerConfig[]) {}

  list(): McpServerConfig[] {
    return [...this.servers];
  }

  get(id: string): McpServerConfig | null {
    return this.servers.find((s) => s.id === id) ?? null;
  }

  async inspect(id: string, workspacePath: string) {
    const server = this.get(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);
    const client = new StdioMcpClient({
      serverId: server.id,
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd ?? workspacePath,
      timeoutMs: server.timeoutMs ?? 30_000,
    });
    try {
      const tools = await client.listTools();
      return { server, tools };
    } finally {
      await client.close();
    }
  }

  async testTool(
    id: string,
    workspacePath: string,
    toolName: string,
    args: Record<string, unknown> = {},
  ) {
    const server = this.get(id);
    if (!server) throw new Error(`MCP server not found: ${id}`);
    if (!server.allowedTools.includes(toolName)) {
      throw new Error(
        `Tool '${toolName}' is not in allowedTools for server '${id}' (refusing call)`,
      );
    }
    const client = new StdioMcpClient({
      serverId: server.id,
      command: server.command,
      args: server.args,
      env: server.env,
      cwd: server.cwd ?? workspacePath,
      timeoutMs: server.timeoutMs ?? 30_000,
    });
    try {
      return await client.callTool(toolName, args);
    } finally {
      await client.close();
    }
  }
}

/** Persist enabled flag into forge.config.json (best-effort). */
export function setMcpServerEnabled(
  workspacePath: string,
  serverId: string,
  enabled: boolean,
): void {
  const path = join(workspacePath, "forge.config.json");
  if (!existsSync(path)) {
    throw new Error("forge.config.json not found — run forge init");
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as {
    mcp?: { servers?: McpServerConfig[] };
  };
  const servers = raw.mcp?.servers;
  if (!servers?.length) {
    throw new Error("No mcp.servers configured in forge.config.json");
  }
  const target = servers.find((s) => s.id === serverId);
  if (!target) {
    throw new Error(`MCP server '${serverId}' not in forge.config.json`);
  }
  target.enabled = enabled;
  raw.mcp = { ...raw.mcp, servers };
  writeFileSync(path, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
}
