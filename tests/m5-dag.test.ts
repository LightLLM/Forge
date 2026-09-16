import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  DeterministicDecomposer,
  TaskGraph,
  TaskScheduler,
  runTaskGraph,
  loadSpec,
} from "../src/scheduler/index.js";
import {
  createDirectiveExecutor,
  createInstrumentedExecutor,
} from "../src/scheduler/executors.js";
import { ForgeError } from "../src/core/types.js";

const dirs: string[] = [];
const fixturePlan = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "multi-part-plan",
  "plan.json",
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
  const dir = mkdtempSync(join(tmpdir(), "forge-m5-"));
  dirs.push(dir);
  return dir;
}

describe("M5 task DAG + parallel workers", () => {
  it("rejects cycles and missing dependencies", () => {
    expect(
      () =>
        new TaskGraph({
          objective: "bad",
          nodes: [
            { id: "a", objective: "A", dependsOn: ["b"] },
            { id: "b", objective: "B", dependsOn: ["a"] },
          ],
        }),
    ).toThrow(ForgeError);

    expect(
      () =>
        new TaskGraph({
          objective: "bad",
          nodes: [{ id: "a", objective: "A", dependsOn: ["missing"] }],
        }),
    ).toThrow(/missing/i);
  });

  it("keeps dependents pending until deps complete", async () => {
    const graph = new TaskGraph({
      objective: "order",
      nodes: [
        { id: "a", objective: "write:a.txt:A", dependsOn: [] },
        { id: "b", objective: "write:b.txt:B", dependsOn: ["a"] },
      ],
    });
    expect(graph.readyNodes().map((n) => n.id)).toEqual(["a"]);
    const dir = tempDir();
    const scheduler = new TaskScheduler({ maxParallelWorkers: 2 });
    const result = await scheduler.run(graph, createDirectiveExecutor(dir));
    expect(result.status).toBe("completed");
    expect(result.nodes.find((n) => n.id === "a")?.status).toBe("completed");
    expect(result.nodes.find((n) => n.id === "b")?.status).toBe("completed");
    expect(readFileSync(join(dir, "b.txt"), "utf8")).toBe("B");
  });

  it("runs independent nodes in parallel (maxParallelObserved >= 2)", async () => {
    const graph = new TaskGraph({
      objective: "parallel",
      nodes: [
        { id: "a", objective: "write:a.txt:A", dependsOn: [] },
        { id: "b", objective: "write:b.txt:B", dependsOn: [] },
      ],
    });
    const dir = tempDir();
    const events: string[] = [];
    const started: number[] = [];
    const scheduler = new TaskScheduler({
      maxParallelWorkers: 2,
      onEvent: (e) => {
        if (e.type === "node_started") {
          events.push(`start:${e.node.id}:${e.parallelSlot}`);
          started.push(Date.now());
        }
      },
    });
    const executor = createInstrumentedExecutor(createDirectiveExecutor(dir), 150);
    const t0 = Date.now();
    const result = await scheduler.run(graph, executor);
    const elapsed = Date.now() - t0;
    expect(result.status).toBe("completed");
    expect(result.maxParallelObserved).toBe(2);
    expect(elapsed).toBeLessThan(280); // serial would be ~300ms+
    expect(events.some((e) => e.endsWith(":2"))).toBe(true);
  });

  it("blocks dependents when a dependency fails", async () => {
    const dir = tempDir();
    const graph = new TaskGraph({
      objective: "fail-chain",
      nodes: [
        { id: "a", objective: "nope", dependsOn: [] },
        { id: "b", objective: "write:b.txt:B", dependsOn: ["a"] },
      ],
    });
    const result = await new TaskScheduler({ maxParallelWorkers: 2 }).run(
      graph,
      createDirectiveExecutor(dir),
    );
    expect(result.status).toBe("failed");
    expect(result.nodes.find((n) => n.id === "a")?.status).toBe("failed");
    expect(result.nodes.find((n) => n.id === "b")?.status).toBe("blocked");
    expect(existsSync(join(dir, "b.txt"))).toBe(false);
  });

  it("respects maxParallelWorkers cap", async () => {
    const graph = new TaskGraph({
      objective: "cap",
      nodes: [
        { id: "a", objective: "write:a.txt:A", dependsOn: [] },
        { id: "b", objective: "write:b.txt:B", dependsOn: [] },
        { id: "c", objective: "write:c.txt:C", dependsOn: [] },
      ],
    });
    const result = await new TaskScheduler({ maxParallelWorkers: 1 }).run(
      graph,
      createInstrumentedExecutor(createDirectiveExecutor(tempDir()), 40),
    );
    expect(result.status).toBe("completed");
    expect(result.maxParallelObserved).toBe(1);
  });

  it("E2E gate: multi-part fixture completes with parallel alpha/beta then combine", async () => {
    const dir = tempDir();
    const result = await runTaskGraph({
      objective: "fixture",
      workspacePath: dir,
      maxParallelWorkers: 2,
      plan: fixturePlan,
      executor: createDirectiveExecutor(dir),
    });
    expect(result.status).toBe("completed");
    expect(result.maxParallelObserved).toBe(2);
    expect(result.nodes.every((n) => n.status === "completed")).toBe(true);
    expect(readFileSync(join(dir, "src/alpha.ts"), "utf8")).toContain("ALPHA");
    expect(readFileSync(join(dir, "src/beta.ts"), "utf8")).toContain("BETA");
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toContain("./alpha");
    expect(readFileSync(join(dir, "src/index.ts"), "utf8")).toContain("./beta");
  });

  it("decomposes numbered / then objectives", () => {
    const d = new DeterministicDecomposer();
    const numbered = d.decompose("1. Setup schema\n2. Add API\n3. Add UI");
    expect(numbered.nodes).toHaveLength(3);
    expect(numbered.nodes[2]!.dependsOn).toEqual(["step-2"]);

    const then = d.decompose("create alpha then create beta then combine");
    expect(then.nodes).toHaveLength(3);
    expect(then.nodes[0]!.dependsOn).toEqual([]);
  });

  it("loadSpec reads fixture plan JSON", () => {
    const spec = loadSpec("x", fixturePlan);
    expect(spec.nodes.map((n) => n.id)).toEqual(["alpha", "beta", "combine"]);
  });
});
