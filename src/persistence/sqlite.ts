import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApprovalRecord,
  ArtifactRecord,
  EventRecord,
  ProjectRecord,
  RunRecord,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";
import { assertTransition } from "../core/state/machine.js";
import type {
  CreateRunInput,
  CreateTaskInput,
  PersistenceStore,
} from "./store.js";

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * SQLite-backed store using Node's built-in `node:sqlite` (no native addon).
 * PersistenceStore allows swapping to PostgreSQL later.
 */
export class SqliteStore implements PersistenceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        objective TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL,
        routing_mode TEXT NOT NULL,
        local_model TEXT,
        cloud_model TEXT,
        max_turns INTEGER NOT NULL,
        max_repairs INTEGER NOT NULL,
        timeout_ms INTEGER NOT NULL,
        cloud_budget_usd REAL,
        plan TEXT,
        acceptance_criteria TEXT,
        turn_count INTEGER NOT NULL DEFAULT 0,
        repair_count INTEGER NOT NULL DEFAULT 0,
        cloud_cost_usd REAL NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        estimated_cost_usd REAL,
        verification_status TEXT,
        escalation_reason TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        run_id TEXT,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        kind TEXT NOT NULL,
        path TEXT,
        content TEXT,
        metadata TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id),
        action TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  upsertProject(path: string, name: string): ProjectRecord {
    const existing = this.getProjectByPath(path);
    const ts = nowIso();
    if (existing) {
      this.db
        .prepare(`UPDATE projects SET name = ?, updated_at = ? WHERE id = ?`)
        .run(name, ts, existing.id);
      return { ...existing, name, updatedAt: ts };
    }
    const record: ProjectRecord = {
      id: randomUUID(),
      path,
      name,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO projects (id, path, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.path, record.name, record.createdAt, record.updatedAt);
    return record;
  }

  getProjectByPath(path: string): ProjectRecord | null {
    const row = this.db.prepare(`SELECT * FROM projects WHERE path = ?`).get(path) as
      | {
          id: string;
          path: string;
          name: string;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createTask(input: CreateTaskInput): TaskRecord {
    const ts = nowIso();
    const record: TaskRecord = {
      id: randomUUID(),
      projectId: input.projectId,
      objective: input.objective,
      workspacePath: input.workspacePath,
      status: "CREATED",
      routingMode: input.routingMode,
      localModel: input.localModel,
      cloudModel: input.cloudModel,
      maxTurns: input.maxTurns,
      maxRepairs: input.maxRepairs,
      timeoutMs: input.timeoutMs,
      cloudBudgetUsd: input.cloudBudgetUsd,
      plan: null,
      acceptanceCriteria: input.acceptanceCriteria ?? null,
      turnCount: 0,
      repairCount: 0,
      cloudCostUsd: 0,
      error: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (
          id, project_id, objective, workspace_path, status, routing_mode,
          local_model, cloud_model, max_turns, max_repairs, timeout_ms,
          cloud_budget_usd, plan, acceptance_criteria, turn_count, repair_count,
          cloud_cost_usd, error, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.objective,
        record.workspacePath,
        record.status,
        record.routingMode,
        record.localModel,
        record.cloudModel,
        record.maxTurns,
        record.maxRepairs,
        record.timeoutMs,
        record.cloudBudgetUsd,
        record.plan,
        record.acceptanceCriteria,
        record.turnCount,
        record.repairCount,
        record.cloudCostUsd,
        record.error,
        record.createdAt,
        record.updatedAt,
        record.completedAt,
      );
    return record;
  }

  getTask(id: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapTask(row) : null;
  }

  listTasks(limit = 50): TaskRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(mapTask);
  }

  updateTaskStatus(id: string, status: TaskStatus, error?: string | null): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    assertTransition(task.status, status);
    const ts = nowIso();
    const completedAt =
      status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
        ? ts
        : task.completedAt;
    this.db
      .prepare(
        `UPDATE tasks SET status = ?, error = COALESCE(?, error), updated_at = ?, completed_at = ? WHERE id = ?`,
      )
      .run(status, error ?? null, ts, completedAt, id);
    this.appendEvent(id, "state_transition", {
      from: task.status,
      to: status,
      error: error ?? null,
    });
    const updated = this.getTask(id);
    if (!updated) throw new Error(`Task missing after update: ${id}`);
    return updated;
  }

  updateTaskFields(
    id: string,
    fields: Partial<
      Pick<
        TaskRecord,
        | "plan"
        | "turnCount"
        | "repairCount"
        | "cloudCostUsd"
        | "localModel"
        | "cloudModel"
        | "error"
        | "completedAt"
      >
    >,
  ): TaskRecord {
    const task = this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    const next = { ...task, ...fields, updatedAt: nowIso() };
    this.db
      .prepare(
        `UPDATE tasks SET
          plan = ?, turn_count = ?, repair_count = ?, cloud_cost_usd = ?,
          local_model = ?, cloud_model = ?, error = ?, completed_at = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(
        next.plan,
        next.turnCount,
        next.repairCount,
        next.cloudCostUsd,
        next.localModel,
        next.cloudModel,
        next.error,
        next.completedAt,
        next.updatedAt,
        id,
      );
    const updated = this.getTask(id);
    if (!updated) throw new Error(`Task missing after update: ${id}`);
    return updated;
  }

  createRun(input: CreateRunInput): RunRecord {
    const record: RunRecord = {
      id: randomUUID(),
      taskId: input.taskId,
      provider: input.provider,
      model: input.model,
      status: "running",
      startedAt: nowIso(),
      endedAt: null,
      toolCallCount: 0,
      promptTokens: null,
      completionTokens: null,
      estimatedCostUsd: null,
      verificationStatus: null,
      escalationReason: input.escalationReason ?? null,
      error: null,
    };
    this.db
      .prepare(
        `INSERT INTO runs (
          id, task_id, provider, model, status, started_at, ended_at,
          tool_call_count, prompt_tokens, completion_tokens, estimated_cost_usd,
          verification_status, escalation_reason, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.provider,
        record.model,
        record.status,
        record.startedAt,
        record.endedAt,
        record.toolCallCount,
        record.promptTokens,
        record.completionTokens,
        record.estimatedCostUsd,
        record.verificationStatus,
        record.escalationReason,
        record.error,
      );
    return record;
  }

  getRun(id: string): RunRecord | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapRun(row) : null;
  }

  listRuns(taskId: string): RunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM runs WHERE task_id = ? ORDER BY started_at ASC`)
      .all(taskId) as Record<string, unknown>[];
    return rows.map(mapRun);
  }

  updateRun(
    id: string,
    fields: Partial<
      Pick<
        RunRecord,
        | "status"
        | "endedAt"
        | "toolCallCount"
        | "promptTokens"
        | "completionTokens"
        | "estimatedCostUsd"
        | "verificationStatus"
        | "error"
      >
    >,
  ): RunRecord {
    const run = this.getRun(id);
    if (!run) throw new Error(`Run not found: ${id}`);
    const next = { ...run, ...fields };
    this.db
      .prepare(
        `UPDATE runs SET
          status = ?, ended_at = ?, tool_call_count = ?, prompt_tokens = ?,
          completion_tokens = ?, estimated_cost_usd = ?, verification_status = ?, error = ?
        WHERE id = ?`,
      )
      .run(
        next.status,
        next.endedAt,
        next.toolCallCount,
        next.promptTokens,
        next.completionTokens,
        next.estimatedCostUsd,
        next.verificationStatus,
        next.error,
        id,
      );
    const updated = this.getRun(id);
    if (!updated) throw new Error(`Run missing after update: ${id}`);
    return updated;
  }

  appendEvent(
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
    runId?: string | null,
  ): EventRecord {
    const record: EventRecord = {
      id: randomUUID(),
      taskId,
      runId: runId ?? null,
      type,
      payload,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO events (id, task_id, run_id, type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.runId,
        record.type,
        JSON.stringify(record.payload),
        record.createdAt,
      );
    return record;
  }

  listEvents(taskId: string): EventRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM events WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<{
      id: string;
      task_id: string;
      run_id: string | null;
      type: string;
      payload: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      runId: row.run_id,
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  createArtifact(
    taskId: string,
    kind: string,
    content: string | null,
    path: string | null = null,
    metadata: Record<string, unknown> = {},
  ): ArtifactRecord {
    const record: ArtifactRecord = {
      id: randomUUID(),
      taskId,
      kind,
      path,
      content,
      metadata,
      createdAt: nowIso(),
    };
    this.db
      .prepare(
        `INSERT INTO artifacts (id, task_id, kind, path, content, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.kind,
        record.path,
        record.content,
        JSON.stringify(record.metadata),
        record.createdAt,
      );
    return record;
  }

  listArtifacts(taskId: string): ArtifactRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM artifacts WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<{
      id: string;
      task_id: string;
      kind: string;
      path: string | null;
      content: string | null;
      metadata: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      kind: row.kind,
      path: row.path,
      content: row.content,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  }

  createApproval(
    taskId: string,
    action: string,
    reason: string | null = null,
  ): ApprovalRecord {
    const record: ApprovalRecord = {
      id: randomUUID(),
      taskId,
      action,
      status: "pending",
      reason,
      createdAt: nowIso(),
      resolvedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO approvals (id, task_id, action, status, reason, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.action,
        record.status,
        record.reason,
        record.createdAt,
        record.resolvedAt,
      );
    return record;
  }

  resolveApproval(id: string, status: "approved" | "denied"): ApprovalRecord {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE approvals SET status = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(status, ts, id);
    const updated = this.getApproval(id);
    if (!updated) throw new Error(`Approval not found: ${id}`);
    return updated;
  }

  getApproval(id: string): ApprovalRecord | null {
    const row = this.db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(id) as
      | {
          id: string;
          task_id: string;
          action: string;
          status: "pending" | "approved" | "denied";
          reason: string | null;
          created_at: string;
          resolved_at: string | null;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      taskId: row.task_id,
      action: row.action,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    };
  }

  listApprovals(taskId: string): ApprovalRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM approvals WHERE task_id = ? ORDER BY created_at ASC`)
      .all(taskId) as Array<{
      id: string;
      task_id: string;
      action: string;
      status: "pending" | "approved" | "denied";
      reason: string | null;
      created_at: string;
      resolved_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      action: row.action,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }));
  }

  listPendingApprovals(taskId?: string): ApprovalRecord[] {
    if (taskId) {
      return this.listApprovals(taskId).filter((a) => a.status === "pending");
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM approvals WHERE status = 'pending' ORDER BY created_at ASC`,
      )
      .all() as Array<{
      id: string;
      task_id: string;
      action: string;
      status: "pending" | "approved" | "denied";
      reason: string | null;
      created_at: string;
      resolved_at: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      taskId: row.task_id,
      action: row.action,
      status: row.status,
      reason: row.reason,
      createdAt: row.created_at,
      resolvedAt: row.resolved_at,
    }));
  }
}

function mapTask(row: Record<string, unknown>): TaskRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    objective: String(row.objective),
    workspacePath: String(row.workspace_path),
    status: row.status as TaskStatus,
    routingMode: row.routing_mode as TaskRecord["routingMode"],
    localModel: (row.local_model as string | null) ?? null,
    cloudModel: (row.cloud_model as string | null) ?? null,
    maxTurns: Number(row.max_turns),
    maxRepairs: Number(row.max_repairs),
    timeoutMs: Number(row.timeout_ms),
    cloudBudgetUsd:
      row.cloud_budget_usd == null ? null : Number(row.cloud_budget_usd),
    plan: (row.plan as string | null) ?? null,
    acceptanceCriteria: (row.acceptance_criteria as string | null) ?? null,
    turnCount: Number(row.turn_count),
    repairCount: Number(row.repair_count),
    cloudCostUsd: Number(row.cloud_cost_usd),
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    completedAt: (row.completed_at as string | null) ?? null,
  };
}

function mapRun(row: Record<string, unknown>): RunRecord {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    provider: row.provider as RunRecord["provider"],
    model: String(row.model),
    status: row.status as RunRecord["status"],
    startedAt: String(row.started_at),
    endedAt: (row.ended_at as string | null) ?? null,
    toolCallCount: Number(row.tool_call_count),
    promptTokens: row.prompt_tokens == null ? null : Number(row.prompt_tokens),
    completionTokens:
      row.completion_tokens == null ? null : Number(row.completion_tokens),
    estimatedCostUsd:
      row.estimated_cost_usd == null ? null : Number(row.estimated_cost_usd),
    verificationStatus: (row.verification_status as string | null) ?? null,
    escalationReason: (row.escalation_reason as string | null) ?? null,
    error: (row.error as string | null) ?? null,
  };
}
