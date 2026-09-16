import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import type { DaemonRuntimeState } from "./types.js";

export function daemonStatePath(workspacePath: string): string {
  return join(resolve(workspacePath), ".forge", "daemon.json");
}

export function readDaemonState(workspacePath: string): DaemonRuntimeState | null {
  const path = daemonStatePath(workspacePath);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as DaemonRuntimeState;
  } catch {
    return null;
  }
}

export function writeDaemonState(workspacePath: string, state: DaemonRuntimeState): void {
  const path = daemonStatePath(workspacePath);
  mkdirSync(join(resolve(workspacePath), ".forge"), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  try {
    renameSync(tmp, path);
  } catch {
    writeFileSync(path, JSON.stringify(state, null, 2), "utf8");
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

export function clearDaemonState(workspacePath: string): void {
  const path = daemonStatePath(workspacePath);
  try {
    unlinkSync(path);
  } catch {
    // ignore
  }
}

/** Best-effort check whether a PID appears alive (Node process). */
export function isPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function requestDaemonStop(workspacePath: string): DaemonRuntimeState | null {
  const state = readDaemonState(workspacePath);
  if (!state) return null;
  if (state.status === "stopped") return state;
  const next: DaemonRuntimeState = {
    ...state,
    status: "stopping",
    heartbeatAt: new Date().toISOString(),
  };
  writeDaemonState(workspacePath, next);
  if (isPidAlive(state.pid) && state.pid !== process.pid) {
    try {
      process.kill(state.pid, "SIGTERM");
    } catch {
      // ignore — process may exit between check and kill
    }
  }
  return next;
}
