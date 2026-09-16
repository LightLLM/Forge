import type { TaskStatus } from "../types.js";
import { ForgeError } from "../types.js";

const TERMINAL: ReadonlySet<TaskStatus> = new Set([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

/**
 * Explicit allowed transitions for the task state machine.
 * Invalid transitions throw — chat history is never used as application state.
 */
const ALLOWED: ReadonlyMap<TaskStatus, ReadonlySet<TaskStatus>> = new Map([
  ["CREATED", new Set(["CONTEXT_BUILDING", "CANCELLED", "FAILED"])],
  ["CONTEXT_BUILDING", new Set(["PLANNING", "FAILED", "CANCELLED"])],
  ["PLANNING", new Set(["READY", "FAILED", "CANCELLED"])],
  ["READY", new Set(["IMPLEMENTING", "FAILED", "CANCELLED"])],
  [
    "IMPLEMENTING",
    new Set(["VERIFYING", "REPAIRING", "ESCALATING", "REVIEW", "FAILED", "CANCELLED"]),
  ],
  [
    "VERIFYING",
    new Set([
      "COMPLETED",
      "REPAIRING",
      "ESCALATING",
      "REVIEW",
      "FAILED",
      "CANCELLED",
      "IMPLEMENTING",
    ]),
  ],
  [
    "REPAIRING",
    new Set(["VERIFYING", "ESCALATING", "IMPLEMENTING", "FAILED", "CANCELLED"]),
  ],
  ["ESCALATING", new Set(["IMPLEMENTING", "REPAIRING", "VERIFYING", "FAILED", "CANCELLED"])],
  ["REVIEW", new Set(["COMPLETED", "REPAIRING", "FAILED", "CANCELLED"])],
  ["COMPLETED", new Set()],
  ["FAILED", new Set()],
  ["CANCELLED", new Set()],
]);

export function isTerminalStatus(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false;
  return ALLOWED.get(from)?.has(to) ?? false;
}

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransition(from, to)) {
    throw new ForgeError(
      `Invalid task state transition: ${from} → ${to}`,
      "INVALID_TRANSITION",
      { from, to },
    );
  }
}

export function allowedTransitions(from: TaskStatus): TaskStatus[] {
  return [...(ALLOWED.get(from) ?? [])];
}
