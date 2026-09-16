import { spawn } from "node:child_process";
import type { Workspace } from "./workspace.js";

/**
 * Forge-owned git helpers. These are not model tools — branch names are validated
 * and only safe, non-destructive operations are performed.
 */

export function sanitizeTaskBranchName(taskId: string): string {
  const short = taskId.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 12) || "task";
  return `forge/${short}`;
}

export async function createTaskBranch(
  workspace: Workspace,
  taskId: string,
): Promise<{ branch: string; created: boolean; detail: string }> {
  const branch = sanitizeTaskBranchName(taskId);

  const status = await runGit(workspace.root, ["rev-parse", "--is-inside-work-tree"]);
  if (status.exitCode !== 0 || !status.stdout.includes("true")) {
    return { branch, created: false, detail: "not a git repository" };
  }

  const current = await runGit(workspace.root, ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (current.stdout.trim() === branch) {
    return { branch, created: false, detail: "already on task branch" };
  }

  // Prefer switch -c; fall back to checkout -b.
  const created = await runGit(workspace.root, ["switch", "-c", branch]);
  if (created.exitCode === 0) {
    return { branch, created: true, detail: "created with git switch -c" };
  }

  const fallback = await runGit(workspace.root, ["checkout", "-b", branch]);
  if (fallback.exitCode === 0) {
    return { branch, created: true, detail: "created with git checkout -b" };
  }

  return {
    branch,
    created: false,
    detail: `failed: ${fallback.stderr || created.stderr || "unknown error"}`,
  };
}

function runGit(
  cwd: string,
  args: string[],
): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c: Buffer) => {
      stdout += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      stderr += c.toString("utf8");
    });
    child.on("error", (err) => {
      resolve({ exitCode: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ exitCode: code, stdout, stderr });
    });
  });
}
