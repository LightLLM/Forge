# ADR 024 — Skill improvements require human install

## Status

Accepted (M19)

## Decision

Forge may propose skill improvements from outcomes, but must never silently install security-impacting changes. Privilege-seeking skill metadata remains rejected by `SkillValidator`.

## Consequences

Self-improvement is proposal-only until a human approves and installs.
