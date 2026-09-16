# ADR 021 — Architecture guardian in verification

## Status

Accepted (M16)

## Decision

Architecture rules live in `.forge/architecture.json` and are evaluated by `ArchitectureEvaluator` during verification (`verification.architecture`). Violations fail verification independently of the model.

## Consequences

Layer boundary regressions are caught by Forge's verification engine, not by model self-report.
