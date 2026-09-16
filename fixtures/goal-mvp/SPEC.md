# Goal MVP fixture

Build a minimal multi-module TypeScript library per this spec.

## Requirements

1. Create `src/alpha.ts` exporting `ALPHA`
2. Create `src/beta.ts` exporting `BETA` (may run in parallel with alpha)
3. Create `src/index.ts` re-exporting both modules

Use the bundled `plan.json` for the task DAG.
