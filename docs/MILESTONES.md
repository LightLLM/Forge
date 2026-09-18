# Forge milestones

Tracker for the Super Build Prompt. Mark complete only after Definition of Done (tests + E2E + docs).

Legend: `[✓]` complete · `[~]` partial · `[ ]` not started · `[!]` blocked

| ID | Milestone | Status | Completion |
|----|-----------|--------|------------|
| M0 | Baseline (v0 verify + docs) | [✓] | 2026-09-16 |
| M1 | Persistent Engineering Memory | [✓] | 2026-09-16 |
| M2 | Skills | [✓] | 2026-09-16 |
| M3 | MCP Gateway | [✓] | 2026-09-16 |
| M4 | Worktrees | [✓] | 2026-09-16 |
| M5 | Task DAG + Parallel Workers | [✓] | 2026-09-16 |
| M6 | Specialized Agents | [✓] | 2026-09-16 |
| M7 | Browser QA | [✓] | 2026-09-16 |
| M8 | Persistent Daemon | [✓] | 2026-09-16 |
| M9 | Background Jobs | [✓] | 2026-09-16 |
| M10 | Remote Execution | [✓] | 2026-09-16 |
| M11 | Goal Mode | [✓] | 2026-09-16 |
| M12 | Model Evaluation | [✓] | 2026-09-16 |
| M13 | Adaptive Router | [✓] | 2026-09-16 |
| M14 | Failure Intelligence | [✓] | 2026-09-16 |
| M15 | Knowledge Graph | [✓] | 2026-09-16 |
| M16 | Architecture Guardian | [✓] | 2026-09-16 |
| M17 | Human Approval Framework | [✓] | 2026-09-16 |
| M18 | Operator Dashboard | [✓] | 2026-09-16 |
| M19 | Self-Improving Skills | [✓] | 2026-09-16 |
| M20 | Forge v1 RC | [✓] | 2026-09-16 |
| GUI-0 | Gateway API + sessions + SSE | [✓] | 2026-09-16 |
| GUI-1–4 / GW-1–4 / UX-1 | Web GUI + Telegram/Slack + WhatsApp stub | [✓] | 2026-09-16 |
| DESKTOP-0 | Desktop shell ADR (Electron vs Tauri) | [✓] | 2026-09-17 |
| DESKTOP-1 | Electron shell embeds Forge GUI | [✓] | 2026-09-17 |
| DESKTOP-2 | Runtime supervisor / crash restart | [✓] | 2026-09-17 |
| DESKTOP-3 | Project picker + app data + SecretStore | [✓] | 2026-09-17 |
| DESKTOP-4 | Onboarding + Ollama/OpenRouter | [✓] | 2026-09-17 |
| DESKTOP-5 | Tray + notifications + background | [✓] | 2026-09-17 |
| DESKTOP-6 | Windows NSIS packaging | [✓] | 2026-09-17 |
| DESKTOP-7 | macOS DMG packaging (CI) | [✓] | 2026-09-17 |
| DESKTOP-8 | Linux AppImage packaging (CI) | [✓] | 2026-09-17 |
| DESKTOP-9 | CI release matrix + signing hooks | [✓] | 2026-09-17 |
| DESKTOP-10 | electron-updater architecture | [✓] | 2026-09-17 |

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

## M3 — MCP Gateway

- **Status:** complete
- **Scope:** stdio MCP client; server registry; allowlisted policy wrapping; audit events; CLI; fixture echo server
- **Tests:** existing suite + `tests/m3-mcp.test.ts`
- **E2E evidence:** fixture server tools/list + echo call through McpGateway + PolicyEngine; non-allowlisted tools never registered; hostile MCP text does not grant network
- **Limitations:** stdio only; no resources/prompts; no process pool across tasks
- **Completion date:** 2026-09-16

## M4 — Worktrees

- **Status:** complete
- **Scope:** WorktreeManager, WorkspaceLease, ConflictDetector, IntegrationManager; orchestrator wiring; CLI
- **Tests:** existing suite + `tests/m4-worktrees.test.ts`
- **E2E evidence:** two worktrees write independent files without touching primary repo or each other; same-path lease denied; dirty remove refused without force
- **Limitations:** no auto-merge/PR; leases are file-based without daemon heartbeat yet
- **Completion date:** 2026-09-16

## M5 — Task DAG + Parallel Workers

- **Status:** complete
- **Scope:** TaskGraph, DeterministicDecomposer, TaskScheduler, directive executor, `forge graph` CLI, multi-part fixture
- **Tests:** existing suite + `tests/m5-dag.test.ts`
- **E2E evidence:** multi-part plan runs alpha∥beta then combine; parallel observed=2; failure blocks dependents; cycle/missing-dep rejected
- **Limitations:** no LLM planner yet; graph executor for CLI is directive-based (agent-backed node execution deferred)
- **Completion date:** 2026-09-16

## M6 — Specialized Agents

- **Status:** complete
- **Scope:** architect/planner/implementer/debugger/tester/reviewer roles; phase selection; tool/permission filtering; context injection; CLI
- **Tests:** existing suite + `tests/m6-roles.test.ts`
- **E2E evidence:** reviewer denied write_file; implementer allowed; role prompts and context budgets differ; tool allowlists diverge
- **Limitations:** model preference is advisory under routing mode; full multi-role pipelines not yet a single CLI command
- **Completion date:** 2026-09-16

## M7 — Browser QA

- **Status:** complete
- **Scope:** BrowserQaEngine, stub + Playwright drivers, scenario JSON, verification integration, screenshots, CLI, web-login fixture
- **Tests:** existing suite + `tests/m7-browserqa.test.ts`
- **E2E evidence:** login fixture navigate→type→click→assert success with screenshots; VerificationEngine browser_qa check passes; bad credentials fail
- **Limitations:** stub used by default in CI; live Chromium Playwright requires optional install
- **Completion date:** 2026-09-16

## M8 — Persistent Daemon

- **Status:** complete
- **Scope:** durable job queue (`daemon_jobs`), ForgeDaemon worker pool, heartbeats, crash recovery, CLI start/status/stop/enqueue
- **Tests:** existing suite + `tests/m8-daemon.test.ts`
- **E2E evidence:** orphaned running jobs requeued after simulated crash; stop mid-flight then restart completes remaining work without loss
- **Limitations:** `agent_task` not yet wired to TaskOrchestrator; JobStore is SQLite-first (schema mirrored in Postgres)
- **Completion date:** 2026-09-16

## M9 — Background Jobs

- **Status:** complete
- **Scope:** analysis catalog, durable schedules, JobScheduler→daemon enqueue, artifacts/proposals, CLI `forge jobs`
- **Tests:** existing suite + `tests/m9-jobs.test.ts`
- **E2E evidence:** scheduled fixture `todo_analysis` fires, completes, and records findings + artifact under `.forge/artifacts/jobs/`
- **Limitations:** interval schedules only (no cron); analyses are heuristic/report-only; no auto-remediation
- **Completion date:** 2026-09-16

## M10 — Remote Execution

- **Status:** complete
- **Scope:** ExecutionBackend abstraction; Local + Docker implementations; Remote adapter stub; CLI `forge exec`
- **Tests:** existing suite + `tests/m10-execution.test.ts`
- **E2E evidence:** local and docker share createWorkspace/execute/destroy; local run succeeds; remote stub rejects when unconfigured
- **Limitations:** remote provider not connected; legacy `commands.sandbox` still the primary config knob for agent runs
- **Completion date:** 2026-09-16

## M11 — Goal Mode

- **Status:** complete
- **Scope:** GoalStore, GoalEngine phased pipeline, resumable DAG execution, CLI `forge goal`
- **Tests:** existing suite + `tests/m11-goal.test.ts`
- **E2E evidence:** goal-mvp fixture decomposes to 3 tasks and completes; partial graph snapshot resumes after restart
- **Limitations:** planner/architect phases are deterministic; nodes use directive executor not full agent loop
- **Completion date:** 2026-09-16

## M12 — Model Evaluation

- **Status:** complete
- **Scope:** EvalRunner, EvalStore, fake model datasets, CLI `forge eval`
- **Tests:** existing suite + `tests/m12-eval.test.ts`
- **E2E evidence:** good-fake vs bad-fake compared deterministically with stable pass rates
- **Limitations:** live provider eval not included; metrics not auto-fed from orchestrator yet
- **Completion date:** 2026-09-16

## M13 — Adaptive Router

- **Status:** complete
- **Scope:** PerformanceStore, AdaptiveModelRouter, config `routing.adaptive`
- **Tests:** existing suite + `tests/m13-adaptive-router.test.ts`
- **E2E evidence:** picks higher-performing local candidate; local-only never selects cloud despite stats
- **Limitations:** performance recording not automatic on every task; category classification basic
- **Completion date:** 2026-09-16

## M14 — Failure Intelligence

- **Status:** complete
- **Scope:** FailureCorpus, symptom→solution retrieval, CLI `forge failures search`
- **Tests:** existing suite + `tests/m14-failures.test.ts`
- **E2E evidence:** known typecheck failure retrieves stored successful fix evidence
- **Limitations:** keyword retrieval only; not yet wired into orchestrator repair context
- **Completion date:** 2026-09-16

## M15 — Knowledge Graph

- **Status:** complete
- **Scope:** KnowledgeAnalyzer + KnowledgeQuery; file import graph; CLI `forge kg`
- **Tests:** existing suite + `tests/m15-knowledge.test.ts`
- **E2E evidence:** SignupPage→UserRepository dependency path on fixture
- **Limitations:** file-level imports only (no symbols/routes/tables yet)
- **Completion date:** 2026-09-16

## M16 — Architecture Guardian

- **Status:** complete
- **Scope:** ArchitectureRule/Policy/Evaluator; verification.architecture; fixtures
- **Tests:** existing suite + `tests/m16-architecture.test.ts`
- **E2E evidence:** UI→DB import fails verification when policy present
- **Limitations:** primarily `no_import` layer rules
- **Completion date:** 2026-09-16

## M17 — Human Approval Framework

- **Status:** complete
- **Scope:** ApprovalFramework for restricted actions; silence ≠ approval; CLI `--restricted`
- **Tests:** existing suite + `tests/m17-approvals.test.ts`
- **E2E evidence:** pending blocks assertApproved; model cannot self-approve
- **Limitations:** not every future action path is wired yet
- **Completion date:** 2026-09-16

## M18 — Operator Dashboard

- **Status:** complete
- **Scope:** DashboardServer HTTP API + minimal UI over PersistenceStore
- **Tests:** existing suite + `tests/m18-dashboard.test.ts`
- **E2E evidence:** approve via UI API; store/CLI see same status
- **Limitations:** lightweight local UI only
- **Completion date:** 2026-09-16

## M19 — Self-Improving Skills

- **Status:** complete
- **Scope:** SkillImprovementService propose/approve/install; forbid silent security installs
- **Tests:** existing suite + `tests/m19-skill-improve.test.ts`
- **E2E evidence:** hostile proposal cannot silent-install; privilege metadata rejected
- **Limitations:** proposals are manual/CLI; no auto-clustering yet
- **Completion date:** 2026-09-16

## M20 — Forge v1 RC

- **Status:** complete
- **Scope:** 20-capability checklist, eval-suite catalog, version `1.0.0-rc.1`
- **Tests:** existing suite + `tests/m20-v1-rc.test.ts`
- **E2E evidence:** checklist complete; catalog ≥20 tasks; modules exported
- **Limitations:** live soak across many repos remains manual
- **Completion date:** 2026-09-16

## DESKTOP-0 — Desktop runtime ADR

- **Status:** complete
- **Scope:** Inspect Core/Gateway/GUI/daemon/deps; choose Electron vs Tauri 2 for *this* repo; document in `docs/adr/desktop-runtime.md` and `docs/desktop.md`. No shell scaffolding.
- **Tests:** existing suite + `tests/desktop-0-adr.test.ts`
- **E2E evidence:** ADR records Electron decision with comparison table; GUI identified as vanilla gateway SPA (not React/Next)
- **Limitations:** No installer yet; product still started via CLI for development
- **Completion date:** 2026-09-17

## DESKTOP-1 — Electron shell embeds Forge GUI

- **Status:** complete
- **Scope:** `desktop/` Electron app; loading splash; spawn Gateway sidecar on `127.0.0.1` ephemeral port; load existing vanilla GUI in `BrowserWindow`; narrow preload; quit kills sidecar. Scripts: `pnpm desktop:dev|test|build`.
- **Tests:** existing suite + `tests/desktop-1-shell.test.ts`
- **E2E evidence:** sidecar helpers pick loopback port / wait for `/api/system/status`; package declares Electron main; GUI never requires an external browser for primary UI
- **Limitations:** Superseded by DESKTOP-2…10 finalize
- **Completion date:** 2026-09-17

## DESKTOP-2 … DESKTOP-10 — Desktop finalize

- **Status:** complete
- **Scope:** Runtime supervisor + in-process host; app-data settings; SecretStore (safeStorage); native project picker; onboarding wizard; Ollama detect; OpenRouter key storage; tray + notifications + background mode; electron-builder Win/macOS/Linux; GitHub Actions release matrix; electron-updater hooks. Version `1.2.0-rc.1`.
- **Tests:** `tests/desktop-finalize.test.ts` + prior desktop gates
- **E2E evidence:** in-process gateway status OK; secrets round-trip; supervisor restart bounds; packaging config + CI workflow present
- **Limitations:** macOS/Linux installers produced on CI runners; code signing/notarization require secrets (unsigned = not production-distribution ready); full GUI E2E with FakeModel is follow-on soak
- **Completion date:** 2026-09-17

## Next incomplete

Desktop product RC is feature-complete for local install → launch → onboard → build. Follow-ons: signed release credentials, deeper GUI E2E, optional always-on OS service mode (explicitly deferred).

Super Build Prompt milestones M0–M20 and GUI/Gateway v1.1 are complete. Hosted control plane remains an explicit non-goal.
