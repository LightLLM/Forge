import { ConflictDetector } from "./conflict.js";

export interface IntegrationPlan {
  worktreePaths: string[];
  overlappingPaths: string[];
  safeToIntegrate: boolean;
  detail: string;
}

/**
 * Lightweight integration helper: refuses silent merge when worktrees overlap.
 * Full merge/PR flow is deferred to later milestones.
 */
export class IntegrationManager {
  private readonly conflicts = new ConflictDetector();

  async plan(
    worktreePaths: string[],
    baseRef = "HEAD",
  ): Promise<IntegrationPlan> {
    if (worktreePaths.length < 2) {
      return {
        worktreePaths,
        overlappingPaths: [],
        safeToIntegrate: true,
        detail: "fewer than two worktrees",
      };
    }
    const overlaps = new Set<string>();
    for (let i = 0; i < worktreePaths.length; i++) {
      for (let j = i + 1; j < worktreePaths.length; j++) {
        const hit = await this.conflicts.overlappingPaths(
          worktreePaths[i]!,
          worktreePaths[j]!,
          baseRef,
        );
        for (const p of hit) overlaps.add(p);
      }
    }
    const overlappingPaths = [...overlaps].sort();
    return {
      worktreePaths,
      overlappingPaths,
      safeToIntegrate: overlappingPaths.length === 0,
      detail:
        overlappingPaths.length === 0
          ? "no overlapping changed paths"
          : `overlap: ${overlappingPaths.join(", ")}`,
    };
  }
}
