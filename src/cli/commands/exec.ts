import { resolve } from "node:path";
import type { Command } from "commander";
import { loadConfig } from "../../config/load.js";
import {
  DockerExecutionBackend,
  LocalExecutionBackend,
  RemoteExecutionBackend,
  listBackendKinds,
  resolveExecutionBackend,
  runWithBackend,
  type ExecutionBackendMode,
} from "../../execution/index.js";
import { loadDotEnv, resolveWorkspace } from "../env.js";

export function registerExec(program: Command): void {
  const cmd = program
    .command("exec")
    .description("Execution backends (local / docker / remote adapter)");

  cmd
    .command("backends")
    .description("List execution backends and availability")
    .option("--workspace <path>", "Workspace path")
    .action(async (opts: { workspace?: string }) => {
      const workspace = resolve(opts.workspace ?? resolveWorkspace());
      loadDotEnv(workspace);
      const config = loadConfig(workspace);

      const local = new LocalExecutionBackend();
      const docker = new DockerExecutionBackend({
        image: config.commands.dockerImage,
        networkDisabled: config.commands.dockerNetworkDisabled,
        hardened: config.commands.dockerHardened,
        memoryLimit: config.commands.dockerMemoryLimit,
        pidsLimit: config.commands.dockerPidsLimit,
      });
      const remote = new RemoteExecutionBackend({
        endpoint: config.execution.remote.endpoint,
        tokenEnv: config.execution.remote.tokenEnv,
      });

      const availability: Record<string, boolean> = {
        local: await local.isAvailable(),
        docker: await docker.isAvailable(),
        remote: await remote.isAvailable(),
      };

      for (const info of listBackendKinds()) {
        console.log(
          `${info.kind.padEnd(8)} ${availability[info.kind] ? "available" : "unavailable"}  ${info.description}`,
        );
      }
      console.log(
        `config: execution.backend=${config.execution.backend} (commands.sandbox=${config.commands.sandbox})`,
      );
    });

  cmd
    .command("run")
    .description("Run a command through the ExecutionBackend interface")
    .argument("<command>", "Shell command to execute")
    .option("--workspace <path>", "Workspace path")
    .option("--backend <kind>", "auto|local|docker|remote")
    .action(
      async (
        command: string,
        opts: { workspace?: string; backend?: string },
      ) => {
        const workspace = resolve(opts.workspace ?? resolveWorkspace());
        loadDotEnv(workspace);
        const config = loadConfig(workspace);
        const mode = (opts.backend ??
          config.execution.backend) as ExecutionBackendMode;

        const backend = await resolveExecutionBackend({
          mode,
          sandbox: {
            mode: config.commands.sandbox,
            image: config.commands.dockerImage,
            networkDisabled: config.commands.dockerNetworkDisabled,
            hardened: config.commands.dockerHardened,
            memoryLimit: config.commands.dockerMemoryLimit,
            pidsLimit: config.commands.dockerPidsLimit,
          },
          remote: {
            endpoint: config.execution.remote.endpoint,
            tokenEnv: config.execution.remote.tokenEnv,
          },
        });

        console.log(`backend: ${backend.kind} (${backend.name})`);
        const result = await runWithBackend(backend, workspace, {
          command,
          timeoutMs: config.limits.commandTimeoutMs,
          maxOutputChars: config.limits.maxCommandOutputChars,
        });
        if (result.stdout) process.stdout.write(result.stdout);
        if (result.stderr) process.stderr.write(result.stderr);
        console.error(
          `\n[forge exec] exit=${result.exitCode} timedOut=${result.timedOut} durationMs=${result.durationMs} backend=${result.backend}`,
        );
        process.exitCode = result.exitCode === 0 ? 0 : (result.exitCode ?? 1);
      },
    );
}
