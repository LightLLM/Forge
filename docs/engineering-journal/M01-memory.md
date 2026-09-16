# M01 — Persistent Engineering Memory

## Problem

Forge had a per-task audit trail (events/artifacts/runs) but no durable cross-task memory. Failures and fixes were lost after a run, so repair always started cold.

## Design

- Extend SQLite (and Postgres schema) with `sessions` and `memories`
- `MemoryService`: write/retrieve/search/prune over `PersistenceStore`
- Prefer **failure** and **solution** memory during repair/escalate
- Inject retrieved memories into `ContextCompiler` as labeled Forge DATA (cannot grant permissions)
- CLI: `forge memory list|search|inspect|prune|write`

## Alternatives

- Vector DB / embeddings — deferred until keyword retrieval is insufficient
- Separate memory database file — rejected; keep one local SQLite for install simplicity

## Implementation

- Types: `MemoryKind`, `MemoryRecord`, `SessionRecord`
- Persistence methods on `PersistenceStore` / `SqliteStore`
- Orchestrator: open session; record failure on verify fail; record solution on recovered complete; always write task outcome; retrieve before each agent phase
- Journal ADR: `docs/adr/004-memory.md`

## Failures

None blocking. Hostile memory content correctly remains DATA; policy unchanged.

## Verification

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Includes `tests/m1-memory.test.ts` (unit + security + E2E retrieval).

## Remaining debt

- Async Postgres memory method parity
- Optional SQLite FTS5
- Richer failure taxonomy (M14)
