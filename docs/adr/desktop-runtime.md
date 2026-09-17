# ADR — Desktop runtime shell (Electron vs Tauri 2)

## Status

Accepted (DESKTOP-0) — **choose Electron** for Forge Desktop v1.

## Context

Forge today is a **Node.js 22+ TypeScript harness**, not a hosted web SaaS:

| Area | Current state |
|------|----------------|
| GUI | Vanilla HTML/CSS/JS SPA embedded in `src/gateway/ui-html.ts` (~19KB). **Not** Next.js, Vite React, or another SPA framework. Served by the Interaction Gateway. |
| Gateway API | `GatewayServer` (`src/gateway/server.ts`) — HTTP + SSE on **127.0.0.1** by default |
| Runtime | `TaskOrchestrator` + agent loop + policy + tools in-process with the gateway/CLI |
| Daemon | `src/daemon` — durable SQLite job queue, workers, crash recovery (`forge daemon`) |
| Persistence | `node:sqlite` (`DatabaseSync`) — **no native addon** |
| Models | Ollama (HTTP localhost) + OpenRouter (HTTP) via `ModelProvider` |
| Tools | Workspace sandbox, allowlisted `child_process`, Git, optional Docker `ExecutionBackend` |
| Browser QA | Optional Playwright driver when the **target project** has Playwright — Node-side |
| Packaging | npm package `forge-harness` + CLI bin; **no** desktop installer yet |
| Layout | Single package (`src/*`), not yet `apps/` + `packages/` monorepo |

Product goal: **download → install → launch Forge → select repo → configure AI → build**, with no terminal, no manual localhost, no browser.

Architectural invariant: **one Forge Core**; Desktop / CLI / Gateway are interfaces. The shell must not duplicate agent, policy, or persistence logic.

## Options

### A — Electron

Chromium + Node main process. Forge Core runs as a **managed sidecar** (child Node process running Gateway) or, later, in the main process. Renderer loads the existing GUI (gateway URL or packaged static assets). Loopback HTTP/SSE stays internal and invisible to users.

### B — Tauri 2

OS WebView + Rust core. Forge Core would need a **Node sidecar** anyway (or a full rewrite). IPC would bridge Rust ↔ Node ↔ GUI. Smaller installer and lower idle memory are real benefits.

## Comparison (for *this* repository)

| Criterion | Electron | Tauri 2 | Winner for Forge now |
|-----------|----------|---------|----------------------|
| Installer size | Larger (~80–150MB+ typical) | Smaller (WebView + Rust) | Tauri |
| Memory | Higher (Chromium) | Lower | Tauri |
| Node integration | Native — same runtime as Core | Requires sidecar or rewrite | **Electron** |
| Child processes | Straightforward (`child_process`, tree-kill) | Possible via sidecar; more glue | **Electron** |
| Filesystem | Node `fs` + existing workspace sandbox | Rust FS + bridge to Core sandbox | **Electron** |
| PTY / terminal | Node ecosystem (`node-pty` later) | Extra native work | **Electron** |
| SQLite | Already `node:sqlite` in Core | Would still live in Node Core | Tie (Core unchanged) |
| Git | Existing Node/Git tooling | Same via sidecar | Tie |
| Ollama | Existing HTTP client in Core | Same via sidecar | Tie |
| Playwright | Node-based optional driver | Same via sidecar; harder packaging story | **Electron** |
| Auto-update | `electron-updater` (signed feeds) | Tauri updater | Tie (both mature) |
| Code signing | Established Win/macOS flows | Established | Tie |
| Windows / macOS / Linux | Mature | Mature (WebView2 / WKWebView / WebKitGTK) | Tie |
| Security (renderer) | Must lock down; contextIsolation + narrow preload IPC | Stronger default isolation | Tauri slight edge |
| Development complexity | Low — team already ships Node gateway + GUI | High — Rust + Node dual stack for same Core | **Electron** |
| Time-to-DESKTOP-1 | Embed existing GUI in `BrowserWindow` quickly | Scaffold Rust app + spawn Node + IPC | **Electron** |

## Decision

**Adopt Electron as the Forge Desktop shell for DESKTOP-1 onward.**

Reasons specific to this codebase:

1. **Forge Core is already a Node process graph** (gateway, daemon workers, tool spawns, Playwright). Electron’s main process is the least-friction host for starting/stopping that graph as a bundled sidecar.
2. **GUI is gateway-served vanilla HTML**, not a Rust-friendly asset pipeline. DESKTOP-1 can render it inside a native window without rewriting UI.
3. **No monorepo split yet.** Introducing Tauri before Core is packageable as a stable sidecar increases dual-toolchain risk without buying user-visible product value.
4. Installer size and RAM are secondary to shipping: *install → launch → build* without a terminal.

**Revisit Tauri 2** only if/when Forge Core can ship as a single non-Node binary (or a frozen sidecar with stable IPC) *and* installer size becomes a measured product blocker. That revisit is a new ADR, not a silent flip.

## Non-goals for DESKTOP-0

- No Electron/Tauri scaffolding in this milestone
- No `apps/` / `packages/` monorepo migration yet (planned conceptually; executed later)
- No claim of signed production installers

## Consequences

- DESKTOP-1: Electron shell; load existing Forge GUI in-window; no external browser
- DESKTOP-2+: shell owns lifecycle; Core remains headless and reusable by CLI/Gateway
- Loopback (`127.0.0.1`) may remain for GUI↔Core; users never manage ports
- Renderer stays untrusted; narrow typed IPC only (no `exec`, no arbitrary FS)
- Packaging (DESKTOP-6–8) will use Electron Builder (or equivalent), not Tauri bundlers
