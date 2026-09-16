# M08 — Persistent Daemon

## Problem

Forge could only run tasks in the foreground CLI process. Killing the process lost in-flight work and left no durable background queue.

## Design

- `JobStore` / `daemon_jobs` table for durable queue state
- `ForgeDaemon` worker pool with claim/heartbeat/complete/fail
- Crash recovery: requeue orphaned `running` jobs on start and when heartbeats go stale
- Runtime state in `.forge/daemon.json` (pid, workers, heartbeat)
- CLI: `forge daemon start|status|stop|enqueue`
- Config: `daemon.maxWorkers`, poll/heartbeat/stale intervals

## Gate

Terminate/restart during a queued workload without losing durable state — orphaned running jobs are requeued and completed after restart.

## Remaining debt

- Wire `agent_task` jobs to `TaskOrchestrator`
- Detached multi-machine workers / Postgres-backed job store API
- Workspace lease heartbeats tied to daemon workers (partially deferred from M4)
- Rich scheduled analysis catalog (M9)
