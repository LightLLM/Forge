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
| `src/models` | Provider-neutral inference + deterministic router |
| `src/context` | Context compiler (not full-repo dumps) |
| `src/policy` | Authorization decisions |
| `src/tools` | Typed tools (Zod) + allowlisted commands |
| `src/workspace` | Path sandbox |
| `src/agent` | Bounded loop + orchestrator |
| `src/verification` | Independent checks |
| `src/telemetry` | Structured logs with secret redaction |

## Persistence

SQLite via Node's built-in `node:sqlite` (`DatabaseSync`) stores `projects`, `tasks`, `runs`, `events`, `artifacts`, `approvals`. No native addon is required.

The `PersistenceStore` interface is designed so PostgreSQL can replace SQLite later without changing the orchestrator.

Chat history is **not** application state. Task status transitions are explicit and validated.

## Provider independence

Orchestrator code depends on `ModelProvider`, never on Ollama/OpenRouter specifics.

## Why this layout

Small modules with explicit interfaces keep policy, verification, and routing auditable — the properties Forge must never outsource to a model.
