import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { loadDotEnv } from "../env.js";

export function registerStatus(program: Command): void {
  program
    .command("status")
    .description("Show task status and run metadata")
    .argument("<task-id>", "Task ID")
    .action((taskId: string) => {
      const workspace = resolve(process.cwd());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new SqliteStore(config.dbPath);
      store.initialize();
      try {
        const task = store.getTask(taskId);
        if (!task) {
          console.error(`Task not found: ${taskId}`);
          process.exitCode = 1;
          return;
        }
        const runs = store.listRuns(taskId);
        console.log(`Task ${task.id}`);
        console.log(`  status     : ${task.status}`);
        console.log(`  objective  : ${task.objective}`);
        console.log(`  mode       : ${task.routingMode}`);
        console.log(`  turns      : ${task.turnCount}/${task.maxTurns}`);
        console.log(`  repairs    : ${task.repairCount}/${task.maxRepairs}`);
        console.log(`  cloud cost : ${task.cloudCostUsd}${task.cloudBudgetUsd != null ? ` / ${task.cloudBudgetUsd}` : ""}`);
        console.log(`  created    : ${task.createdAt}`);
        console.log(`  updated    : ${task.updatedAt}`);
        if (task.error) console.log(`  error      : ${task.error}`);
        console.log(`  runs (${runs.length}):`);
        for (const run of runs) {
          console.log(
            `    - ${run.id.slice(0, 8)} ${run.provider}/${run.model} ${run.status}` +
              (run.escalationReason ? ` [escalated: ${run.escalationReason}]` : ""),
          );
        }
      } finally {
        store.close();
      }
    });
}
