# Roadmap

## v0 (shipped)

- Local-first harness with Ollama + optional OpenRouter
- Policy-gated tools, SQLite audit trail, verification + repair
- CLI: init, doctor, run, status, inspect, models

## v0.1 (shipped)

1. Optional Docker command sandbox
2. Richer escalation packaging
3. Task branch creation
4. Streaming progress
5. Playwright detection

## v0.2 (this release)

1. **Approval gates** for high-risk tools — `approvals.mode`: `off` | `prompt` | `deny-high-risk`
2. **Hardened Docker profiles** — no-new-privileges, cap-drop ALL, read-only rootfs + tmpfs, pids/memory limits
3. **Better relevance** — entrypoint detection, git-diff boost, 2-hop import neighborhoods

## Later

- PostgreSQL persistence backend
- Plugin tool packs (still policy-gated)
- Hosted control plane (explicit non-goal until local loop is excellent)
- Approval UX via `forge approve` for detached runs
