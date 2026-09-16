# Model routing

## Providers

- **Ollama** — local default
- **OpenRouter** — optional cloud escalation
- **Fake** — deterministic tests (no network)

## Modes

### local-only

All inference stays on Ollama (or Fake in tests). Escalation attempts throw `CLOUD_FORBIDDEN`.

### local-preferred

1. Try local
2. On verification failure, repair locally up to `maxRepairs`
3. If still failing and OpenRouter is configured, escalate with a **concise package** (not the full transcript)

### cloud-allowed

May select OpenRouter when local is unavailable or policy prefers cloud. Still respects cloud budget.

## Escalation package contents

- original objective
- acceptance criteria
- relevant files (biased toward failure-linked paths)
- shallow import closure from failing test/typecheck output
- current diff
- verification failures
- previous attempted approach
- architecture / security constraints

## Cost controls

- `OPENROUTER_MAX_COST_USD` / `limits.maxCloudCostUsd`
- Cumulative task cloud cost tracked
- If provider omits cost, Forge marks cost as **unknown** (does not invent numbers)
- Unbounded cloud loops are refused via turn/repair/budget limits

## Replaceability

`ModelRouter` is an interface. `DeterministicModelRouter` is the v0 strategy — no AI-based routing.
