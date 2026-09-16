import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { SkillValidator } from "./validator.js";
import { FORBIDDEN_SKILL_KEYS } from "./types.js";

export type SkillProposalKind =
  | "skill"
  | "context_strategy"
  | "routing_heuristic"
  | "debug_procedure"
  | "evaluation_case";

export interface SkillImprovementProposal {
  id: string;
  kind: SkillProposalKind;
  title: string;
  rationale: string;
  proposedContent: string;
  securityImpacting: boolean;
  status: "pending" | "approved" | "rejected" | "installed";
  createdAt: string;
  resolvedAt: string | null;
  decisionMaker: string | null;
}

const SECURITY_KEYWORDS = [
  "policy",
  "approval",
  "budget",
  "credential",
  "verification",
  "sandbox",
  "permission",
  "allowlist",
  "network",
];

/**
 * Propose skill improvements from outcomes. Never silently install
 * security-impacting changes; those require explicit human approval.
 */
export class SkillImprovementService {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
  }

  initialize(): void {
    this.db.exec(`
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
    `);
  }

  close(): void {
    this.db.close();
  }

  propose(input: {
    kind: SkillProposalKind;
    title: string;
    rationale: string;
    proposedContent: string;
  }): SkillImprovementProposal {
    const securityImpacting = detectSecurityImpact(input.proposedContent, input.title);
    const record: SkillImprovementProposal = {
      id: randomUUID(),
      kind: input.kind,
      title: input.title,
      rationale: input.rationale,
      proposedContent: input.proposedContent,
      securityImpacting,
      status: "pending",
      createdAt: new Date().toISOString(),
      resolvedAt: null,
      decisionMaker: null,
    };
    this.db
      .prepare(
        `INSERT INTO skill_proposals
         (id, kind, title, rationale, proposed_content, security_impacting, status, created_at, resolved_at, decision_maker)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.kind,
        record.title,
        record.rationale,
        record.proposedContent,
        record.securityImpacting ? 1 : 0,
        record.status,
        record.createdAt,
        record.resolvedAt,
        record.decisionMaker,
      );
    return record;
  }

  get(id: string): SkillImprovementProposal | null {
    const row = this.db
      .prepare(`SELECT * FROM skill_proposals WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapProposal(row) : null;
  }

  list(status?: SkillImprovementProposal["status"]): SkillImprovementProposal[] {
    if (status) {
      return (
        this.db
          .prepare(`SELECT * FROM skill_proposals WHERE status = ? ORDER BY created_at DESC`)
          .all(status) as Record<string, unknown>[]
      ).map(mapProposal);
    }
    return (
      this.db
        .prepare(`SELECT * FROM skill_proposals ORDER BY created_at DESC`)
        .all() as Record<string, unknown>[]
    ).map(mapProposal);
  }

  resolve(
    id: string,
    decision: "approved" | "rejected",
    decisionMaker: string,
  ): SkillImprovementProposal {
    if (!decisionMaker || decisionMaker === "model" || decisionMaker === "agent") {
      throw new Error("Model/agent cannot approve skill proposals");
    }
    const current = this.get(id);
    if (!current) throw new Error(`Proposal not found: ${id}`);
    if (current.status !== "pending") {
      throw new Error(`Proposal already ${current.status}`);
    }
    const resolvedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE skill_proposals SET status = ?, decision_maker = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(decision, decisionMaker, resolvedAt, id);
    return this.get(id)!;
  }

  /**
   * Install only after human approval. Security-impacting proposals that try
   * to weaken policy are rejected even if somehow marked approved without maker.
   */
  install(id: string, skillsDir: string): { path: string; proposal: SkillImprovementProposal } {
    const proposal = this.get(id);
    if (!proposal) throw new Error(`Proposal not found: ${id}`);
    if (proposal.status !== "approved") {
      throw new Error(
        `Cannot install proposal in status=${proposal.status}; human approval required`,
      );
    }
    if (!proposal.decisionMaker || proposal.decisionMaker === "model") {
      throw new Error("Cannot install without human decision maker");
    }

    // Validate content does not smuggle forbidden privilege keys
    let parsed: unknown;
    try {
      parsed = JSON.parse(proposal.proposedContent);
    } catch {
      parsed = null;
    }
    if (parsed && typeof parsed === "object") {
      const validation = new SkillValidator().validateRaw(parsed);
      if (!validation.ok) {
        throw new Error(`Proposed skill invalid: ${validation.errors.join("; ")}`);
      }
    }
    if (proposal.securityImpacting && containsForbiddenPrivilege(proposal.proposedContent)) {
      throw new Error(
        "Refusing to install security-impacting skill that declares forbidden privileges",
      );
    }

    mkdirSync(skillsDir, { recursive: true });
    const slug = proposal.id.slice(0, 8);
    const skillRoot = join(skillsDir, `proposed-${slug}`);
    mkdirSync(skillRoot, { recursive: true });

    if (parsed && typeof parsed === "object") {
      writeFileSync(join(skillRoot, "skill.json"), JSON.stringify(parsed, null, 2) + "\n");
      writeFileSync(
        join(skillRoot, "SKILL.md"),
        `# ${proposal.title}\n\n${proposal.rationale}\n`,
      );
    } else {
      writeFileSync(
        join(skillRoot, "skill.json"),
        JSON.stringify(
          {
            id: `proposed-${slug}`,
            name: proposal.title,
            description: proposal.rationale.slice(0, 200),
            tags: ["proposed"],
          },
          null,
          2,
        ) + "\n",
      );
      writeFileSync(join(skillRoot, "SKILL.md"), proposal.proposedContent);
    }

    const resolvedAt = new Date().toISOString();
    this.db
      .prepare(`UPDATE skill_proposals SET status = 'installed', resolved_at = ? WHERE id = ?`)
      .run(resolvedAt, id);

    return { path: skillRoot, proposal: this.get(id)! };
  }

  /** Attempt silent install — always throws for security-impacting. */
  trySilentInstall(id: string, _skillsDir: string): never {
    const proposal = this.get(id);
    if (proposal?.securityImpacting) {
      throw new Error("Silent install of security-impacting skill changes is forbidden");
    }
    throw new Error("Silent skill install is forbidden; use approve then install");
  }
}

export function detectSecurityImpact(content: string, title = ""): boolean {
  const hay = `${title}\n${content}`.toLowerCase();
  if (SECURITY_KEYWORDS.some((k) => hay.includes(k))) return true;
  for (const key of FORBIDDEN_SKILL_KEYS) {
    if (hay.includes(`"${key}"`) || hay.includes(`'${key}'`)) return true;
  }
  return false;
}

function containsForbiddenPrivilege(content: string): boolean {
  try {
    const obj = JSON.parse(content) as Record<string, unknown>;
    return Object.keys(obj).some((k) =>
      (FORBIDDEN_SKILL_KEYS as readonly string[]).includes(k.toLowerCase()),
    );
  } catch {
    return SECURITY_KEYWORDS.some((k) => content.toLowerCase().includes(k));
  }
}

function mapProposal(row: Record<string, unknown>): SkillImprovementProposal {
  return {
    id: String(row.id),
    kind: row.kind as SkillProposalKind,
    title: String(row.title),
    rationale: String(row.rationale),
    proposedContent: String(row.proposed_content),
    securityImpacting: Boolean(row.security_impacting),
    status: row.status as SkillImprovementProposal["status"],
    createdAt: String(row.created_at),
    resolvedAt: (row.resolved_at as string | null) ?? null,
    decisionMaker: (row.decision_maker as string | null) ?? null,
  };
}

export function proposalsDir(workspaceRoot: string): string {
  const dir = join(workspaceRoot, ".forge", "skills");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}
