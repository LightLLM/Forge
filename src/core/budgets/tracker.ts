export interface BudgetSnapshot {
  maxTurns: number;
  turnCount: number;
  maxRepairs: number;
  repairCount: number;
  timeoutMs: number;
  startedAtMs: number;
  cloudBudgetUsd: number | null;
  cloudCostUsd: number;
  maxToolCallsPerTurn: number;
  toolCallsThisTurn: number;
}

export type BudgetViolation =
  | "max_turns"
  | "max_repairs"
  | "timeout"
  | "cloud_budget"
  | "tool_calls_per_turn";

export class BudgetTracker {
  private toolCallsThisTurn = 0;

  constructor(
    private readonly limits: {
      maxTurns: number;
      maxRepairs: number;
      timeoutMs: number;
      cloudBudgetUsd: number | null;
      maxToolCallsPerTurn?: number;
    },
    private turnCount = 0,
    private repairCount = 0,
    private cloudCostUsd = 0,
    private readonly startedAtMs = Date.now(),
  ) {}

  snapshot(): BudgetSnapshot {
    return {
      maxTurns: this.limits.maxTurns,
      turnCount: this.turnCount,
      maxRepairs: this.limits.maxRepairs,
      repairCount: this.repairCount,
      timeoutMs: this.limits.timeoutMs,
      startedAtMs: this.startedAtMs,
      cloudBudgetUsd: this.limits.cloudBudgetUsd,
      cloudCostUsd: this.cloudCostUsd,
      maxToolCallsPerTurn: this.limits.maxToolCallsPerTurn ?? 20,
      toolCallsThisTurn: this.toolCallsThisTurn,
    };
  }

  beginTurn(): BudgetViolation | null {
    const timeout = this.checkTimeout();
    if (timeout) return timeout;
    if (this.turnCount >= this.limits.maxTurns) return "max_turns";
    this.turnCount += 1;
    this.toolCallsThisTurn = 0;
    return null;
  }

  beginRepair(): BudgetViolation | null {
    if (this.repairCount >= this.limits.maxRepairs) return "max_repairs";
    this.repairCount += 1;
    return null;
  }

  recordToolCall(): BudgetViolation | null {
    const max = this.limits.maxToolCallsPerTurn ?? 20;
    if (this.toolCallsThisTurn >= max) return "tool_calls_per_turn";
    this.toolCallsThisTurn += 1;
    return null;
  }

  addCloudCost(usd: number | null | undefined): BudgetViolation | null {
    if (usd == null || Number.isNaN(usd)) return null;
    this.cloudCostUsd += usd;
    if (
      this.limits.cloudBudgetUsd != null &&
      this.cloudCostUsd > this.limits.cloudBudgetUsd
    ) {
      return "cloud_budget";
    }
    return null;
  }

  wouldExceedCloudBudget(additionalUsd: number | null | undefined): boolean {
    if (additionalUsd == null || this.limits.cloudBudgetUsd == null) return false;
    return this.cloudCostUsd + additionalUsd > this.limits.cloudBudgetUsd;
  }

  checkTimeout(): BudgetViolation | null {
    if (Date.now() - this.startedAtMs >= this.limits.timeoutMs) return "timeout";
    return null;
  }

  getTurnCount(): number {
    return this.turnCount;
  }

  getRepairCount(): number {
    return this.repairCount;
  }

  getCloudCostUsd(): number {
    return this.cloudCostUsd;
  }

  repairsRemaining(): number {
    return Math.max(0, this.limits.maxRepairs - this.repairCount);
  }
}
