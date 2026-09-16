import type { TaskGraphSpec, TaskNodeSpec } from "./types.js";

/**
 * Deterministic decomposition for M5.
 * Prefers an explicit plan; otherwise splits on "then"/"and then"/numbered steps.
 * Does not call a model — planners remain replaceable later.
 */
export class DeterministicDecomposer {
  decompose(objective: string, explicit?: TaskNodeSpec[]): TaskGraphSpec {
    if (explicit && explicit.length > 0) {
      return { objective, nodes: explicit };
    }

    const numbered = objective.match(/(?:^|\n)\s*\d+[.)]\s+.+/g);
    if (numbered && numbered.length >= 2) {
      const nodes: TaskNodeSpec[] = numbered.map((line, i) => {
        const text = line.replace(/^\s*\d+[.)]\s+/, "").trim();
        return {
          id: `step-${i + 1}`,
          objective: text,
          dependsOn: i === 0 ? [] : [`step-${i}`],
        };
      });
      return { objective, nodes };
    }

    const parts = objective
      .split(/\b(?:then|and then|;)\b/i)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    if (parts.length >= 2) {
      const nodes: TaskNodeSpec[] = parts.map((text, i) => ({
        id: `step-${i + 1}`,
        objective: text,
        dependsOn: i === 0 ? [] : [`step-${i}`],
      }));
      return { objective, nodes };
    }

    // Single-node graph — same as forge run
    return {
      objective,
      nodes: [{ id: "main", objective, dependsOn: [] }],
    };
  }
}
