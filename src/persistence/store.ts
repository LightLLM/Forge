import type {
  ApprovalRecord,
  ArtifactRecord,
  EventRecord,
  MemoryKind,
  MemoryRecord,
  ProjectRecord,
  RunRecord,
  SessionRecord,
  TaskRecord,
  TaskStatus,
} from "../core/types.js";

export interface CreateTaskInput {
  projectId: string;
  objective: string;
  workspacePath: string;
  routingMode: TaskRecord["routingMode"];
  localModel: string | null;
  cloudModel: string | null;
  maxTurns: number;
  maxRepairs: number;
  timeoutMs: number;
  cloudBudgetUsd: number | null;
  acceptanceCriteria?: string | null;
}

export interface CreateRunInput {
  taskId: string;
  provider: RunRecord["provider"];
  model: string;
  escalationReason?: string | null;
}

export interface PersistenceStore {
  initialize(): void;
  close(): void;

  upsertProject(path: string, name: string): ProjectRecord;
  getProjectByPath(path: string): ProjectRecord | null;

  createTask(input: CreateTaskInput): TaskRecord;
  getTask(id: string): TaskRecord | null;
  listTasks(limit?: number): TaskRecord[];
  updateTaskStatus(id: string, status: TaskStatus, error?: string | null): TaskRecord;
  updateTaskFields(
    id: string,
    fields: Partial<
      Pick<
        TaskRecord,
        | "plan"
        | "turnCount"
        | "repairCount"
        | "cloudCostUsd"
        | "localModel"
        | "cloudModel"
        | "error"
        | "completedAt"
      >
    >,
  ): TaskRecord;

  createRun(input: CreateRunInput): RunRecord;
  getRun(id: string): RunRecord | null;
  listRuns(taskId: string): RunRecord[];
  updateRun(
    id: string,
    fields: Partial<
      Pick<
        RunRecord,
        | "status"
        | "endedAt"
        | "toolCallCount"
        | "promptTokens"
        | "completionTokens"
        | "estimatedCostUsd"
        | "verificationStatus"
        | "error"
      >
    >,
  ): RunRecord;

  appendEvent(
    taskId: string,
    type: string,
    payload: Record<string, unknown>,
    runId?: string | null,
  ): EventRecord;
  listEvents(taskId: string): EventRecord[];

  createArtifact(
    taskId: string,
    kind: string,
    content: string | null,
    path?: string | null,
    metadata?: Record<string, unknown>,
  ): ArtifactRecord;
  listArtifacts(taskId: string): ArtifactRecord[];

  createApproval(taskId: string, action: string, reason?: string | null): ApprovalRecord;
  getApproval(id: string): ApprovalRecord | null;
  resolveApproval(
    id: string,
    status: "approved" | "denied",
  ): ApprovalRecord;
  listApprovals(taskId: string): ApprovalRecord[];
  listPendingApprovals(taskId?: string): ApprovalRecord[];

  createSession(projectId: string, label?: string | null): SessionRecord;
  getSession(id: string): SessionRecord | null;
  listSessions(projectId?: string, status?: SessionRecord["status"]): SessionRecord[];
  closeSession(id: string): SessionRecord;

  createMemory(input: CreateMemoryInput): MemoryRecord;
  getMemory(id: string): MemoryRecord | null;
  listMemories(opts?: ListMemoriesOptions): MemoryRecord[];
  searchMemories(query: string, opts?: SearchMemoriesOptions): MemoryRecord[];
  deleteMemory(id: string): boolean;
  pruneMemories(opts: PruneMemoriesOptions): number;
}

export interface CreateMemoryInput {
  projectId?: string | null;
  kind: MemoryKind;
  title: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  sourceTaskId?: string | null;
}

export interface ListMemoriesOptions {
  projectId?: string;
  kind?: MemoryKind;
  limit?: number;
}

export interface SearchMemoriesOptions {
  projectId?: string;
  kind?: MemoryKind;
  limit?: number;
}

export interface PruneMemoriesOptions {
  kind?: MemoryKind;
  projectId?: string;
  olderThanDays?: number;
  keepLatest?: number;
  dryRun?: boolean;
}
