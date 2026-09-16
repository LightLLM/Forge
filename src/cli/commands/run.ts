import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig, type CliOverrides } from "../../config/load.js";
import { TaskOrchestrator } from "../../agent/orchestrator.js";
import { OllamaProvider } from "../../models/ollama.js";
import { OpenRouterProvider } from "../../models/openrouter.js";
import { SqliteStore } from "../../persistence/sqlite.js";
import { rootLogger } from "../../telemetry/logger.js";
import type { RoutingMode } from "../../core/types.js";
import { loadDotEnv } from "../env.js";

export function registerRun(program: Command): void {
  program
    .command("run")
    .description("Run an autonomous coding task")
    .argument("<objective>", "What Forge should accomplish")
    .option("--mode <mode>", "local-only | local-preferred | cloud-allowed")
    .option("--local-model <model>", "Ollama model name")
    .option("--cloud-model <model>", "OpenRouter model name")
    .option("--max-turns <n>", "Maximum agent turns", (v: string) => Number(v))
    .option("--max-repairs <n>", "Maximum repair attempts", (v: string) => Number(v))
    .option(
      "--timeout <duration>",
      "Timeout minutes (number) or e.g. 30m",
      parseTimeoutMinutes,
    )
    .option("--workspace <path>", "Workspace path (default: cwd)")
    .action(async (objective: string, opts: Record<string, unknown>) => {
      const workspace = resolve(
        typeof opts.workspace === "string" ? opts.workspace : process.cwd(),
      );
      loadDotEnv(workspace);

      const overrides: CliOverrides = {};
      if (typeof opts.mode === "string") {
        overrides.mode = opts.mode as RoutingMode;
      }
      if (typeof opts.localModel === "string") overrides.localModel = opts.localModel;
      if (typeof opts.cloudModel === "string") overrides.cloudModel = opts.cloudModel;
      if (typeof opts.maxTurns === "number") overrides.maxTurns = opts.maxTurns;
      if (typeof opts.maxRepairs === "number") overrides.maxRepairs = opts.maxRepairs;
      if (typeof opts.timeout === "number") overrides.timeoutMinutes = opts.timeout;

      const config = loadConfig(workspace, overrides);
      const store = new SqliteStore(config.dbPath);
      store.initialize();

      const ollama = new OllamaProvider({ baseUrl: config.ollamaBaseUrl });
      const openrouter = config.openRouterApiKey
        ? new OpenRouterProvider({ apiKey: config.openRouterApiKey })
        : null;

      const orchestrator = new TaskOrchestrator({
        store,
        config,
        logger: rootLogger.child("run"),
        ollama,
        openrouter,
      });

      console.log(`Forge run`);
      console.log(`  objective : ${objective}`);
      console.log(`  mode      : ${config.mode}`);
      console.log(`  workspace : ${workspace}`);
      console.log(`  local     : ${config.local.model || "(unset)"}`);
      console.log(`  cloud     : ${config.cloud.model || "(unset)"}`);
      console.log("");

      const controller = new AbortController();
      const onSig = () => controller.abort();
      process.on("SIGINT", onSig);
      process.on("SIGTERM", onSig);

      try {
        const report = await orchestrator.run({
          objective,
          workspacePath: workspace,
          signal: controller.signal,
        });

        console.log(`Task ${report.task.id}`);
        console.log(`  status      : ${report.task.status}`);
        console.log(`  turns       : ${report.task.turnCount}`);
        console.log(`  repairs     : ${report.task.repairCount}`);
        console.log(`  escalated   : ${report.escalated}`);
        console.log(`  cloud cost  : ${report.task.cloudCostUsd}`);
        if (report.verification) {
          console.log(`  verification: ${report.verification.status} — ${report.verification.summary}`);
        }
        if (report.task.error) {
          console.log(`  error       : ${report.task.error}`);
        }
        console.log(`  summary     : ${report.summary}`);
        if (report.finalDiff) {
          console.log("\n--- diff ---");
          console.log(report.finalDiff.slice(0, 20_000));
        }
        console.log(`\nInspect: forge inspect ${report.task.id}`);

        if (report.task.status !== "COMPLETED") {
          process.exitCode = 1;
        }
      } finally {
        process.off("SIGINT", onSig);
        process.off("SIGTERM", onSig);
        store.close();
      }
    });
}

function parseTimeoutMinutes(value: string): number {
  if (/^\d+$/.test(value)) return Number(value);
  const match = /^(\d+)\s*m(in(utes)?)?$/i.exec(value);
  if (match) return Number(match[1]);
  const hours = /^(\d+)\s*h(ours?)?$/i.exec(value);
  if (hours) return Number(hours[1]) * 60;
  throw new Error(`Invalid timeout: ${value}`);
}
