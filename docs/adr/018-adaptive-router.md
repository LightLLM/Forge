# ADR 018 — Adaptive routing under policy envelope

## Status

Accepted (M13)

## Decision

`AdaptiveModelRouter` wraps deterministic policy and ranks only among allowed candidates using `model_performance` history. Routing mode (`local-only`, etc.) is never overridden.

## Consequences

Performance data influences model choice without weakening privacy or budget policy.
