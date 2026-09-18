# Forge Desktop

Forge is an **installable cross-platform desktop application**. The Web GUI and CLI remain interfaces onto one **Forge Core**; end users install Forge like any other app and never open a terminal or browser to `localhost`.

## Quick start (developers)

```bash
pnpm desktop:dev
```

On first launch, complete onboarding (project picker → Ollama → OpenRouter → routing), then the existing Forge GUI loads inside the Electron window.

```bash
pnpm desktop:test
pnpm desktop:build:win    # Windows NSIS installer (local)
pnpm desktop:build:mac    # macOS DMG (macOS host/CI)
pnpm desktop:build:linux  # AppImage (Linux host/CI)
```

## Architecture

```text
Electron shell (desktop/)
      │
      ├── Onboarding / tray / notifications / SecretStore IPC
      │
      └── Forge Core (Gateway + orchestrator)
                 │
                 └── 127.0.0.1 only (invisible to users)
```

Invariant: one Core — CLI, Desktop, and Gateway share it. See [ADR](adr/desktop-runtime.md).

## Milestone status

| ID | Scope | Status |
|----|--------|--------|
| DESKTOP-0 | Electron vs Tauri ADR | [✓] |
| DESKTOP-1 | Electron shell embeds GUI | [✓] |
| DESKTOP-2 | Sidecar/runtime supervisor + restart | [✓] |
| DESKTOP-3 | Project picker, app data, SecretStore | [✓] |
| DESKTOP-4 | Onboarding + Ollama/OpenRouter | [✓] |
| DESKTOP-5 | Tray + notifications + background | [✓] |
| DESKTOP-6 | Windows NSIS packaging | [✓] |
| DESKTOP-7 | macOS DMG packaging (CI) | [✓] |
| DESKTOP-8 | Linux AppImage packaging (CI) | [✓] |
| DESKTOP-9 | CI release matrix + signing hooks | [✓] |
| DESKTOP-10 | electron-updater architecture | [✓] |

## Data & secrets

| Kind | Location |
|------|----------|
| Settings | OS app data (`%APPDATA%/Forge`, macOS Application Support, XDG) |
| Secrets | Electron `safeStorage` (Credential Manager / Keychain / libsecret) with file fallback |
| Workspace | User-selected project directory only |
| Chat sessions / messages | Local SQLite (`config.dbPath` under workspace `.forge`) — restored on relaunch |
| Model traces & error logs | Same SQLite (`model_traces`, `app_logs`) — **Eval & Traces** panel |

## Operator panels

- **Terminal** — allowlisted workspace commands (same policy as agent `run_command`); not a free shell
- **Eval & Traces** — token usage, latency, and warn/error log for model calls
- **Sessions** — reopen prior chats; sidebar keeps recent sessions

## Packaging notes

- Artifacts: `Forge-<version>-Windows-x64.exe`, macOS DMG, Linux AppImage
- CI workflow template: [docs/desktop-release.workflow.yml](desktop-release.workflow.yml) → copy to `.github/workflows/desktop-release.yml` (requires a GitHub token with `workflow` scope)
- **Unsigned** builds are development artifacts unless `CSC_*` / Apple notarization secrets are configured
- Auto-update uses `electron-updater` against GitHub Releases — never executes arbitrary binaries
- Local Windows installer was verified: `desktop/release/Forge-1.2.0-rc.1-Windows-x64.exe`

## Product UX

```text
Download → Install → Launch → Open project → Configure AI → Build
```
