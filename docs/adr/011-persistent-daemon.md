# ADR 011 — Persistent daemon with durable job queue

## Status

Accepted (M8)

## Context

Forge must continue operating independently of a foreground CLI session. In-memory schedulers lose work on process exit.

## Decision

1. Persist daemon jobs in SQLite (`daemon_jobs`) alongside the Forge DB.
2. Expose `forge daemon start|status|stop|enqueue`.
3. On start (and periodically), requeue orphaned `running` jobs whose workers died.
4. Heartbeat job leases while workers execute; stale heartbeats trigger recovery.
5. Keep built-in job kinds (`echo`, `sleep`, `write_file`) for CI gates; `agent_task` reserved for later orchestrator wiring.

## Consequences

Crash/restart preserves queued and mid-flight work. Full agent loops via daemon workers remain a follow-on; M9 covers richer scheduled analysis jobs.
