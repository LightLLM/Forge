import type { ResolvedConfig } from "../config/load.js";
import type { PersistenceStore } from "./store.js";
import { SqliteStore } from "./sqlite.js";
import { PostgresStore } from "./postgres.js";

/**
 * Open the harness persistence backend.
 *
 * Default: SQLite (sync PersistenceStore used by the orchestrator).
 * When FORGE_DATABASE_URL is set, schema is ensured on Postgres and a warning
 * is emitted — the live agent loop still uses SQLite until the orchestrator
 * is fully async. Use `PostgresStore` programmatically for PG-native apps.
 */
export async function openStore(config: ResolvedConfig): Promise<PersistenceStore> {
  const url = config.databaseUrl ?? process.env.FORGE_DATABASE_URL ?? null;
  if (url) {
    try {
      const pg = new PostgresStore(url);
      await pg.initialize();
      await pg.close();
      console.warn(
        "[forge] FORGE_DATABASE_URL detected: PostgreSQL schema ensured. " +
          "CLI/orchestrator still uses SQLite for sync I/O; use PostgresStore for async PG access.",
      );
    } catch (err) {
      console.warn(
        `[forge] PostgreSQL init failed (${err instanceof Error ? err.message : String(err)}); continuing with SQLite.`,
      );
    }
  }

  const store = new SqliteStore(config.dbPath);
  store.initialize();
  return store;
}
