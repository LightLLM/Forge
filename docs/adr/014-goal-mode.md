# ADR 014 — Goal mode as durable multi-task objectives

## Status

Accepted (M11)

## Context

`forge run` handles one task. Larger objectives decompose into DAGs and must survive process restarts.

## Decision

1. Introduce `GoalEngine` with phases: architect → plan → execute → integrate → verify → review → complete.
2. Persist goals in SQLite (`goals`) including plan and graph snapshots.
3. Resume from last phase/snapshot without re-running completed nodes.
4. M11 uses deterministic plans/directive executor; full agent loop per node remains future work.

## Consequences

Goals are durable and auditable. `forge goal` is the higher-level entry point above `forge run` / `forge graph`.
