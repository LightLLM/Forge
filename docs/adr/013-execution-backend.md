# ADR 013 — Vendor-neutral ExecutionBackend

## Status

Accepted (M10)

## Context

Command execution was split between host and Docker helpers without a shared lifecycle. Future remote workers (SSH, GPU VM, etc.) must not force a vendor SDK into the core loop.

## Decision

1. Introduce `ExecutionBackend` with `createWorkspace` / `execute` / `destroy`.
2. Ship `LocalExecutionBackend` and `DockerExecutionBackend` on that interface.
3. Ship `RemoteExecutionBackend` as an adapter stub (configure endpoint + token; no vendor lock-in).
4. Route `executeCommand` through the abstraction so policy/tools stay backend-agnostic.

## Consequences

Local and Docker are interchangeable at the call site. Remote providers can be plugged in later without rewriting the agent loop.
