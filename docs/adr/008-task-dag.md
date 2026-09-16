# ADR 008 — Explicit task DAG scheduling

## Status

Accepted (M5)

## Context

Multi-step engineering work needs ordered and parallel stages without uncontrolled fan-out.

## Decision

1. Represent plans as an explicit DAG with validated dependencies (no cycles).
2. Schedule only ready nodes; cap concurrency with `maxParallelWorkers` (default 2).
3. On failure, block dependents rather than running them.
4. Keep decomposition deterministic in M5; model-based planners can emit the same graph schema later.

## Consequences

Parallelism is opt-in and bounded. Fixture plans prove correctness without paid APIs.
