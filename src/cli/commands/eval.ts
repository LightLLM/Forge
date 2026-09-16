import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  BUILTIN_EVAL_DATASET,
  EvalRunner,
  EvalStore,
  loadEvalDataset,
} from "../../eval/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerEval(program: Command): void {
  const evalCmd = program.command("eval").description("Model evaluation datasets and metrics");

  evalCmd
    .command("run")
    .description("Run an evaluation dataset")
    .option("--workspace <path>", "Workspace path")
    .option("--dataset <path>", "Dataset JSON path")
    .action(async (opts: { workspace?: string; dataset?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const dataset = opts.dataset
        ? loadEvalDataset(resolve(workspace, opts.dataset))
        : BUILTIN_EVAL_DATASET;

      const runner = new EvalRunner();
      const report = await runner.run(dataset);

      const store = new EvalStore(config.dbPath);
      store.initialize();
      store.saveReport(report);
      store.close();

      console.log(`Eval run ${report.runId}`);
      console.log(`Dataset: ${report.datasetId}`);
      for (const s of report.summaries) {
        console.log(
          `  ${s.modelId.padEnd(12)} pass=${(s.passRate * 100).toFixed(0)}% (${s.passed}/${s.passed + s.failed}) avg=${s.avgLatencyMs}ms`,
        );
      }
    });

  evalCmd
    .command("models")
    .description("Show model summaries from recent eval runs")
    .option("--workspace <path>", "Workspace path")
    .action((opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new EvalStore(config.dbPath);
      store.initialize();
      const runs = store.listRuns(5);
      store.close();
      if (runs.length === 0) {
        console.log("No eval runs yet. Try: forge eval run");
        return;
      }
      for (const run of runs) {
        console.log(`Run ${run.runId.slice(0, 8)}… ${run.datasetId} @ ${run.finishedAt}`);
        for (const s of run.summaries) {
          console.log(
            `  ${s.modelId.padEnd(12)} pass=${(s.passRate * 100).toFixed(0)}% samples=${s.passed + s.failed}`,
          );
        }
      }
    });

  evalCmd
    .command("report")
    .description("Print a detailed eval report")
    .argument("[run-id]", "Run id (latest if omitted)")
    .option("--workspace <path>", "Workspace path")
    .action((runId: string | undefined, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new EvalStore(config.dbPath);
      store.initialize();
      const run = runId
        ? store.getRun(runId)
        : store.listRuns(1)[0] ?? null;
      store.close();
      if (!run) {
        console.log("No eval report found.");
        return;
      }
      console.log(JSON.stringify(run, null, 2));
    });
}
