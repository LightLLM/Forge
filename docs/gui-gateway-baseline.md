# Forge GUI + Gateway baseline

**Date:** 2026-09-16  
**Package:** `forge-harness@1.0.0-rc.1`  
**Verification (pre-GUI work):**

| Check | Result |
|-------|--------|
| typecheck | PASS |
| lint | PASS |
| test | PASS — 29 files, 141 tests |
| build | PASS |

## What exists

| Capability | Status | Notes |
|------------|--------|-------|
| CLI | ✓ | Full Commander CLI |
| Daemon | ✓ | Durable job queue + workers |
| HTTP API | ~ | Operator dashboard only (`src/dashboard`) |
| Task orchestrator | ✓ | `TaskOrchestrator` + `AgentLoop` |
| Goal system | ✓ | `GoalEngine` / `GoalStore` |
| Sessions | ~ | Memory/task sessions — **not** interaction/chat sessions |
| Memory | ✓ | Keyword retrieval |
| Model router | ✓ | Deterministic + adaptive |
| Ollama / OpenRouter | ✓ | Via `ModelProvider` |
| Tools / policy / approvals | ✓ | Including restricted-action framework |
| Events | ~ | SQLite audit trail — **no** SSE/WebSocket push |
| Database | ✓ | SQLite default; Postgres module |
| Skills / MCP / worktrees / agents | ✓ | |
| Verification / scheduler | ✓ | |
| Operator dashboard | ✓ | Minimal HTML, 2s poll, localhost |
| Channel gateway | ✗ | No Telegram / Slack / WhatsApp |
| Next.js / React / Tailwind | ✗ | Not in dependencies |
| Interaction Gateway API | ✗ | Missing |
| Session Manager (chat) | ✗ | Missing |
| Real-time event stream | ✗ | Missing |

## Architectural decision (this workstream)

- **Do not rebuild** orchestrator, router, policy, tools, or CLI business logic.
- Add `src/gateway/` as Interaction Gateway (human → Forge), separate from Model Gateway and MCP/Tool Gateway.
- Serve a Vite + React + Tailwind SPA from the same localhost-bound Gateway process (SPA chosen over Next.js so GUI and API share one process and bind to `127.0.0.1` by default).
- Channel adapters (Fake → Telegram → Slack → WhatsApp stub) normalize to `GatewayMessage` and call the same Gateway API.

## Gaps this workstream closes

1. GUI-0 — Gateway API, interaction sessions, SSE  
2. GUI-1–4 — Web dashboard through gateway management  
3. GW-1–4 — Channel abstraction + Telegram + Slack + WhatsApp stub  
4. UX-1 — Mobile, palette, notifications  
5. CLI `forge gateway` / `forge start`, doctor expansions, tests, docs  
