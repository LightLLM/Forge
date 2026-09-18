/**
 * Sidecar / runtime supervisor with bounded restart (DESKTOP-2).
 */

import type { RuntimeHandle } from "./runtime-host.js";

export interface SupervisorOptions {
  maxRestarts?: number;
  restartDelayMs?: number;
  start: () => Promise<RuntimeHandle>;
  onStatus?: (msg: string) => void;
}

export class RuntimeSupervisor {
  private handle: RuntimeHandle | null = null;
  private restarts = 0;
  private stopped = false;
  private readonly maxRestarts: number;
  private readonly restartDelayMs: number;
  private readonly startFn: () => Promise<RuntimeHandle>;
  private readonly onStatus?: (msg: string) => void;

  constructor(opts: SupervisorOptions) {
    this.maxRestarts = opts.maxRestarts ?? 3;
    this.restartDelayMs = opts.restartDelayMs ?? 1_500;
    this.startFn = opts.start;
    this.onStatus = opts.onStatus;
  }

  get runtime(): RuntimeHandle | null {
    return this.handle;
  }

  async start(): Promise<RuntimeHandle> {
    this.stopped = false;
    this.handle = await this.startFn();
    this.onStatus?.(`runtime ready (${this.handle.mode}) ${this.handle.baseUrl}`);
    return this.handle;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.handle) {
      await this.handle.stop();
      this.handle = null;
    }
  }

  /**
   * Attempt a safe restart after unexpected failure.
   * Does not silently replay high-consequence work — only brings API back up.
   */
  async restartAfterCrash(reason: string): Promise<RuntimeHandle | null> {
    if (this.stopped) return null;
    if (this.restarts >= this.maxRestarts) {
      this.onStatus?.(
        `runtime crash limit reached (${this.maxRestarts}): ${reason}`,
      );
      return null;
    }
    this.restarts += 1;
    this.onStatus?.(
      `restarting runtime (${this.restarts}/${this.maxRestarts}): ${reason}`,
    );
    try {
      if (this.handle) {
        try {
          await this.handle.stop();
        } catch {
          /* ignore */
        }
        this.handle = null;
      }
      await new Promise((r) => setTimeout(r, this.restartDelayMs));
      if (this.stopped) return null;
      this.handle = await this.startFn();
      this.onStatus?.(`runtime recovered ${this.handle.baseUrl}`);
      return this.handle;
    } catch (err) {
      this.onStatus?.(
        `restart failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}
