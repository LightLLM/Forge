# ADR 009 — Specialized agent roles

## Status

Accepted (M6)

## Context

Different engineering jobs need different tool surfaces and instructions without weakening Forge policy.

## Decision

1. Define built-in roles with explicit allowlists and permission flags.
2. Select roles by phase (and optional heuristics); emit `role_selected` audit events.
3. Compile role instructions into the system prompt as Forge-owned guidance.
4. Never allow roles to enable network risk or bypass verification.

## Consequences

Implement/repair/review paths get distinct authorities. Multi-agent **pipelines** (`build`, `debug`, `design`, `full`) document ordered role sequences; Goal mode still runs DAG nodes with parallel workers. Nested Hermes-style `delegate_task` is intentionally not enabled — keep tool authority auditable.
