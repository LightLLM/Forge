# ADR 020 — Deterministic knowledge graph

## Status

Accepted (M15)

## Decision

Forge builds a repository knowledge graph via static analysis of TS/JS imports. Queries (`forge kg deps`) answer dependency questions deterministically. LLMs may enrich later but must not replace the graph.

## Consequences

Dependency questions are CI-reproducible without model calls.
