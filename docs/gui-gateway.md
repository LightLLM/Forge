# Forge Interaction Gateway + Web GUI

## Status

Shipped in `1.1.0-rc.1` (GUI-0 → UX-1 foundation).

## Separation of gateways

| Gateway | Role |
|---------|------|
| **Interaction Gateway** (`src/gateway`) | Humans ↔ Forge (Web, Telegram, Slack, API) |
| **Model Gateway** (`src/models`) | Forge ↔ Ollama / OpenRouter |
| **Tool Gateway** (`src/policy` + `src/tools` + MCP) | Forge ↔ filesystem/Git/commands/MCP |

## Run

```bash
forge-harness gateway start --port 8787
# or
forge-harness start
```

Open `http://127.0.0.1:8787/` (loopback by default).

## API (selected)

- `GET /api/health`
- `GET /api/system/status`
- `POST /api/sessions` · `POST /api/sessions/:id/messages`
- `GET /api/events/stream` (SSE)
- `GET /api/approvals` · pairings · channels · models · skills · memory · tools
- `GET /api/tools` — loaded tool packs (repository + Hermes-style `agent`) and network gate

## Channels

- **Fake** — CI E2E
- **Telegram** — polling when `TELEGRAM_BOT_TOKEN` set; pairing required
- **Slack** — webhook `/api/webhooks/slack` when `SLACK_BOT_TOKEN` set
- **WhatsApp** — stub only (official Cloud API later)

## Security

- Default bind `127.0.0.1`
- Channel identities are platform IDs, not display names
- Pairing required before Telegram/Slack command execution
- Chat cannot escalate `local-only` → cloud
- Secrets never returned from API

## Related

- [gui-gateway-baseline.md](gui-gateway-baseline.md)
- ADR 026 (interaction gateway)
