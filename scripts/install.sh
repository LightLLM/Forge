#!/usr/bin/env bash
# Install Forge globally from this clone (macOS / Linux).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (v22+). Install from https://nodejs.org"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22+ required (found $(node -v))"
  exit 1
fi

if command -v pnpm >/dev/null 2>&1; then
  pnpm install
  pnpm build
else
  npm install
  npm run build
fi

# Prefer npm for global bin shims (works with pnpm-managed tree via install from cwd).
# --force overwrites a conflicting `forge` binary (Atlassian / Foundry).
echo "Installing global commands forge-harness and forge..."
npm install -g "$ROOT" --force

echo ""
echo "Installed. Try:"
echo "  forge-harness --version"
echo "  forge-harness doctor"
echo ""
echo "Prefer forge-harness if another tool also named forge is on your PATH."
