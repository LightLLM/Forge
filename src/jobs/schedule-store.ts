import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  AnalysisId,
  CreateScheduleInput,
  ScheduleRecord,
  ScheduleStatus,
} from "./types.js";
import { ForgeError } from "../core/types.js";
import { estimateCronEveryMs, nextCronOccurrence, parseCronExpression } from "./cron.js";

function nowIso(): string {
  return new Date().toISOString();
}

function rowToSchedule(row: {
  id: string;
  name: string;
  analysis_id: string;
  every_ms: number;
  cron_expr: string | null;
  status: string;
  payload: string;
  last_run_at: string | null;
  next_run_at: string;
  last_job_id: string | null;
  run_count: number;
  created_at: string;
  updated_at: string;
}): ScheduleRecord {
  return {
    id: row.id,
    name: row.name,
    analysisId: row.analysis_id as AnalysisId,
    everyMs: row.every_ms,
    cronExpr: row.cron_expr,
    status: row.status as ScheduleStatus,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    lastJobId: row.last_job_id,
    runCount: row.run_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Durable schedule definitions for background engineering jobs.
 */
export class ScheduleStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daemon_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        analysis_id TEXT NOT NULL,
        every_ms INTEGER NOT NULL,
        cron_expr TEXT,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        last_run_at TEXT,
        next_run_at TEXT NOT NULL,
        last_job_id TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_daemon_schedules_next ON daemon_schedules(next_run_at);
      CREATE INDEX IF NOT EXISTS idx_daemon_schedules_status ON daemon_schedules(status);
    `);
    // Migrate older DBs created before cron_expr existed.
    const cols = this.db
      .prepare(`PRAGMA table_info(daemon_schedules)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "cron_expr")) {
      this.db.exec(`ALTER TABLE daemon_schedules ADD COLUMN cron_expr TEXT`);
    }
  }

  close(): void {
    this.db.close();
  }

  create(input: CreateScheduleInput): ScheduleRecord {
    let everyMs = input.everyMs;
    let cronExpr: string | null = input.cronExpr?.trim() || null;
    if (cronExpr) {
      parseCronExpression(cronExpr);
      if (!everyMs || everyMs < 50) {
        everyMs = estimateCronEveryMs(cronExpr);
      }
    }
    if (everyMs < 50) {
      throw new ForgeError("everyMs must be >= 50", "INVALID_SCHEDULE");
    }
    const ts = nowIso();
    const nextRunAt =
      input.nextRunAt ??
      (cronExpr ? nextCronOccurrence(cronExpr, new Date()).toISOString() : ts);
    const record: ScheduleRecord = {
      id: randomUUID(),
      name: input.name,
      analysisId: input.analysisId,
      everyMs,
      cronExpr,
      status: input.status ?? "active",
      payload: input.payload ?? {},
      lastRunAt: null,
      nextRunAt,
      lastJobId: null,
      runCount: 0,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO daemon_schedules (
          id, name, analysis_id, every_ms, cron_expr, status, payload,
          last_run_at, next_run_at, last_job_id, run_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.name,
        record.analysisId,
        record.everyMs,
        record.cronExpr,
        record.status,
        JSON.stringify(record.payload),
        null,
        record.nextRunAt,
        null,
        0,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  get(id: string): ScheduleRecord | null {
    const row = this.db.prepare(`SELECT * FROM daemon_schedules WHERE id = ?`).get(id) as
      | Parameters<typeof rowToSchedule>[0]
      | undefined;
    return row ? rowToSchedule(row) : null;
  }

  list(opts?: { status?: ScheduleStatus; limit?: number }): ScheduleRecord[] {
    const limit = opts?.limit ?? 100;
    if (opts?.status) {
      const rows = this.db
        .prepare(
          `SELECT * FROM daemon_schedules WHERE status = ? ORDER BY next_run_at ASC LIMIT ?`,
        )
        .all(opts.status, limit) as Parameters<typeof rowToSchedule>[0][];
      return rows.map(rowToSchedule);
    }
    const rows = this.db
      .prepare(`SELECT * FROM daemon_schedules ORDER BY next_run_at ASC LIMIT ?`)
      .all(limit) as Parameters<typeof rowToSchedule>[0][];
    return rows.map(rowToSchedule);
  }

  setStatus(id: string, status: ScheduleStatus): ScheduleRecord {
    const ts = nowIso();
    this.db
      .prepare(`UPDATE daemon_schedules SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, ts, id);
    const s = this.get(id);
    if (!s) throw new ForgeError(`Schedule not found: ${id}`, "SCHEDULE_MISSING");
    return s;
  }

  /** Schedules that are active and due at or before `now`. */
  listDue(now = new Date()): ScheduleRecord[] {
    const iso = now.toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM daemon_schedules
         WHERE status = 'active' AND next_run_at <= ?
         ORDER BY next_run_at ASC`,
      )
      .all(iso) as Parameters<typeof rowToSchedule>[0][];
    return rows.map(rowToSchedule);
  }

  /**
   * Mark schedule as fired: bump next_run_at (cron or interval) and record job id.
   */
  markFired(id: string, jobId: string, firedAt = new Date()): ScheduleRecord {
    const current = this.get(id);
    if (!current) {
      throw new ForgeError(`Schedule not found: ${id}`, "SCHEDULE_MISSING");
    }
    const ts = firedAt.toISOString();
    const next = current.cronExpr
      ? nextCronOccurrence(current.cronExpr, firedAt).toISOString()
      : new Date(firedAt.getTime() + current.everyMs).toISOString();
    this.db
      .prepare(
        `UPDATE daemon_schedules SET
          last_run_at = ?,
          next_run_at = ?,
          last_job_id = ?,
          run_count = run_count + 1,
          updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, next, jobId, ts, id);
    const s = this.get(id);
    if (!s) throw new ForgeError(`Schedule missing after fire: ${id}`, "SCHEDULE_MISSING");
    return s;
  }
}
