$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
if (!(Test-Path -LiteralPath 'dist/index.html')) { throw 'Run pnpm build first.' }
$releaseStamp = [DateTime]::UtcNow.ToString('yyyyMMdd-HHmmssfff') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$releaseStage = Join-Path $projectRoot ('.cache/release-stage/v0.1.0-preview-' + $releaseStamp)
$releaseFolder = Join-Path $projectRoot '.cache/releases'
New-Item -ItemType Directory -Path $releaseStage,$releaseFolder,(Join-Path $releaseStage 'scripts') -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $projectRoot 'dist') -Destination $releaseStage -Recurse -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/serve-build.mjs') -Destination (Join-Path $releaseStage 'scripts/serve-build.mjs') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/THIRD_PARTY.md') -Destination $releaseStage -Force
$releaseInstructions = @'
AniMirror v0.1.0-preview

Requires Node.js 22.13+ or 24. No npm dependencies required to run this build.
Extract the complete archive, open a terminal in the extracted folder, and run:

node scripts/serve-build.mjs

Open http://127.0.0.1:4173 in Chrome / Edge. Stop with Ctrl+C.
All tracking JS / WASM / model resources are already bundled locally.
Import your licensed, self-contained humanoid .vrm file to get started.
For code and instructions, use https://github.com/epiconfuison/AniMirror#readme.

This is an engineering preview. Real webcam gesture / anime model visual /
30-minute stability acceptance remains open.
Third-party notices: dist/THIRD_PARTY_LICENSES.txt and THIRD_PARTY.md.
'@
Set-Content -LiteralPath (Join-Path $releaseStage 'START-HERE.txt') -Value $releaseInstructions -Encoding utf8
$releaseArchive = Join-Path $releaseFolder 'AR-Capture-v0.1.0-preview.zip'
Compress-Archive -Path (Join-Path $releaseStage '*') -DestinationPath $releaseArchive -Force
Get-Item -LiteralPath $releaseArchive | Select-Object FullName,Length
