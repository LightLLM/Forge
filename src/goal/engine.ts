import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "../telemetry/logger.js";
import { TaskGraph, TaskScheduler } from "../scheduler/index.js";
import { createDirectiveExecutor, parseWriteDirective } from "../scheduler/executors.js";
import type { TaskNodeState } from "../scheduler/types.js";
import { GoalStore } from "./store.js";
import { resolveGoalPlan } from "./plan.js";
import type { GoalPhase, GoalRecord, GoalRunResult } from "./types.js";
import { isTerminalGoalPhase } from "./types.js";
import { ForgeError } from "../core/types.js";

export interface GoalEngineOptions {
  store: GoalStore;
  workspacePath: string;
  maxParallelWorkers?: number;
  logger?: Logger;
  signal?: AbortSignal;
}

export class GoalEngine {
  private readonly store: GoalStore;
  private readonly workspacePath: string;
  private readonly maxParallelWorkers: number;
  private readonly logger?: Logger;
  private readonly signal?: AbortSignal;

  constructor(options: GoalEngineOptions) {
    this.store = options.store;
    this.workspacePath = options.workspacePath;
    this.maxParallelWorkers = options.maxParallelWorkers ?? 2;
    this.logger = options.logger;
    this.signal = options.signal;
  }

  create(objective: string): GoalRecord {
    return this.store.create({
      objective,
      workspacePath: this.workspacePath,
    });
  }

  /**
   * Run or resume a goal through architect → plan → execute → integrate → verify → review.
   */
  async run(goalId: string, planPath?: string): Promise<GoalRunResult> {
    let goal = this.store.get(goalId);
    if (!goal) {
      throw new ForgeError(`Goal not found: ${goalId}`, "GOAL_MISSING");
    }

    if (goal.phase === "completed") {
      return this.toResult(goal);
    }
    if (goal.phase === "failed" || goal.phase === "cancelled") {
      throw new ForgeError(
        `Goal ${goalId} is ${goal.phase}: ${goal.error ?? ""}`,
        "GOAL_TERMINAL",
      );
    }

    try {
      if (goal.phase === "created") {
        goal = this.advance(goal, "architecting");
        this.logger?.info("goal architect", { goalId, objective: goal.objective });
      }

      if (goal.phase === "architecting") {
        const plan = resolveGoalPlan(goal.objective, goal.workspacePath, planPath);
        if (plan.nodes.length < 1) {
          throw new ForgeError("Goal plan has no tasks", "GOAL_EMPTY_PLAN");
        }
        const graph = new TaskGraph(plan);
        goal = this.store.updatePlan(goal.id, plan, graph.id);
        goal = this.advance(goal, "planning");
        this.logger?.info("goal planned", {
          goalId,
          nodes: plan.nodes.length,
        });
      }

      if (goal.phase === "planning") {
        goal = this.advance(goal, "executing");
      }

      if (goal.phase === "executing") {
        goal = await this.executeGraph(goal);
        if (goal.phase === "executing") {
          goal = this.advance(goal, "integrating");
        }
      }

      if (goal.phase === "integrating") {
        const integration = this.runIntegration(goal);
        goal = this.store.updateVerification(goal.id, integration, goal.reviewSummary ?? "");
        goal = this.advance(goal, "verifying");
      }

      if (goal.phase === "verifying") {
        const verification = this.runVerification(goal);
        goal = this.store.updateVerification(
          goal.id,
          { ...goal.verification, ...verification },
          goal.reviewSummary ?? "",
        );
        if (verification.passed !== true) {
          return this.fail(goal, verification.summary as string ?? "Verification failed");
        }
        goal = this.advance(goal, "reviewing");
      }

      if (goal.phase === "reviewing") {
        const summary = this.runReview(goal);
        goal = this.store.updateVerification(
          goal.id,
          goal.verification ?? {},
          summary,
        );
        goal = this.advance(goal, "completed");
      }

      return this.toResult(goal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      goal = this.store.get(goalId)!;
      return this.fail(goal, message);
    }
  }

  private async executeGraph(goal: GoalRecord): Promise<GoalRecord> {
    if (!goal.plan) {
      throw new ForgeError("Goal missing plan", "GOAL_NO_PLAN");
    }
    const graph = new TaskGraph(goal.plan);
    if (goal.graphSnapshot?.length) {
      graph.restoreSnapshot(goal.graphSnapshot);
    }

    const executor = createDirectiveExecutor(goal.workspacePath);
    const scheduler = new TaskScheduler({
      maxParallelWorkers: this.maxParallelWorkers,
      signal: this.signal,
      onEvent: (event) => {
        if (event.type === "node_finished") {
          this.store.updateGraphSnapshot(goal.id, graph.snapshot());
          this.logger?.info("goal node finished", {
            goalId: goal.id,
            nodeId: event.node.id,
            ok: event.ok,
          });
        }
      },
    });

    const result = await scheduler.run(graph, executor);
    this.store.updateGraphSnapshot(goal.id, graph.snapshot());

    if (result.status !== "completed") {
      const failed = result.nodes.find((n) => n.status === "failed");
      throw new ForgeError(
        failed?.error ?? "Task graph execution failed",
        "GOAL_EXEC_FAILED",
      );
    }
    return this.store.get(goal.id)!;
  }

  private runIntegration(goal: GoalRecord): Record<string, unknown> {
    const snapshot = goal.graphSnapshot ?? [];
    const completed = snapshot.filter((n) => n.status === "completed");
    const missing: string[] = [];
    for (const node of completed) {
      const directive = parseWriteDirective(node.objective);
      if (!directive) continue;
      const abs = join(goal.workspacePath, directive.path);
      if (!existsSync(abs)) {
        missing.push(directive.path);
      }
    }
    return {
      integration: true,
      nodesCompleted: completed.length,
      nodesTotal: snapshot.length,
      missingArtifacts: missing,
      passed: missing.length === 0,
    };
  }

  private runVerification(goal: GoalRecord): Record<string, unknown> {
    const snapshot = goal.graphSnapshot ?? [];
    const checks: { name: string; ok: boolean; detail?: string }[] = [];

    for (const node of snapshot) {
      const directive = parseWriteDirective(node.objective);
      if (!directive) continue;
      const abs = join(goal.workspacePath, directive.path);
      if (!existsSync(abs)) {
        checks.push({ name: node.id, ok: false, detail: `missing ${directive.path}` });
        continue;
      }
      const content = readFileSync(abs, "utf8");
      if (directive.content.trim() && content.trim() !== directive.content.trim()) {
        checks.push({
          name: node.id,
          ok: false,
          detail: `content mismatch for ${directive.path}`,
        });
        continue;
      }
      checks.push({ name: node.id, ok: true });
    }

    const passed = checks.every((c) => c.ok);
    return {
      passed,
      summary: passed
        ? `All ${checks.length} artifact checks passed`
        : `Verification failed: ${checks.filter((c) => !c.ok).map((c) => c.name).join(", ")}`,
      checks,
    };
  }

  private runReview(goal: GoalRecord): string {
    const nodes = goal.graphSnapshot ?? [];
    const done = nodes.filter((n) => n.status === "completed").length;
    return `Goal completed: ${done}/${nodes.length} tasks; objective satisfied per verification.`;
  }

  private advance(goal: GoalRecord, phase: GoalPhase): GoalRecord {
    return this.store.setPhase(goal.id, phase);
  }

  private fail(goal: GoalRecord, message: string): GoalRunResult {
    const updated = this.store.setPhase(goal.id, "failed", message);
    return this.toResult(updated, message);
  }

  private toResult(goal: GoalRecord, error?: string): GoalRunResult {
    const snapshot = goal.graphSnapshot ?? [];
    const completed = snapshot.filter((n) => n.status === "completed").length;
    const total = snapshot.length || goal.plan?.nodes.length || 0;
    let status: GoalRunResult["status"] = "in_progress";
    if (goal.phase === "completed") status = "completed";
    else if (goal.phase === "failed") status = "failed";
    else if (isTerminalGoalPhase(goal.phase)) status = "failed";

    return {
      goalId: goal.id,
      phase: goal.phase,
      status,
      nodesCompleted: completed,
      nodesTotal: total,
      verification: goal.verification ?? undefined,
      error: error ?? goal.error ?? undefined,
    };
  }
}

export function countCompletedNodes(snapshot: TaskNodeState[] | null): number {
  return (snapshot ?? []).filter((n) => n.status === "completed").length;
}
