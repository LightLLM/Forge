# Forge Desktop

Forge is a **desktop product**. The Web GUI and CLI remain interfaces onto one **Forge Core**; end users should eventually install Forge like any other app (Windows / macOS / Linux) without opening a terminal or a browser to `localhost`.

## Current reality (DESKTOP-0 inspection)

| Piece | Status |
|-------|--------|
| Forge Core | Node/TypeScript under `src/` (orchestrator, policy, tools, verification) |
| Interaction Gateway | `forge start` / `forge gateway start` — HTTP + SSE on `127.0.0.1` |
| GUI | Vanilla SPA in `src/gateway/ui-html.ts` (not React/Next/Vite) |
| Daemon | `src/daemon` + `forge daemon` |
| SQLite | `node:sqlite` — no native addon |
| Packaging | npm CLI package only — **no installer yet** |

## Shell decision

**Electron** is the chosen desktop shell. See [ADR desktop-runtime](adr/desktop-runtime.md) for the full Tauri 2 comparison.

Invariant:

```text
             FORGE CORE
       ┌─────────┼──────────┐
       ▼         ▼          ▼
      CLI     Desktop    Gateway
```

Do not duplicate agent/runtime logic inside the shell.

## Milestone plan

| ID | Scope | Status |
|----|--------|--------|
| DESKTOP-0 | Architecture + Electron ADR | [✓] |
| DESKTOP-1 | Electron shell; embed existing GUI | [ ] |
| DESKTOP-2 | Auto start/stop Core sidecar | [ ] |
| DESKTOP-3 | Native project picker, app data, SecretStore | [ ] |
| DESKTOP-4 | Onboarding + Ollama/OpenRouter UI | [ ] |
| DESKTOP-5 | Tray + notifications + background | [ ] |
| DESKTOP-6 | Windows installer | [ ] |
| DESKTOP-7 | macOS package | [ ] |
| DESKTOP-8 | Linux package | [ ] |
| DESKTOP-9 | CI matrix + signing architecture | [ ] |
| DESKTOP-10 | Auto-update + RC hardening | [ ] |

Developer commands (`pnpm desktop:dev`, etc.) land with DESKTOP-1+. Until then, use:

```bash
pnpm forge -- start --workspace <path>
```

and open the printed URL only for development — that is **not** the product UX.

## Target user experience (future)

```text
Download installer → Install → Launch Forge → Select project → Configure AI → Build
```

No terminal. No manual daemon. No browser. No ports.
