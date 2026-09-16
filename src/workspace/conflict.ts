import { runGit } from "./git.js";

/**
 * Detect overlapping dirty/changed paths across worktrees relative to a base ref.
 */
export class ConflictDetector {
  async changedPaths(worktreePath: string, baseRef = "HEAD"): Promise<string[]> {
    const tracked = await runGit(worktreePath, [
      "diff",
      "--name-only",
      `${baseRef}`,
    ]);
    const untracked = await runGit(worktreePath, [
      "ls-files",
      "--others",
      "--exclude-standard",
    ]);
    const paths = new Set<string>();
    for (const line of `${tracked.stdout}\n${untracked.stdout}`.split(/\r?\n/)) {
      const p = line.trim().replace(/\\/g, "/");
      if (p) paths.add(p);
    }
    return [...paths].sort();
  }

  async overlappingPaths(
    worktreeA: string,
    worktreeB: string,
    baseRef = "HEAD",
  ): Promise<string[]> {
    const [a, b] = await Promise.all([
      this.changedPaths(worktreeA, baseRef),
      this.changedPaths(worktreeB, baseRef),
    ]);
    const setB = new Set(b);
    return a.filter((p) => setB.has(p));
  }
}
