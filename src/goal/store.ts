import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskGraphSpec, TaskNodeState } from "../scheduler/types.js";
import {
  assertGoalPhaseTransition,
  type CreateGoalInput,
  type GoalPhase,
  type GoalRecord,
} from "./types.js";
import { ForgeError } from "../core/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function rowToGoal(row: {
  id: string;
  objective: string;
  workspace_path: string;
  phase: string;
  plan_json: string | null;
  graph_id: string | null;
  graph_snapshot: string | null;
  verification_json: string | null;
  review_summary: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}): GoalRecord {
  return {
    id: row.id,
    objective: row.objective,
    workspacePath: row.workspace_path,
    phase: row.phase as GoalPhase,
    plan: row.plan_json
      ? (JSON.parse(row.plan_json) as TaskGraphSpec)
      : null,
    graphId: row.graph_id,
    graphSnapshot: row.graph_snapshot
      ? (JSON.parse(row.graph_snapshot) as TaskNodeState[])
      : null,
    verification: row.verification_json
      ? (JSON.parse(row.verification_json) as Record<string, unknown>)
      : null,
    reviewSummary: row.review_summary,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

/**
 * Durable goal records — survive process restarts.
 */
export class GoalStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize(): void {
    this.db.exec(`
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
    `);
  }

  close(): void {
    this.db.close();
  }

  create(input: CreateGoalInput): GoalRecord {
    const ts = nowIso();
    const record: GoalRecord = {
      id: randomUUID(),
      objective: input.objective,
      workspacePath: input.workspacePath,
      phase: "created",
      plan: null,
      graphId: null,
      graphSnapshot: null,
      verification: null,
      reviewSummary: null,
      error: null,
      createdAt: ts,
      updatedAt: ts,
      completedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO goals (
          id, objective, workspace_path, phase, plan_json, graph_id,
          graph_snapshot, verification_json, review_summary, error,
          created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.objective,
        record.workspacePath,
        record.phase,
        null,
        null,
        null,
        null,
        null,
        null,
        record.createdAt,
        record.updatedAt,
        null,
      );
    return record;
  }

  get(id: string): GoalRecord | null {
    const row = this.db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id) as
      | Parameters<typeof rowToGoal>[0]
      | undefined;
    return row ? rowToGoal(row) : null;
  }

  list(opts?: { phase?: GoalPhase; limit?: number }): GoalRecord[] {
    const limit = opts?.limit ?? 50;
    if (opts?.phase) {
      const rows = this.db
        .prepare(
          `SELECT * FROM goals WHERE phase = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(opts.phase, limit) as Parameters<typeof rowToGoal>[0][];
      return rows.map(rowToGoal);
    }
    const rows = this.db
      .prepare(`SELECT * FROM goals ORDER BY created_at DESC LIMIT ?`)
      .all(limit) as Parameters<typeof rowToGoal>[0][];
    return rows.map(rowToGoal);
  }

  setPhase(id: string, phase: GoalPhase, error?: string | null): GoalRecord {
    const current = this.get(id);
    if (!current) {
      throw new ForgeError(`Goal not found: ${id}`, "GOAL_MISSING");
    }
    assertGoalPhaseTransition(current.phase, phase);
    const ts = nowIso();
    const completedAt =
      phase === "completed" || phase === "failed" || phase === "cancelled"
        ? ts
        : current.completedAt;
    this.db
      .prepare(
        `UPDATE goals SET phase = ?, error = COALESCE(?, error), updated_at = ?, completed_at = COALESCE(?, completed_at) WHERE id = ?`,
      )
      .run(phase, error ?? null, ts, completedAt, id);
    const next = this.get(id);
    if (!next) throw new ForgeError(`Goal missing after update: ${id}`, "GOAL_MISSING");
    return next;
  }

  updatePlan(id: string, plan: TaskGraphSpec, graphId: string): GoalRecord {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE goals SET plan_json = ?, graph_id = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(plan), graphId, ts, id);
    const g = this.get(id);
    if (!g) throw new ForgeError(`Goal missing: ${id}`, "GOAL_MISSING");
    return g;
  }

  updateGraphSnapshot(id: string, snapshot: TaskNodeState[]): GoalRecord {
    const ts = nowIso();
    this.db
      .prepare(`UPDATE goals SET graph_snapshot = ?, updated_at = ? WHERE id = ?`)
      .run(JSON.stringify(snapshot), ts, id);
    const g = this.get(id);
    if (!g) throw new ForgeError(`Goal missing: ${id}`, "GOAL_MISSING");
    return g;
  }

  updateVerification(
    id: string,
    verification: Record<string, unknown>,
    reviewSummary: string,
  ): GoalRecord {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE goals SET verification_json = ?, review_summary = ?, updated_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(verification), reviewSummary, ts, id);
    const g = this.get(id);
    if (!g) throw new ForgeError(`Goal missing: ${id}`, "GOAL_MISSING");
    return g;
  }
}
