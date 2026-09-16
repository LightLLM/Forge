# ADR 006 — MCP behind policy with explicit allowlists

## Status

Accepted (M3)

## Context

MCP expands tool surface area. Servers and their outputs are untrusted.

## Decision

1. Speak a minimal stdio MCP subset in-process (initialize, tools/list, tools/call).
2. Do not load a full MCP SDK for v0 local-first installs.
3. Never expose MCP tools to agents unless the server is `enabled` and the tool is in `allowedTools`.
4. Wrap MCP tools as `RegisteredTool` with risk, timeout, and result limits; still pass `PolicyEngine`.
5. Treat MCP responses as DATA that cannot change Forge policy.

## Consequences

Safe fixture integrations work without installing large dependency trees. Advanced transports can be added later behind the same gateway interface.
