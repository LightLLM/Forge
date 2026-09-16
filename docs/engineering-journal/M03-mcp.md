# M03 — MCP Gateway

## Problem

Agents needed external tool ecosystems, but unrestricted MCP would bypass Forge’s policy and treat untrusted server output as authority.

## Design

```text
AGENT → POLICY → TOOL GATEWAY → MCP CLIENT (stdio) → MCP SERVER
```

- Minimal stdio JSON-RPC client (no full MCP SDK dependency)
- Servers configured in `mcp.servers`; disabled by default
- **Explicit `allowedTools` required** for agent exposure (never auto-expose)
- Risk classification + overrides; timeouts; result truncation
- MCP payloads marked untrusted; cannot grant permissions

## Gate

Fixture `fixtures/mcp-echo-server` successfully listed/called through gateway + policy.

## CLI

`forge mcp list|inspect|test|enable|disable`

## Remaining debt

- HTTP/SSE transports
- Full MCP resources/prompts
- Persistent MCP process pool across tasks
