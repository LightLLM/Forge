import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ForgeDaemon,
  JobStore,
  getDaemonStatus,
  readDaemonState,
} from "../src/daemon/index.js";

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

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "forge-m8-"));
  dirs.push(dir);
  return dir;
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 8_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("waitFor timeout");
}

describe("M8 persistent daemon", () => {
  it("enqueues, claims, completes durable jobs", () => {
    const dir = tempDir();
    const store = new JobStore(join(dir, "forge.db"));
    store.initialize();
    const job = store.enqueue({
      kind: "echo",
      payload: { message: "hi" },
    });
    expect(job.status).toBe("queued");
    const claimed = store.claimNext("w1");
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    store.heartbeat(job.id, "w1");
    const done = store.complete(job.id, "w1", { echoed: "hi" });
    expect(done.status).toBe("completed");
    expect(done.result).toEqual({ echoed: "hi" });
    expect(store.counts().completed).toBe(1);
    store.close();
  });

  it("requeues orphaned running jobs on recovery", () => {
    const dir = tempDir();
    const dbPath = join(dir, "forge.db");
    const store = new JobStore(dbPath);
    store.initialize();
    store.enqueue({ kind: "echo", payload: { message: "a" } });
    store.enqueue({ kind: "echo", payload: { message: "b" } });
    const a = store.claimNext("dead-worker");
    expect(a?.status).toBe("running");
    const recovered = store.recoverOrphans({ forceAllRunning: true });
    expect(recovered).toBe(1);
    expect(store.getJob(a!.id)?.status).toBe("queued");
    expect(store.listJobs({ status: "queued" }).length).toBe(2);
    store.close();
  });

  it("runs write_file jobs through the worker pool", async () => {
    const dir = tempDir();
    const dbPath = join(dir, ".forge", "forge.db");
    const daemon = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 2,
      pollIntervalMs: 50,
      heartbeatIntervalMs: 200,
    });
    const handle = daemon.start();
    handle.store.enqueue({
      kind: "write_file",
      payload: { path: "out/a.txt", content: "A" },
    });
    handle.store.enqueue({
      kind: "write_file",
      payload: { path: "out/b.txt", content: "B" },
    });

    await waitFor(() => handle.store.counts().completed === 2);
    expect(readFileSync(join(dir, "out/a.txt"), "utf8")).toBe("A");
    expect(readFileSync(join(dir, "out/b.txt"), "utf8")).toBe("B");
    expect(readDaemonState(dir)?.status).toBe("running");
    await handle.stop();
    expect(getDaemonStatus(dir).state?.status).toBe("stopped");
  });

  it("gate: terminate and restart mid-workload without losing durable state", async () => {
    const dir = tempDir();
    const dbPath = join(dir, ".forge", "forge.db");

    // Seed queue, then simulate crash: jobs left running by a dead worker
    {
      const seed = new JobStore(dbPath);
      seed.initialize();
      for (let i = 0; i < 4; i++) {
        seed.enqueue({
          kind: "write_file",
          payload: { path: `crash/f${i}.txt`, content: `v${i}` },
          maxAttempts: 5,
        });
      }
      // Claim two as if workers were mid-flight when process died
      seed.claimNext("crashed-1");
      seed.claimNext("crashed-2");
      expect(seed.counts().running).toBe(2);
      expect(seed.counts().queued).toBe(2);
      seed.close();
    }

    // Restart daemon — must recover orphans and finish all work
    const daemon = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 2,
      pollIntervalMs: 40,
      heartbeatIntervalMs: 150,
      recoverOnStart: true,
    });
    const handle = daemon.start();

    await waitFor(() => {
      const c = handle.store.counts();
      return c.completed === 4 && c.running === 0 && c.queued === 0;
    }, 10_000);

    for (let i = 0; i < 4; i++) {
      expect(existsSync(join(dir, `crash/f${i}.txt`))).toBe(true);
      expect(readFileSync(join(dir, `crash/f${i}.txt`), "utf8")).toBe(`v${i}`);
    }

    await handle.stop();
  });

  it("gate: stop mid-flight then restart completes remaining work", async () => {
    const dir = tempDir();
    const dbPath = join(dir, ".forge", "forge.db");
    const daemon1 = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 1,
      pollIntervalMs: 40,
      heartbeatIntervalMs: 100,
    });
    const h1 = daemon1.start();
    for (let i = 0; i < 3; i++) {
      h1.store.enqueue({
        kind: "sleep",
        payload: { ms: 400 },
        maxAttempts: 5,
      });
    }

    await waitFor(() => h1.store.counts().running >= 1, 5_000);
    await h1.stop();

    const afterStop = new JobStore(dbPath);
    afterStop.initialize();
    const mid = afterStop.counts();
    // Work must remain durable (queued or completed), not silently lost
    expect(mid.queued + mid.completed + mid.running + mid.failed).toBe(3);
    expect(mid.completed).toBeLessThan(3);
    afterStop.close();

    const daemon2 = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 2,
      pollIntervalMs: 40,
      heartbeatIntervalMs: 100,
      recoverOnStart: true,
    });
    const h2 = daemon2.start();
    await waitFor(() => h2.store.counts().completed === 3, 12_000);
    await h2.stop();
  });

  it("refuses a second daemon while one is alive", async () => {
    const dir = tempDir();
    const dbPath = join(dir, ".forge", "forge.db");
    const d1 = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 1,
      pollIntervalMs: 100,
    });
    const h1 = d1.start();
    const d2 = new ForgeDaemon({
      workspacePath: dir,
      dbPath,
      maxWorkers: 1,
    });
    expect(() => d2.start()).toThrow(/already running/i);
    await h1.stop();
  });
});
