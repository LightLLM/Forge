import type { ToolRisk } from "../core/types.js";

/**
 * Conservative default risk for MCP tools.
 * Prefer read only when the name clearly indicates inspection.
 */
export function classifyMcpToolRisk(
  toolName: string,
  override?: ToolRisk,
): ToolRisk {
  if (override) return override;
  const n = toolName.toLowerCase();
  if (
    /^(get_|list_|read_|search_|find_|describe_|show_|echo|ping)/.test(n) ||
    /(^|_)(get|list|read|search|find|describe|show|echo|ping)$/.test(n)
  ) {
    return "read";
  }
  if (/(fetch|http|url|request|network|download|upload|send|email|post|webhook)/.test(n)) {
    return "network";
  }
  if (/(exec|shell|command|run_|spawn|process)/.test(n)) {
    return "execute";
  }
  if (/(write|create|update|delete|remove|put_|patch_|set_|apply)/.test(n)) {
    return "write";
  }
  // Unknown MCP tools default to execute (requires stronger policy attention).
  return "execute";
}

export function mcpToolName(serverId: string, toolName: string): string {
  return `mcp__${serverId}__${toolName}`;
}

export function parseMcpToolName(
  forgeName: string,
): { serverId: string; toolName: string } | null {
  if (!forgeName.startsWith("mcp__")) return null;
  const rest = forgeName.slice("mcp__".length);
  const idx = rest.indexOf("__");
  if (idx <= 0) return null;
  return {
    serverId: rest.slice(0, idx),
    toolName: rest.slice(idx + 2),
  };
}
