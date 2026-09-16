import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import { ForgeError } from "../core/types.js";
import type {
  CreateWorkspaceOptions,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
  ExecutionWorkspaceHandle,
} from "./types.js";
import { spawnCaptured } from "./local.js";

export interface DockerBackendOptions {
  image: string;
  networkDisabled?: boolean;
  hardened?: boolean;
  memoryLimit?: string;
  pidsLimit?: number;
}

let dockerAvailableCache: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailableCache != null) return dockerAvailableCache;
  dockerAvailableCache = await new Promise<boolean>((resolveAvail) => {
    const child = spawn("docker", ["info"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      resolveAvail(false);
    }, 4_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolveAvail(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolveAvail(code === 0);
    });
  });
  return dockerAvailableCache;
}

/** Reset cache (tests). */
export function resetDockerAvailabilityCache(): void {
  dockerAvailableCache = null;
}

function toDockerMount(hostPath: string): string {
  if (platform() === "win32") {
    return hostPath.replace(/\\/g, "/");
  }
  return hostPath;
}

/** Exported for tests — constructs `docker run` argv. */
export function buildDockerRunArgs(
  command: string,
  workspaceRoot: string,
  options: DockerBackendOptions,
): string[] {
  const mount = toDockerMount(workspaceRoot);
  const hardened = options.hardened !== false;
  const args = ["run", "--rm"];

  if (hardened) {
    args.push(
      "--security-opt",
      "no-new-privileges",
      "--cap-drop",
      "ALL",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,size=256m",
      "--pids-limit",
      String(options.pidsLimit ?? 256),
      "--memory",
      options.memoryLimit ?? "2g",
    );
  }

  args.push("-v", `${mount}:/workspace`, "-w", "/workspace");

  if (options.networkDisabled !== false) {
    args.push("--network", "none");
  }
  args.push(options.image, "sh", "-c", command);
  return args;
}

/**
 * Runs commands inside Docker using the same ExecutionBackend interface as local.
 */
export class DockerExecutionBackend implements ExecutionBackend {
  readonly kind = "docker" as const;
  readonly name = "docker";
  private readonly options: DockerBackendOptions;

  constructor(options: DockerBackendOptions) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    return isDockerAvailable();
  }

  async createWorkspace(
    opts: CreateWorkspaceOptions,
  ): Promise<ExecutionWorkspaceHandle> {
    if (!(await this.isAvailable())) {
      throw new ForgeError(
        "Docker execution backend unavailable",
        "DOCKER_UNAVAILABLE",
      );
    }
    return {
      id: `docker-${randomUUID().slice(0, 8)}`,
      hostPath: resolve(opts.hostPath),
      backend: "docker",
      label: opts.label,
      meta: { image: this.options.image },
    };
  }

  async execute(
    workspace: ExecutionWorkspaceHandle,
    req: ExecutionRequest,
  ): Promise<ExecutionResult> {
    if (!(await this.isAvailable())) {
      throw new ForgeError(
        "Docker execution backend unavailable",
        "DOCKER_UNAVAILABLE",
      );
    }
    const started = Date.now();
    const workdir = req.cwd
      ? resolve(workspace.hostPath, req.cwd)
      : workspace.hostPath;
    // Docker always mounts workspace.root; relative cwd is expressed in the shell command.
    const command =
      req.cwd && req.cwd !== "." && req.cwd !== ""
        ? `cd ${JSON.stringify(req.cwd)} && ${req.command}`
        : req.command;
    const args = buildDockerRunArgs(command, workdir, this.options);
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.OPENROUTER_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.OPENAI_API_KEY;
    if (req.env) {
      Object.assign(env, req.env);
    }
    const raw = await spawnCaptured("docker", args, {
      cwd: workspace.hostPath,
      env,
      command: req.command,
      timeoutMs: req.timeoutMs,
      maxOutput: req.maxOutputChars,
      signal: req.signal,
    });
    return {
      command: req.command,
      exitCode: raw.exitCode,
      stdout: raw.stdout,
      stderr: raw.stderr,
      timedOut: raw.timedOut,
      backend: "docker",
      workspaceId: workspace.id,
      durationMs: Date.now() - started,
    };
  }

  async destroy(_workspace: ExecutionWorkspaceHandle): Promise<void> {
    // Ephemeral `--rm` containers; nothing to tear down.
  }
}
