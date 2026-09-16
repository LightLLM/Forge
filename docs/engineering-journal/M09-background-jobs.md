# M09 — Background Jobs

## Problem

The daemon could run generic jobs, but Forge lacked scheduled engineering analyses that discover issues and record proposals without rewriting code.

## Design

- Analysis catalog: todo, dependency audit, security scan, repo summary, dead-code hints
- `ScheduleStore` + `JobScheduler` fire due schedules into durable `analysis` jobs
- Daemon tick integrates schedule firing
- Artifacts under `.forge/artifacts/jobs/`; markdown proposals under `.forge/proposals/`
- CLI: `forge jobs catalog|run|schedule|schedules|pause|resume|results`
- Fixture: `fixtures/scheduled-repo`

## Gate

Scheduled fixture job executes and records results (findings + artifact path on completed job).

## Remaining debt

- Cron expressions (interval-only today)
- Wire nightly test / coverage analyses to verification engine
- Optional enqueue of follow-up `forge run` tasks from proposals (still human-gated)
