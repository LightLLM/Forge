import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { EvalRunReport } from "./types.js";

export class EvalStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS eval_runs (
        id TEXT PRIMARY KEY,
        dataset_id TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT NOT NULL,
        report_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eval_runs_dataset ON eval_runs(dataset_id);
    `);
  }

  close(): void {
    this.db.close();
  }

  saveReport(report: EvalRunReport): void {
    this.db
      .prepare(
        `INSERT INTO eval_runs (id, dataset_id, started_at, finished_at, report_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        report.runId,
        report.datasetId,
        report.startedAt,
        report.finishedAt,
        JSON.stringify(report),
      );
  }

  listRuns(limit = 20): EvalRunReport[] {
    const rows = this.db
      .prepare(`SELECT report_json FROM eval_runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as { report_json: string }[];
    return rows.map((r) => JSON.parse(r.report_json) as EvalRunReport);
  }

  getRun(id: string): EvalRunReport | null {
    const row = this.db
      .prepare(`SELECT report_json FROM eval_runs WHERE id = ?`)
      .get(id) as { report_json: string } | undefined;
    return row ? (JSON.parse(row.report_json) as EvalRunReport) : null;
  }
}
