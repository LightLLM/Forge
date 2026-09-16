# M04 — Git worktrees

## Problem

Parallel agents sharing one workspace race on files and git index. Task branches alone do not isolate the working tree.

## Design

- `WorktreeManager` creates `git worktree` checkouts under `.forge/worktrees`
- `WorkspaceLease` file lock prevents two holders on the same path
- `ConflictDetector` / `IntegrationManager` detect overlapping dirty paths
- Dirty worktrees are never force-removed unless explicitly forced
- Config: `git.useWorktrees`, `git.worktreeBase`, `git.acquireLease`

## Gate

Two worktrees write distinct files concurrently; primary repo untouched; no path overlap; same-path lease denied.

## CLI

`forge worktrees list|cleanup|leases|conflicts`

## Remaining debt

- Automatic merge/PR integration (later milestones)
- Lease heartbeats for long daemon workers
