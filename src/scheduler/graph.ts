import { randomUUID } from "node:crypto";
import { ForgeError } from "../core/types.js";
import type { TaskGraphSpec, TaskNodeState } from "./types.js";

/**
 * Explicit dependency DAG for multi-task objectives.
 */
export class TaskGraph {
  readonly id: string;
  readonly objective: string;
  private readonly nodes = new Map<string, TaskNodeState>();

  constructor(spec: TaskGraphSpec) {
    this.id = spec.id ?? randomUUID();
    this.objective = spec.objective;
    if (!spec.nodes.length) {
      throw new ForgeError("Task graph requires at least one node", "GRAPH_EMPTY");
    }
    for (const n of spec.nodes) {
      if (this.nodes.has(n.id)) {
        throw new ForgeError(`Duplicate node id: ${n.id}`, "GRAPH_DUPLICATE_NODE");
      }
      this.nodes.set(n.id, {
        ...n,
        dependsOn: n.dependsOn ?? [],
        status: "pending",
      });
    }
    this.validate();
    this.refreshReady();
  }

  static fromJSON(raw: unknown): TaskGraph {
    const spec = raw as TaskGraphSpec;
    if (!spec || typeof spec !== "object" || !Array.isArray(spec.nodes)) {
      throw new ForgeError("Invalid graph JSON", "GRAPH_INVALID");
    }
    if (typeof spec.objective !== "string" || !spec.objective.trim()) {
      throw new ForgeError("Graph objective is required", "GRAPH_INVALID");
    }
    return new TaskGraph(spec);
  }

  list(): TaskNodeState[] {
    return [...this.nodes.values()];
  }

  get(id: string): TaskNodeState | null {
    return this.nodes.get(id) ?? null;
  }

  readyNodes(): TaskNodeState[] {
    return this.list().filter((n) => n.status === "ready");
  }

  incomplete(): boolean {
    return this.list().some(
      (n) =>
        n.status === "pending" ||
        n.status === "ready" ||
        n.status === "running",
    );
  }

  markRunning(id: string): void {
    const n = this.require(id);
    if (n.status !== "ready") {
      throw new ForgeError(
        `Node ${id} cannot run from status ${n.status}`,
        "GRAPH_BAD_TRANSITION",
      );
    }
    n.status = "running";
    n.startedAt = new Date().toISOString();
  }

  markCompleted(id: string, summary: string, workspacePath?: string): void {
    const n = this.require(id);
    n.status = "completed";
    n.summary = summary;
    n.workspacePath = workspacePath;
    n.finishedAt = new Date().toISOString();
    this.refreshReady();
  }

  markFailed(id: string, error: string): void {
    const n = this.require(id);
    n.status = "failed";
    n.error = error;
    n.finishedAt = new Date().toISOString();
    this.blockDependents(id);
    this.refreshReady();
  }

  markCancelled(id: string): void {
    const n = this.require(id);
    if (n.status === "completed" || n.status === "failed") return;
    n.status = "cancelled";
    n.finishedAt = new Date().toISOString();
    this.blockDependents(id);
    this.refreshReady();
  }

  toSpec(): TaskGraphSpec {
    return {
      id: this.id,
      objective: this.objective,
      nodes: this.list().map((n) => ({
        id: n.id,
        objective: n.objective,
        dependsOn: n.dependsOn,
        acceptanceCriteria: n.acceptanceCriteria,
        useWorktree: n.useWorktree,
      })),
    };
  }

  snapshot(): TaskNodeState[] {
    return this.list().map((n) => ({ ...n, dependsOn: [...n.dependsOn] }));
  }

  /** Restore persisted node states (for goal resume). */
  restoreSnapshot(snapshot: TaskNodeState[]): void {
    for (const s of snapshot) {
      const n = this.nodes.get(s.id);
      if (!n) continue;
      n.status = s.status;
      n.summary = s.summary;
      n.error = s.error;
      n.startedAt = s.startedAt;
      n.finishedAt = s.finishedAt;
      n.workspacePath = s.workspacePath;
    }
    this.refreshReady();
  }

  private require(id: string): TaskNodeState {
    const n = this.nodes.get(id);
    if (!n) throw new ForgeError(`Unknown node: ${id}`, "GRAPH_UNKNOWN_NODE");
    return n;
  }

  private validate(): void {
    for (const n of this.nodes.values()) {
      for (const dep of n.dependsOn) {
        if (!this.nodes.has(dep)) {
          throw new ForgeError(
            `Node '${n.id}' depends on missing node '${dep}'`,
            "GRAPH_MISSING_DEP",
          );
        }
      }
    }
    // Cycle detection via DFS
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        throw new ForgeError(`Cycle detected at node '${id}'`, "GRAPH_CYCLE");
      }
      visiting.add(id);
      for (const dep of this.nodes.get(id)!.dependsOn) visit(dep);
      visiting.delete(id);
      visited.add(id);
    };
    for (const id of this.nodes.keys()) visit(id);
  }

  private refreshReady(): void {
    for (const n of this.nodes.values()) {
      if (n.status !== "pending" && n.status !== "ready") continue;
      const depsOk = n.dependsOn.every(
        (d) => this.nodes.get(d)?.status === "completed",
      );
      const depsFailed = n.dependsOn.some((d) => {
        const s = this.nodes.get(d)?.status;
        return s === "failed" || s === "blocked" || s === "cancelled";
      });
      if (depsFailed) {
        n.status = "blocked";
      } else if (depsOk) {
        n.status = "ready";
      } else {
        n.status = "pending";
      }
    }
  }

  private blockDependents(failedId: string): void {
    for (const n of this.nodes.values()) {
      if (n.status === "pending" || n.status === "ready") {
        if (dependsOnTransitively(this.nodes, n.id, failedId)) {
          n.status = "blocked";
          n.error = `Blocked by failed/cancelled dependency chain including '${failedId}'`;
        }
      }
    }
  }
}

function dependsOnTransitively(
  nodes: Map<string, TaskNodeState>,
  nodeId: string,
  targetId: string,
): boolean {
  const seen = new Set<string>();
  const stack = [...(nodes.get(nodeId)?.dependsOn ?? [])];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === targetId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of nodes.get(id)?.dependsOn ?? []) stack.push(d);
  }
  return false;
}
