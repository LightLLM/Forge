import type { ToolRisk } from "../core/types.js";

export interface McpServerConfig {
  /** Stable server id used in tool names: mcp__<id>__<tool> */
  id: string;
  /** Executable to spawn (stdio transport). */
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  /** Must be true for Forge to connect and expose tools. */
  enabled: boolean;
  /**
   * Explicit allowlist of MCP tool names exposed to the agent.
   * Empty = advertise via CLI only; never auto-expose to the agent.
   */
  allowedTools: string[];
  /** Optional per-tool risk overrides (default classification otherwise). */
  riskOverrides?: Record<string, ToolRisk>;
  timeoutMs?: number;
  maxResultChars?: number;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpCallResult {
  content: unknown;
  isError?: boolean;
  raw: unknown;
}

export interface McpClient {
  readonly serverId: string;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  close(): Promise<void>;
}
