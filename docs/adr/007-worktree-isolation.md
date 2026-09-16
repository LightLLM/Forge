# ADR 007 — Worktree isolation for parallel workers

## Status

Accepted (M4)

## Context

Multiple Forge workers must not mutate the same working tree. Branch-only isolation is insufficient.

## Decision

1. Optional `git.useWorktrees` creates a dedicated worktree per task under `.forge/worktrees`.
2. `WorkspaceLease` provides exclusive locks per workspace path (file-based under `.forge/leases`).
3. Cleanup never force-deletes dirty worktrees unless the operator passes `--force`.
4. Conflict detection compares changed paths across worktrees before integration.

## Consequences

Safe parallel coding becomes possible. Integration/merge automation remains a later milestone; overlaps are reported, not auto-merged.
