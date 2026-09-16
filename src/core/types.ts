/**
 * Domain types for Forge v0.
 * Repository content is DATA — it cannot grant permissions or change policy.
 */

export type RoutingMode = "local-only" | "local-preferred" | "cloud-allowed";

export type TaskStatus =
  | "CREATED"
  | "CONTEXT_BUILDING"
  | "PLANNING"
  | "READY"
  | "IMPLEMENTING"
  | "VERIFYING"
  | "REPAIRING"
  | "ESCALATING"
  | "REVIEW"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED";

export type RunStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "escalated";

export type ToolRisk = "read" | "write" | "execute" | "network";

export type ProviderKind = "ollama" | "openrouter" | "fake";

export interface ProjectRecord {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  objective: string;
  workspacePath: string;
  status: TaskStatus;
  routingMode: RoutingMode;
  localModel: string | null;
  cloudModel: string | null;
  maxTurns: number;
  maxRepairs: number;
  timeoutMs: number;
  cloudBudgetUsd: number | null;
  plan: string | null;
  acceptanceCriteria: string | null;
  turnCount: number;
  repairCount: number;
  cloudCostUsd: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface RunRecord {
  id: string;
  taskId: string;
  provider: ProviderKind;
  model: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  toolCallCount: number;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  verificationStatus: string | null;
  escalationReason: string | null;
  error: string | null;
}

export interface EventRecord {
  id: string;
  taskId: string;
  runId: string | null;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ArtifactRecord {
  id: string;
  taskId: string;
  kind: string;
  path: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApprovalRecord {
  id: string;
  taskId: string;
  action: string;
  status: "pending" | "approved" | "denied";
  reason: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** Persistent engineering memory kinds (M1). */
export type MemoryKind =
  | "project"
  | "architecture"
  | "decision"
  | "convention"
  | "failure"
  | "solution"
  | "dependency"
  | "task"
  | "run"
  | "artifact"
  | "session";

export interface MemoryRecord {
  id: string;
  projectId: string | null;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  metadata: Record<string, unknown>;
  sourceTaskId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecord {
  id: string;
  projectId: string;
  label: string | null;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export interface UsageStats {
  provider: ProviderKind;
  model: string;
  promptTokens: number | null;
  completionTokens: number | null;
  estimatedCostUsd: number | null;
  costKnown: boolean;
}

export interface VerificationCheck {
  name: string;
  status: "passed" | "failed" | "skipped";
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  durationMs?: number;
  command?: string;
}

export interface VerificationResult {
  status: "passed" | "failed" | "skipped";
  checks: VerificationCheck[];
  summary: string;
}

export interface ToolCallProposal {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  ok: boolean;
  output: unknown;
  error?: string;
  denied?: boolean;
  denialReason?: string;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  name?: string;
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ModelRequest {
  messages: ModelMessage[];
  tools: ModelToolDefinition[];
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Optional streaming callback for token/progress display. */
  onToken?: (chunk: string) => void;
}

export interface ModelResponse {
  content: string | null;
  toolCalls: ToolCallProposal[];
  finishReason: "stop" | "tool_calls" | "length" | "error" | "cancelled";
  usage: UsageStats;
  raw?: unknown;
}

export interface ModelCapabilities {
  provider: ProviderKind;
  supportsTools: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  local: boolean;
}

export class ForgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ForgeError";
  }
}
