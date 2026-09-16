import { randomUUID } from "node:crypto";
import type { Logger } from "../telemetry/logger.js";
import { JobStore } from "./job-store.js";
import {
  clearDaemonState,
  isPidAlive,
  readDaemonState,
  writeDaemonState,
} from "./runtime-state.js";
import { createBuiltinExecutor } from "./executors.js";
import type { DaemonRuntimeState, JobExecutor } from "./types.js";
import { ForgeError } from "../core/types.js";
import { JobScheduler, ScheduleStore } from "../jobs/index.js";

export interface ForgeDaemonOptions {
  workspacePath: string;
  dbPath: string;
  maxWorkers?: number;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  /** Jobs without heartbeat for this long are treated as orphans. */
  staleJobMs?: number;
  /** When false, skip firing due schedules. Default true. */
  schedulesEnabled?: boolean;
  executor?: JobExecutor;
  logger?: Logger;
  /** When true, recover all running jobs on start (crash restart). Default true. */
  recoverOnStart?: boolean;
}

export interface ForgeDaemonHandle {
  /** Resolves when the daemon loop exits. */
  done: Promise<void>;
  stop(): Promise<void>;
  store: JobStore;
  schedules: ScheduleStore;
  scheduler: JobScheduler;
  getState(): DaemonRuntimeState | null;
}

/**
 * Persistent Forge daemon: durable job queue, worker pool, crash recovery,
 * and scheduled background engineering analyses.
 */
export class ForgeDaemon {
  private readonly opts: Required<
    Pick<
      ForgeDaemonOptions,
      | "workspacePath"
      | "dbPath"
      | "maxWorkers"
      | "pollIntervalMs"
      | "heartbeatIntervalMs"
      | "staleJobMs"
      | "recoverOnStart"
      | "schedulesEnabled"
    >
  > & {
    executor: JobExecutor;
    logger?: Logger;
  };
  private store: JobStore | null = null;
  private scheduleStore: ScheduleStore | null = null;
  private stopping = false;
  private active = new Map<string, AbortController>();
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private stateHeartbeat: ReturnType<typeof setInterval> | null = null;

  constructor(options: ForgeDaemonOptions) {
    this.opts = {
      workspacePath: options.workspacePath,
      dbPath: options.dbPath,
      maxWorkers: options.maxWorkers ?? 2,
      pollIntervalMs: options.pollIntervalMs ?? 200,
      heartbeatIntervalMs: options.heartbeatIntervalMs ?? 2_000,
      staleJobMs: options.staleJobMs ?? 30_000,
      recoverOnStart: options.recoverOnStart ?? true,
      schedulesEnabled: options.schedulesEnabled ?? true,
      executor: options.executor ?? createBuiltinExecutor(),
      logger: options.logger,
    };
  }

  /**
   * Start the daemon loop. Returns a handle; call stop() for graceful shutdown.
   * On start, orphaned running jobs are requeued so crash restart preserves work.
   */
  start(): ForgeDaemonHandle {
    const existing = readDaemonState(this.opts.workspacePath);
    if (existing && existing.status !== "stopped" && isPidAlive(existing.pid)) {
      throw new ForgeError(
        `Daemon already running (pid ${existing.pid})`,
        "DAEMON_ALREADY_RUNNING",
        { pid: existing.pid },
      );
    }

    const store = new JobStore(this.opts.dbPath);
    store.initialize();
    this.store = store;

    const scheduleStore = new ScheduleStore(this.opts.dbPath);
    scheduleStore.initialize();
    this.scheduleStore = scheduleStore;

    const scheduler = new JobScheduler({
      scheduleStore,
      jobStore: store,
      logger: this.opts.logger,
    });

    this.stopping = false;

    let recovered = 0;
    if (this.opts.recoverOnStart) {
      recovered = store.recoverOrphans({ forceAllRunning: true });
      this.opts.logger?.info("daemon recovered orphaned jobs", { recovered });
    }

    const startedAt = new Date().toISOString();
    const writeState = (patch: Partial<DaemonRuntimeState> = {}) => {
      const state: DaemonRuntimeState = {
        pid: process.pid,
        status: this.stopping ? "stopping" : "running",
        workspacePath: this.opts.workspacePath,
        dbPath: this.opts.dbPath,
        startedAt,
        heartbeatAt: new Date().toISOString(),
        maxWorkers: this.opts.maxWorkers,
        activeWorkers: this.active.size,
        ...patch,
      };
      writeDaemonState(this.opts.workspacePath, state);
      return state;
    };

    writeState({ status: "starting" });
    writeState({ status: "running" });
    this.opts.logger?.info("daemon started", {
      pid: process.pid,
      maxWorkers: this.opts.maxWorkers,
      recovered,
      schedulesEnabled: this.opts.schedulesEnabled,
    });

    this.stateHeartbeat = setInterval(() => {
      if (!this.stopping) writeState();
    }, this.opts.heartbeatIntervalMs);

    let resolveDone!: () => void;
    const done = new Promise<void>((r) => {
      resolveDone = r;
    });

    const tick = async () => {
      if (this.stopping) return;
      try {
        if (this.opts.schedulesEnabled) {
          scheduler.tick();
        }
        store.recoverOrphans({ staleAfterMs: this.opts.staleJobMs });

        while (!this.stopping && this.active.size < this.opts.maxWorkers) {
          const workerId = `w-${process.pid}-${randomUUID().slice(0, 8)}`;
          const job = store.claimNext(workerId);
          if (!job) break;
          const ac = new AbortController();
          this.active.set(job.id, ac);
          writeState();
          void this.runJob(store, job.id, workerId, ac)
            .catch((err: unknown) => {
              this.opts.logger?.error("daemon worker error", {
                jobId: job.id,
                error: err instanceof Error ? err.message : String(err),
              });
            })
            .finally(() => {
              this.active.delete(job.id);
              writeState();
            });
        }
      } catch (err) {
        this.opts.logger?.error("daemon tick failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        writeState({
          lastError: err instanceof Error ? err.message : String(err),
        });
      }

      if (!this.stopping) {
        this.loopTimer = setTimeout(() => {
          void tick();
        }, this.opts.pollIntervalMs);
      }
    };

    void tick();

    const stop = async () => {
      if (this.stopping) {
        await done;
        return;
      }
      this.stopping = true;
      writeState({ status: "stopping" });
      if (this.loopTimer) {
        clearTimeout(this.loopTimer);
        this.loopTimer = null;
      }
      if (this.stateHeartbeat) {
        clearInterval(this.stateHeartbeat);
        this.stateHeartbeat = null;
      }
      for (const ac of this.active.values()) {
        ac.abort();
      }
      const deadline = Date.now() + 5_000;
      while (this.active.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      store.recoverOrphans({ forceAllRunning: true });
      writeDaemonState(this.opts.workspacePath, {
        pid: process.pid,
        status: "stopped",
        workspacePath: this.opts.workspacePath,
        dbPath: this.opts.dbPath,
        startedAt,
        heartbeatAt: new Date().toISOString(),
        maxWorkers: this.opts.maxWorkers,
        activeWorkers: 0,
      });
      scheduleStore.close();
      this.scheduleStore = null;
      store.close();
      this.store = null;
      this.opts.logger?.info("daemon stopped");
      resolveDone();
    };

    return {
      done,
      stop,
      store,
      schedules: scheduleStore,
      scheduler,
      getState: () => readDaemonState(this.opts.workspacePath),
    };
  }

  private async runJob(
    store: JobStore,
    jobId: string,
    workerId: string,
    ac: AbortController,
  ): Promise<void> {
    const job = store.getJob(jobId);
    if (!job || job.status !== "running") return;

    const hbTimer = setInterval(() => {
      try {
        store.heartbeat(jobId, workerId);
      } catch {
        // job may have completed
      }
    }, Math.max(100, Math.floor(this.opts.heartbeatIntervalMs / 2)));

    try {
      const result = await this.opts.executor({
        job,
        workspacePath: this.opts.workspacePath,
        signal: ac.signal,
        heartbeat: () => {
          try {
            store.heartbeat(jobId, workerId);
          } catch {
            // ignore
          }
        },
      });
      store.complete(jobId, workerId, result ?? {});
      this.opts.logger?.info("job completed", { jobId, kind: job.kind });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const aborted = ac.signal.aborted;
      try {
        store.fail(jobId, workerId, message, true);
      } catch {
        // Job may already be recovered/completed
      }
      this.opts.logger?.warn("job failed", {
        jobId,
        kind: job.kind,
        error: message,
        aborted,
      });
    } finally {
      clearInterval(hbTimer);
    }
  }
}

export function getDaemonStatus(workspacePath: string): {
  state: DaemonRuntimeState | null;
  alive: boolean;
  counts?: ReturnType<JobStore["counts"]>;
} {
  const state = readDaemonState(workspacePath);
  if (!state) {
    return { state: null, alive: false };
  }
  const alive = state.status !== "stopped" && isPidAlive(state.pid);
  let counts: ReturnType<JobStore["counts"]> | undefined;
  try {
    const store = new JobStore(state.dbPath);
    store.initialize();
    counts = store.counts();
    store.close();
  } catch {
    // db may be locked or missing
  }
  return { state, alive, counts };
}

export { clearDaemonState };
