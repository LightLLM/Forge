# ADR 004 — Persistent engineering memory

## Status

Accepted (M1)

## Context

Forge needs durable knowledge across tasks—especially failure/solution pairs—without dumping chat history into every prompt.

## Decision

1. Store memories and sessions in the same SQLite database as tasks/events.
2. Support kinds: project, architecture, decision, convention, failure, solution, dependency, task, run, artifact, session.
3. Use deterministic keyword scoring for retrieval; no vector database in M1.
4. Memory text injected into worker context is **DATA** and cannot grant permissions, change budgets, or disable verification.
5. Expose inspectable CLI: list, search, inspect, prune, write.

## Consequences

- Local-first install remains simple.
- Retrieval quality depends on tags/keywords; may need FTS/embeddings later (benchmark first).
- Postgres schema mirrors tables for future async parity; live loop stays on SQLite for now.
