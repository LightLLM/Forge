# M02 — Skills

## Problem

Workers received generic instructions only. Domain procedures (TypeScript, auth, Playwright) were not selected per task, so context was either empty of guidance or would have required dumping every skill.

## Design

- Skill packages: `skills/<id>/skill.json` + `SKILL.md`
- `SkillValidator` rejects privilege keys (permissions, budgets, routing, tools, …)
- `SkillLoader` merges built-in + workspace + config paths
- `SkillRouter` scores triggers/tags/signals; caps with `skills.maxSkills`
- Context injection labeled as DATA; cannot grant tools

## Alternatives

- Always inject all skills — rejected (context bloat)
- Skills that declare tool packs — rejected (privilege escalation)

## Implementation

- `src/skills/*`, built-ins under `/skills`, CLI `forge skills list|inspect|match`
- Orchestrator selects skills each phase and emits `skills_selected` events

## Verification

`pnpm typecheck && pnpm lint && pnpm test && pnpm build` including `tests/m2-skills.test.ts`.

## Remaining debt

- Skill scripts/templates execution (not needed for M2 gate)
- Nextjs/postgres/github built-ins can be added without API changes
