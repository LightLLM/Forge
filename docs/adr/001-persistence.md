# ADR 001 — Persistence

## Status

Accepted (v0)

## Decision

Use SQLite via Node `node:sqlite` as the default sync store. Expose `PersistenceStore` so PostgreSQL can be adopted later without rewriting orchestrator domain logic.

## Consequences

Zero native addon; laptop-friendly. Postgres remains optional/async until the orchestrator is fully async.
