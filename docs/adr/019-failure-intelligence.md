# ADR 019 — Structured failure corpus

## Status

Accepted (M14)

## Decision

Store structured failures (`symptom`, `cause`, `fix`, `success_evidence`) in `failure_corpus`. Retrieve prior successful fix evidence by keyword overlap during repair.

## Consequences

Known failures surface prior solutions as DATA; they cannot grant permissions or bypass verification.
