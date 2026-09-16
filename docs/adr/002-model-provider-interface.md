# ADR 002 — Model provider interface

## Status

Accepted (v0)

## Decision

All inference goes through `ModelProvider`. Concrete adapters: Ollama, OpenRouter, Fake. Orchestrator/router never import provider SDKs.

## Consequences

Provider independence preserved; new vendors are adapters only.
