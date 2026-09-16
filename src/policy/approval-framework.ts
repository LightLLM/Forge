import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { PersistenceStore } from "../persistence/store.js";

export type RestrictedActionKind =
  | "cloud_escalation"
  | "large_cloud_spend"
  | "git_push"
  | "pr_create"
  | "merge"
  | "deployment"
  | "database_migration"
  | "production_access"
  | "external_communication"
  | "destructive_action"
  | "skill_install"
  | "custom";

export interface RestrictedActionRequest {
  taskId: string;
  kind: RestrictedActionKind;
  reason: string;
  risk: "low" | "medium" | "high" | "critical";
  evidence?: string;
  requestingAgent?: string;
  /** When true, silence / timeout never grants approval. */
  requireExplicit?: boolean;
}

export interface DurableApproval {
  id: string;
  taskId: string;
  kind: RestrictedActionKind;
  reason: string;
  risk: string;
  evidence: string | null;
  requestingAgent: string | null;
  status: "pending" | "approved" | "denied";
  decisionMaker: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/**
 * Explicit human approval for restricted actions.
 * Never infers approval from silence. Model cannot self-approve.
 */
export class ApprovalFramework {
  private readonly db: DatabaseSync;

  constructor(
    dbPath: string,
    private readonly store?: PersistenceStore,
  ) {
    this.db = new DatabaseSync(dbPath);
  }

  initialize(): void {
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_restricted_approvals_status
        ON restricted_approvals(status);
    `);
  }

  close(): void {
    this.db.close();
  }

  request(input: RestrictedActionRequest): DurableApproval {
    const record: DurableApproval = {
      id: randomUUID(),
      taskId: input.taskId,
      kind: input.kind,
      reason: input.reason,
      risk: input.risk,
      evidence: input.evidence ?? null,
      requestingAgent: input.requestingAgent ?? null,
      status: "pending",
      decisionMaker: null,
      createdAt: new Date().toISOString(),
      resolvedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO restricted_approvals
         (id, task_id, kind, reason, risk, evidence, requesting_agent, status, decision_maker, created_at, resolved_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.taskId,
        record.kind,
        record.reason,
        record.risk,
        record.evidence,
        record.requestingAgent,
        record.status,
        record.decisionMaker,
        record.createdAt,
        record.resolvedAt,
      );

    // Mirror into core approvals table for CLI/dashboard sync when store present
    try {
      this.store?.createApproval(
        input.taskId,
        `restricted:${input.kind}`,
        `${input.risk}: ${input.reason}`,
      );
    } catch {
      // Task may not exist yet — restricted table is source of truth
    }

    return record;
  }

  get(id: string): DurableApproval | null {
    const row = this.db
      .prepare(`SELECT * FROM restricted_approvals WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  }

  resolve(
    id: string,
    decision: "approved" | "denied",
    decisionMaker: string,
  ): DurableApproval {
    if (!decisionMaker || decisionMaker === "model" || decisionMaker === "agent") {
      throw new Error("Model/agent cannot approve restricted actions");
    }
    const current = this.get(id);
    if (!current) throw new Error(`Approval not found: ${id}`);
    if (current.status !== "pending") {
      throw new Error(`Approval already ${current.status}`);
    }
    const resolvedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE restricted_approvals
         SET status = ?, decision_maker = ?, resolved_at = ?
         WHERE id = ?`,
      )
      .run(decision, decisionMaker, resolvedAt, id);
    return this.get(id)!;
  }

  /**
   * Execute only if explicitly approved. Silence / pending = deny.
   */
  assertApproved(id: string): DurableApproval {
    const a = this.get(id);
    if (!a) throw new Error("Restricted action has no approval record");
    if (a.status !== "approved") {
      throw new Error(
        `Restricted action blocked: status=${a.status} (silence is not approval)`,
      );
    }
    return a;
  }

  listPending(taskId?: string): DurableApproval[] {
    if (taskId) {
      return (
        this.db
          .prepare(
            `SELECT * FROM restricted_approvals WHERE status = 'pending' AND task_id = ? ORDER BY created_at`,
          )
          .all(taskId) as Record<string, unknown>[]
      ).map(mapRow);
    }
    return (
      this.db
        .prepare(
          `SELECT * FROM restricted_approvals WHERE status = 'pending' ORDER BY created_at`,
        )
        .all() as Record<string, unknown>[]
    ).map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): DurableApproval {
  return {
    id: String(row.id),
    taskId: String(row.task_id),
    kind: row.kind as DurableApproval["kind"],
    reason: String(row.reason),
    risk: String(row.risk),
    evidence: (row.evidence as string | null) ?? null,
    requestingAgent: (row.requesting_agent as string | null) ?? null,
    status: row.status as DurableApproval["status"],
    decisionMaker: (row.decision_maker as string | null) ?? null,
    createdAt: String(row.created_at),
    resolvedAt: (row.resolved_at as string | null) ?? null,
  };
}
