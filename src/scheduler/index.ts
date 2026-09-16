import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { TaskGraph } from "./graph.js";
import { DeterministicDecomposer } from "./decompose.js";
import { TaskScheduler, type SchedulerEvent } from "./scheduler.js";
import type {
  GraphRunResult,
  NodeExecutor,
  TaskGraphSpec,
  TaskNodeSpec,
} from "./types.js";

export interface RunGraphOptions {
  objective: string;
  workspacePath: string;
  maxParallelWorkers: number;
  /** Explicit nodes or path to plan JSON. */
  plan?: TaskNodeSpec[] | string;
  executor: NodeExecutor;
  signal?: AbortSignal;
  onEvent?: (event: SchedulerEvent) => void;
}

/**
 * Load/decompose a plan and execute it under the scheduler.
 */
export async function runTaskGraph(options: RunGraphOptions): Promise<GraphRunResult> {
  const spec = loadSpec(options.objective, options.plan);
  const graph = new TaskGraph(spec);
  const scheduler = new TaskScheduler({
    maxParallelWorkers: options.maxParallelWorkers,
    signal: options.signal,
    onEvent: options.onEvent,
  });
  return scheduler.run(graph, options.executor);
}

export function loadSpec(
  objective: string,
  plan?: TaskNodeSpec[] | string,
): TaskGraphSpec {
  const decomposer = new DeterministicDecomposer();
  if (typeof plan === "string") {
    const path = resolve(plan);
    if (!existsSync(path)) {
      throw new Error(`Plan file not found: ${path}`);
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as TaskGraphSpec;
    return {
      id: raw.id,
      objective: raw.objective || objective,
      nodes: raw.nodes,
    };
  }
  if (Array.isArray(plan)) {
    return decomposer.decompose(objective, plan);
  }
  return decomposer.decompose(objective);
}

export { TaskGraph } from "./graph.js";
export { TaskScheduler } from "./scheduler.js";
export { DeterministicDecomposer } from "./decompose.js";
export type * from "./types.js";
export type { SchedulerEvent } from "./scheduler.js";
