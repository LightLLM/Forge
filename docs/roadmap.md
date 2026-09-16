# Roadmap

## v0 (shipped)

- Local-first harness with Ollama + optional OpenRouter
- Policy-gated tools, SQLite audit trail, verification + repair
- CLI: init, doctor, run, status, inspect, models

## v0.1 (this release)

1. **Optional Docker command sandbox** — `commands.sandbox`: `auto` | `host` | `docker`
2. **Richer escalation packaging** — failure path extraction + shallow import closure
3. **Task branch creation** — `git.createTaskBranch` → `forge/<task-id>`
4. **Streaming progress** — Ollama token progress on stderr when `ui.streamProgress` is true
5. **Playwright detection** — `verification.playwright`: `auto` | `on` | `off`

## Later

- PostgreSQL persistence backend
- Better relevance (still preferably without a mandatory vector DB)
- Approval gates for high-risk writes
- Plugin tool packs (still policy-gated)
- Hosted control plane (explicit non-goal until local loop is excellent)
- Hardened Docker user/seccomp profiles
