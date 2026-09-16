# M10 — Remote Execution

## Problem

Host vs Docker execution used parallel helpers. There was no shared lifecycle for workspaces and no place for a remote worker adapter.

## Design

- `ExecutionBackend`: createWorkspace → execute → destroy
- Implementations: Local, Docker, Remote (stub adapter)
- `resolveExecutionBackend` / `runWithBackend`
- `executeCommand` delegates to the shared interface
- CLI: `forge exec backends|run`
- Config: `execution.backend`, `execution.remote.endpoint` / `tokenEnv`

## Gate

Local and Docker use the same interface; remote remains an adapter interface.

## Remaining debt

- Concrete remote providers (SSH / Runpod / VM) behind the adapter
- Compute fleet capability advertisement (M22-adjacent)
- Align orchestrator to prefer `execution.backend` over legacy `commands.sandbox` naming
