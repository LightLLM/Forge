# Roadmap

## v0 (shipped)

- Local-first harness with Ollama + optional OpenRouter
- Policy-gated tools, SQLite audit trail, verification + repair
- CLI: init, doctor, run, status, inspect, models

## v0.1 (shipped)

Optional Docker sandbox, escalation packaging, task branches, streaming, Playwright

## v0.2 (shipped)

Approval gates, hardened Docker profiles, better relevance

## v0.3 (shipped)

1. **Detached approvals** — `approvals.mode=queue` + `forge approvals` / `forge approve` / `forge deny`
2. **Plugin tool packs** — `tools.packs` loads built-in + external modules (still policy-gated)
3. **PostgreSQL store module** — `PostgresStore` + schema; CLI still defaults to SQLite sync I/O

## v0.4 / M1 (shipped)

**Persistent engineering memory**

- Sessions bound to tasks
- Project / decision / failure / solution / task memories in SQLite
- Keyword retrieval into repair/escalate context
- CLI: `forge memory list|search|inspect|prune|write`
- Tracker: [MILESTONES.md](MILESTONES.md)

## v0.5 / M2 (shipped)

**Skills system**

- Built-in + workspace skills (`skill.json` + `SKILL.md`)
- Validator blocks privilege escalation via skill metadata
- Router loads only relevant skills into worker context
- CLI: `forge skills list|inspect|match`

## v0.6 / M3 (shipped)

**MCP gateway**

- Minimal stdio MCP client (no full SDK)
- Explicit `allowedTools` allowlist; disabled servers by default
- Policy-wrapped `mcp__<server>__<tool>` names with risk/timeout/truncation
- CLI: `forge mcp list|inspect|test|enable|disable`
- Fixture: `fixtures/mcp-echo-server`

## v0.7 / M4 (shipped)

**Git worktrees**

- `WorktreeManager` + workspace leases + conflict detection
- `git.useWorktrees` isolates tasks under `.forge/worktrees`
- CLI: `forge worktrees list|cleanup|leases|conflicts`
- Dirty worktrees never force-deleted by default

## v0.8 / M5 (shipped)

**Task DAG + parallel workers**

- Explicit dependency graphs with cycle checks
- Scheduler with `scheduler.maxParallelWorkers` (default 2)
- Deterministic decomposition + plan JSON
- CLI: `forge graph validate|run`
- Fixture: `fixtures/multi-part-plan`

## v0.9 / M6 (shipped)

**Specialized agents**

- Roles: architect, planner, implementer, debugger, tester, reviewer
- Distinct tools, permissions, context budgets, instructions
- Phase role map via `agents.phaseRoles`
- CLI: `forge roles list|inspect|match`

## v0.10 / M7 (shipped)

**Browser QA**

- Declarative scenarios (`navigate`/`click`/`type`/`assert`/`screenshot`)
- Stub driver for CI + optional Playwright driver
- Integrated into VerificationEngine (`verification.browserQa`)
- CLI: `forge browserqa list|run|demo`
- Fixture: `fixtures/web-login`

## v0.11 / M8 (shipped)

**Persistent daemon**

- Durable job queue in SQLite (`daemon_jobs`)
- Worker pool with claim / heartbeat / complete / fail
- Crash recovery requeues orphaned running jobs
- CLI: `forge daemon start|status|stop|enqueue`
- Config: `daemon.maxWorkers`, poll/heartbeat/stale intervals

## v0.12 / M9 (shipped)

**Background jobs**

- Scheduled engineering analyses (todo, deps, security, summary, dead-code hints)
- Durable `daemon_schedules` + daemon tick firing
- Results as proposals/artifacts (never silent rewrites)
- CLI: `forge jobs catalog|run|schedule|schedules|…`
- Fixture: `fixtures/scheduled-repo`

## v0.13 / M10 (shipped)

**Execution backends**

- `ExecutionBackend` interface: createWorkspace / execute / destroy
- Local + Docker implementations; Remote adapter stub (vendor-neutral)
- `executeCommand` routes through the shared interface
- CLI: `forge exec backends|run`
- Config: `execution.backend`, `execution.remote`

## v0.14 / M11 (shipped)

**Goal mode**

- Durable goals (`goals` table) with phased pipeline
- Resumable task DAG via graph snapshots
- CLI: `forge goal "<objective>"`, `forge goal resume|status|list`
- Fixture: `fixtures/goal-mvp`

## v0.17 / M12–M14 (this release)

**Model evaluation (M12)**

- Deterministic fake-model eval datasets + metrics store
- CLI: `forge eval run|models|report`

**Adaptive router (M13)**

- Performance history ranks policy-allowed model candidates
- Config: `routing.adaptive`, `localCandidates`, `cloudCandidates`

**Failure intelligence (M14)**

- Structured failure corpus + solution evidence retrieval
- CLI: `forge failures search`

## Later

- M15 knowledge graph (see milestones)
- Fully async orchestrator wired to PostgreSQL end-to-end
- Hosted control plane (explicit non-goal until local loop is excellent)
