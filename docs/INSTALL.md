# Install Forge on Windows, macOS, and Linux

Forge ships as a **desktop application** and as a developer CLI (`forge-harness`).  
Supported desktops: **Windows 10/11**, **macOS 12+**, and **Linux** (x64/arm64).

Repository: https://github.com/LightLLM/Forge

---

## Desktop installer (recommended for end users)

1. Download the artifact for your OS from [GitHub Releases](https://github.com/LightLLM/Forge/releases) (or build locally — see below).
2. Install / open the app (`Forge-*-Windows-x64.exe`, `.dmg`, or `.AppImage`).
3. Launch **Forge** → complete onboarding → open a project → start building.

No terminal, no `localhost`, no manual daemon.

Local Windows package (unsigned RC):

```bash
pnpm desktop:build:win
# → desktop/release/Forge-1.2.0-rc.1-Windows-x64.exe
```

macOS / Linux packages are built on CI (`macos-latest` / `ubuntu-latest`). Unsigned builds are **not** production-distribution ready until signing secrets are configured.

---

## 1. Prerequisites (CLI / developer installs)

| Tool | Requirement | Why |
|------|-------------|-----|
| **Node.js** | **22 or newer** | Runtime (`node:sqlite`, ESM CLI) |
| **Git** | Any recent | Clone repo, task branches/worktrees |
| **pnpm** (recommended) or npm | pnpm 9+ / npm 10+ | Install & link the CLI |
| **Ollama** | Optional but recommended | Local models (`local-only` / `local-preferred`) |
| **OpenRouter API key** | Optional | Cloud escalation |
| **Docker** | Optional | Sandboxed command execution |

### Install Node.js 22+

- **Windows:** https://nodejs.org (LTS 22+) or `winget install OpenJS.NodeJS.LTS`
- **macOS:** https://nodejs.org or `brew install node@22`
- **Linux:** https://nodejs.org or your distro’s Node 22 package / NodeSource

Verify:

```bash
node -v    # must print v22.x or higher
npm -v
git --version
```

### Install pnpm (recommended)

```bash
npm install -g pnpm
pnpm -v
```

### Install Ollama (local models)

1. Download from https://ollama.com (Windows / macOS / Linux installers)
2. Pull a model you choose (Forge does **not** hard-code names):

```bash
ollama pull llama3.2
# or any tool-capable model you prefer
```

3. Confirm the daemon responds:

```bash
ollama list
curl http://localhost:11434/api/tags
```

On Windows PowerShell, `curl` is an alias for `Invoke-WebRequest`; use:

```powershell
Invoke-RestMethod http://localhost:11434/api/tags
```

---

## 2. Install Forge (pick one method)

### Method A — Clone and install globally (best for desktop)

Works the same on Windows, macOS, and Linux.

```bash
git clone https://github.com/LightLLM/Forge.git
cd Forge
```

Then either run the helper script:

```bash
# macOS / Linux
chmod +x scripts/install.sh && ./scripts/install.sh

# Windows PowerShell
.\scripts\install.ps1
```

Or install manually:

```bash
pnpm install          # or: npm install
pnpm build            # or: npm run build
npm install -g . --force
```

`--force` overwrites a conflicting global `forge` binary (Atlassian Forge / Foundry). Prefer **`forge-harness`** day to day.

Verify:

```bash
forge-harness --version
# expect: 1.0.0-rc.1 (or newer)
forge-harness doctor
```

> **Name collision:** Atlassian Forge and Ethereum Foundry also ship a `forge` binary.  
> Prefer **`forge-harness`**. Check which binary you get:
>
> ```bash
> # macOS / Linux
> which forge
> which forge-harness
>
> # Windows PowerShell
> Get-Command forge, forge-harness | Format-Table Name, Source
> ```

### Method B — Global install directly from GitHub

```bash
npm install -g github:LightLLM/Forge
# if another `forge` exists:
npm install -g github:LightLLM/Forge --force
```

Then:

```bash
forge-harness --version
forge-harness doctor
```

### Method C — Use without a global install

From the cloned repo:

```bash
pnpm forge -- doctor
pnpm forge -- run "your objective" --mode local-only
```

Or after build:

```bash
node dist/cli/index.js doctor
```

### Method D — One-shot via npx (no permanent install)

```bash
npx --yes github:LightLLM/Forge doctor
```

For day-to-day use, Method A or B is clearer.

---

## 3. Platform notes

### Windows

- Use **PowerShell** or **Windows Terminal**. Command Prompt also works after Node is on `PATH`.
- Global shims are created as `forge.cmd` / `forge-harness.cmd` under your npm/pnpm global prefix.
- If `forge` / `forge-harness` is not found after linking:

  ```powershell
  npm prefix -g
  # Ensure that folder's ...\bin or the pnpm home is on PATH
  ```

  Typical npm global bin (User install):

  `%AppData%\npm`

  Add it to **Settings → System → About → Advanced → Environment Variables → Path**.

- Execution policy rarely blocks npm shims; if a `.ps1` shim is blocked:

  ```powershell
  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
  ```

- Paths with spaces are fine; always quote objectives:

  ```powershell
  forge-harness run "Fix the failing tests" --mode local-preferred
  ```

### macOS

- Apple Silicon and Intel are both fine (Node + Ollama provide native builds).
- If `pnpm link --global` puts binaries in a directory not on `PATH`, follow the path hint pnpm prints (often `~/Library/pnpm` or `/usr/local/bin`).
- Grant Terminal/iTerm Full Disk Access only if you need Forge to touch protected folders; normally project directories are enough.

### Linux

- Ensure `build-essential` / compiler toolchain is **not** required for Forge itself (pure JS + Node built-ins).
- If using nvm/fnm, run `pnpm link --global` in the same shell where `node` is active, and open a new terminal after changing Node versions.
- Headless servers: Ollama and Docker are optional; use `--mode local-only` only when Ollama is reachable.

---

## 4. First-time setup in your project

```bash
cd /path/to/your-project

# 1) Create forge.config.json + .env.example
forge-harness init

# 2) Copy env and set your model (never commit .env)
cp .env.example .env
```

Edit `.env`:

```bash
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2

# Optional cloud escalation
# OPENROUTER_API_KEY=sk-or-...
# OPENROUTER_MODEL=openai/gpt-4o-mini
# OPENROUTER_MAX_COST_USD=1.0

FORGE_MODE=local-preferred
```

Windows PowerShell copy:

```powershell
Copy-Item .env.example .env
notepad .env
```

Health check:

```bash
forge-harness doctor
forge-harness models
```

`doctor` should report Node ≥22, Git, config, database, and (if running) Ollama.

---

## 5. Everyday usage

### Run a task

```bash
forge-harness run "Fix the failing signup tests" --mode local-preferred
```

Useful flags:

| Flag | Purpose |
|------|---------|
| `--mode local-only` | Never use cloud |
| `--mode local-preferred` | Local first; escalate after repair budget if cloud configured |
| `--mode cloud-allowed` | May choose cloud per policy |
| `--local-model <name>` | Override Ollama model |
| `--cloud-model <name>` | Override OpenRouter model |
| `--max-turns <n>` | Cap agent turns |
| `--max-repairs <n>` | Cap repair loops |
| `--timeout <minutes>` | Wall-clock timeout |
| `--workspace <path>` | Project root (default: cwd) |

### Inspect results

```bash
forge-harness status <task-id>
forge-harness inspect <task-id>
```

### Approvals (when `approvals.mode` is `queue` or `prompt`)

```bash
forge-harness approvals
forge-harness approve <approval-id>
forge-harness deny <approval-id>
```

### Operator dashboard (same SQLite backend as CLI)

```bash
forge-harness dashboard start --port 8787
# open http://127.0.0.1:8787
```

### Knowledge graph / architecture / skills (examples)

```bash
forge-harness kg build
forge-harness kg deps src/a.ts src/b.ts
forge-harness skills list
forge-harness skills match "add authentication"
```

### Background daemon & jobs

```bash
forge-harness daemon start
forge-harness daemon status
forge-harness jobs catalog
forge-harness jobs run todo_analysis
```

### Goal mode

```bash
forge-harness goal "Ship a minimal invite-by-email feature"
forge-harness goal list
forge-harness goal status
```

Full command table: see the [README](../README.md#cli).

---

## 6. Routing modes (privacy)

| Mode | Behavior |
|------|----------|
| `local-only` | Ollama only. **Never** OpenRouter. |
| `local-preferred` | Ollama first; cloud only after repair budget if configured |
| `cloud-allowed` | May select cloud when policy says so |

Set via `.env` (`FORGE_MODE`), `forge.config.json` (`mode`), or `--mode`.

---

## 7. Updating

```bash
cd Forge   # your clone
git pull
pnpm install
pnpm build
npm install -g . --force
```

Or reinstall from GitHub:

```bash
npm install -g github:LightLLM/Forge --force
```

## 8. Uninstall

```bash
npm uninstall -g forge-harness
```

---

## 9. Troubleshooting

| Symptom | Fix |
|---------|-----|
| `forge` runs Atlassian/Foundry instead | Use `forge-harness`, or `pnpm forge` inside the clone |
| `Need Node >= 22` | Upgrade Node; restart the terminal |
| `Ollama unavailable` | Start Ollama app/service; set `OLLAMA_BASE_URL` / `OLLAMA_MODEL` |
| `No local model configured` | Set `OLLAMA_MODEL` in `.env` or `forge.config.json` |
| Global command not found | Put npm/pnpm global bin on `PATH` (see Windows notes) |
| `prepare` / build fails on git install | Install build tools: `npm install -g typescript` then retry, or use Method A |
| SQLite experimental warning | Harmless on Node 22; Forge uses `node:sqlite` by design |
| Docker sandbox fails | Set `"commands": { "sandbox": "host" }` or install Docker Desktop |

Run diagnostics anytime:

```bash
forge-harness doctor
```

---

## 10. Security reminders

- Repository content is **untrusted DATA** — it cannot raise permissions.
- Do not commit `.env` or API keys.
- Prefer `local-only` for private codebases until you explicitly allow cloud.
- Model self-reports are never treated as success; Forge’s verification engine decides.

---

## Related docs

- [README](../README.md) — overview & CLI table  
- [Architecture](architecture.md)  
- [Security](security.md)  
- [Model routing](model-routing.md)  
- [Milestones](MILESTONES.md)  
