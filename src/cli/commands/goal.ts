import { resolve } from "node:path";
import { Command } from "commander";
import type { Command as CommandType } from "commander";
import { loadConfig } from "../../config/load.js";
import { GoalEngine, GoalStore } from "../../goal/index.js";
import { rootLogger } from "../../telemetry/logger.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

async function runGoalObjective(
  objective: string,
  opts: { workspace?: string; plan?: string; parallel?: number },
): Promise<void> {
  const workspace = resolve(opts.workspace ?? resolveWorkspace());
  loadDotEnv(workspace);
  const config = loadConfig(workspace);
  const store = new GoalStore(config.dbPath);
  store.initialize();

  const engine = new GoalEngine({
    store,
    workspacePath: workspace,
    maxParallelWorkers:
      typeof opts.parallel === "number" && !Number.isNaN(opts.parallel)
        ? opts.parallel
        : config.scheduler.maxParallelWorkers,
    logger: rootLogger.child("goal"),
  });

  const record = engine.create(objective);
  console.log(`Goal ${record.id}`);
  console.log(`  objective : ${objective}`);
  console.log(`  workspace : ${workspace}`);
  console.log("");

  try {
    const result = await engine.run(record.id, opts.plan);
    console.log(`Goal ${result.status}`);
    console.log(`  phase     : ${result.phase}`);
    console.log(`  tasks     : ${result.nodesCompleted}/${result.nodesTotal}`);
    if (result.verification?.summary) {
      console.log(`  verify    : ${result.verification.summary}`);
    }
    if (result.error) {
      console.error(`  error     : ${result.error}`);
      process.exitCode = 1;
    } else if (result.status !== "completed") {
      process.exitCode = 1;
    }
  } finally {
    store.close();
  }
}

export function registerGoal(program: CommandType): void {
  const goal = program
    .command("goal")
    .description("Persistent multi-task engineering objectives");

  const runCmd = new Command("run")
    .description("Start a new goal (decompose → execute → verify)")
    .argument("<objective>", "High-level engineering objective")
    .option("--workspace <path>", "Workspace path")
    .option("--plan <path>", "Explicit plan.json path")
    .option("--parallel <n>", "Max parallel workers", (v: string) => Number(v))
    .action(runGoalObjective);

  goal.addCommand(runCmd, { isDefault: true });

  goal
    .command("resume")
    .description("Resume a persisted goal after restart")
    .argument("<goal-id>", "Goal id")
    .option("--workspace <path>", "Workspace path")
    .option("--plan <path>", "Override plan path")
    .option("--parallel <n>", "Max parallel workers", (v: string) => Number(v))
    .action(
      async (
        goalId: string,
        opts: { workspace?: string; plan?: string; parallel?: number },
      ) => {
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);
        const store = new GoalStore(config.dbPath);
        store.initialize();

        const existing = store.get(goalId);
        if (!existing) {
          console.error(`Goal not found: ${goalId}`);
          process.exitCode = 1;
          store.close();
          return;
        }

        const engine = new GoalEngine({
          store,
          workspacePath: existing.workspacePath,
          maxParallelWorkers:
            typeof opts.parallel === "number" && !Number.isNaN(opts.parallel)
              ? opts.parallel
              : config.scheduler.maxParallelWorkers,
          logger: rootLogger.child("goal"),
        });

        console.log(`Resuming goal ${goalId} (phase=${existing.phase})`);
        try {
          const result = await engine.run(goalId, opts.plan);
          console.log(`Goal ${result.status} phase=${result.phase}`);
          if (result.error) {
            console.error(result.error);
            process.exitCode = 1;
          } else if (result.status !== "completed") {
            process.exitCode = 1;
          }
        } finally {
          store.close();
        }
      },
    );

  goal
    .command("status")
    .description("Show goal status")
    .argument("[goal-id]", "Goal id (latest if omitted)")
    .option("--workspace <path>", "Workspace path")
    .action((goalId: string | undefined, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new GoalStore(config.dbPath);
      store.initialize();

      const record = goalId ? store.get(goalId) : store.list({ limit: 1 })[0] ?? null;
      store.close();

      if (!record) {
        console.log("No goals found.");
        return;
      }

      const nodes = record.graphSnapshot ?? [];
      const completed = nodes.filter((n) => n.status === "completed").length;
      console.log(`Goal: ${record.id}`);
      console.log(`  phase     : ${record.phase}`);
      console.log(`  objective : ${record.objective}`);
      console.log(`  workspace : ${record.workspacePath}`);
      console.log(`  tasks     : ${completed}/${nodes.length || record.plan?.nodes.length || 0}`);
      if (record.error) console.log(`  error     : ${record.error}`);
      if (record.reviewSummary) console.log(`  review    : ${record.reviewSummary}`);
    });

  goal
    .command("list")
    .description("List persisted goals")
    .option("--workspace <path>", "Workspace path")
    .option("--limit <n>", "Max rows", (v: string) => Number(v))
    .action((opts: { workspace?: string; limit?: number }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new GoalStore(config.dbPath);
      store.initialize();
      const list = store.list({
        limit: typeof opts.limit === "number" ? opts.limit : 20,
      });
      store.close();
      if (list.length === 0) {
        console.log("No goals.");
        return;
      }
      for (const g of list) {
        console.log(
          `${g.id.slice(0, 8)}… ${g.phase.padEnd(12)} ${g.objective.slice(0, 60)}`,
        );
      }
    });
}
