import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runGit } from "../src/workspace/git.js";
import { WorktreeManager } from "../src/workspace/worktree.js";
import { WorkspaceLease } from "../src/workspace/lease.js";
import { ConflictDetector } from "../src/workspace/conflict.js";
import { IntegrationManager } from "../src/workspace/integration.js";
import { ForgeError } from "../src/core/types.js";

const dirs: string[] = [];

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

async function initRepo(): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "forge-m4-"));
  dirs.push(dir);
  await runGit(dir, ["init"]);
  await runGit(dir, ["config", "user.email", "forge@test.local"]);
  await runGit(dir, ["config", "user.name", "Forge Test"]);
  writeFileSync(join(dir, "README.md"), "# fixture\n", "utf8");
  await runGit(dir, ["add", "README.md"]);
  await runGit(dir, ["commit", "-m", "init"]);
  return dir;
}

describe("M4 worktrees", () => {
  it("E2E: two isolated workers modify independent worktrees without interference", async () => {
    const repo = await initRepo();
    const manager = new WorktreeManager(repo);

    const a = await manager.createForTask("task-aaa111");
    const b = await manager.createForTask("task-bbb222");

    expect(a.path).not.toBe(b.path);
    expect(a.branch).not.toBe(b.branch);
    expect(existsSync(a.path)).toBe(true);
    expect(existsSync(b.path)).toBe(true);

    // Concurrent leases on distinct worktree paths succeed
    const leaseA = WorkspaceLease.acquire(a.path, "task-aaa111", 60_000);
    const leaseB = WorkspaceLease.acquire(b.path, "task-bbb222", 60_000);

    writeFileSync(join(a.path, "worker-a.ts"), "export const a = 1;\n", "utf8");
    writeFileSync(join(b.path, "worker-b.ts"), "export const b = 2;\n", "utf8");

    expect(existsSync(join(a.path, "worker-a.ts"))).toBe(true);
    expect(existsSync(join(a.path, "worker-b.ts"))).toBe(false);
    expect(existsSync(join(b.path, "worker-b.ts"))).toBe(true);
    expect(existsSync(join(b.path, "worker-a.ts"))).toBe(false);
    expect(existsSync(join(repo, "worker-a.ts"))).toBe(false);
    expect(existsSync(join(repo, "worker-b.ts"))).toBe(false);

    const detector = new ConflictDetector();
    const overlaps = await detector.overlappingPaths(a.path, b.path);
    expect(overlaps).toEqual([]);

    const plan = await new IntegrationManager().plan([a.path, b.path]);
    expect(plan.safeToIntegrate).toBe(true);

    leaseA.release();
    leaseB.release();
  });

  it("refuses a second lease on the same workspace path", () => {
    const dir = mkdtempSync(join(tmpdir(), "forge-m4-lease-"));
    dirs.push(dir);
    writeFileSync(join(dir, "x.txt"), "x", "utf8");
    const first = WorkspaceLease.acquire(dir, "holder-1", 60_000);
    expect(() => WorkspaceLease.acquire(dir, "holder-2", 60_000)).toThrow(ForgeError);
    first.release();
    const second = WorkspaceLease.acquire(dir, "holder-2", 60_000);
    expect(second.record.holderId).toBe("holder-2");
    second.release();
  });

  it("detects overlapping file changes across worktrees", async () => {
    const repo = await initRepo();
    const manager = new WorktreeManager(repo);
    const a = await manager.createForTask("overlap-a");
    const b = await manager.createForTask("overlap-b");

    writeFileSync(join(a.path, "shared.ts"), "export const v = 1;\n", "utf8");
    writeFileSync(join(b.path, "shared.ts"), "export const v = 2;\n", "utf8");

    const overlaps = await new ConflictDetector().overlappingPaths(a.path, b.path);
    expect(overlaps).toContain("shared.ts");

    const plan = await new IntegrationManager().plan([a.path, b.path]);
    expect(plan.safeToIntegrate).toBe(false);
  });

  it("refuses to remove a dirty worktree without force", async () => {
    const repo = await initRepo();
    const manager = new WorktreeManager(repo);
    const wt = await manager.createForTask("dirty-task");
    writeFileSync(join(wt.path, "dirty.txt"), "nope\n", "utf8");
    await expect(manager.remove("dirty-task")).rejects.toThrow(/uncommitted/i);
    const forced = await manager.remove("dirty-task", { force: true });
    expect(forced.removed).toBe(true);
    expect(existsSync(wt.path)).toBe(false);
  });

  it("cleanupAbandoned skips dirty trees unless force", async () => {
    const repo = await initRepo();
    const manager = new WorktreeManager(repo);
    const wt = await manager.createForTask("abandon-1");
    writeFileSync(join(wt.path, "keep.txt"), "keep\n", "utf8");
    const dry = await manager.cleanupAbandoned({ dryRun: true });
    expect(dry.some((a) => a.action === "skipped-dirty" || a.action === "would-force-remove")).toBe(
      true,
    );
    const skipped = await manager.cleanupAbandoned();
    expect(skipped.some((a) => a.action === "skipped-dirty")).toBe(true);
    expect(existsSync(wt.path)).toBe(true);
  });

  it("lists only Forge worktrees under worktreeBase", async () => {
    const repo = await initRepo();
    const manager = new WorktreeManager(repo);
    await manager.createForTask("list-1");
    await manager.createForTask("list-2");
    const list = await manager.list();
    expect(list.length).toBe(2);
    expect(list.every((i) => i.path.includes(".forge"))).toBe(true);
  });
});
