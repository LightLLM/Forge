import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  ApprovalRecord,
  ArtifactRecord,
  EventRecord,
  MemoryKind,
  MemoryRecord,
  ProjectRecord,
  RunRecord,
  SessionRecord,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";
import { assertTransition } from "../core/state/machine.js";
import type {
  CreateMemoryInput,
  CreateRunInput,
  CreateTaskInput,
  ListMemoriesOptions,
  PersistenceStore,
  PruneMemoriesOptions,
  SearchMemoriesOptions,
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

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        label TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        closed_at TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT NOT NULL,
        metadata TEXT NOT NULL,
        source_task_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
      CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);
      CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_id);
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

  createSession(projectId: string, label: string | null = null): SessionRecord {
    const ts = nowIso();
    const record: SessionRecord = {
      id: randomUUID(),
      projectId,
      label,
      status: "open",
      createdAt: ts,
      updatedAt: ts,
      closedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO sessions (id, project_id, label, status, created_at, updated_at, closed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.label,
        record.status,
        record.createdAt,
        record.updatedAt,
        record.closedAt,
      );
    return record;
  }

  getSession(id: string): SessionRecord | null {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapSession(row) : null;
  }

  listSessions(
    projectId?: string,
    status?: SessionRecord["status"],
  ): SessionRecord[] {
    let sql = `SELECT * FROM sessions WHERE 1=1`;
    const params: string[] = [];
    if (projectId) {
      sql += ` AND project_id = ?`;
      params.push(projectId);
    }
    if (status) {
      sql += ` AND status = ?`;
      params.push(status);
    }
    sql += ` ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapSession);
  }

  closeSession(id: string): SessionRecord {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE sessions SET status = 'closed', updated_at = ?, closed_at = ? WHERE id = ?`,
      )
      .run(ts, ts, id);
    const updated = this.getSession(id);
    if (!updated) throw new Error(`Session not found: ${id}`);
    return updated;
  }

  createMemory(input: CreateMemoryInput): MemoryRecord {
    const ts = nowIso();
    const record: MemoryRecord = {
      id: randomUUID(),
      projectId: input.projectId ?? null,
      kind: input.kind,
      title: input.title,
      content: input.content,
      tags: input.tags ?? [],
      metadata: input.metadata ?? {},
      sourceTaskId: input.sourceTaskId ?? null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO memories
         (id, project_id, kind, title, content, tags, metadata, source_task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.projectId,
        record.kind,
        record.title,
        record.content,
        JSON.stringify(record.tags),
        JSON.stringify(record.metadata),
        record.sourceTaskId,
        record.createdAt,
        record.updatedAt,
      );
    return record;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? mapMemory(row) : null;
  }

  listMemories(opts: ListMemoriesOptions = {}): MemoryRecord[] {
    let sql = `SELECT * FROM memories WHERE 1=1`;
    const params: string[] = [];
    if (opts.projectId) {
      sql += ` AND project_id = ?`;
      params.push(opts.projectId);
    }
    if (opts.kind) {
      sql += ` AND kind = ?`;
      params.push(opts.kind);
    }
    sql += ` ORDER BY created_at DESC`;
    if (opts.limit != null) {
      sql += ` LIMIT ?`;
      params.push(String(opts.limit));
    }
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
    return rows.map(mapMemory);
  }

  searchMemories(query: string, opts: SearchMemoriesOptions = {}): MemoryRecord[] {
    const tokens = tokenize(query);
    const candidates = this.listMemories({
      projectId: opts.projectId,
      kind: opts.kind,
      limit: Math.max(opts.limit ?? 20, 100),
    });
    const scored = candidates
      .map((m) => ({ memory: m, score: scoreMemory(m, tokens, query) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.slice(0, opts.limit ?? 20).map((x) => x.memory);
  }

  deleteMemory(id: string): boolean {
    const result = this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return Number(result.changes) > 0;
  }

  pruneMemories(opts: PruneMemoriesOptions): number {
    if (opts.olderThanDays == null && opts.keepLatest == null) {
      throw new Error("pruneMemories requires olderThanDays and/or keepLatest");
    }
    let candidates = this.listMemories({
      projectId: opts.projectId,
      kind: opts.kind,
    });
    if (opts.keepLatest != null) {
      const keepIds = new Set(
        candidates.slice(0, Math.max(0, opts.keepLatest)).map((m) => m.id),
      );
      candidates = candidates.filter((m) => !keepIds.has(m.id));
    }
    if (opts.olderThanDays != null) {
      const cutoff = Date.now() - opts.olderThanDays * 86_400_000;
      candidates = candidates.filter(
        (m) => new Date(m.createdAt).getTime() < cutoff,
      );
    }
    if (opts.dryRun) return candidates.length;
    let removed = 0;
    for (const m of candidates) {
      if (this.deleteMemory(m.id)) removed += 1;
    }
    return removed;
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

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    label: (row.label as string | null) ?? null,
    status: row.status as SessionRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    closedAt: (row.closed_at as string | null) ?? null,
  };
}

function mapMemory(row: Record<string, unknown>): MemoryRecord {
  return {
    id: String(row.id),
    projectId: (row.project_id as string | null) ?? null,
    kind: row.kind as MemoryKind,
    title: String(row.title),
    content: String(row.content),
    tags: JSON.parse(String(row.tags)) as string[],
    metadata: JSON.parse(String(row.metadata)) as Record<string, unknown>,
    sourceTaskId: (row.source_task_id as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_/-]+/)
    .filter((t) => t.length > 2);
}

function scoreMemory(memory: MemoryRecord, tokens: string[], rawQuery: string): number {
  if (tokens.length === 0 && !rawQuery.trim()) return 0;
  const hay = `${memory.title}\n${memory.content}\n${memory.tags.join(" ")}`.toLowerCase();
  let score = 0;
  for (const t of tokens) {
    if (hay.includes(t)) score += 1;
    if (memory.title.toLowerCase().includes(t)) score += 1;
    if (memory.tags.some((tag) => tag.toLowerCase().includes(t))) score += 2;
  }
  const q = rawQuery.trim().toLowerCase();
  if (q && hay.includes(q)) score += 3;
  return score;
}
