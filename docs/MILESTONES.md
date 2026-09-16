# Forge milestones

Tracker for the Super Build Prompt. Mark complete only after Definition of Done (tests + E2E + docs).

Legend: `[✓]` complete · `[~]` partial · `[ ]` not started · `[!]` blocked

| ID | Milestone | Status | Completion |
|----|-----------|--------|------------|
| M0 | Baseline (v0 verify + docs) | [✓] | 2026-09-16 |
| M1 | Persistent Engineering Memory | [✓] | 2026-09-16 |
| M2 | Skills | [✓] | 2026-09-16 |
| M3 | MCP Gateway | [ ] | |
| M4 | Worktrees | [ ] | |
| M5 | Task DAG + Parallel Workers | [ ] | |
| M6 | Specialized Agents | [ ] | |
| M7 | Browser QA | [ ] | |
| M8 | Persistent Daemon | [ ] | |
| M9 | Background Jobs | [ ] | |
| M10 | Remote Execution | [ ] | |
| M11 | Goal Mode | [ ] | |
| M12 | Model Evaluation | [ ] | |
| M13 | Adaptive Router | [ ] | |
| M14 | Failure Intelligence | [ ] | |
| M15 | Knowledge Graph | [ ] | |
| M16 | Architecture Guardian | [ ] | |
| M17 | Human Approval Framework | [~] | queue approvals in v0.3; full durable framework later |
| M18 | Operator Dashboard | [ ] | |
| M19 | Self-Improving Skills | [ ] | |
| M20 | Forge v1 RC | [ ] | |

---

## M0 — Baseline

- **Status:** complete
- **Scope:** Inspect repo, run full verification, write `docs/v0-baseline.md`
- **Tests:** `pnpm typecheck && pnpm lint && pnpm test && pnpm build`
- **E2E evidence:** 59 existing tests green including fake-provider agent E2E
- **Limitations:** Pre-memory; see baseline doc
- **Completion date:** 2026-09-16

## M1 — Persistent Engineering Memory

- **Status:** complete
- **Scope:** sessions; project/decision/failure/solution/task memory; retrieval; CLI; context injection; failure→solution write path
- **Tests:** existing suite + `tests/m1-memory.test.ts`
- **E2E evidence:** failure corpus written by task A is retrieved for task B repair context; policy still denies network after hostile memory text
- **Limitations:** Keyword retrieval only (no embeddings/FTS); Postgres schema includes tables but agent loop remains SQLite; no MemoryCompactor LLM summarization yet (prune is retention-based)
- **Completion date:** 2026-09-16

## M2 — Skills

- **Status:** complete
- **Scope:** SkillRegistry/Loader/Router/Validator; built-in skills; relevant-only context injection; `forge skills` CLI
- **Tests:** existing suite + `tests/m2-skills.test.ts`
- **E2E evidence:** “Implement authentication” selects security-review (+ typescript via signals) and excludes playwright/documentation; privilege-seeking skill.json rejected
- **Limitations:** Keyword/signal routing only; skill scripts not executed; subset of planned skill catalog shipped as built-ins
- **Completion date:** 2026-09-16

## Next incomplete

**M3 — MCP Gateway** (MCP client, server registry, policy wrapping, audit, CLI)
