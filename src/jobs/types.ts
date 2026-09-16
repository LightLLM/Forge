import { ForgeError } from "../core/types.js";

/** Built-in scheduled engineering analyses (discovery → proposal, not silent rewrites). */
export type AnalysisId =
  | "todo_analysis"
  | "dependency_audit"
  | "security_scan"
  | "repo_summary"
  | "dead_code_hints";

export interface AnalysisFinding {
  severity: "info" | "low" | "medium" | "high";
  title: string;
  detail: string;
  path?: string;
  line?: number;
}

export interface AnalysisReport {
  analysisId: AnalysisId;
  workspacePath: string;
  startedAt: string;
  finishedAt: string;
  summary: string;
  findings: AnalysisFinding[];
  /** Proposal / recommendation text — never applied automatically. */
  proposal: string;
  metrics: Record<string, number | string | boolean>;
}

export interface AnalysisDefinition {
  id: AnalysisId;
  name: string;
  description: string;
  /** Default interval when installed as a schedule (ms). */
  defaultEveryMs: number;
}

export type ScheduleStatus = "active" | "paused" | "disabled";

export interface ScheduleRecord {
  id: string;
  name: string;
  analysisId: AnalysisId;
  everyMs: number;
  status: ScheduleStatus;
  payload: Record<string, unknown>;
  lastRunAt: string | null;
  nextRunAt: string;
  lastJobId: string | null;
  runCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateScheduleInput {
  name: string;
  analysisId: AnalysisId;
  everyMs: number;
  status?: ScheduleStatus;
  payload?: Record<string, unknown>;
  /** If set, first run at this ISO time; otherwise now. */
  nextRunAt?: string;
}

export function assertAnalysisId(id: string): asserts id is AnalysisId {
  const ok: AnalysisId[] = [
    "todo_analysis",
    "dependency_audit",
    "security_scan",
    "repo_summary",
    "dead_code_hints",
  ];
  if (!ok.includes(id as AnalysisId)) {
    throw new ForgeError(`Unknown analysis id: ${id}`, "INVALID_ANALYSIS", { id });
  }
}
