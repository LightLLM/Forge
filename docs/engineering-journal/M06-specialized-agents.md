# M06 — Specialized Agents

## Problem

A single generic worker used the same tools/permissions/prompt for implement, repair, and review, preventing role separation.

## Design

- Built-in roles: architect, planner, implementer, debugger, tester, reviewer
- Each role defines instructions, allowed tools, permissions, context budget, model preference
- Orchestrator selects role per phase (`agents.phaseRoles`) and applies role policy + tool filter
- Roles cannot grant network or raise Forge privileges
- CLI: `forge roles list|inspect|match`

## Gate

Reviewer lacks write tools and is denied write_file by policy; implementer has writes; context prompts differ by role.

## Remaining debt

- Dedicated multi-role pipelines (architect→planner→implementer→reviewer) as first-class runs
- Per-role model binding beyond preference hints (still subject to routing mode)
