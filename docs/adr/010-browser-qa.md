# ADR 010 — Browser QA as Forge-owned verification

## Status

Accepted (M7)

## Context

UI success cannot be claimed by models. Browser checks must be deterministic and auditable.

## Decision

1. Declarative scenarios under `.forge/browserqa` / `browserqa`.
2. Prefer Playwright when installed; otherwise use a stub driver for local/CI gates.
3. Treat screenshots and step results as verification artifacts.
4. Never accept model text as browser proof.

## Consequences

Forge can verify login-style flows without requiring Chromium in every environment, while remaining ready for real Playwright.
