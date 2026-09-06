# Build + deploy anatomy.adrian.my (Cloudflare Pages project `adrian-anatomy`, Adrey account).
# Usage: pwsh -File ./deploy.ps1
#
# Why the env file and not the wrangler OAuth session: since 2026-09-06 the OAuth session on this
# box is gone, and wrangler then dies with a native crash (exit -1073740791) and NO error text --
# the real message ("non-interactive environment... set CLOUDFLARE_API_TOKEN") never prints.
# So the token is loaded explicitly here and nulled again on the way out.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envFile = 'E:\Agentic\ws\infra\.env.adrey'
if (-not (Test-Path $envFile)) { throw "missing $envFile (Adrey CF credentials)" }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^(\w+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }

  npx wrangler pages deploy dist --project-name adrian-anatomy --branch main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw 'wrangler pages deploy failed' }

  Write-Host ''
  Write-Host 'Deployed. Verify on the real host (behind the *.adrian.my CF Access gate):' -ForegroundColor Green
  Write-Host '  https://anatomy.adrian.my/?select=FMA22315&isolate=1&view=front' -ForegroundColor Green
} finally {
  $env:CLOUDFLARE_API_TOKEN = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $null
}
