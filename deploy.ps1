# Build + deploy anatomy.adrian.my — ONE Worker, ONE command (L34, 2026-09-26).
#
# Usage: pwsh -File ./deploy.ps1            deploy the merged Worker `human-anatomy`
#        pwsh -File ./deploy.ps1 -AllowDirty   ...from a dirty tree (the build id gets `-dirty`)
#
# ══ WHAT THIS REPLACES ══════════════════════════════════════════════════════════════════════════
#
# Before L34 this script deployed ONE of the project's two halves (`wrangler pages deploy`) and told
# you, in yellow, to go and deploy the other one by hand. Between them sat a tripwire: `SITE_BUILD`
# was a hand-edited literal in `workers/snap/wrangler.toml`, it is part of the renderer's R2 cache
# key, and forgetting to move it served the previous build's pictures for the new build at HTTP 200.
# The guard compared file mtimes against a `renderPaths` list and refused the deploy; it cost three
# separate "own commit" SITE_BUILD bumps in L31, each one an argued essay about whether a plate could
# have moved.
#
# THE TRIPWIRE IS DELETED, AND THE THING IT GUARDED CANNOT HAPPEN ANY MORE. `scripts/build-id.mjs`
# derives the id from git (short hash + a `-dirty` flag) into `worker/build-id.mjs`, which is bundled
# into the SAME artefact as the site and read by the renderer's cache key. A different commit is a
# different id, always, with nobody remembering anything. The two properties that makes load-bearing
# — different id => different key, same id => same key — are executed by
# `test/snap-cache-key.test.mjs` (written red-first against the missing function).
#
# ⚠️ THE COST, STATED: every deploy now retires every cached plate, so the first render of each view
# after a deploy is COLD (~60 s on this account). The old literal could deliberately sit still across
# a commit that provably changed no picture. That trade is taken deliberately: the old direction failed
# SILENTLY with a plausible wrong picture, this one fails slowly and visibly, and
# `scripts/plate-goldens.mjs compare` still proves the picture itself did not change.
#
# Why the env file and not the wrangler OAuth session: since 2026-09-06 the OAuth session on this box
# is gone, and wrangler then dies with a native crash (exit -1073740791) and NO error text — the real
# message ("non-interactive environment... set CLOUDFLARE_API_TOKEN") never prints. So the token is
# loaded explicitly here and nulled again on the way out.
#
# Order matters:
#   1. scripts/build-id.mjs      -> worker/build-id.mjs (the cache-key salt AND what About prints;
#                                   vite reads it through `define`, so it must exist before the build)
#   2. scripts/build-zh.mjs      -> public/i18n/*.json  (the Chinese dictionaries the app lazy-loads;
#                                   offline and deterministic, reads scripts/zh-llm-cache.json)
#   3. scripts/build-pinyin.mjs  -> public/i18n/pinyin.json (reads the zh-Hans dictionary from step 2)
#   4. scripts/build-index.mjs   -> public/api/index.json (the /mcp tools' only data source; reads the
#                                   dictionaries from step 2, so it must run after them or /mcp ships
#                                   with no Chinese names while the page has them)
#   5. vite build                 copies public/ -> dist/ , so the index, the dictionaries, `_headers`
#                                   and `_routes.json` land in the artefact
#   6. wrangler deploy -c worker/wrangler.toml   the WHOLE thing: site assets + router + /mcp +
#                                   /api/snap + the in-process renderer, in one deployment
#
# ⚠️ NEVER `wrangler pages deploy` in this task. The Pages project `human-anatomy-viewer` is the
# ROLLBACK and must stay exactly as it was last deployed; `../wrangler.toml` is left working for it.
param([switch]$AllowDirty)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

$envFile = 'E:\Agentic\ws\infra\.env.adrey'
if (-not (Test-Path $envFile)) { throw "missing $envFile (Adrey CF credentials)" }
foreach ($line in Get-Content $envFile) {
  if ($line -match '^(\w+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process') }
}

try {
  # THE TREE-CLEAN GUARD, which is what the deleted tripwire's honesty budget is spent on instead.
  # A dirty tree produces a `-dirty` build id, so it can never collide with a committed build's cached
  # pictures -- but a deployment nobody can point at a commit is not a deployment anyone can audit, so
  # it takes an explicit -AllowDirty.
  $dirty = (git status --porcelain) | Where-Object { $_ }
  if ($dirty -and -not $AllowDirty) {
    throw ("the tree is dirty (" + $dirty.Count + " path(s)). Commit first, or pass -AllowDirty to " +
           "ship a `-dirty` build id that no commit names.")
  }

  node scripts/build-id.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-id failed' }
  if (-not (Test-Path 'worker/build-id.mjs')) { throw 'worker/build-id.mjs missing - the renderer cache key and About would both read `dev`' }
  $buildId = (Select-String -Path 'worker/build-id.mjs' -Pattern 'SITE_BUILD\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
  if (-not $AllowDirty -and $buildId -notmatch '^[0-9a-f]{7,40}$') {
    throw "the build id is '$buildId' - a clean deploy must be named by a commit"
  }

  node scripts/build-zh.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-zh failed' }
  node scripts/build-pinyin.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-pinyin failed' }
  node scripts/build-index.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-index failed' }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }

  if (-not (Test-Path 'dist/api/index.json'))     { throw 'dist/api/index.json missing - the /mcp tools would all fail' }
  if (-not (Test-Path 'dist/i18n/zh-Hans.json'))  { throw 'dist/i18n/zh-Hans.json missing - the language switch would 404' }
  if (-not (Test-Path 'dist/i18n/zh-Hant.json'))  { throw 'dist/i18n/zh-Hant.json missing - the language switch would 404' }
  # S4: the pinyin toggle fetches this. A 404 here used to be answered by Pages with the SPA shell at
  # HTTP 200 (the trap app/i18n/dict.ts documents); the merged Worker 404s honestly, which the
  # loader's content-type guard also rejects. Asserted in the deploy either way.
  if (-not (Test-Path 'dist/i18n/pinyin.json'))   { throw 'dist/i18n/pinyin.json missing - the pinyin toggle would silently show nothing' }
  # ⚠️ THE DOCUMENT'S SECURITY HEADERS COME FROM THIS FILE, not from code: with
  # `run_worker_first = ["/mcp","/api/*"]` a document request never reaches the router, so `_headers`
  # in the artefact is the only thing that puts the CSP on the page. A build that dropped it would
  # deploy green and serve an unprotected origin.
  if (-not (Test-Path 'dist/_headers'))           { throw 'dist/_headers missing - the CSP, nosniff and Referrer-Policy would all be absent from the document' }

  npx wrangler deploy -c worker/wrangler.toml
  if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }

  Write-Host ''
  Write-Host "Deployed human-anatomy, build $buildId." -ForegroundColor Green
  Write-Host '  who answered:  https://anatomy.adrian.my/api/timing   (worker + build fields)' -ForegroundColor Green
  Write-Host '  the app:       https://anatomy.adrian.my/?select=FMA22315,FMA22314,FMA18060&isolate=1&view=back' -ForegroundColor Green
  Write-Host ''
  Write-Host 'ROLLBACK: comment out the [[routes]] block in worker/wrangler.toml and run this script' -ForegroundColor Yellow
  Write-Host 'again. The Pages project human-anatomy-viewer is still deployed underneath, untouched.' -ForegroundColor Yellow
} finally {
  $env:CLOUDFLARE_API_TOKEN = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $null
}
