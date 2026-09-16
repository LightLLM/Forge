# ADR 003 — Tool security

## Status

Accepted (v0)

## Decision

Models only propose tool calls. Forge validates schema, classifies risk, applies policy (sandbox paths, command allowlist, secret denial, approvals). Network tools denied by default. Repository/MCP/skill text cannot raise privileges.

## Consequences

No unrestricted shell or host access. Autonomy grows only behind the same gate.
