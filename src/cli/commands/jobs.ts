import { resolve } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  ANALYSIS_CATALOG,
  JobScheduler,
  ScheduleStore,
  assertAnalysisId,
  runAnalysis,
  writeAnalysisArtifact,
  type AnalysisId,
} from "../../jobs/index.js";
import { JobStore } from "../../daemon/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerJobs(program: Command): void {
  const cmd = program
    .command("jobs")
    .description("Background engineering analyses and schedules");

  cmd
    .command("catalog")
    .description("List built-in analysis job types")
    .action(() => {
      for (const a of ANALYSIS_CATALOG) {
        console.log(
          `${a.id.padEnd(20)} ${a.name} — ${a.description}`,
        );
      }
    });

  cmd
    .command("run")
    .description("Run an analysis immediately and record results")
    .argument("<analysis-id>", "Analysis id from catalog")
    .option("--workspace <path>", "Workspace path")
    .option("--enqueue", "Enqueue via job store instead of running inline")
    .action(
      (
        analysisIdArg: string,
        opts: { workspace?: string; enqueue?: boolean },
      ) => {
        assertAnalysisId(analysisIdArg);
        const analysisId = analysisIdArg as AnalysisId;
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);

        if (opts.enqueue) {
          const jobs = new JobStore(config.dbPath);
          jobs.initialize();
          const schedules = new ScheduleStore(config.dbPath);
          schedules.initialize();
          const scheduler = new JobScheduler({
            scheduleStore: schedules,
            jobStore: jobs,
          });
          const job = scheduler.enqueueNow(analysisId);
          jobs.close();
          schedules.close();
          console.log(`Enqueued analysis job ${job.id} (${analysisId})`);
          console.log("Start the daemon to execute: forge daemon start");
          return;
        }

        const report = runAnalysis(analysisId, workspace);
        const artifact = writeAnalysisArtifact(workspace, report);
        console.log(`Analysis: ${report.analysisId}`);
        console.log(`Summary : ${report.summary}`);
        console.log(`Findings: ${report.findings.length}`);
        console.log(`Proposal: ${report.proposal}`);
        console.log(`Artifact: ${artifact}`);
        for (const f of report.findings.slice(0, 20)) {
          console.log(
            `  [${f.severity}] ${f.title}${f.path ? ` @ ${f.path}${f.line ? `:${f.line}` : ""}` : ""}`,
          );
        }
      },
    );

  cmd
    .command("schedule")
    .description("Create a recurring analysis schedule")
    .argument("<analysis-id>", "Analysis id from catalog")
    .option("--workspace <path>", "Workspace path")
    .option("--name <name>", "Schedule display name")
    .option(
      "--every <ms>",
      "Interval milliseconds",
      (v: string) => Number(v),
    )
    .option(
      "--cron <expr>",
      '5-field UTC cron (e.g. "0 */6 * * *" every 6 hours)',
    )
    .option("--paused", "Create schedule paused")
    .action(
      (
        analysisIdArg: string,
        opts: {
          workspace?: string;
          name?: string;
          every?: number;
          cron?: string;
          paused?: boolean;
        },
      ) => {
        assertAnalysisId(analysisIdArg);
        const analysisId = analysisIdArg as AnalysisId;
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);
        const def = ANALYSIS_CATALOG.find((a) => a.id === analysisId)!;
        const everyMs =
          typeof opts.every === "number" && !Number.isNaN(opts.every)
            ? opts.every
            : config.jobs.defaultEveryMs || def.defaultEveryMs;

        const store = new ScheduleStore(config.dbPath);
        store.initialize();
        const schedule = store.create({
          name: opts.name ?? def.name,
          analysisId,
          everyMs,
          cronExpr: opts.cron ?? null,
          status: opts.paused ? "paused" : "active",
        });
        store.close();
        console.log(
          `Scheduled ${schedule.id} analysis=${schedule.analysisId}` +
            (schedule.cronExpr
              ? ` cron="${schedule.cronExpr}"`
              : ` everyMs=${schedule.everyMs}`) +
            ` next=${schedule.nextRunAt}`,
        );
      },
    );

  cmd
    .command("schedules")
    .description("List analysis schedules")
    .option("--workspace <path>", "Workspace path")
    .action((opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new ScheduleStore(config.dbPath);
      store.initialize();
      const list = store.list();
      store.close();
      if (list.length === 0) {
        console.log("No schedules.");
        return;
      }
      for (const s of list) {
        console.log(
          `${s.id.slice(0, 8)}… ${s.status.padEnd(8)} ${s.analysisId.padEnd(18)} ` +
            (s.cronExpr ? `cron="${s.cronExpr}"` : `every=${s.everyMs}ms`) +
            ` runs=${s.runCount} next=${s.nextRunAt}`,
        );
      }
    });

  cmd
    .command("pause")
    .description("Pause a schedule")
    .argument("<schedule-id>", "Schedule id")
    .option("--workspace <path>", "Workspace path")
    .action((id: string, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new ScheduleStore(config.dbPath);
      store.initialize();
      const s = store.setStatus(id, "paused");
      store.close();
      console.log(`Paused ${s.id}`);
    });

  cmd
    .command("resume")
    .description("Resume a paused schedule")
    .argument("<schedule-id>", "Schedule id")
    .option("--workspace <path>", "Workspace path")
    .action((id: string, opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const store = new ScheduleStore(config.dbPath);
      store.initialize();
      const s = store.setStatus(id, "active");
      store.close();
      console.log(`Resumed ${s.id} next=${s.nextRunAt}`);
    });

  cmd
    .command("results")
    .description("Show latest analysis artifact paths")
    .option("--workspace <path>", "Workspace path")
    .action((opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      const dir = resolve(workspace, ".forge", "artifacts", "jobs");
      if (!existsSync(dir)) {
        console.log("No analysis artifacts yet.");
        return;
      }
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".json"))
        .sort();
      for (const f of files.slice(-20)) {
        const raw = readFileSync(resolve(dir, f), "utf8");
        try {
          const j = JSON.parse(raw) as { analysisId?: string; summary?: string };
          console.log(`${f}  ${j.analysisId ?? "?"}  ${j.summary ?? ""}`);
        } catch {
          console.log(f);
        }
      }
    });
}
