# Roadmap

## v0 (shipped)

- Local-first harness with Ollama + optional OpenRouter
- Policy-gated tools, SQLite audit trail, verification + repair
- CLI: init, doctor, run, status, inspect, models

## v0.1 (shipped)

Optional Docker sandbox, escalation packaging, task branches, streaming, Playwright

## v0.2 (shipped)

Approval gates, hardened Docker profiles, better relevance

## v0.3 (this release)

1. **Detached approvals** — `approvals.mode=queue` + `forge approvals` / `forge approve` / `forge deny`
2. **Plugin tool packs** — `tools.packs` loads built-in + external modules (still policy-gated)
3. **PostgreSQL store module** — `PostgresStore` + schema; CLI still defaults to SQLite sync I/O

## Later

- Fully async orchestrator wired to PostgreSQL end-to-end
- Hosted control plane (explicit non-goal until local loop is excellent)
- Richer pack marketplace / signing
