# M05 — Task DAG + Parallel Workers

## Problem

Single-task `forge run` cannot express multi-step objectives with dependencies or safe concurrency.

## Design

- Explicit `TaskGraph` / node statuses / cycle checks
- `DeterministicDecomposer` for plans / numbered / "then" splits (no model required)
- `TaskScheduler` runs ready nodes with `scheduler.maxParallelWorkers`
- Failed nodes block dependents; independent nodes may run together
- Directive executor (`write:path:content`) for deterministic fixture gates
- CLI: `forge graph validate|run`

## Gate

`fixtures/multi-part-plan/plan.json`: alpha ∥ beta → combine completes; maxParallelObserved = 2.

## Remaining debt

- LLM planner role (M6)
- Worktree-per-node auto-merge after parallel graph runs
- Persist graph runs as first-class DB entities
