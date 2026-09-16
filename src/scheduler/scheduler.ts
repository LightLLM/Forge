import type {
  GraphRunResult,
  NodeExecutor,
  TaskNodeState,
} from "./types.js";
import type { TaskGraph } from "./graph.js";

export interface TaskSchedulerOptions {
  maxParallelWorkers: number;
  signal?: AbortSignal;
  onEvent?: (event: SchedulerEvent) => void;
}

export type SchedulerEvent =
  | { type: "graph_started"; graphId: string }
  | { type: "node_started"; node: TaskNodeState; parallelSlot: number }
  | { type: "node_finished"; node: TaskNodeState; ok: boolean }
  | { type: "graph_finished"; status: GraphRunResult["status"] };

/**
 * Runs ready DAG nodes with a concurrency cap.
 * Dependent nodes wait; independent nodes may run together.
 */
export class TaskScheduler {
  constructor(private readonly options: TaskSchedulerOptions) {
    if (options.maxParallelWorkers < 1) {
      throw new Error("maxParallelWorkers must be >= 1");
    }
  }

  async run(graph: TaskGraph, executor: NodeExecutor): Promise<GraphRunResult> {
    const startedAt = new Date().toISOString();
    let maxParallelObserved = 0;
    this.emit({ type: "graph_started", graphId: graph.id });

    while (graph.incomplete()) {
      if (this.options.signal?.aborted) {
        for (const n of graph.readyNodes()) graph.markCancelled(n.id);
        for (const n of graph.list()) {
          if (n.status === "pending") graph.markCancelled(n.id);
        }
        break;
      }

      const ready = graph.readyNodes();
      if (ready.length === 0) {
        // No ready nodes but incomplete → deadlock / all blocked
        break;
      }

      const batch = ready.slice(0, this.options.maxParallelWorkers);
      maxParallelObserved = Math.max(maxParallelObserved, batch.length);

      for (const node of batch) {
        graph.markRunning(node.id);
        this.emit({
          type: "node_started",
          node: graph.get(node.id)!,
          parallelSlot: batch.length,
        });
      }

      const results = await Promise.all(
        batch.map(async (node) => {
          try {
            const result = await executor({
              node: graph.get(node.id)!,
              graphId: graph.id,
              signal: this.options.signal,
            });
            return { id: node.id, result };
          } catch (err) {
            return {
              id: node.id,
              result: {
                ok: false as const,
                summary: "executor threw",
                error: err instanceof Error ? err.message : String(err),
              },
            };
          }
        }),
      );

      for (const { id, result } of results) {
        if (result.ok) {
          graph.markCompleted(id, result.summary, result.workspacePath);
          this.emit({
            type: "node_finished",
            node: graph.get(id)!,
            ok: true,
          });
        } else {
          graph.markFailed(id, result.error ?? result.summary);
          this.emit({
            type: "node_finished",
            node: graph.get(id)!,
            ok: false,
          });
        }
      }
    }

    const nodes = graph.snapshot();
    const anyFailed = nodes.some((n) => n.status === "failed");
    const anyCancelled = nodes.some((n) => n.status === "cancelled");
    const allDone = nodes.every(
      (n) => n.status === "completed" || n.status === "blocked",
    );
    const status: GraphRunResult["status"] = anyCancelled
      ? "cancelled"
      : anyFailed || !allDone
        ? "failed"
        : "completed";

    // If some pending remain with no ready (shouldn't), mark failed
    if (nodes.some((n) => n.status === "pending" || n.status === "ready" || n.status === "running")) {
      // treat as failed/stuck
    }

    this.emit({ type: "graph_finished", status });
    return {
      graphId: graph.id,
      objective: graph.objective,
      status,
      nodes,
      startedAt,
      finishedAt: new Date().toISOString(),
      maxParallelObserved,
    };
  }

  private emit(event: SchedulerEvent): void {
    this.options.onEvent?.(event);
  }
}
