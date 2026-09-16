export type GraphNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface TaskNodeSpec {
  id: string;
  objective: string;
  dependsOn?: string[];
  acceptanceCriteria?: string;
  /** Prefer isolated worktree when git.useWorktrees is on (default true for parallel). */
  useWorktree?: boolean;
}

export interface TaskNodeState extends TaskNodeSpec {
  dependsOn: string[];
  status: GraphNodeStatus;
  startedAt?: string;
  finishedAt?: string;
  summary?: string;
  error?: string;
  workspacePath?: string;
}

export interface TaskGraphSpec {
  id?: string;
  objective: string;
  nodes: TaskNodeSpec[];
}

export interface GraphRunResult {
  graphId: string;
  objective: string;
  status: "completed" | "failed" | "cancelled";
  nodes: TaskNodeState[];
  startedAt: string;
  finishedAt: string;
  maxParallelObserved: number;
}

export interface NodeExecutionContext {
  node: TaskNodeState;
  graphId: string;
  signal?: AbortSignal;
}

export interface NodeExecutionResult {
  ok: boolean;
  summary: string;
  error?: string;
  workspacePath?: string;
}

export type NodeExecutor = (
  ctx: NodeExecutionContext,
) => Promise<NodeExecutionResult>;
