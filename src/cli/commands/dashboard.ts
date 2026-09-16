import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { DashboardServer } from "../../dashboard/index.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerDashboard(program: Command): void {
  const cmd = program
    .command("dashboard")
    .description("Lightweight operator dashboard (same backend as CLI)");

  cmd
    .command("start")
    .description("Start local HTTP dashboard")
    .option("--workspace <path>", "Workspace path")
    .option("--host <host>", "Bind host", "127.0.0.1")
    .option("--port <port>", "Bind port (0 = ephemeral)", "8787")
    .action(async (opts: { workspace?: string; host: string; port: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new SqliteStore(config.dbPath);
      store.initialize();

      const handle = await new DashboardServer({
        store,
        dbPath: config.dbPath,
        host: opts.host,
        port: Number(opts.port),
      }).start();

      console.log(`Forge dashboard: ${handle.url}`);
      console.log("Press Ctrl+C to stop.");

      const shutdown = async () => {
        await handle.close();
        store.close();
        process.exit(0);
      };
      process.on("SIGINT", () => void shutdown());
      process.on("SIGTERM", () => void shutdown());

      // Keep process alive
      await new Promise(() => undefined);
    });
}
