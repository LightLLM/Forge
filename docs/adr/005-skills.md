# ADR 005 — Skills as non-privileged guidance

## Status

Accepted (M2)

## Context

Reusable engineering procedures should enter worker context only when relevant, without becoming a permission channel.

## Decision

1. Skills are filesystem packages (`skill.json` + `SKILL.md`).
2. Metadata may describe identity, tags, and triggers only.
3. Forbidden metadata keys include permissions, budgets, routing, tools, MCP, approvals, secrets.
4. Selection is deterministic keyword/signal scoring with a max count.
5. Injected skill text is DATA and cannot raise Forge privileges.

## Consequences

Skills improve guidance quality without expanding the attack surface. Privilege changes remain human-controlled in Forge policy/config.
