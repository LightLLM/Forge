import type { ExecutionBackendKind } from "../execution/types.js";
import {
  buildDockerRunArgs as buildDockerRunArgsImpl,
  isDockerAvailable as isDockerAvailableImpl,
  resetDockerAvailabilityCache as resetDockerAvailabilityCacheImpl,
} from "../execution/docker.js";
import {
  resolveExecutionBackend,
  sandboxModeToExecutionMode,
} from "../execution/factory.js";
import { runWithBackend } from "../execution/run.js";

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

export async function isDockerAvailable(): Promise<boolean> {
  return isDockerAvailableImpl();
}

/** Reset cache (tests). */
export function resetDockerAvailabilityCache(): void {
  resetDockerAvailabilityCacheImpl();
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
  return (await isDockerAvailable()) ? "docker" : "host";
}

function mapBackendLabel(kind: ExecutionBackendKind): "host" | "docker" {
  return kind === "docker" ? "docker" : "host";
}

/**
 * Execute a shell command via the shared ExecutionBackend abstraction.
 * Local and Docker share the same createWorkspace/execute/destroy interface.
 */
export async function executeCommand(
  command: string,
  ctx: CommandRunContext,
): Promise<CommandRunResult> {
  const sandbox = ctx.sandbox ?? {
    mode: "host" as const,
    image: "node:22-bookworm-slim",
    networkDisabled: true,
  };
  const backend = await resolveExecutionBackend({
    mode: sandboxModeToExecutionMode(sandbox.mode),
    sandbox,
  });
  const result = await runWithBackend(backend, ctx.workspaceRoot, {
    command,
    timeoutMs: ctx.commandTimeoutMs,
    maxOutputChars: ctx.maxCommandOutputChars,
    signal: ctx.signal,
  });
  return {
    command: result.command,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    backend: mapBackendLabel(result.backend),
  };
}

/** Exported for tests — constructs `docker run` argv. */
export function buildDockerRunArgs(
  command: string,
  workspaceRoot: string,
  sandbox: SandboxOptions,
): string[] {
  return buildDockerRunArgsImpl(command, workspaceRoot, {
    image: sandbox.image,
    networkDisabled: sandbox.networkDisabled,
    hardened: sandbox.hardened,
    memoryLimit: sandbox.memoryLimit,
    pidsLimit: sandbox.pidsLimit,
  });
}
