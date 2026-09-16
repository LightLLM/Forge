import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadSpec } from "../scheduler/index.js";
import type { TaskGraphSpec } from "../scheduler/types.js";

/**
 * Resolve a task plan for a goal (architect → plan).
 * Prefers explicit path, then workspace goal artifacts, then decomposition.
 */
export function resolveGoalPlan(
  objective: string,
  workspacePath: string,
  planPath?: string,
): TaskGraphSpec {
  const root = resolve(workspacePath);
  const candidates: string[] = [];

  if (planPath) {
    candidates.push(resolve(root, planPath));
  }
  candidates.push(
    join(root, ".forge", "goal", "plan.json"),
    join(root, "goal.plan.json"),
    join(root, "plan.json"),
  );

  // Objective may reference a plan file: "... from plan.json" or "... fixtures/foo/plan.json"
  const ref = objective.match(
    /(?:from|using|per)\s+([^\s]+\.json)/i,
  );
  if (ref?.[1]) {
    candidates.unshift(resolve(root, ref[1]!));
  }

  for (const path of candidates) {
    if (existsSync(path)) {
      return loadSpec(objective, path);
    }
  }

  return loadSpec(objective);
}

export function readGoalSpec(workspacePath: string): string | null {
  const root = resolve(workspacePath);
  for (const rel of ["SPEC.md", "spec.md", ".forge/goal/SPEC.md"]) {
    const path = join(root, rel);
    if (existsSync(path)) {
      return readFileSync(path, "utf8");
    }
  }
  return null;
}
