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

## v0.4 / M1 (this release)

**Persistent engineering memory**

- Sessions bound to tasks
- Project / decision / failure / solution / task memories in SQLite
- Keyword retrieval into repair/escalate context
- CLI: `forge memory list|search|inspect|prune|write`
- Tracker: [MILESTONES.md](MILESTONES.md)

## Later

- M2 Skills, M3 MCP, worktrees, task DAG, daemon, goal mode (see milestones)
- Fully async orchestrator wired to PostgreSQL end-to-end
- Hosted control plane (explicit non-goal until local loop is excellent)
