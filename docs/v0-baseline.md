# Forge v0 baseline (M0)

**Date:** 2026-09-16  
**Package:** `forge-harness@0.3.0` (pre-M1) → verified before M1 work  
**Commit baseline:** `ce1df26` (Release Forge v0.3)

## Verification commands

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Results (2026-09-16)

| Check | Result |
|-------|--------|
| typecheck | PASS |
| lint | PASS |
| test | PASS — 9 files, 59 tests |
| build | PASS |

## What works

- Control loop: model proposes → policy → tools → independent verification → repair/escalate
- Providers: Ollama, OpenRouter, Fake (`ModelProvider`)
- Routing: `local-only` | `local-preferred` | `cloud-allowed` (deterministic)
- Persistence: SQLite sync store (projects, tasks, runs, events, artifacts, approvals)
- Optional Postgres schema/`PostgresStore` (agent loop still SQLite)
- Policy: path sandbox, command allowlist, secret path denial, approval gates (off/prompt/queue/deny-high-risk)
- Tool packs (policy-gated)
- Context compiler with keyword/relevance/diff/failure-path signals
- CLI: init, doctor, run, status, inspect, models, approvals/approve/deny

## Explicitly absent (pre-M1)

- Sessions / durable engineering memory corpus
- Project / decision / failure / solution memory APIs
- Memory retrieval into worker context
- `forge memory` CLI
- Skills, MCP, worktrees, task DAG, daemon, goal mode (later milestones)

## Security posture (confirmed by existing tests)

- LOCAL_ONLY never selects OpenRouter
- Path traversal / symlink escape blocked
- Unknown tools and network risk denied
- Repository instructions treated as untrusted DATA in prompts

## Conclusion

Forge v0.3 is a healthy baseline. First incomplete super-build milestone: **M1 — Persistent Engineering Memory**.
