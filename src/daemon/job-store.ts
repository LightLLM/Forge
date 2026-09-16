import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { EnqueueJobInput, JobKind, JobRecord, JobStatus } from "./types.js";
import { ForgeError } from "../core/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function rowToJob(row: {
  id: string;
  kind: string;
  payload: string;
  status: string;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  leased_at: string | null;
  heartbeat_at: string | null;
  result: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}): JobRecord {
  return {
    id: row.id,
    kind: row.kind as JobKind,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status as JobStatus,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    workerId: row.worker_id,
    leasedAt: row.leased_at,
    heartbeatAt: row.heartbeat_at,
    result: row.result ? (JSON.parse(row.result) as Record<string, unknown>) : null,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/**
 * Durable job queue persisted in SQLite (same DB file as Forge tasks by default).
 */
export class JobStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daemon_jobs (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        worker_id TEXT,
        leased_at TEXT,
        heartbeat_at TEXT,
        result TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_jobs_status ON daemon_jobs(status);
      CREATE INDEX IF NOT EXISTS idx_daemon_jobs_heartbeat ON daemon_jobs(heartbeat_at);
    `);
  }

  close(): void {
    this.db.close();
  }

  enqueue(input: EnqueueJobInput): JobRecord {
    const ts = nowIso();
    const record: JobRecord = {
      id: randomUUID(),
      kind: input.kind,
      payload: input.payload ?? {},
      status: "queued",
      attempts: 0,
      maxAttempts: input.maxAttempts ?? 3,
      workerId: null,
      leasedAt: null,
      heartbeatAt: null,
      result: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO daemon_jobs (
          id, kind, payload, status, attempts, max_attempts, worker_id,
          leased_at, heartbeat_at, result, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.kind,
        JSON.stringify(record.payload),
        record.status,
        record.attempts,
        record.maxAttempts,
        record.workerId,
        record.leasedAt,
        record.heartbeatAt,
        null,
        null,
        record.createdAt,
        record.updatedAt,
        null,
      );
    return record;
  }

  getJob(id: string): JobRecord | null {
    const row = this.db.prepare(`SELECT * FROM daemon_jobs WHERE id = ?`).get(id) as
      | Parameters<typeof rowToJob>[0]
      | undefined;
    return row ? rowToJob(row) : null;
  }

  listJobs(opts?: { status?: JobStatus; limit?: number }): JobRecord[] {
    const limit = opts?.limit ?? 100;
    if (opts?.status) {
      const rows = this.db
        .prepare(
          `SELECT * FROM daemon_jobs WHERE status = ? ORDER BY created_at ASC LIMIT ?`,
        )
        .all(opts.status, limit) as Parameters<typeof rowToJob>[0][];
      return rows.map(rowToJob);
    }
    const rows = this.db
      .prepare(`SELECT * FROM daemon_jobs ORDER BY created_at ASC LIMIT ?`)
      .all(limit) as Parameters<typeof rowToJob>[0][];
    return rows.map(rowToJob);
  }

  /**
   * Atomically claim the oldest queued job for a worker.
   */
  claimNext(workerId: string): JobRecord | null {
    const ts = nowIso();
    const tx = this.db.prepare("BEGIN IMMEDIATE");
    const commit = this.db.prepare("COMMIT");
    const rollback = this.db.prepare("ROLLBACK");
    tx.run();
    try {
      const row = this.db
        .prepare(
          `SELECT * FROM daemon_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1`,
        )
        .get() as Parameters<typeof rowToJob>[0] | undefined;
      if (!row) {
        commit.run();
        return null;
      }
      this.db
        .prepare(
          `UPDATE daemon_jobs SET
            status = 'running',
            attempts = attempts + 1,
            worker_id = ?,
            leased_at = ?,
            heartbeat_at = ?,
            updated_at = ?,
            error = NULL
          WHERE id = ? AND status = 'queued'`,
        )
        .run(workerId, ts, ts, ts, row.id);
      const updated = this.db
        .prepare(`SELECT * FROM daemon_jobs WHERE id = ?`)
        .get(row.id) as Parameters<typeof rowToJob>[0];
      commit.run();
      return rowToJob(updated);
    } catch (err) {
      try {
        rollback.run();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  heartbeat(jobId: string, workerId: string): void {
    const ts = nowIso();
    const result = this.db
      .prepare(
        `UPDATE daemon_jobs SET heartbeat_at = ?, updated_at = ?
         WHERE id = ? AND worker_id = ? AND status = 'running'`,
      )
      .run(ts, ts, jobId, workerId);
    if (result.changes === 0) {
      throw new ForgeError(`Cannot heartbeat job ${jobId}`, "JOB_HEARTBEAT_FAILED", {
        jobId,
        workerId,
      });
    }
  }

  complete(jobId: string, workerId: string, result?: Record<string, unknown>): JobRecord {
    const ts = nowIso();
    const r = this.db
      .prepare(
        `UPDATE daemon_jobs SET
          status = 'completed',
          result = ?,
          error = NULL,
          updated_at = ?,
          completed_at = ?,
          worker_id = NULL,
          leased_at = NULL,
          heartbeat_at = NULL
         WHERE id = ? AND worker_id = ? AND status = 'running'`,
      )
      .run(JSON.stringify(result ?? {}), ts, ts, jobId, workerId);
    if (r.changes === 0) {
      throw new ForgeError(`Cannot complete job ${jobId}`, "JOB_COMPLETE_FAILED", {
        jobId,
        workerId,
      });
    }
    const job = this.getJob(jobId);
    if (!job) throw new ForgeError(`Job missing after complete: ${jobId}`, "JOB_MISSING");
    return job;
  }

  fail(jobId: string, workerId: string, error: string, requeue: boolean): JobRecord {
    const ts = nowIso();
    const current = this.getJob(jobId);
    if (!current) {
      throw new ForgeError(`Job not found: ${jobId}`, "JOB_MISSING");
    }
    if (current.workerId !== workerId || current.status !== "running") {
      throw new ForgeError(`Cannot fail job ${jobId}`, "JOB_FAIL_FAILED", {
        jobId,
        workerId,
        status: current.status,
      });
    }
    const shouldRequeue = requeue && current.attempts < current.maxAttempts;
    if (shouldRequeue) {
      this.db
        .prepare(
          `UPDATE daemon_jobs SET
            status = 'queued',
            error = ?,
            worker_id = NULL,
            leased_at = NULL,
            heartbeat_at = NULL,
            updated_at = ?
           WHERE id = ?`,
        )
        .run(error, ts, jobId);
    } else {
      this.db
        .prepare(
          `UPDATE daemon_jobs SET
            status = 'failed',
            error = ?,
            worker_id = NULL,
            leased_at = NULL,
            heartbeat_at = NULL,
            updated_at = ?,
            completed_at = ?
           WHERE id = ?`,
        )
        .run(error, ts, ts, jobId);
    }
    const job = this.getJob(jobId);
    if (!job) throw new ForgeError(`Job missing after fail: ${jobId}`, "JOB_MISSING");
    return job;
  }

  /**
   * Requeue orphaned running jobs (stale heartbeat or daemon restart).
   * Returns number of jobs recovered.
   */
  recoverOrphans(opts?: { staleAfterMs?: number; forceAllRunning?: boolean }): number {
    const staleAfterMs = opts?.staleAfterMs ?? 30_000;
    const forceAll = opts?.forceAllRunning ?? false;
    const ts = nowIso();
    const running = this.listJobs({ status: "running", limit: 10_000 });
    let recovered = 0;
    for (const job of running) {
      const hb = job.heartbeatAt ? Date.parse(job.heartbeatAt) : 0;
      const stale = !hb || Date.now() - hb > staleAfterMs;
      if (!forceAll && !stale) continue;

      if (job.attempts >= job.maxAttempts) {
        this.db
          .prepare(
            `UPDATE daemon_jobs SET
              status = 'failed',
              error = COALESCE(error, 'orphaned: max attempts exceeded'),
              worker_id = NULL,
              leased_at = NULL,
              heartbeat_at = NULL,
              updated_at = ?,
              completed_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .run(ts, ts, job.id);
      } else {
        this.db
          .prepare(
            `UPDATE daemon_jobs SET
              status = 'queued',
              error = 'requeued after daemon recovery',
              worker_id = NULL,
              leased_at = NULL,
              heartbeat_at = NULL,
              updated_at = ?
             WHERE id = ? AND status = 'running'`,
          )
          .run(ts, job.id);
      }
      recovered += 1;
    }
    return recovered;
  }

  counts(): Record<JobStatus, number> {
    const rows = this.db
      .prepare(`SELECT status, COUNT(*) as n FROM daemon_jobs GROUP BY status`)
      .all() as { status: JobStatus; n: number | bigint }[];
    const out: Record<JobStatus, number> = {
      queued: 0,
      running: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of rows) {
      out[row.status] = Number(row.n);
    }
    return out;
  }
}
