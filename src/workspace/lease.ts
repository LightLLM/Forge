import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { ForgeError } from "../core/types.js";

export interface LeaseRecord {
  workspacePath: string;
  holderId: string;
  acquiredAt: string;
  expiresAt: string;
}

export interface LeaseHandle {
  record: LeaseRecord;
  release(): void;
  refresh(ttlMs?: number): void;
}

/**
 * File-based workspace lease. Prevents two Forge workers from mutating
 * the same workspace path concurrently. Worktrees use distinct paths, so
 * they can hold leases in parallel.
 */
export class WorkspaceLease {
  static leaseDir(repoOrWorkspaceRoot: string): string {
    return join(resolve(repoOrWorkspaceRoot), ".forge", "leases");
  }

  static leasePath(workspacePath: string): string {
    const abs = resolve(workspacePath);
    const hash = createHash("sha256").update(abs).digest("hex").slice(0, 16);
    // Store under the workspace's own .forge when possible; fall back to path hash file next to it.
    const dir = join(abs, ".forge", "leases");
    return join(dir, `${hash}.json`);
  }

  /**
   * Acquire an exclusive lease. Expired leases may be stolen.
   * Never deletes unrelated user files — only Forge lease JSON.
   */
  static acquire(
    workspacePath: string,
    holderId: string,
    ttlMs = 3_600_000,
  ): LeaseHandle {
    const abs = resolve(workspacePath);
    const path = WorkspaceLease.leasePath(abs);
    mkdirSync(dirname(path), { recursive: true });

    const existing = WorkspaceLease.read(path);
    const now = Date.now();
    if (existing) {
      const exp = Date.parse(existing.expiresAt);
      if (!Number.isNaN(exp) && exp > now && existing.holderId !== holderId) {
        throw new ForgeError(
          `Workspace leased by '${existing.holderId}' until ${existing.expiresAt}`,
          "WORKSPACE_LEASE_HELD",
          { holderId: existing.holderId, expiresAt: existing.expiresAt, path: abs },
        );
      }
    }

    const record: LeaseRecord = {
      workspacePath: abs,
      holderId,
      acquiredAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlMs).toISOString(),
    };

    // Atomic-ish write via temp rename
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(record, null, 2), "utf8");
    try {
      renameSync(tmp, path);
    } catch {
      writeFileSync(path, JSON.stringify(record, null, 2), "utf8");
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }

    // Re-read to detect lost race
    const confirmed = WorkspaceLease.read(path);
    if (!confirmed || confirmed.holderId !== holderId) {
      throw new ForgeError(
        `Failed to acquire workspace lease for ${abs}`,
        "WORKSPACE_LEASE_RACE",
      );
    }

    return {
      record: confirmed,
      release: () => WorkspaceLease.release(abs, holderId),
      refresh: (nextTtl = ttlMs) => {
        WorkspaceLease.acquire(abs, holderId, nextTtl);
      },
    };
  }

  static release(workspacePath: string, holderId: string): void {
    const path = WorkspaceLease.leasePath(resolve(workspacePath));
    const existing = WorkspaceLease.read(path);
    if (!existing) return;
    if (existing.holderId !== holderId) {
      throw new ForgeError(
        `Cannot release lease held by '${existing.holderId}'`,
        "WORKSPACE_LEASE_NOT_OWNER",
      );
    }
    try {
      unlinkSync(path);
    } catch {
      // ignore missing
    }
  }

  static peek(workspacePath: string): LeaseRecord | null {
    return WorkspaceLease.read(WorkspaceLease.leasePath(resolve(workspacePath)));
  }

  private static read(path: string): LeaseRecord | null {
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf8")) as LeaseRecord;
    } catch {
      return null;
    }
  }
}
