import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { WorktreeManager } from "../../workspace/worktree.js";
import { WorkspaceLease } from "../../workspace/lease.js";
import { ConflictDetector } from "../../workspace/conflict.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerWorktrees(program: Command): void {
  const wt = program
    .command("worktrees")
    .description("Manage Forge git worktrees and workspace leases");

  wt.command("list")
    .description("List Forge-managed worktrees")
    .action(async () => {
      const { manager } = open();
      try {
        const list = await manager.list();
        if (list.length === 0) {
          console.log("No Forge worktrees found.");
          return;
        }
        for (const i of list) {
          console.log(`${i.branch.padEnd(24)} ${i.path}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  wt.command("cleanup")
    .description("Clean abandoned Forge worktrees (skips dirty unless --force)")
    .option("--force", "Allow removing dirty worktrees", false)
    .option("--dry-run", "Show actions without removing", false)
    .action(async (opts: { force: boolean; dryRun: boolean }) => {
      const { manager } = open();
      try {
        const actions = await manager.cleanupAbandoned({
          force: opts.force,
          dryRun: opts.dryRun,
        });
        if (actions.length === 0) {
          console.log("Nothing to clean.");
          return;
        }
        for (const a of actions) {
          console.log(`${a.action.padEnd(20)} ${a.path}`);
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  wt.command("leases")
    .description("Show lease for the current workspace path")
    .action(() => {
      const workspace = resolveWorkspace();
      const lease = WorkspaceLease.peek(workspace);
      if (!lease) {
        console.log("No active lease for this workspace.");
        return;
      }
      console.log(JSON.stringify(lease, null, 2));
    });

  wt.command("conflicts")
    .description("Detect overlapping changed paths between two worktrees")
    .argument("<path-a>", "First worktree path")
    .argument("<path-b>", "Second worktree path")
    .action(async (a: string, b: string) => {
      try {
        const overlaps = await new ConflictDetector().overlappingPaths(a, b);
        if (overlaps.length === 0) {
          console.log("No overlapping changed paths.");
          return;
        }
        for (const p of overlaps) console.log(p);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}

function open() {
  const workspace = resolveWorkspace();
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  const manager = new WorktreeManager(workspace, {
    worktreeBase: config.git.worktreeBase,
  });
  return { manager, workspace, config };
}
