import { ForgeError } from "../core/types.js";

/** Durable daemon job lifecycle. */
export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type JobKind = "echo" | "sleep" | "write_file" | "agent_task" | "analysis";

export interface JobRecord {
  id: string;
  kind: JobKind;
  payload: Record<string, unknown>;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  workerId: string | null;
  leasedAt: string | null;
  heartbeatAt: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface EnqueueJobInput {
  kind: JobKind;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
}

export interface DaemonRuntimeState {
  pid: number;
  status: "starting" | "running" | "stopping" | "stopped";
  workspacePath: string;
  dbPath: string;
  startedAt: string;
  heartbeatAt: string;
  maxWorkers: number;
  activeWorkers: number;
  lastError?: string;
}

export interface JobExecutorContext {
  job: JobRecord;
  workspacePath: string;
  signal: AbortSignal;
  /** Refresh job lease / heartbeat while work is in progress. */
  heartbeat: () => void;
}

export type JobExecutor = (ctx: JobExecutorContext) => Promise<Record<string, unknown> | void>;

const JOB_TERMINAL: ReadonlySet<JobStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

export function isTerminalJobStatus(status: JobStatus): boolean {
  return JOB_TERMINAL.has(status);
}

export function assertJobKind(kind: string): asserts kind is JobKind {
  if (
    kind !== "echo" &&
    kind !== "sleep" &&
    kind !== "write_file" &&
    kind !== "agent_task" &&
    kind !== "analysis"
  ) {
    throw new ForgeError(`Unknown job kind: ${kind}`, "INVALID_JOB_KIND", { kind });
  }
}
