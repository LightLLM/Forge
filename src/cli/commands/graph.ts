import type { Command } from "commander";
import { resolve } from "node:path";
import { loadConfig } from "../../config/load.js";
import {
  loadSpec,
  runTaskGraph,
  TaskGraph,
} from "../../scheduler/index.js";
import { createDirectiveExecutor } from "../../scheduler/executors.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerGraph(program: Command): void {
  const graph = program
    .command("graph")
    .description("Validate and run task DAGs (multi-task plans)");

  graph
    .command("validate")
    .description("Validate a plan JSON or decomposed objective")
    .argument("[plan]", "Path to plan.json (optional)")
    .option("--objective <text>", "Objective used when plan omitted or for decomposition")
    .action((plan: string | undefined, opts: { objective?: string }) => {
      try {
        const objective = opts.objective ?? "validate";
        const spec = loadSpec(objective, plan);
        const g = new TaskGraph(spec);
        console.log(`Graph OK: ${g.id}`);
        console.log(`Objective: ${g.objective}`);
        for (const n of g.list()) {
          console.log(
            `  ${n.id.padEnd(16)} deps=[${n.dependsOn.join(",")}]  ${n.objective.slice(0, 60)}`,
          );
        }
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });

  graph
    .command("run")
    .description("Execute a task DAG (directive executor unless --agent)")
    .argument("<plan>", "Path to plan.json")
    .option("--workspace <path>", "Workspace root")
    .option("--parallel <n>", "Max parallel workers", (v) => Number(v))
    .action(async (plan: string, opts: { workspace?: string; parallel?: number }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const parallel =
        opts.parallel && opts.parallel > 0
          ? opts.parallel
          : config.scheduler.maxParallelWorkers;

      console.log(`Forge graph run`);
      console.log(`  plan      : ${resolve(plan)}`);
      console.log(`  workspace : ${workspace}`);
      console.log(`  parallel  : ${parallel}`);
      console.log("");

      try {
        const result = await runTaskGraph({
          objective: "graph-run",
          workspacePath: workspace,
          maxParallelWorkers: parallel,
          plan: resolve(plan),
          executor: createDirectiveExecutor(workspace),
          onEvent: (e) => {
            if (e.type === "node_started") {
              console.log(`→ start ${e.node.id} (parallel=${e.parallelSlot})`);
            } else if (e.type === "node_finished") {
              console.log(
                `${e.ok ? "✓" : "✗"} ${e.node.id}  ${e.node.summary ?? e.node.error ?? ""}`,
              );
            }
          },
        });
        console.log("");
        console.log(`Graph ${result.status}`);
        console.log(`  max parallel observed: ${result.maxParallelObserved}`);
        for (const n of result.nodes) {
          console.log(`  ${n.status.padEnd(10)} ${n.id}`);
        }
        if (result.status !== "completed") process.exitCode = 1;
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exitCode = 1;
      }
    });
}
