# ADR 012 — Scheduled engineering analyses as proposals

## Status

Accepted (M9)

## Context

Forge should discover repo issues on a schedule without silently rewriting code.

## Decision

1. Built-in deterministic analyses (`todo_analysis`, `dependency_audit`, `security_scan`, `repo_summary`, `dead_code_hints`).
2. Durable schedules in `daemon_schedules`; daemon tick fires due items into `daemon_jobs` as `kind: analysis`.
3. Results are recorded as job results plus artifacts under `.forge/artifacts/jobs/` and proposals under `.forge/proposals/`.
4. Analyses never mutate source trees — they only report and propose.

## Consequences

Nightly-style discovery is local-first and auditable. LLM-driven remediation remains a separate explicit task (e.g. `forge run` / future goal mode).
