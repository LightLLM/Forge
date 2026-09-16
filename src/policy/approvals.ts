import type { ToolRisk } from "../core/types.js";
import type { PersistenceStore } from "../persistence/store.js";
import type { Logger } from "../telemetry/logger.js";
import * as readline from "node:readline";

export type ApprovalMode = "off" | "prompt" | "queue" | "deny-high-risk";

export interface ApprovalRequest {
  taskId: string;
  toolName: string;
  risk: ToolRisk;
  summary: string;
}

export interface ApprovalGate {
  decide(request: ApprovalRequest): Promise<"approved" | "denied">;
}

export interface ApprovalsConfig {
  mode: ApprovalMode;
  risks: ToolRisk[];
  /** Max wait for queued approvals (ms). Default 15 minutes. */
  queueTimeoutMs?: number;
  /** Poll interval for queued approvals (ms). Default 1000. */
  queuePollMs?: number;
}

export function riskNeedsApproval(config: ApprovalsConfig, risk: ToolRisk): boolean {
  if (config.mode === "off") return false;
  return config.risks.includes(risk);
}

export class DenyHighRiskGate implements ApprovalGate {
  async decide(_request: ApprovalRequest): Promise<"approved" | "denied"> {
    return "denied";
  }
}

export class AutoApproveGate implements ApprovalGate {
  async decide(_request: ApprovalRequest): Promise<"approved" | "denied"> {
    return "approved";
  }
}

export class PromptApprovalGate implements ApprovalGate {
  constructor(
    private readonly store?: PersistenceStore,
    private readonly logger?: Logger,
  ) {}

  async decide(request: ApprovalRequest): Promise<"approved" | "denied"> {
    const approval = this.store?.createApproval(
      request.taskId,
      `${request.toolName}:${request.risk}`,
      request.summary,
    );

    if (process.env.FORGE_AUTO_APPROVE === "1") {
      if (approval) this.store?.resolveApproval(approval.id, "approved");
      return "approved";
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      this.logger?.warn("approval required but no TTY; denying (use mode=queue for detached)", {
        tool: request.toolName,
      });
      if (approval) this.store?.resolveApproval(approval.id, "denied");
      return "denied";
    }

    const answer = await ask(
      `\n[forge approval] Allow ${request.risk} tool '${request.toolName}'?\n  ${request.summary}\n  [y/N] `,
    );
    const ok = /^y(es)?$/i.test(answer.trim());
    if (approval) this.store?.resolveApproval(approval.id, ok ? "approved" : "denied");
    return ok ? "approved" : "denied";
  }
}

/**
 * Detached approvals: persist pending row and poll until forge approve/deny
 * (or timeout).
 */
export class QueueApprovalGate implements ApprovalGate {
  constructor(
    private readonly store: PersistenceStore,
    private readonly logger?: Logger,
    private readonly timeoutMs = 15 * 60_000,
    private readonly pollMs = 1_000,
  ) {}

  async decide(request: ApprovalRequest): Promise<"approved" | "denied"> {
    if (process.env.FORGE_AUTO_APPROVE === "1") {
      return "approved";
    }

    const approval = this.store.createApproval(
      request.taskId,
      `${request.toolName}:${request.risk}`,
      request.summary,
    );

    this.logger?.info("approval queued", {
      approvalId: approval.id,
      tool: request.toolName,
      summary: request.summary,
    });
    process.stderr.write(
      `\n[forge] Approval queued: ${approval.id}\n` +
        `  tool: ${request.toolName}\n` +
        `  ${request.summary}\n` +
        `  Resolve with: forge approve ${approval.id}   OR   forge deny ${approval.id}\n`,
    );

    const deadline = Date.now() + this.timeoutMs;
    while (Date.now() < deadline) {
      await sleep(this.pollMs);
      const current = this.store.getApproval(approval.id);
      if (!current) return "denied";
      if (current.status === "approved") return "approved";
      if (current.status === "denied") return "denied";
    }

    this.store.resolveApproval(approval.id, "denied");
    this.logger?.warn("approval queue timed out; denying", { approvalId: approval.id });
    return "denied";
  }
}

export function createApprovalGate(
  config: ApprovalsConfig,
  deps: { store?: PersistenceStore; logger?: Logger } = {},
): ApprovalGate {
  if (config.mode === "off") return new AutoApproveGate();
  if (config.mode === "deny-high-risk") return new DenyHighRiskGate();
  if (process.env.FORGE_AUTO_APPROVE === "1") return new AutoApproveGate();
  if (config.mode === "queue") {
    if (!deps.store) {
      throw new Error("approvals.mode=queue requires a persistence store");
    }
    return new QueueApprovalGate(
      deps.store,
      deps.logger,
      config.queueTimeoutMs,
      config.queuePollMs,
    );
  }
  return new PromptApprovalGate(deps.store, deps.logger);
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
