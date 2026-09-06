# Build + deploy anatomy.adrian.my (Cloudflare Pages project `human-anatomy-viewer`, Adrey account).
# Usage: pwsh -File ./deploy.ps1
#
# Why the env file and not the wrangler OAuth session: since 2026-09-06 the OAuth session on this
# box is gone, and wrangler then dies with a native crash (exit -1073740791) and NO error text --
# the real message ("non-interactive environment... set CLOUDFLARE_API_TOKEN") never prints.
# So the token is loaded explicitly here and nulled again on the way out.
#
# Order matters:
#   1. scripts/build-zh.mjs writes public/i18n/*.json (the Chinese dictionaries the app lazy-loads)
#      -- offline and deterministic; it reads scripts/zh-llm-cache.json and never calls a model
#   2. scripts/build-index.mjs writes public/api/index.json (the /mcp Function's only data source)
#      -- it READS the dictionaries from step 1, so it must run after them or /mcp ships with no
#      Chinese names while the page has them
#   3. vite build copies public/ -> dist/ , so the index, the dictionaries and public/_routes.json
#      land in the deploy
#   4. wrangler pages deploy is run WITHOUT a directory argument: wrangler.toml sets
#      pages_build_output_dir, and passing the directory as well is what produces a stale
#      Functions bundle (.claude/rules/infra/deploy-rules.md).
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envFile = 'E:\Agentic\ws\infra\.env.adrey'
if (-not (Test-Path $envFile)) { throw "missing $envFile (Adrey CF credentials)" }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^(\w+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

try {
  node scripts/build-zh.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-zh failed' }

  node scripts/build-index.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-index failed' }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }

  if (-not (Test-Path 'dist/api/index.json'))     { throw 'dist/api/index.json missing - the /mcp tools would all fail' }
  if (-not (Test-Path 'dist/_routes.json'))       { throw 'dist/_routes.json missing - the SPA would swallow /mcp' }
  if (-not (Test-Path 'dist/i18n/zh-Hans.json'))  { throw 'dist/i18n/zh-Hans.json missing - the language switch would 404' }
  if (-not (Test-Path 'dist/i18n/zh-Hant.json'))  { throw 'dist/i18n/zh-Hant.json missing - the language switch would 404' }

  npx wrangler pages deploy --project-name human-anatomy-viewer --branch main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw 'wrangler pages deploy failed' }

  Write-Host ''
  Write-Host 'Deployed. Verify on the real host (behind CF Access):' -ForegroundColor Green
  Write-Host '  https://anatomy.adrian.my/?select=FMA22315,FMA22314,FMA18060&isolate=1&view=back' -ForegroundColor Green
} finally {
  $env:CLOUDFLARE_API_TOKEN = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $null
}
