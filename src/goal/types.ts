import { ForgeError } from "../core/types.js";
import type { TaskGraphSpec, TaskNodeState } from "../scheduler/types.js";

/** Durable multi-task engineering objective lifecycle. */
export type GoalPhase =
  | "created"
  | "architecting"
  | "planning"
  | "executing"
  | "integrating"
  | "verifying"
  | "reviewing"
  | "completed"
  | "failed"
  | "cancelled";

export interface GoalRecord {
  id: string;
  objective: string;
  workspacePath: string;
  phase: GoalPhase;
  plan: TaskGraphSpec | null;
  graphId: string | null;
  graphSnapshot: TaskNodeState[] | null;
  verification: Record<string, unknown> | null;
  reviewSummary: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface CreateGoalInput {
  objective: string;
  workspacePath: string;
  /** Optional explicit plan path or inline spec. */
  planPath?: string;
}

export interface GoalRunResult {
  goalId: string;
  phase: GoalPhase;
  status: "completed" | "failed" | "in_progress";
  nodesCompleted: number;
  nodesTotal: number;
  verification?: Record<string, unknown>;
  error?: string;
}

export function isTerminalGoalPhase(phase: GoalPhase): boolean {
  return phase === "completed" || phase === "failed" || phase === "cancelled";
}

export function assertGoalPhaseTransition(from: GoalPhase, to: GoalPhase): void {
  if (from === to) return;
  const allowed: Partial<Record<GoalPhase, GoalPhase[]>> = {
    created: ["architecting", "failed", "cancelled"],
    architecting: ["planning", "failed", "cancelled"],
    planning: ["executing", "failed", "cancelled"],
    executing: ["integrating", "failed", "cancelled"],
    integrating: ["verifying", "failed", "cancelled"],
    verifying: ["reviewing", "failed", "cancelled"],
    reviewing: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };
  const next = allowed[from];
  if (!next?.includes(to)) {
    throw new ForgeError(
      `Invalid goal phase transition: ${from} → ${to}`,
      "INVALID_GOAL_TRANSITION",
      { from, to },
    );
  }
}
