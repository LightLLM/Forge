import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { CreateFailureInput, FailureEntry, FailureMatch } from "./types.js";
import { ForgeError } from "../core/types.js";

function nowIso(): string {
  return new Date().toISOString();
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 2);
}

/**
 * Structured failure corpus with retrieval of prior successful fixes.
 */
export class FailureCorpus {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize(): void {
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_failure_corpus_symptom ON failure_corpus(symptom);
    `);
  }

  close(): void {
    this.db.close();
  }

  record(input: CreateFailureInput): FailureEntry {
    const ts = nowIso();
    const entry: FailureEntry = {
      id: randomUUID(),
      symptom: input.symptom,
      cause: input.cause ?? null,
      fix: input.fix,
      tags: input.tags ?? [],
      successEvidence: input.successEvidence ?? null,
      relatedSolutionId: null,
      createdAt: ts,
      updatedAt: ts,
    };
    this.db
      .prepare(
        `INSERT INTO failure_corpus
         (id, symptom, cause, fix, tags, success_evidence, related_solution_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.symptom,
        entry.cause,
        entry.fix,
        JSON.stringify(entry.tags),
        entry.successEvidence,
        null,
        entry.createdAt,
        entry.updatedAt,
      );
    return entry;
  }

  linkSolution(failureId: string, solutionEvidence: string): FailureEntry {
    const ts = nowIso();
    this.db
      .prepare(
        `UPDATE failure_corpus SET success_evidence = ?, updated_at = ? WHERE id = ?`,
      )
      .run(solutionEvidence, ts, failureId);
    const row = this.get(failureId);
    if (!row) throw new ForgeError(`Failure entry missing: ${failureId}`, "FAILURE_MISSING");
    return row;
  }

  get(id: string): FailureEntry | null {
    const row = this.db.prepare(`SELECT * FROM failure_corpus WHERE id = ?`).get(id) as
      | {
          id: string;
          symptom: string;
          cause: string | null;
          fix: string;
          tags: string;
          success_evidence: string | null;
          related_solution_id: string | null;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      symptom: row.symptom,
      cause: row.cause,
      fix: row.fix,
      tags: JSON.parse(row.tags) as string[],
      successEvidence: row.success_evidence,
      relatedSolutionId: row.related_solution_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  search(query: string, limit = 5): FailureMatch[] {
    const qTokens = new Set(tokenize(query));
    const rows = this.db
      .prepare(`SELECT * FROM failure_corpus ORDER BY updated_at DESC LIMIT 200`)
      .all() as {
      id: string;
      symptom: string;
      cause: string | null;
      fix: string;
      tags: string;
      success_evidence: string | null;
      related_solution_id: string | null;
      created_at: string;
      updated_at: string;
    }[];

    const scored: FailureMatch[] = [];
    for (const row of rows) {
      const entry: FailureEntry = {
        id: row.id,
        symptom: row.symptom,
        cause: row.cause,
        fix: row.fix,
        tags: JSON.parse(row.tags) as string[],
        successEvidence: row.success_evidence,
        relatedSolutionId: row.related_solution_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
      const hay = tokenize(
        [entry.symptom, entry.cause ?? "", entry.fix, ...entry.tags].join(" "),
      );
      let overlap = 0;
      for (const t of hay) {
        if (qTokens.has(t)) overlap += 1;
      }
      if (overlap === 0) continue;
      scored.push({
        entry,
        score: overlap,
        reason: `${overlap} keyword overlap`,
      });
    }
    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /** Return best prior successful fix evidence for a symptom. */
  retrieveSolutionEvidence(symptom: string): string | null {
    const matches = this.search(symptom, 3);
    for (const m of matches) {
      if (m.entry.successEvidence) return m.entry.successEvidence;
    }
    for (const m of matches) {
      if (m.entry.fix) return m.entry.fix;
    }
    return null;
  }
}
