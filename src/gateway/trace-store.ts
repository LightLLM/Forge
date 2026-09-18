import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export interface ModelTraceRecord {
  id: string;
  sessionId: string | null;
  taskId: string | null;
  source: "chat" | "build" | "terminal" | "system";
  provider: string;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  latencyMs: number | null;
  status: "ok" | "error";
  error: string | null;
  createdAt: string;
}

export interface AppLogRecord {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  scope: string;
  message: string;
  fields: Record<string, unknown> | null;
  createdAt: string;
}

/**
 * Durable model-usage traces + application error log.
 * Shares the interaction DB connection (do not open a second handle).
 */
export class TraceStore {
  constructor(private readonly db: DatabaseSync) {}

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS model_traces (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        task_id TEXT,
        source TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        estimated_cost_usd REAL,
        latency_ms INTEGER,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_model_traces_created
        ON model_traces(created_at DESC);
      CREATE TABLE IF NOT EXISTS app_logs (
        id TEXT PRIMARY KEY,
        level TEXT NOT NULL,
        scope TEXT NOT NULL,
        message TEXT NOT NULL,
        fields_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_app_logs_created
        ON app_logs(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_app_logs_level
        ON app_logs(level, created_at DESC);
    `);
  }

  recordTrace(
    input: Omit<ModelTraceRecord, "id" | "createdAt"> & {
      id?: string;
      createdAt?: string;
    },
  ): ModelTraceRecord {
    const record: ModelTraceRecord = {
      id: input.id ?? randomUUID(),
      sessionId: input.sessionId,
      taskId: input.taskId,
      source: input.source,
      provider: input.provider,
      model: input.model,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      estimatedCostUsd: input.estimatedCostUsd,
      latencyMs: input.latencyMs,
      status: input.status,
      error: input.error,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO model_traces (
          id, session_id, task_id, source, provider, model,
          prompt_tokens, completion_tokens, estimated_cost_usd, latency_ms,
          status, error, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId,
        record.taskId,
        record.source,
        record.provider,
        record.model,
        record.promptTokens,
        record.completionTokens,
        record.estimatedCostUsd,
        record.latencyMs,
        record.status,
        record.error,
        record.createdAt,
      );
    return record;
  }

  listTraces(limit = 100): ModelTraceRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM model_traces ORDER BY created_at DESC LIMIT ?`)
      .all(Math.min(Math.max(limit, 1), 500)) as Record<string, unknown>[];
    return rows.map(mapTrace);
  }

  summarizeUsage(): {
    calls: number;
    errors: number;
    promptTokens: number;
    completionTokens: number;
    estimatedCostUsd: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) AS calls,
          SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS errors,
          COALESCE(SUM(prompt_tokens), 0) AS prompt_tokens,
          COALESCE(SUM(completion_tokens), 0) AS completion_tokens,
          COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd
         FROM model_traces`,
      )
      .get() as Record<string, unknown>;
    return {
      calls: Number(row.calls ?? 0),
      errors: Number(row.errors ?? 0),
      promptTokens: Number(row.prompt_tokens ?? 0),
      completionTokens: Number(row.completion_tokens ?? 0),
      estimatedCostUsd: Number(row.estimated_cost_usd ?? 0),
    };
  }

  appendLog(input: {
    level: AppLogRecord["level"];
    scope: string;
    message: string;
    fields?: Record<string, unknown> | null;
  }): AppLogRecord {
    const record: AppLogRecord = {
      id: randomUUID(),
      level: input.level,
      scope: input.scope,
      message: input.message.slice(0, 4000),
      fields: input.fields ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare(
        `INSERT INTO app_logs (id, level, scope, message, fields_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.level,
        record.scope,
        record.message,
        record.fields ? JSON.stringify(record.fields) : null,
        record.createdAt,
      );
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS n FROM app_logs`)
      .get() as { n: number };
    if (Number(countRow.n) > 2000) {
      this.db.exec(`
        DELETE FROM app_logs WHERE id IN (
          SELECT id FROM app_logs ORDER BY created_at ASC LIMIT 200
        );
      `);
    }
    return record;
  }

  listLogs(opts?: {
    level?: AppLogRecord["level"];
    limit?: number;
  }): AppLogRecord[] {
    const limit = Math.min(Math.max(opts?.limit ?? 100, 1), 500);
    const rows = (
      opts?.level
        ? (this.db
            .prepare(
              `SELECT * FROM app_logs WHERE level = ? ORDER BY created_at DESC LIMIT ?`,
            )
            .all(opts.level, limit) as Record<string, unknown>[])
        : (this.db
            .prepare(`SELECT * FROM app_logs ORDER BY created_at DESC LIMIT ?`)
            .all(limit) as Record<string, unknown>[])
    );
    return rows.map(mapLog);
  }
}

function mapTrace(row: Record<string, unknown>): ModelTraceRecord {
  return {
    id: String(row.id),
    sessionId: row.session_id == null ? null : String(row.session_id),
    taskId: row.task_id == null ? null : String(row.task_id),
    source: row.source as ModelTraceRecord["source"],
    provider: String(row.provider),
    model: String(row.model),
    promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
    completionTokens:
      row.completion_tokens == null ? null : Number(row.completion_tokens),
    estimatedCostUsd:
      row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    latencyMs: row.latency_ms == null ? null : Number(row.latency_ms),
    status: row.status as ModelTraceRecord["status"],
    error: row.error == null ? null : String(row.error),
    createdAt: String(row.created_at),
  };
}

function mapLog(row: Record<string, unknown>): AppLogRecord {
  let fields: Record<string, unknown> | null = null;
  if (typeof row.fields_json === "string" && row.fields_json) {
    try {
      fields = JSON.parse(row.fields_json) as Record<string, unknown>;
    } catch {
      fields = null;
    }
  }
  return {
    id: String(row.id),
    level: row.level as AppLogRecord["level"],
    scope: String(row.scope),
    message: String(row.message),
    fields,
    createdAt: String(row.created_at),
  };
}
