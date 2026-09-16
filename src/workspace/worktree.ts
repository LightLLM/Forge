import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ForgeError } from "../core/types.js";
import { runGit, sanitizeTaskBranchName } from "./git.js";
import { Workspace } from "./workspace.js";

export interface WorktreeInfo {
  taskId: string;
  branch: string;
  path: string;
  bare: boolean;
}

export interface CreateWorktreeResult {
  taskId: string;
  branch: string;
  path: string;
  workspace: Workspace;
  created: boolean;
  detail: string;
}

export interface WorktreeManagerOptions {
  /** Directory under repo root for worktrees (default `.forge/worktrees`). */
  worktreeBase?: string;
}

/**
 * Creates isolated git worktrees per task so parallel workers do not share
 * a writable workspace. Never force-deletes user work by default.
 */
export class WorktreeManager {
  readonly repoRoot: string;
  readonly worktreeBase: string;

  constructor(repoRoot: string, options: WorktreeManagerOptions = {}) {
    this.repoRoot = resolve(repoRoot);
    this.worktreeBase = resolve(
      this.repoRoot,
      options.worktreeBase ?? join(".forge", "worktrees"),
    );
  }

  async assertGitRepo(): Promise<void> {
    const status = await runGit(this.repoRoot, ["rev-parse", "--is-inside-work-tree"]);
    if (status.exitCode !== 0 || !status.stdout.includes("true")) {
      throw new ForgeError(
        `Not a git repository: ${this.repoRoot}`,
        "NOT_A_GIT_REPO",
      );
    }
  }

  worktreePathFor(taskId: string): string {
    const branch = sanitizeTaskBranchName(taskId);
    const leaf = branch.replace(/\//g, "-");
    return join(this.worktreeBase, leaf);
  }

  async createForTask(taskId: string): Promise<CreateWorktreeResult> {
    await this.assertGitRepo();
    const branch = sanitizeTaskBranchName(taskId);
    const path = this.worktreePathFor(taskId);
    mkdirSync(this.worktreeBase, { recursive: true });

    if (existsSync(path)) {
      const ws = new Workspace(path);
      return {
        taskId,
        branch,
        path,
        workspace: ws,
        created: false,
        detail: "worktree path already exists",
      };
    }

    // Create new branch from HEAD in a new worktree.
    const add = await runGit(this.repoRoot, [
      "worktree",
      "add",
      "-b",
      branch,
      path,
      "HEAD",
    ]);
    if (add.exitCode === 0) {
      return {
        taskId,
        branch,
        path,
        workspace: new Workspace(path),
        created: true,
        detail: "created with git worktree add -b",
      };
    }

    // Branch may already exist — attach worktree to existing branch.
    const addExisting = await runGit(this.repoRoot, [
      "worktree",
      "add",
      path,
      branch,
    ]);
    if (addExisting.exitCode === 0) {
      return {
        taskId,
        branch,
        path,
        workspace: new Workspace(path),
        created: true,
        detail: "attached worktree to existing branch",
      };
    }

    throw new ForgeError(
      `Failed to create worktree for task ${taskId}: ${addExisting.stderr || add.stderr}`,
      "WORKTREE_CREATE_FAILED",
      { stderr: addExisting.stderr || add.stderr },
    );
  }

  async list(): Promise<WorktreeInfo[]> {
    await this.assertGitRepo();
    const result = await runGit(this.repoRoot, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    if (result.exitCode !== 0) {
      throw new ForgeError(result.stderr || "git worktree list failed", "WORKTREE_LIST_FAILED");
    }
    const infos: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        if (current.path) {
          infos.push(finalizeInfo(current));
        }
        current = { path: line.slice("worktree ".length).trim() };
      } else if (line.startsWith("branch ")) {
        const ref = line.slice("branch ".length).trim();
        current.branch = ref.replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        current.bare = true;
      } else if (line === "") {
        if (current.path) {
          infos.push(finalizeInfo(current));
          current = {};
        }
      }
    }
    if (current.path) infos.push(finalizeInfo(current));
    return infos.filter((i) => normalizePath(i.path).startsWith(normalizePath(this.worktreeBase)));
  }

  async listAll(): Promise<WorktreeInfo[]> {
    await this.assertGitRepo();
    const result = await runGit(this.repoRoot, ["worktree", "list", "--porcelain"]);
    if (result.exitCode !== 0) return [];
    const infos: WorktreeInfo[] = [];
    let current: Partial<WorktreeInfo> = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith("worktree ")) {
        if (current.path) infos.push(finalizeInfo(current));
        current = { path: line.slice("worktree ".length).trim() };
      } else if (line.startsWith("branch ")) {
        current.branch = line.slice("branch ".length).trim().replace(/^refs\/heads\//, "");
      } else if (line === "bare") {
        current.bare = true;
      } else if (line === "") {
        if (current.path) {
          infos.push(finalizeInfo(current));
          current = {};
        }
      }
    }
    if (current.path) infos.push(finalizeInfo(current));
    return infos;
  }

  /**
   * Remove a Forge worktree. Refuses if dirty unless force=true.
   * Never deletes the primary repo worktree.
   */
  async remove(
    taskId: string,
    options: { force?: boolean; deleteBranch?: boolean } = {},
  ): Promise<{ removed: boolean; detail: string }> {
    await this.assertGitRepo();
    const path = this.worktreePathFor(taskId);
    const branch = sanitizeTaskBranchName(taskId);

    if (!existsSync(path)) {
      return { removed: false, detail: "worktree path does not exist" };
    }
    if (normalizePath(path) === normalizePath(this.repoRoot)) {
      throw new ForgeError("Refusing to remove primary repository worktree", "WORKTREE_REFUSED");
    }

    if (!options.force) {
      const dirty = await isDirty(path);
      if (dirty) {
        throw new ForgeError(
          `Worktree has uncommitted changes; pass force to remove: ${path}`,
          "WORKTREE_DIRTY",
          { path },
        );
      }
    }

    const args = ["worktree", "remove", ...(options.force ? ["--force"] : []), path];
    const result = await runGit(this.repoRoot, args);
    if (result.exitCode !== 0) {
      // Fallback: prune + rm directory only if force
      if (options.force) {
        await runGit(this.repoRoot, ["worktree", "prune"]);
        rmSync(path, { recursive: true, force: true });
      } else {
        throw new ForgeError(
          `Failed to remove worktree: ${result.stderr}`,
          "WORKTREE_REMOVE_FAILED",
        );
      }
    }

    if (options.deleteBranch) {
      await runGit(this.repoRoot, ["branch", "-D", branch]);
    }

    return { removed: true, detail: options.force ? "force-removed" : "removed" };
  }

  /**
   * Clean abandoned Forge worktrees (under worktreeBase) that are gone/missing.
   * Does not force-delete dirty trees unless force=true.
   */
  async cleanupAbandoned(
    options: { force?: boolean; dryRun?: boolean } = {},
  ): Promise<Array<{ path: string; action: string }>> {
    await this.assertGitRepo();
    await runGit(this.repoRoot, ["worktree", "prune"]);
    const forgeTrees = await this.list();
    const actions: Array<{ path: string; action: string }> = [];

    for (const info of forgeTrees) {
      if (!existsSync(info.path)) {
        actions.push({ path: info.path, action: "already-missing" });
        continue;
      }
      const dirty = await isDirty(info.path);
      if (dirty && !options.force) {
        actions.push({ path: info.path, action: "skipped-dirty" });
        continue;
      }
      if (options.dryRun) {
        actions.push({ path: info.path, action: dirty ? "would-force-remove" : "would-remove" });
        continue;
      }
      const taskId = inferTaskId(info);
      try {
        await this.remove(taskId, { force: Boolean(options.force || dirty) });
        actions.push({ path: info.path, action: "removed" });
      } catch (err) {
        actions.push({
          path: info.path,
          action: `error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    return actions;
  }
}

async function isDirty(worktreePath: string): Promise<boolean> {
  const status = await runGit(worktreePath, ["status", "--porcelain"]);
  return status.stdout.trim().length > 0;
}

function finalizeInfo(partial: Partial<WorktreeInfo>): WorktreeInfo {
  const path = partial.path ?? "";
  const branch = partial.branch ?? "";
  return {
    path,
    branch,
    bare: Boolean(partial.bare),
    taskId: branch.replace(/^forge\//, "") || "unknown",
  };
}

function inferTaskId(info: WorktreeInfo): string {
  if (info.branch.startsWith("forge/")) return info.branch.slice("forge/".length);
  return info.taskId;
}

function normalizePath(p: string): string {
  return resolve(p).replace(/\\/g, "/").toLowerCase();
}
