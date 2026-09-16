import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { platform } from "node:os";
import { spawn } from "node:child_process";
import type {
  CreateWorkspaceOptions,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
  ExecutionWorkspaceHandle,
} from "./types.js";

function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  delete out.OPENROUTER_API_KEY;
  delete out.ANTHROPIC_API_KEY;
  delete out.OPENAI_API_KEY;
  return out;
}

export function spawnCaptured(
  file: string,
  args: string[],
  opts: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    command: string;
    timeoutMs: number;
    maxOutput: number;
    signal?: AbortSignal;
  },
): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
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
        exitCode: code,
        stdout: stdout.slice(0, max),
        stderr: stderr.slice(0, max),
        timedOut,
      });
    });
  });
}

/**
 * Runs commands directly on the host (current process machine).
 */
export class LocalExecutionBackend implements ExecutionBackend {
  readonly kind = "local" as const;
  readonly name = "local";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async createWorkspace(
    opts: CreateWorkspaceOptions,
  ): Promise<ExecutionWorkspaceHandle> {
    return {
      id: `local-${randomUUID().slice(0, 8)}`,
      hostPath: resolve(opts.hostPath),
      backend: "local",
      label: opts.label,
    };
  }

  async execute(
    workspace: ExecutionWorkspaceHandle,
    req: ExecutionRequest,
  ): Promise<ExecutionResult> {
    const started = Date.now();
    const cwd = req.cwd
      ? resolve(workspace.hostPath, req.cwd)
      : workspace.hostPath;
    const isWin = platform() === "win32";
    const file = isWin ? "cmd.exe" : "/bin/sh";
    const args = isWin ? ["/d", "/s", "/c", req.command] : ["-c", req.command];
    const env = scrubEnv({ ...process.env, ...(req.env ?? {}) });
    const raw = await spawnCaptured(file, args, {
      cwd,
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
      backend: "local",
      workspaceId: workspace.id,
      durationMs: Date.now() - started,
    };
  }

  async destroy(_workspace: ExecutionWorkspaceHandle): Promise<void> {
    // Host workspaces are not ephemeral containers.
  }
}
