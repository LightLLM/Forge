import { resolve } from "node:path";
import { spawn } from "node:child_process";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import { rootLogger } from "../../telemetry/logger.js";
import {
  ForgeDaemon,
  JobStore,
  assertJobKind,
  getDaemonStatus,
  requestDaemonStop,
  type JobKind,
} from "../../daemon/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerDaemon(program: Command): void {
  const cmd = program
    .command("daemon")
    .description("Persistent Forge daemon (queue, workers, crash recovery)");

  cmd
    .command("start")
    .description("Start the Forge daemon")
    .option("--workspace <path>", "Workspace path")
    .option("--workers <n>", "Max parallel workers", (v: string) => Number(v))
    .option("--foreground", "Run in the current process (default)", true)
    .option("--detach", "Spawn a background daemon process")
    .option("--no-recover", "Skip orphan job recovery on start")
    .action(
      async (opts: {
        workspace?: string;
        workers?: number;
        foreground?: boolean;
        detach?: boolean;
        recover?: boolean;
      }) => {
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);

        if (opts.detach) {
          const cli = process.argv[1];
          if (!cli) {
            console.error("Cannot detach: CLI path unknown");
            process.exitCode = 1;
            return;
          }
          const child = spawn(
            process.execPath,
            [
              cli,
              "daemon",
              "start",
              "--foreground",
              "--workspace",
              workspace,
              ...(typeof opts.workers === "number" && !Number.isNaN(opts.workers)
                ? ["--workers", String(opts.workers)]
                : []),
              ...(opts.recover === false ? ["--no-recover"] : []),
            ],
            {
              detached: true,
              stdio: "ignore" as const,
              cwd: workspace,
              env: process.env,
              windowsHide: true,
            },
          );
          child.unref();
          console.log(`Daemon spawning (pid ${child.pid}) in ${workspace}`);
          await new Promise((r) => setTimeout(r, 400));
          const status = getDaemonStatus(workspace);
          if (status.alive && status.state) {
            console.log(`Daemon running pid=${status.state.pid}`);
          } else {
            console.log("Daemon spawn requested; run `forge daemon status` to confirm.");
          }
          return;
        }

        const maxWorkers =
          typeof opts.workers === "number" && !Number.isNaN(opts.workers)
            ? opts.workers
            : config.daemon.maxWorkers;

        const daemon = new ForgeDaemon({
          workspacePath: workspace,
          dbPath: config.dbPath,
          maxWorkers,
          pollIntervalMs: config.daemon.pollIntervalMs,
          heartbeatIntervalMs: config.daemon.heartbeatIntervalMs,
          staleJobMs: config.daemon.staleJobMs,
          recoverOnStart: opts.recover !== false,
          logger: rootLogger.child("daemon"),
        });

        const handle = daemon.start();
        console.log(`Forge daemon running`);
        console.log(`  pid       : ${process.pid}`);
        console.log(`  workspace : ${workspace}`);
        console.log(`  db        : ${config.dbPath}`);
        console.log(`  workers   : ${maxWorkers}`);
        console.log(`  Ctrl+C to stop`);

        const onSig = () => {
          void handle.stop().then(() => {
            process.exit(0);
          });
        };
        process.on("SIGINT", onSig);
        process.on("SIGTERM", onSig);

        await handle.done;
      },
    );

  cmd
    .command("status")
    .description("Show daemon status and job queue counts")
    .option("--workspace <path>", "Workspace path")
    .action((opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);
      const status = getDaemonStatus(workspace);

      if (!status.state) {
        // Still show queue if DB exists
        try {
          const store = new JobStore(config.dbPath);
          store.initialize();
          const counts = store.counts();
          store.close();
          console.log("Daemon: not running");
          console.log(
            `Queue: queued=${counts.queued} running=${counts.running} completed=${counts.completed} failed=${counts.failed}`,
          );
        } catch {
          console.log("Daemon: not running");
        }
        return;
      }

      console.log(`Daemon: ${status.alive ? "running" : "stale"}`);
      console.log(`  pid       : ${status.state.pid}`);
      console.log(`  status    : ${status.state.status}`);
      console.log(`  workspace : ${status.state.workspacePath}`);
      console.log(`  workers   : ${status.state.activeWorkers}/${status.state.maxWorkers}`);
      console.log(`  heartbeat : ${status.state.heartbeatAt}`);
      console.log(`  started   : ${status.state.startedAt}`);
      if (status.counts) {
        const c = status.counts;
        console.log(
          `Queue: queued=${c.queued} running=${c.running} completed=${c.completed} failed=${c.failed} cancelled=${c.cancelled}`,
        );
      }
    });

  cmd
    .command("stop")
    .description("Stop a running Forge daemon")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      const next = requestDaemonStop(workspace);
      if (!next) {
        console.log("No daemon state found.");
        return;
      }
      console.log(`Stop requested for pid ${next.pid}`);
      // Wait briefly for graceful exit
      for (let i = 0; i < 40; i++) {
        const s = getDaemonStatus(workspace);
        if (!s.alive || s.state?.status === "stopped") {
          console.log("Daemon stopped.");
          return;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      console.log("Daemon stop signaled; check `forge daemon status`.");
    });

  cmd
    .command("enqueue")
    .description("Enqueue a durable daemon job")
    .argument("<kind>", "echo | sleep | write_file | agent_task")
    .option("--workspace <path>", "Workspace path")
    .option("--message <text>", "echo payload message")
    .option("--ms <n>", "sleep duration ms", (v: string) => Number(v))
    .option("--path <rel>", "write_file relative path")
    .option("--content <text>", "write_file content")
    .option("--max-attempts <n>", "Max attempts", (v: string) => Number(v))
    .action(
      (
        kindArg: string,
        opts: {
          workspace?: string;
          message?: string;
          ms?: number;
          path?: string;
          content?: string;
          maxAttempts?: number;
        },
      ) => {
        assertJobKind(kindArg);
        const kind = kindArg as JobKind;
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);
        const store = new JobStore(config.dbPath);
        store.initialize();

        const payload: Record<string, unknown> = {};
        if (kind === "echo") payload.message = opts.message ?? "hello";
        if (kind === "sleep") payload.ms = opts.ms ?? 100;
        if (kind === "write_file") {
          payload.path = opts.path ?? "daemon-out.txt";
          payload.content = opts.content ?? "";
        }

        const job = store.enqueue({
          kind,
          payload,
          maxAttempts:
            typeof opts.maxAttempts === "number" && !Number.isNaN(opts.maxAttempts)
              ? opts.maxAttempts
              : undefined,
        });
        store.close();
        console.log(`Enqueued ${job.id} kind=${job.kind} status=${job.status}`);
      },
    );
}
