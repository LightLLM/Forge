# Install Forge globally from this clone (Windows PowerShell).
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js is required (v22+). Install from https://nodejs.org or: winget install OpenJS.NodeJS.LTS"
}

$major = [int]((node -p "process.versions.node.split('.')[0]").Trim())
if ($major -lt 22) {
  Write-Error "Node.js 22+ required (found $(node -v))"
}

if (Get-Command pnpm -ErrorAction SilentlyContinue) {
  pnpm install
  pnpm build
} else {
  npm install
  npm run build
}

# Prefer npm for global bin shims. --force overwrites a conflicting `forge` (Atlassian / Foundry).
Write-Host "Installing global commands forge-harness and forge..."
npm install -g $Root --force

Write-Host ""
Write-Host "Installed. Try:"
Write-Host "  forge-harness --version"
Write-Host "  forge-harness doctor"
Write-Host ""
Write-Host "Prefer forge-harness if another tool also named forge is on your PATH."
Write-Host "If commands are missing, add your npm global bin to PATH (often %AppData%\npm)."
