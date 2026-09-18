# Forge architecture

## Control loop

```text
USER → CLI → TaskOrchestrator → ContextCompiler → ModelRouter
                                              ↓
                                         AgentLoop
                                              ↓
                                         PolicyEngine
                                              ↓
                                         ToolGateway → Workspace
                                              ↓
                                         VerificationEngine
                                              ↓
                                    pass → COMPLETE
                                    fail → Repair → (optional) Escalate
```

## Module map

| Area | Responsibility |
|------|----------------|
| `src/cli` | User commands; no business logic beyond wiring |
| `src/config` | Zod-validated config + env/CLI merge |
| `src/core` | Domain types, state machine, budgets |
| `src/persistence` | `PersistenceStore` interface + SQLite impl |
| `src/memory` | Sessions + durable engineering memory |
| `src/skills` | Skill load/validate/route into context |
| `src/mcp` | Policy-gated MCP client + registry |
| `src/models` | Provider-neutral inference + deterministic router |
| `src/context` | Context compiler (not full-repo dumps) |
| `src/policy` | Authorization decisions |
| `src/tools` | Typed tools (Zod) + allowlisted commands |
| `src/workspace` | Path sandbox + git worktrees/leases |
| `src/agent` | Bounded loop + orchestrator |
| `src/agents` | Specialized role definitions + selection |
| `src/scheduler` | Task DAG + parallel worker scheduler |
| `src/verification` | Independent checks + browser QA |
| `src/daemon` | Persistent job queue, workers, crash recovery |
| `src/jobs` | Scheduled engineering analyses + schedule store |
| `src/execution` | Local / Docker / remote ExecutionBackend |
| `src/goal` | Durable multi-task goals + resumable pipeline |
| `src/eval` | Model evaluation datasets and metrics |
| `src/routing` | Adaptive performance-aware routing |
| `src/failures` | Structured failure corpus + retrieval |
| `src/knowledge` | Deterministic repository knowledge graph |
| `src/architecture` | Architecture rules + verification guardian |
| `src/dashboard` | Operator HTTP UI over PersistenceStore |
| `src/v1` | Forge v1 capability checklist + eval catalog helpers |
| `src/gateway` | Interaction Gateway API, sessions, SSE, channels, web GUI |
| `src/desktop` | Desktop sidecar lifecycle helpers (Electron host; no agent logic) |
| `src/telemetry` | Structured logs with secret redaction |

## Desktop product direction

Forge is intended to ship as a **cross-platform desktop application** (Windows / macOS / Linux). The Interaction Gateway web GUI is the presentation layer; it will be embedded in a native shell so users never open a browser or manage `localhost`.

**DESKTOP-0…10:** Electron shell with onboarding, SecretStore, tray, Win/macOS/Linux packaging, CI release matrix, and electron-updater. See [desktop.md](desktop.md).

Invariant: one Forge Core; CLI, Desktop, and Gateway are interfaces — do not duplicate runtime logic in the shell.

## Persistence

SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) stores `projects`, `tasks`, `runs`, `events`, `artifacts`, `approvals`, `sessions`, and `memories`. No native addon is required.

Durable engineering memory (project/decision/failure/solution/…) is retrievable across tasks and injected into the context compiler as labeled DATA. See [ADR 004](adr/004-memory.md) and [MILESTONES.md](MILESTONES.md).

The `PersistenceStore` interface is designed so PostgreSQL can replace SQLite later without changing the orchestrator.

Chat history is **not** application state. Task status transitions are explicit and validated.

## Provider independence

Orchestrator code depends on `ModelProvider`, never on Ollama/OpenRouter specifics.

## Why this layout

Small modules with explicit interfaces keep policy, verification, and routing auditable — the properties Forge must never outsource to a model.
