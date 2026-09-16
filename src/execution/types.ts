import { ForgeError } from "../core/types.js";

/** Backend kinds — vendor-neutral; remote is an adapter slot. */
export type ExecutionBackendKind = "local" | "docker" | "remote";

export type ExecutionBackendMode = "auto" | ExecutionBackendKind;

export interface ExecutionWorkspaceHandle {
  id: string;
  /** Host filesystem path mounted or used as cwd. */
  hostPath: string;
  backend: ExecutionBackendKind;
  label?: string;
  /** Backend-specific metadata (container id, remote session, …). */
  meta?: Record<string, unknown>;
}

export interface ExecutionRequest {
  command: string;
  /** Relative cwd under workspace hostPath (optional). */
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputChars: number;
  signal?: AbortSignal;
}

export interface ExecutionResult {
  command: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  backend: ExecutionBackendKind;
  workspaceId: string;
  durationMs: number;
}

export interface CreateWorkspaceOptions {
  hostPath: string;
  label?: string;
}

/**
 * Vendor-neutral execution surface.
 * Local and Docker must share this interface; Remote may be a stub adapter.
 */
export interface ExecutionBackend {
  readonly kind: ExecutionBackendKind;
  readonly name: string;
  isAvailable(): Promise<boolean>;
  createWorkspace(opts: CreateWorkspaceOptions): Promise<ExecutionWorkspaceHandle>;
  execute(
    workspace: ExecutionWorkspaceHandle,
    req: ExecutionRequest,
  ): Promise<ExecutionResult>;
  destroy(workspace: ExecutionWorkspaceHandle): Promise<void>;
}

export function assertBackendKind(kind: string): asserts kind is ExecutionBackendKind {
  if (kind !== "local" && kind !== "docker" && kind !== "remote") {
    throw new ForgeError(`Unknown execution backend: ${kind}`, "INVALID_EXEC_BACKEND", {
      kind,
    });
  }
}
