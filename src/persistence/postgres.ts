import postgres from "postgres";
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
import type { CreateRunInput, CreateTaskInput } from "./store.js";

export const POSTGRES_SCHEMA_SQL = `
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
  cloud_budget_usd DOUBLE PRECISION,
  plan TEXT,
  acceptance_criteria TEXT,
  turn_count INTEGER NOT NULL DEFAULT 0,
  repair_count INTEGER NOT NULL DEFAULT 0,
  cloud_cost_usd DOUBLE PRECISION NOT NULL DEFAULT 0,
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
  estimated_cost_usd DOUBLE PRECISION,
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
CREATE TABLE IF NOT EXISTS daemon_schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  analysis_id TEXT NOT NULL,
  every_ms INTEGER NOT NULL,
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
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  objective TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  phase TEXT NOT NULL,
  plan_json TEXT,
  graph_id TEXT,
  graph_snapshot TEXT,
  verification_json TEXT,
  review_summary TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_goals_phase ON goals(phase);
CREATE INDEX IF NOT EXISTS idx_goals_workspace ON goals(workspace_path);
CREATE TABLE IF NOT EXISTS eval_runs (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  report_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS model_performance (
  id TEXT PRIMARY KEY,
  provider_kind TEXT NOT NULL,
  model TEXT NOT NULL,
  task_category TEXT NOT NULL,
  success INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  cost_usd REAL NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS failure_corpus (
  id TEXT PRIMARY KEY,
  symptom TEXT NOT NULL,
  cause TEXT,
  fix TEXT NOT NULL,
  tags TEXT NOT NULL,
  success_evidence TEXT,
  related_solution_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS restricted_approvals (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  risk TEXT NOT NULL,
  evidence TEXT,
  requesting_agent TEXT,
  status TEXT NOT NULL,
  decision_maker TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
);
CREATE TABLE IF NOT EXISTS skill_proposals (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  rationale TEXT NOT NULL,
  proposed_content TEXT NOT NULL,
  security_impacting INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  decision_maker TEXT
);
`;

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Async PostgreSQL store (same schema as SQLite).
 * CLI harness still defaults to SQLite; use this programmatically when
 * FORGE_DATABASE_URL is set, or when the orchestrator is migrated to async I/O.
 */
export class PostgresStore {
  private readonly sql: ReturnType<typeof postgres>;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, { max: 5, idle_timeout: 20, connect_timeout: 10 });
  }

  async initialize(): Promise<void> {
    await this.sql.unsafe(POSTGRES_SCHEMA_SQL);
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async upsertProject(path: string, name: string): Promise<ProjectRecord> {
    const existing = await this.getProjectByPath(path);
    const ts = nowIso();
    if (existing) {
      await this.sql`UPDATE projects SET name = ${name}, updated_at = ${ts} WHERE id = ${existing.id}`;
      return { ...existing, name, updatedAt: ts };
    }
    const record: ProjectRecord = {
      id: randomUUID(),
      path,
      name,
      createdAt: ts,
      updatedAt: ts,
    };
    await this.sql`
      INSERT INTO projects (id, path, name, created_at, updated_at)
      VALUES (${record.id}, ${record.path}, ${record.name}, ${record.createdAt}, ${record.updatedAt})
    `;
    return record;
  }

  async getProjectByPath(path: string): Promise<ProjectRecord | null> {
    const rows = await this.sql<
      { id: string; path: string; name: string; created_at: string; updated_at: string }[]
    >`SELECT * FROM projects WHERE path = ${path}`;
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      name: row.name,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async createTask(input: CreateTaskInput): Promise<TaskRecord> {
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
    await this.sql`
      INSERT INTO tasks (
        id, project_id, objective, workspace_path, status, routing_mode,
        local_model, cloud_model, max_turns, max_repairs, timeout_ms,
        cloud_budget_usd, plan, acceptance_criteria, turn_count, repair_count,
        cloud_cost_usd, error, created_at, updated_at, completed_at
      ) VALUES (
        ${record.id}, ${record.projectId}, ${record.objective}, ${record.workspacePath},
        ${record.status}, ${record.routingMode}, ${record.localModel}, ${record.cloudModel},
        ${record.maxTurns}, ${record.maxRepairs}, ${record.timeoutMs}, ${record.cloudBudgetUsd},
        ${record.plan}, ${record.acceptanceCriteria}, ${record.turnCount}, ${record.repairCount},
        ${record.cloudCostUsd}, ${record.error}, ${record.createdAt}, ${record.updatedAt},
        ${record.completedAt}
      )
    `;
    return record;
  }

  async getTask(id: string): Promise<TaskRecord | null> {
    const rows = await this.sql<Record<string, unknown>[]>`SELECT * FROM tasks WHERE id = ${id}`;
    return rows[0] ? mapTask(rows[0]) : null;
  }

  async updateTaskStatus(
    id: string,
    status: TaskStatus,
    error?: string | null,
  ): Promise<TaskRecord> {
    const task = await this.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    assertTransition(task.status, status);
    const ts = nowIso();
    const completedAt =
      status === "COMPLETED" || status === "FAILED" || status === "CANCELLED"
        ? ts
        : task.completedAt;
    await this.sql`
      UPDATE tasks SET status = ${status}, error = COALESCE(${error ?? null}, error),
        updated_at = ${ts}, completed_at = ${completedAt} WHERE id = ${id}
    `;
    await this.appendEvent(id, "state_transition", {
      from: task.status,
      to: status,
      error: error ?? null,
    });
    const updated = await this.getTask(id);
    if (!updated) throw new Error(`Task missing after update: ${id}`);
    return updated;
  }

  async createRun(input: CreateRunInput): Promise<RunRecord> {
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
    await this.sql`
      INSERT INTO runs (
        id, task_id, provider, model, status, started_at, ended_at, tool_call_count,
        prompt_tokens, completion_tokens, estimated_cost_usd, verification_status,
        escalation_reason, error
      ) VALUES (
        ${record.id}, ${record.taskId}, ${record.provider}, ${record.model}, ${record.status},
        ${record.startedAt}, ${record.endedAt}, ${record.toolCallCount}, ${record.promptTokens},
        ${record.completionTokens}, ${record.estimatedCostUsd}, ${record.verificationStatus},
        ${record.escalationReason}, ${record.error}
      )
    `;
    return record;
  }

  async appendEvent(
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
    runId?: string | null,
  ): Promise<EventRecord> {
    const record: EventRecord = {
      id: randomUUID(),
      taskId,
      runId: runId ?? null,
      type,
      payload,
      createdAt: nowIso(),
    };
    await this.sql`
      INSERT INTO events (id, task_id, run_id, type, payload, created_at)
      VALUES (${record.id}, ${record.taskId}, ${record.runId}, ${record.type},
        ${JSON.stringify(record.payload)}, ${record.createdAt})
    `;
    return record;
  }

  async createApproval(
    taskId: string,
    action: string,
    reason: string | null = null,
  ): Promise<ApprovalRecord> {
    const record: ApprovalRecord = {
      id: randomUUID(),
      taskId,
      action,
      status: "pending",
      reason,
      createdAt: nowIso(),
      resolvedAt: null,
    };
    await this.sql`
      INSERT INTO approvals (id, task_id, action, status, reason, created_at, resolved_at)
      VALUES (${record.id}, ${record.taskId}, ${record.action}, ${record.status},
        ${record.reason}, ${record.createdAt}, ${record.resolvedAt})
    `;
    return record;
  }

  async getApproval(id: string): Promise<ApprovalRecord | null> {
    const rows = await this.sql<
      {
        id: string;
        task_id: string;
        action: string;
        status: "pending" | "approved" | "denied";
        reason: string | null;
        created_at: string;
        resolved_at: string | null;
      }[]
    >`SELECT * FROM approvals WHERE id = ${id}`;
    const row = rows[0];
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

  async resolveApproval(
    id: string,
    status: "approved" | "denied",
  ): Promise<ApprovalRecord> {
    const ts = nowIso();
    await this.sql`
      UPDATE approvals SET status = ${status}, resolved_at = ${ts} WHERE id = ${id}
    `;
    const updated = await this.getApproval(id);
    if (!updated) throw new Error(`Approval not found: ${id}`);
    return updated;
  }

  async createArtifact(
    taskId: string,
    kind: string,
    content: string | null,
    path: string | null = null,
    metadata: Record<string, unknown> = {},
  ): Promise<ArtifactRecord> {
    const record: ArtifactRecord = {
      id: randomUUID(),
      taskId,
      kind,
      path,
      content,
      metadata,
      createdAt: nowIso(),
    };
    await this.sql`
      INSERT INTO artifacts (id, task_id, kind, path, content, metadata, created_at)
      VALUES (${record.id}, ${record.taskId}, ${record.kind}, ${record.path}, ${record.content},
        ${JSON.stringify(record.metadata)}, ${record.createdAt})
    `;
    return record;
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
