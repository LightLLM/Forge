import type { RegisteredTool, ToolContext } from "../tools/types.js";
import type { ToolCallProposal, ToolCallResult, ToolRisk } from "../core/types.js";
import {
  riskNeedsApproval,
  type ApprovalGate,
  type ApprovalsConfig,
} from "./approvals.js";

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requiresApproval?: boolean;
}

export interface PolicyEngine {
  evaluate(call: ToolCallProposal, tool: RegisteredTool | undefined): PolicyDecision;
}

const SECRET_PATH_HINT =
  /(^|\/)\.env($|\.)|(^|\/)\.env\.|credentials|secrets?\/|id_rsa|\.pem$/i;

/**
 * Policy is Forge-owned. Repository instructions cannot grant extra tools,
 * raise budgets, or weaken these checks.
 */
export class DefaultPolicyEngine implements PolicyEngine {
  constructor(
    private readonly options: {
      allowWrites: boolean;
      allowExecute: boolean;
      /** Opt-in; default false (local-first). */
      allowNetwork?: boolean;
      forbiddenPathPatterns?: RegExp[];
      approvals?: ApprovalsConfig;
    } = { allowWrites: true, allowExecute: true },
  ) {}

  evaluate(call: ToolCallProposal, tool: RegisteredTool | undefined): PolicyDecision {
    if (!tool) {
      return { allowed: false, reason: `Unknown tool: ${call.name}` };
    }

    if (!this.riskAllowed(tool.risk)) {
      return {
        allowed: false,
        reason: `Tool risk '${tool.risk}' is not permitted in current policy`,
      };
    }

    const pathArg = extractPath(call.arguments);
    if (pathArg) {
      if (SECRET_PATH_HINT.test(pathArg.replace(/\\/g, "/"))) {
        return {
          allowed: false,
          reason: `Access to secret-like path denied: ${pathArg}`,
        };
      }
      for (const pattern of this.options.forbiddenPathPatterns ?? []) {
        if (pattern.test(pathArg)) {
          return {
            allowed: false,
            reason: `Path matches forbidden pattern: ${pathArg}`,
          };
        }
      }
    }

    if (call.name === "run_command") {
      const command = String(call.arguments.command ?? "");
      if (!command.trim()) {
        return { allowed: false, reason: "Empty command" };
      }
    }

    const approvals = this.options.approvals;
    if (approvals && riskNeedsApproval(approvals, tool.risk)) {
      return { allowed: true, requiresApproval: true };
    }

    return { allowed: true };
  }

  private riskAllowed(risk: ToolRisk): boolean {
    switch (risk) {
      case "read":
        return true;
      case "write":
        return this.options.allowWrites;
      case "execute":
        return this.options.allowExecute;
      case "network":
        return this.options.allowNetwork === true;
      default:
        return false;
    }
  }
}

function extractPath(args: Record<string, unknown>): string | null {
  for (const key of ["path", "file", "filePath", "directory", "dir"]) {
    const value = args[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function summarizeCall(call: ToolCallProposal): string {
  const path = extractPath(call.arguments);
  if (call.name === "run_command") {
    return `command: ${String(call.arguments.command ?? "").slice(0, 120)}`;
  }
  if (path) return `path: ${path}`;
  return JSON.stringify(call.arguments).slice(0, 160);
}

export async function authorizeAndExecute(
  call: ToolCallProposal,
  tool: RegisteredTool | undefined,
  policy: PolicyEngine,
  ctx: ToolContext,
  approvalGate?: ApprovalGate,
): Promise<ToolCallResult> {
  const decision = policy.evaluate(call, tool);
  if (!decision.allowed || !tool) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      denied: true,
      denialReason: decision.reason ?? "Denied",
      output: null,
      error: decision.reason ?? "Denied",
    };
  }

  if (decision.requiresApproval) {
    if (!approvalGate) {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        denied: true,
        denialReason: "Approval required but no approval gate configured",
        output: null,
        error: "Approval required",
      };
    }
    const verdict = await approvalGate.decide({
      taskId: ctx.taskId,
      toolName: call.name,
      risk: tool.risk,
      summary: summarizeCall(call),
    });
    if (verdict === "denied") {
      return {
        id: call.id,
        name: call.name,
        ok: false,
        denied: true,
        denialReason: "User or policy denied high-risk approval",
        output: null,
        error: "Approval denied",
      };
    }
  }

  try {
    const output = await tool.execute(call.arguments, ctx);
    return {
      id: call.id,
      name: call.name,
      ok: true,
      output,
    };
  } catch (err) {
    return {
      id: call.id,
      name: call.name,
      ok: false,
      output: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
