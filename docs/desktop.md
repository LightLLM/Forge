# Forge Desktop

Forge is a **desktop product**. The Web GUI and CLI remain interfaces onto one **Forge Core**; end users should eventually install Forge like any other app (Windows / macOS / Linux) without opening a terminal or a browser to `localhost`.

## Current reality

| Piece | Status |
|-------|--------|
| Forge Core | Node/TypeScript under `src/` |
| Interaction Gateway | HTTP + SSE on `127.0.0.1` |
| GUI | Vanilla SPA in `src/gateway/ui-html.ts` (embedded in Electron) |
| Desktop shell | **Electron** under `desktop/` (DESKTOP-1) |
| Daemon | `src/daemon` + `forge daemon` |
| SQLite | `node:sqlite` — no native addon |
| Packaging | Installers = DESKTOP-6+ (not yet) |

## Shell decision

**Electron** — see [ADR desktop-runtime](adr/desktop-runtime.md).

Invariant:

```text
             FORGE CORE
       ┌─────────┼──────────┐
       ▼         ▼          ▼
      CLI     Desktop    Gateway
```

## DESKTOP-1 behavior

```text
pnpm desktop:dev
      ↓
Electron window (loading splash)
      ↓
spawn Forge Gateway sidecar on 127.0.0.1:<ephemeral>
      ↓
load Gateway GUI inside the window
      ↓
on quit → SIGTERM sidecar (no orphans)
```

- No external Chrome/Edge/Safari/Firefox for the primary UI
- Port is chosen automatically; users never type `localhost`
- Workspace defaults to the Forge repo root; override with `FORGE_WORKSPACE`
- Preload exposes only `window.forgeDesktop` metadata (no shell/FS)

## Developer commands

```bash
pnpm desktop:dev     # build Core + launch Electron
pnpm desktop:test    # DESKTOP-0/1 gate tests
pnpm desktop:build   # Core build; packaging arrives in DESKTOP-6+
```

Production users will use an installer (DESKTOP-6+) — never these commands.

## Milestone plan

| ID | Scope | Status |
|----|--------|--------|
| DESKTOP-0 | Architecture + Electron ADR | [✓] |
| DESKTOP-1 | Electron shell; embed existing GUI | [✓] |
| DESKTOP-2 | Hardened sidecar lifecycle / crash restart | [ ] |
| DESKTOP-3 | Native project picker, app data, SecretStore | [ ] |
| DESKTOP-4 | Onboarding + Ollama/OpenRouter UI | [ ] |
| DESKTOP-5 | Tray + notifications + background | [ ] |
| DESKTOP-6 | Windows installer | [ ] |
| DESKTOP-7 | macOS package | [ ] |
| DESKTOP-8 | Linux package | [ ] |
| DESKTOP-9 | CI matrix + signing architecture | [ ] |
| DESKTOP-10 | Auto-update + RC hardening | [ ] |

## Target user experience (future)

```text
Download installer → Install → Launch Forge → Select project → Configure AI → Build
```
