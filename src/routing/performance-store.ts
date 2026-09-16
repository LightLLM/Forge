import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { ProviderKind } from "../core/types.js";

export interface PerformanceRecord {
  providerKind: ProviderKind;
  model: string;
  taskCategory: string;
  success: boolean;
  latencyMs: number;
  costUsd: number;
  recordedAt: string;
}

export interface ModelScore {
  model: string;
  providerKind: ProviderKind;
  successRate: number;
  samples: number;
  avgLatencyMs: number;
}

export class PerformanceStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
  }

  initialize(): void {
    this.db.exec(`
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
      CREATE INDEX IF NOT EXISTS idx_model_perf_lookup
        ON model_performance(provider_kind, model, task_category);
    `);
  }

  close(): void {
    this.db.close();
  }

  record(input: Omit<PerformanceRecord, "recordedAt">): void {
    this.db
      .prepare(
        `INSERT INTO model_performance
         (id, provider_kind, model, task_category, success, latency_ms, cost_usd, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.providerKind,
        input.model,
        input.taskCategory,
        input.success ? 1 : 0,
        input.latencyMs,
        input.costUsd,
        new Date().toISOString(),
      );
  }

  scoreModels(
    providerKind: ProviderKind,
    models: string[],
    taskCategory = "general",
  ): ModelScore[] {
    return models.map((model) => {
      const rows = this.db
        .prepare(
          `SELECT success, latency_ms FROM model_performance
           WHERE provider_kind = ? AND model = ? AND task_category = ?`,
        )
        .all(providerKind, model, taskCategory) as {
        success: number;
        latency_ms: number;
      }[];
      if (rows.length === 0) {
        return {
          model,
          providerKind,
          successRate: 0.5,
          samples: 0,
          avgLatencyMs: 0,
        };
      }
      const successes = rows.filter((r) => r.success === 1).length;
      return {
        model,
        providerKind,
        successRate: successes / rows.length,
        samples: rows.length,
        avgLatencyMs: Math.round(
          rows.reduce((s, r) => s + r.latency_ms, 0) / rows.length,
        ),
      };
    });
  }

  bestModel(
    providerKind: ProviderKind,
    models: string[],
    taskCategory = "general",
  ): ModelScore {
    const scores = this.scoreModels(providerKind, models, taskCategory);
    return scores.sort((a, b) => {
      if (b.successRate !== a.successRate) return b.successRate - a.successRate;
      return a.avgLatencyMs - b.avgLatencyMs;
    })[0]!;
  }
}
