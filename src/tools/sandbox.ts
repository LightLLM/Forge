import { spawn } from "node:child_process";
import { platform } from "node:os";

export type SandboxMode = "auto" | "host" | "docker";

export interface SandboxOptions {
  mode: SandboxMode;
  /** Docker image used when sandboxing (default node:22-bookworm-slim). */
  image: string;
  /** Disable container network (safer; may break installs). Default true. */
  networkDisabled: boolean;
  /**
   * Apply hardened container flags: no-new-privileges, cap-drop ALL,
   * read-only rootfs + tmpfs, pids limit. Default true.
   */
  hardened?: boolean;
  /** Memory limit for Docker (e.g. "2g"). Default "2g" when hardened. */
  memoryLimit?: string;
  /** PIDs limit. Default 256 when hardened. */
  pidsLimit?: number;
}

export interface CommandRunResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  backend: "host" | "docker";
}

export interface CommandRunContext {
  workspaceRoot: string;
  commandTimeoutMs: number;
  maxCommandOutputChars: number;
  signal?: AbortSignal;
  sandbox?: SandboxOptions;
}

let dockerAvailableCache: boolean | null = null;

export async function isDockerAvailable(): Promise<boolean> {
  if (dockerAvailableCache != null) return dockerAvailableCache;
  dockerAvailableCache = await new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["info"], {
      windowsHide: true,
      stdio: "ignore",
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 4_000);
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });
  return dockerAvailableCache;
}

/** Reset cache (tests). */
export function resetDockerAvailabilityCache(): void {
  dockerAvailableCache = null;
}

export async function resolveCommandBackend(
  sandbox?: SandboxOptions,
): Promise<"host" | "docker"> {
  const mode = sandbox?.mode ?? "host";
  if (mode === "host") return "host";
  if (mode === "docker") {
    if (!(await isDockerAvailable())) {
      throw new Error("Docker sandbox required but Docker is unavailable");
    }
    return "docker";
  }
  // auto
  return (await isDockerAvailable()) ? "docker" : "host";
}

export async function executeCommand(
  command: string,
  ctx: CommandRunContext,
): Promise<CommandRunResult> {
  const backend = await resolveCommandBackend(ctx.sandbox);
  if (backend === "docker") {
    return runDocker(command, ctx, ctx.sandbox!);
  }
  return runHost(command, ctx);
}

function runHost(command: string, ctx: CommandRunContext): Promise<CommandRunResult> {
  const isWin = platform() === "win32";
  const file = isWin ? "cmd.exe" : "/bin/sh";
  const args = isWin ? ["/d", "/s", "/c", command] : ["-c", command];

  return spawnCaptured(file, args, {
    cwd: ctx.workspaceRoot,
    env: scrubEnv(process.env),
    command,
    backend: "host",
    timeoutMs: ctx.commandTimeoutMs,
    maxOutput: ctx.maxCommandOutputChars,
    signal: ctx.signal,
  });
}

function runDocker(
  command: string,
  ctx: CommandRunContext,
  sandbox: SandboxOptions,
): Promise<CommandRunResult> {
  const args = buildDockerRunArgs(command, ctx.workspaceRoot, sandbox);

  return spawnCaptured("docker", args, {
    cwd: ctx.workspaceRoot,
    env: scrubEnv(process.env),
    command,
    backend: "docker",
    timeoutMs: ctx.commandTimeoutMs,
    maxOutput: ctx.maxCommandOutputChars,
    signal: ctx.signal,
  });
}

/** Exported for tests — constructs `docker run` argv. */
export function buildDockerRunArgs(
  command: string,
  workspaceRoot: string,
  sandbox: SandboxOptions,
): string[] {
  const mount = toDockerMount(workspaceRoot);
  const hardened = sandbox.hardened !== false;
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
      String(sandbox.pidsLimit ?? 256),
      "--memory",
      sandbox.memoryLimit ?? "2g",
    );
  }

  args.push("-v", `${mount}:/workspace`, "-w", "/workspace");

  if (sandbox.networkDisabled) {
    args.push("--network", "none");
  }
  args.push(sandbox.image, "sh", "-c", command);
  return args;
}

function toDockerMount(hostPath: string): string {
  // Docker Desktop on Windows accepts forward-slash paths.
  if (platform() === "win32") {
    return hostPath.replace(/\\/g, "/");
  }
  return hostPath;
}

function spawnCaptured(
  file: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    command: string;
    backend: "host" | "docker";
    timeoutMs: number;
    maxOutput: number;
    signal?: AbortSignal;
  },
): Promise<CommandRunResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      cwd: opts.cwd,
      env: opts.env,
      windowsHide: true,
      signal: opts.signal,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const max = opts.maxOutput;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, opts.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length < max) stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < max) stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolvePromise({
        command: opts.command,
        exitCode: code,
        stdout: stdout.slice(0, max),
        stderr: stderr.slice(0, max),
        timedOut,
        backend: opts.backend,
      });
    });
  });
}

function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.OPENROUTER_API_KEY;
  delete out.ANTHROPIC_API_KEY;
  delete out.OPENAI_API_KEY;
  return out;
}
