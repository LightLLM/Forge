import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  McpRegistry,
  setMcpServerEnabled,
} from "../../mcp/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerMcp(program: Command): void {
  const mcp = program.command("mcp").description("Manage MCP servers (policy-gated)");

  mcp
    .command("list")
    .description("List configured MCP servers")
    .action(() => {
      const { registry } = openRegistry();
      const list = registry.list();
      if (list.length === 0) {
        console.log("No MCP servers configured. Add mcp.servers in forge.config.json.");
        return;
      }
      for (const s of list) {
        console.log(
          `${s.id.padEnd(16)} ${s.enabled ? "enabled " : "disabled"}  allow=[${s.allowedTools.join(",")}]  ${s.command} ${(s.args ?? []).join(" ")}`,
        );
      }
    });

  mcp
    .command("inspect")
    .description("Connect and list tools advertised by a server")
    .argument("<server-id>", "Server id")
    .action(async (serverId: string) => {
      const { registry, workspace } = openRegistry();
      try {
        const info = await registry.inspect(serverId, workspace);
        console.log(JSON.stringify({
          id: info.server.id,
          enabled: info.server.enabled,
          allowedTools: info.server.allowedTools,
          advertised: info.tools,
        }, null, 2));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  mcp
    .command("test")
    .description("Call an allowlisted MCP tool (fixture/debug)")
    .argument("<server-id>", "Server id")
    .requiredOption("--tool <name>", "Tool name")
    .option("--args <json>", "JSON object of arguments", "{}")
    .action(async (serverId: string, opts: { tool: string; args: string }) => {
      const { registry, workspace } = openRegistry();
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(opts.args) as Record<string, unknown>;
      } catch {
        console.error("--args must be a JSON object");
        process.exitCode = 1;
        return;
      }
      try {
        const result = await registry.testTool(serverId, workspace, opts.tool, args);
        console.log(JSON.stringify(result, null, 2));
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  mcp
    .command("enable")
    .description("Enable an MCP server in forge.config.json")
    .argument("<server-id>", "Server id")
    .action((serverId: string) => {
      try {
        setMcpServerEnabled(resolveWorkspace(), serverId, true);
        console.log(`Enabled MCP server: ${serverId}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  mcp
    .command("disable")
    .description("Disable an MCP server in forge.config.json")
    .argument("<server-id>", "Server id")
    .action((serverId: string) => {
      try {
        setMcpServerEnabled(resolveWorkspace(), serverId, false);
        console.log(`Disabled MCP server: ${serverId}`);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

function openRegistry() {
  const workspace = resolveWorkspace();
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  return { registry: new McpRegistry(config.mcp.servers), workspace };
}

void resolve;
