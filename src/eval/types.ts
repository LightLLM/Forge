export interface EvalCase {
  id: string;
  category: string;
  prompt: string;
  /** Expected substring in model text response (optional). */
  expectContent?: string;
  /** Expected tool name when script emits tool_calls (optional). */
  expectTool?: string;
}

export interface EvalModelProfile {
  id: string;
  provider: "fake";
  /** Named script profile resolved by the runner. */
  profile: "success" | "fail_tools" | "fail_message";
}

export interface EvalDataset {
  id: string;
  name: string;
  models: EvalModelProfile[];
  cases: EvalCase[];
}

export interface EvalCaseResult {
  caseId: string;
  modelId: string;
  passed: boolean;
  detail: string;
  latencyMs: number;
}

export interface EvalModelSummary {
  modelId: string;
  passed: number;
  failed: number;
  passRate: number;
  avgLatencyMs: number;
}

export interface EvalRunReport {
  runId: string;
  datasetId: string;
  startedAt: string;
  finishedAt: string;
  results: EvalCaseResult[];
  summaries: EvalModelSummary[];
}
