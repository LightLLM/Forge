# ADR 023 — Operator dashboard shares CLI backend

## Status

Accepted (M18)

## Decision

The operator dashboard is a thin HTTP UI over `PersistenceStore` and `ApprovalFramework`. Business logic is not duplicated.

## Consequences

Approvals and task state stay synchronized between `forge approve` and the dashboard API.
