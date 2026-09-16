import type { ToolRisk } from "../core/types.js";
import type { PersistenceStore } from "../persistence/store.js";
import type { Logger } from "../telemetry/logger.js";
import * as readline from "node:readline";

export type ApprovalMode = "off" | "prompt" | "deny-high-risk";

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
      this.logger?.warn("approval required but no TTY; denying", {
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

export function createApprovalGate(
  config: ApprovalsConfig,
  deps: { store?: PersistenceStore; logger?: Logger } = {},
): ApprovalGate {
  if (config.mode === "off") return new AutoApproveGate();
  if (config.mode === "deny-high-risk") return new DenyHighRiskGate();
  if (process.env.FORGE_AUTO_APPROVE === "1") return new AutoApproveGate();
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
