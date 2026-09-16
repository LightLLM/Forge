import { mkdtempSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { GoalEngine, GoalStore, resolveGoalPlan } from "../src/goal/index.js";
import type { TaskNodeState } from "../src/scheduler/types.js";

const dirs: string[] = [];
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "goal-mvp",
);

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-m11-"));
  dirs.push(dir);
  return dir;
}

function cloneFixture(): string {
  const dir = tempDir();
  cpSync(fixtureRoot, dir, { recursive: true });
  return dir;
}

describe("M11 goal mode", () => {
  it("resolves plan from workspace plan.json", () => {
    const dir = cloneFixture();
    const plan = resolveGoalPlan(
      "Build the MVP described in SPEC.md",
      dir,
      "plan.json",
    );
    expect(plan.nodes.map((n) => n.id)).toEqual(["alpha", "beta", "combine"]);
    expect(plan.nodes.length).toBeGreaterThan(1);
  });

  it("gate: goal decomposes into multiple tasks and completes fixture project", async () => {
    const dir = cloneFixture();
    const dbPath = join(dir, ".forge", "forge.db");
    const store = new GoalStore(dbPath);
    store.initialize();
    const engine = new GoalEngine({
      store,
      workspacePath: dir,
      maxParallelWorkers: 2,
    });

    const goal = engine.create("Build the MVP from plan.json");
    const result = await engine.run(goal.id, "plan.json");

    expect(result.status).toBe("completed");
    expect(result.phase).toBe("completed");
    expect(result.nodesTotal).toBe(3);
    expect(result.nodesCompleted).toBe(3);
    expect(result.verification?.passed).toBe(true);

    expect(readFileSync(join(dir, "src/alpha.ts"), "utf8")).toContain("ALPHA");
    expect(readFileSync(join(dir, "src/beta.ts"), "utf8")).toContain("BETA");
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toContain("./alpha");

    const persisted = store.get(goal.id);
    expect(persisted?.phase).toBe("completed");
    expect(persisted?.graphSnapshot?.every((n) => n.status === "completed")).toBe(
      true,
    );
    store.close();
  });

  it("gate: goals survive restart — resume partial execution to completion", async () => {
    const dir = cloneFixture();
    const dbPath = join(dir, ".forge", "forge.db");
    const store = new GoalStore(dbPath);
    store.initialize();

    const plan = resolveGoalPlan("Build MVP", dir, "plan.json");
    const graphId = "goal-mvp-resume";
    const partialSnapshot: TaskNodeState[] = plan.nodes.map((n, i) => ({
      ...n,
      dependsOn: n.dependsOn ?? [],
      status: i === 0 ? "completed" : i === 1 ? "ready" : "pending",
      summary: i === 0 ? "wrote src/alpha.ts" : undefined,
      finishedAt: i === 0 ? new Date().toISOString() : undefined,
    }));

    // Simulate crash mid-execution: alpha done, beta ready, combine pending
    const seeded = store.create({
      objective: "Build MVP",
      workspacePath: dir,
    });
    store.setPhase(seeded.id, "architecting");
    store.setPhase(seeded.id, "planning");
    store.setPhase(seeded.id, "executing");
    store.updatePlan(seeded.id, plan, graphId);
    store.updateGraphSnapshot(seeded.id, partialSnapshot);

    // Write alpha artifact as if first worker finished before crash
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(
      join(dir, "src/alpha.ts"),
      'export const ALPHA = "alpha";\n',
      "utf8",
    );

    const engine = new GoalEngine({
      store,
      workspacePath: dir,
      maxParallelWorkers: 2,
    });

    const result = await engine.run(seeded.id);
    expect(result.status).toBe("completed");
    expect(result.nodesCompleted).toBe(3);
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toContain("BETA");

    const after = store.get(seeded.id);
    expect(after?.phase).toBe("completed");
    store.close();
  });

  it("persists goal phases in SQLite", () => {
    const dir = tempDir();
    const store = new GoalStore(join(dir, "forge.db"));
    store.initialize();
    const g = store.create({ objective: "test", workspacePath: dir });
    expect(g.phase).toBe("created");
    store.setPhase(g.id, "architecting");
    store.setPhase(g.id, "planning");
    const loaded = store.get(g.id);
    expect(loaded?.phase).toBe("planning");
    store.close();
  });
});
