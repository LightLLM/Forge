# ADR 022 — Durable restricted-action approvals

## Status

Accepted (M17)

## Decision

Extend tool-call queue approvals with `ApprovalFramework` for restricted actions (cloud spend, destructive ops, skill install, etc.). Silence is never approval. Models/agents cannot be decision makers.

## Consequences

High-risk actions require an explicit human decision recorded with evidence and decision maker.
