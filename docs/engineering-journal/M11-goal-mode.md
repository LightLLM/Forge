# M11 — Goal Mode

## Problem

Forge could run single tasks or raw DAGs, but lacked a persistent higher-level objective that survives restarts.

## Design

- `GoalStore` / `goals` table with phase + plan + graph snapshot
- `GoalEngine` phases: architect → plan → execute → integrate → verify → review
- Plan resolution: explicit path, `.forge/goal/plan.json`, or decomposition
- Resumable execution via `TaskGraph.restoreSnapshot`
- CLI: `forge goal "<objective>"` (default run), `resume`, `status`, `list`
- Fixture: `fixtures/goal-mvp`

## Gate

Goal decomposes into multiple tasks and completes fixture project; partial state resumes to completion.

## Remaining debt

- Architect/planner phases still deterministic (no live model planner)
- Per-node full agent loop (vs directive executor)
- Goal ↔ daemon integration for long-running objectives
