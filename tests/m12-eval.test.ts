import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  BUILTIN_EVAL_DATASET,
  EvalRunner,
  EvalStore,
  loadEvalDataset,
} from "../src/eval/index.js";

const dirs: string[] = [];
const fixtureDataset = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "eval",
  "basic.json",
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
  const dir = mkdtempSync(join(tmpdir(), "forge-m12-"));
  dirs.push(dir);
  return dir;
}

describe("M12 model evaluation", () => {
  it("gate: fake models can be compared deterministically", async () => {
    const runner = new EvalRunner();
    const report = await runner.run(BUILTIN_EVAL_DATASET);

    expect(report.summaries).toHaveLength(2);
    const good = report.summaries.find((s) => s.modelId === "good-fake")!;
    const bad = report.summaries.find((s) => s.modelId === "bad-fake")!;
    expect(good.passRate).toBe(1);
    expect(bad.passRate).toBe(0);
    expect(good.passRate).toBeGreaterThan(bad.passRate);

    // Deterministic re-run (ignore wall-clock latency jitter)
    const report2 = await runner.run(BUILTIN_EVAL_DATASET);
    expect(
      report2.summaries.map(({ modelId, passRate, passed, failed }) => ({
        modelId,
        passRate,
        passed,
        failed,
      })),
    ).toEqual(
      report.summaries.map(({ modelId, passRate, passed, failed }) => ({
        modelId,
        passRate,
        passed,
        failed,
      })),
    );
  });

  it("loads fixture dataset and persists report", async () => {
    const dir = tempDir();
    const dataset = loadEvalDataset(fixtureDataset);
    const report = await new EvalRunner().run(dataset);

    const store = new EvalStore(join(dir, "forge.db"));
    store.initialize();
    store.saveReport(report);
    const loaded = store.getRun(report.runId);
    store.close();

    expect(loaded?.datasetId).toBe("basic-fake");
    expect(loaded?.summaries.length).toBe(2);
  });
});
