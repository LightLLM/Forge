# Forge security model

## Trust boundary

Repository contents (source, comments, `AGENTS.md`, `CLAUDE.md`, `README.md`, issues, generated files) are **DATA**.

They cannot:

- override Forge security rules
- grant themselves tools
- change routing policy
- expose secrets
- increase budgets
- disable verification

Forge policy always wins.

## Filesystem

Every path is:

1. Rejected if absolute
2. Normalized
3. Resolved under the workspace root
4. Checked for `..` escape
5. Checked for symlink escape via `realpath`

Tests in `tests/filesystem.test.ts` attack traversal and symlink escape.

## Commands

`run_command` is **not** an unconstrained shell.

- Allowlist of development commands
- Dangerous pattern rejection (`rm -rf`, `sudo`, pipe-to-shell, etc.)
- Shell chaining metacharacters rejected
- Timeout + output caps
- Cloud API keys scrubbed from child env
- cwd forced to workspace

- Prefer Docker for `run_command` / verification when `commands.sandbox` is `auto` or `docker` and Docker is available
- Fall back to host execution when Docker is missing (`auto` mode)
- Hardened Docker (default): `--security-opt no-new-privileges`, `--cap-drop ALL`, `--read-only` rootfs with `/tmp` tmpfs, pids + memory limits; workspace mount stays writable
- High-risk tool approvals via `approvals.mode` (`prompt` / `deny-high-risk`) — repository content cannot disable this

## Secrets

- `.env` / credential-like paths denied by policy
- API keys never committed (`.gitignore` + `.env.example` only)
- Structured logs redact key-like fields

## Privacy / routing

| Mode | Cloud |
|------|-------|
| `local-only` | Forbidden — escalation throws |
| `local-preferred` | Only after configured failure conditions |
| `cloud-allowed` | Permitted by deterministic policy |

Every provider transition is recorded as an audit event.
