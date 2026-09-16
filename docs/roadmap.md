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

## v0.7 / M4 (this release)

**Git worktrees**

- `WorktreeManager` + workspace leases + conflict detection
- `git.useWorktrees` isolates tasks under `.forge/worktrees`
- CLI: `forge worktrees list|cleanup|leases|conflicts`
- Dirty worktrees never force-deleted by default

## Later

- M5 task DAG + parallel workers, daemon, goal mode (see milestones)
- Fully async orchestrator wired to PostgreSQL end-to-end
- Hosted control plane (explicit non-goal until local loop is excellent)
