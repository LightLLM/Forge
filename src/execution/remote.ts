import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { ForgeError } from "../core/types.js";
import type {
  CreateWorkspaceOptions,
  ExecutionBackend,
  ExecutionRequest,
  ExecutionResult,
  ExecutionWorkspaceHandle,
} from "./types.js";

export interface RemoteBackendOptions {
  /** Optional remote control-plane endpoint (vendor-neutral). */
  endpoint?: string;
  /** Env var name holding an auth token (never logged). */
  tokenEnv?: string;
}

/**
 * Adapter stub for future remote workers (SSH, GPU VM, Runpod, …).
 * Implements ExecutionBackend so callers stay backend-agnostic.
 * Does not couple Forge to any infrastructure vendor.
 */
export class RemoteExecutionBackend implements ExecutionBackend {
  readonly kind = "remote" as const;
  readonly name = "remote";
  private readonly options: RemoteBackendOptions;

  constructor(options: RemoteBackendOptions = {}) {
    this.options = options;
  }

  async isAvailable(): Promise<boolean> {
    const endpoint = this.options.endpoint?.trim();
    if (!endpoint) return false;
    const tokenEnv = this.options.tokenEnv ?? "FORGE_REMOTE_EXEC_TOKEN";
    const token = process.env[tokenEnv];
    return Boolean(token && token.trim() !== "");
  }

  async createWorkspace(
    opts: CreateWorkspaceOptions,
  ): Promise<ExecutionWorkspaceHandle> {
    if (!(await this.isAvailable())) {
      throw new ForgeError(
        "Remote execution backend is not configured (set execution.remote.endpoint and token env)",
        "REMOTE_NOT_CONFIGURED",
      );
    }
    return {
      id: `remote-${randomUUID().slice(0, 8)}`,
      hostPath: resolve(opts.hostPath),
      backend: "remote",
      label: opts.label,
      meta: { endpoint: this.options.endpoint },
    };
  }

  async execute(
    _workspace: ExecutionWorkspaceHandle,
    _req: ExecutionRequest,
  ): Promise<ExecutionResult> {
    throw new ForgeError(
      "Remote execution adapter is not yet connected to a provider",
      "REMOTE_NOT_IMPLEMENTED",
      { endpoint: this.options.endpoint ?? null },
    );
  }

  async destroy(_workspace: ExecutionWorkspaceHandle): Promise<void> {
    // No remote session to release in the stub.
  }
}
