# M07 — Browser QA

## Problem

Forge could invoke Playwright scripts when present, but lacked a first-class, policy-owned browser interaction verifier with screenshots and declarative scenarios.

## Design

- `BrowserQaEngine` runs JSON scenarios: navigate/click/type/assert/screenshot
- Drivers: Playwright (optional dynamic import) and Stub (deterministic HTTP fixture for CI)
- VerificationEngine integrates `browserQa: auto|on|off`
- Screenshots stored under `.forge/artifacts/browserqa/<id>/`
- CLI: `forge browserqa list|run|demo`
- Fixture: `fixtures/web-login`

## Gate

Login scenario passes with stub driver (navigate → type → click → assert success + screenshots).

## Remaining debt

- Live Playwright CI job with browser install
- Network/console richer HAR capture
- Auto-start app servers from scenario metadata
