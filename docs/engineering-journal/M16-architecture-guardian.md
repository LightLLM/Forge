# M16 — Architecture Guardian

## Gate

Intentional architecture violation causes verification failure.

## Evidence

`tests/m16-architecture.test.ts` — UI→DB import fails `architecture` check.

## Debt

Only `no_import` / layer_boundary rules; require_import not yet enforced.
