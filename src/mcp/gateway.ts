import { z } from "zod";
import type { RegisteredTool } from "../tools/types.js";
import { StdioMcpClient } from "./stdio-client.js";
import { classifyMcpToolRisk, mcpToolName } from "./risk.js";
import type { McpServerConfig } from "./types.js";

export interface McpGatewayOptions {
  workspacePath: string;
  servers: McpServerConfig[];
  /** Absolute default timeout if server omits timeoutMs. */
  defaultTimeoutMs?: number;
  defaultMaxResultChars?: number;
}

/**
 * Loads enabled MCP servers and wraps allowed tools as RegisteredTools.
 * MCP output is untrusted DATA. Tools never auto-expose without allowlist.
 */
export class McpGateway {
  private readonly clients: StdioMcpClient[] = [];
  private readonly options: McpGatewayOptions;

  constructor(options: McpGatewayOptions) {
    this.options = options;
  }

  async loadTools(): Promise<RegisteredTool[]> {
    const tools: RegisteredTool[] = [];
    for (const server of this.options.servers) {
      if (!server.enabled) continue;
      if (!server.allowedTools || server.allowedTools.length === 0) {
        continue; // never auto-expose
      }
      const client = new StdioMcpClient({
        serverId: server.id,
        command: server.command,
        args: server.args,
        env: server.env,
        cwd: server.cwd ?? this.options.workspacePath,
        timeoutMs: server.timeoutMs ?? this.options.defaultTimeoutMs ?? 30_000,
      });
      try {
        await client.connect();
        const advertised = await client.listTools();
        const allow = new Set(server.allowedTools);
        for (const desc of advertised) {
          if (!allow.has(desc.name)) continue;
          tools.push(
            this.wrapTool(client, server, desc.name, desc.description, desc.inputSchema),
          );
        }
        this.clients.push(client);
      } catch (err) {
        await client.close().catch(() => undefined);
        throw err;
      }
    }
    return tools;
  }

  async close(): Promise<void> {
    await Promise.all(this.clients.map((c) => c.close().catch(() => undefined)));
    this.clients.length = 0;
  }

  private wrapTool(
    client: StdioMcpClient,
    server: McpServerConfig,
    toolName: string,
    description: string | undefined,
    inputSchema: Record<string, unknown> | undefined,
  ): RegisteredTool {
    const forgeName = mcpToolName(server.id, toolName);
    const risk = classifyMcpToolRisk(
      toolName,
      server.riskOverrides?.[toolName],
    );
    const maxChars =
      server.maxResultChars ?? this.options.defaultMaxResultChars ?? 50_000;

    return {
      name: forgeName,
      description:
        description ??
        `MCP tool ${toolName} from server ${server.id} (untrusted output)`,
      risk,
      inputSchema: z.record(z.string(), z.unknown()),
      jsonSchema: normalizeJsonSchema(inputSchema),
      async execute(input: unknown, ctx) {
        const args =
          input && typeof input === "object" && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {};
        ctx.logger.info("mcp tool call", {
          serverId: server.id,
          tool: toolName,
          forgeName,
          risk,
        });
        const result = await client.callTool(toolName, args);
        const serialized = serializeMcpContent(result.content);
        const truncated =
          serialized.length > maxChars
            ? `${serialized.slice(0, maxChars)}\n...[mcp result truncated]`
            : serialized;
        if (result.isError) {
          throw new Error(`MCP tool error (${server.id}/${toolName}): ${truncated}`);
        }
        return {
          mcpServer: server.id,
          mcpTool: toolName,
          untrusted: true,
          content: truncated,
        };
      },
    };
  }
}

function normalizeJsonSchema(
  schema: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (schema && typeof schema === "object") return schema;
  return { type: "object", additionalProperties: true };
}

function serializeMcpContent(content: unknown): string {
  if (typeof content === "string") return content;
  try {
    return JSON.stringify(content, null, 2);
  } catch {
    return String(content);
  }
}
