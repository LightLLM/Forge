import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { loadDotEnv } from "../env.js";

export function registerInspect(program: Command): void {
  program
    .command("inspect")
    .description("Show detailed task audit history")
    .argument("<task-id>", "Task ID")
    .option("--json", "Emit JSON", false)
    .action((taskId: string, opts: { json: boolean }) => {
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
        const events = store.listEvents(taskId);
        const artifacts = store.listArtifacts(taskId);

        if (opts.json) {
          console.log(JSON.stringify({ task, runs, events, artifacts }, null, 2));
          return;
        }

        console.log(`\n=== Task ${task.id} ===`);
        console.log(`Objective : ${task.objective}`);
        console.log(`Status    : ${task.status}`);
        console.log(`Mode      : ${task.routingMode}`);
        console.log(`Plan      : ${task.plan ?? "(none)"}`);
        console.log(`Local     : ${task.localModel ?? "(none)"}`);
        console.log(`Cloud     : ${task.cloudModel ?? "(none)"}`);
        console.log(`Turns     : ${task.turnCount}/${task.maxTurns}`);
        console.log(`Repairs   : ${task.repairCount}/${task.maxRepairs}`);
        console.log(`Cloud USD : ${task.cloudCostUsd}`);
        if (task.error) console.log(`Error     : ${task.error}`);

        console.log(`\n--- Provider / model history ---`);
        for (const run of runs) {
          console.log(
            `  ${run.startedAt}  ${run.provider}/${run.model}  ${run.status}` +
              `  tools=${run.toolCallCount}` +
              (run.escalationReason ? `  escalate=${run.escalationReason}` : ""),
          );
        }

        console.log(`\n--- Events (${events.length}) ---`);
        for (const event of events) {
          const compact = JSON.stringify(event.payload);
          console.log(
            `  ${event.createdAt}  ${event.type}  ${compact.slice(0, 160)}`,
          );
        }

        const diffs = artifacts.filter((a) => a.kind === "diff");
        const verifications = artifacts.filter((a) => a.kind === "verification");
        console.log(`\n--- Artifacts ---`);
        console.log(`  verification reports: ${verifications.length}`);
        console.log(`  diffs: ${diffs.length}`);
        if (diffs.length > 0) {
          const last = diffs[diffs.length - 1];
          console.log(`\n--- Final diff ---`);
          console.log((last?.content ?? "").slice(0, 15_000) || "(empty)");
        }
        console.log("");
      } finally {
        store.close();
      }
    });
}
