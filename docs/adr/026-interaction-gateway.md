# ADR 026 — Interaction Gateway separate from model and tool gateways

## Status

Accepted

## Decision

Forge exposes a localhost-bound **Interaction Gateway** (`src/gateway`) for Web GUI and messaging channels. It reuses `PersistenceStore`, `TaskOrchestrator`, policy, and memory. It does not replace `McpGateway` or `ModelProvider`.

Channel adapters implement `ChannelAdapter` and normalize to `GatewayMessage`. Authorization and pairing are deterministic backend checks.

## Consequences

CLI, Web, Telegram, and Slack share one runtime. Optional channels do not fail `forge doctor`.
