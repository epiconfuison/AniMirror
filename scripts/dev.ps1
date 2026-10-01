param([switch]$Preview)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (!(Test-Path -LiteralPath $nodePath)) { throw 'Install Node.js 22.12+ or 24, then reopen PowerShell.' }
if (!(Test-Path -LiteralPath 'node_modules/vite/bin/vite.js')) { throw 'Dependencies missing. Run pnpm install --frozen-lockfile first.' }
if (!(Test-Path -LiteralPath 'public/tracking-assets/manifest.json')) { throw 'Tracking assets missing. Run pnpm assets:setup first.' }
if ($Preview) {
  if (!(Test-Path -LiteralPath 'dist/index.html')) { throw 'Build missing. Run pnpm build first.' }
  & $nodePath node_modules/vite/bin/vite.js preview --host 127.0.0.1 --port 4173 --strictPort
} else {
  & $nodePath node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort
}
exit $LASTEXITCODE
