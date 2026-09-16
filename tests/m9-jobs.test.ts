import { mkdtempSync, rmSync, readFileSync, existsSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { ForgeDaemon } from "../src/daemon/index.js";
import {
  ANALYSIS_CATALOG,
  JobScheduler,
  ScheduleStore,
  runAnalysis,
  writeAnalysisArtifact,
} from "../src/jobs/index.js";
import { JobStore } from "../src/daemon/job-store.js";

const dirs: string[] = [];
const fixtureRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "scheduled-repo",
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
  const dir = mkdtempSync(join(tmpdir(), "forge-m9-"));
  dirs.push(dir);
  return dir;
}

function cloneFixture(): string {
  const dir = tempDir();
  cpSync(fixtureRoot, dir, { recursive: true });
  return dir;
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 10_000,
  intervalMs = 40,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

describe("M9 background jobs", () => {
  it("exposes a catalog of engineering analyses", () => {
    expect(ANALYSIS_CATALOG.length).toBeGreaterThanOrEqual(5);
    expect(ANALYSIS_CATALOG.map((a) => a.id)).toContain("todo_analysis");
  });

  it("runs fixture analyses and records artifacts/proposals", () => {
    const dir = cloneFixture();
    const todo = runAnalysis("todo_analysis", dir);
    expect(todo.findings.length).toBeGreaterThan(0);
    expect(todo.summary.toLowerCase()).toMatch(/todo|marker/);

    const deps = runAnalysis("dependency_audit", dir);
    expect(deps.findings.some((f) => /lockfile/i.test(f.title))).toBe(true);
    expect(deps.findings.some((f) => /unbounded/i.test(f.title))).toBe(true);

    const sec = runAnalysis("security_scan", dir);
    expect(sec.findings.length).toBeGreaterThan(0);

    const summary = runAnalysis("repo_summary", dir);
    expect(Number(summary.metrics.files)).toBeGreaterThan(0);

    const artifact = writeAnalysisArtifact(dir, todo, "test-job");
    expect(existsSync(artifact)).toBe(true);
    const saved = JSON.parse(readFileSync(artifact, "utf8")) as {
      analysisId: string;
      findings: unknown[];
    };
    expect(saved.analysisId).toBe("todo_analysis");
    expect(saved.findings.length).toBeGreaterThan(0);
    expect(
      existsSync(join(dir, ".forge", "proposals")),
    ).toBe(true);
  });

  it("scheduler enqueues due schedules as analysis jobs", () => {
    const dir = tempDir();
    const dbPath = join(dir, "forge.db");
    const jobs = new JobStore(dbPath);
    jobs.initialize();
    const schedules = new ScheduleStore(dbPath);
    schedules.initialize();
    schedules.create({
      name: "fixture todo",
      analysisId: "todo_analysis",
      everyMs: 60_000,
      nextRunAt: new Date(Date.now() - 1_000).toISOString(),
    });
    const scheduler = new JobScheduler({ scheduleStore: schedules, jobStore: jobs });
    const { fired, jobIds } = scheduler.tick();
    expect(fired).toHaveLength(1);
    expect(jobIds).toHaveLength(1);
    const job = jobs.getJob(jobIds[0]!);
    expect(job?.kind).toBe("analysis");
    expect(job?.payload.analysisId).toBe("todo_analysis");
    expect(fired[0]!.runCount).toBe(1);
    // Not due again until everyMs elapses
    expect(scheduler.tick().fired).toHaveLength(0);
    jobs.close();
    schedules.close();
  });

  it("gate: scheduled fixture job executes and records results", async () => {
    const dir = cloneFixture();
    const dbPath = join(dir, ".forge", "forge.db");
    const daemon = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 2,
      pollIntervalMs: 40,
      heartbeatIntervalMs: 120,
      schedulesEnabled: true,
    });
    const handle = daemon.start();
    handle.schedules.create({
      name: "nightly todo",
      analysisId: "todo_analysis",
      everyMs: 60_000,
      nextRunAt: new Date(Date.now() - 500).toISOString(),
    });

    await waitFor(() => {
      const completed = handle.store.listJobs({ status: "completed", limit: 20 });
      return completed.some(
        (j) => j.kind === "analysis" && j.payload.analysisId === "todo_analysis",
      );
    });

    const done = handle.store
      .listJobs({ status: "completed", limit: 20 })
      .find((j) => j.kind === "analysis");
    expect(done?.result).toBeTruthy();
    expect(done?.result?.analysisId).toBe("todo_analysis");
    expect(Number(done?.result?.findings)).toBeGreaterThan(0);
    const artifactPath = done?.result?.artifactPath;
    expect(typeof artifactPath).toBe("string");
    expect(existsSync(String(artifactPath))).toBe(true);

    const schedule = handle.schedules.list()[0]!;
    expect(schedule.runCount).toBeGreaterThanOrEqual(1);
    expect(schedule.lastJobId).toBe(done?.id);

    await handle.stop();
  });

  it("analyses propose changes and do not rewrite package.json", () => {
    const dir = cloneFixture();
    const before = readFileSync(join(dir, "package.json"), "utf8");
    runAnalysis("dependency_audit", dir);
    const after = readFileSync(join(dir, "package.json"), "utf8");
    expect(after).toBe(before);
  });
});
