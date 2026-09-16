# ADR 017 — Deterministic model evaluation

## Status

Accepted (M12)

## Decision

Forge owns eval datasets and metrics storage. Fake model profiles enable deterministic comparison without live APIs. CLI: `forge eval run|models|report`.

## Consequences

Model quality comparisons are reproducible in CI; live provider eval remains user-configured later.
