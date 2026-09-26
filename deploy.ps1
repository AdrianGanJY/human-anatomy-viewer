# Build + deploy anatomy.adrian.my — ONE Worker, ONE command (L34, 2026-09-26).
#
# Usage: pwsh -File ./deploy.ps1            deploy the merged Worker `human-anatomy`
#        pwsh -File ./deploy.ps1 -AllowDirty   ...from a dirty tree (the build id gets a change-digest segment)
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
# derives the id from git (short hash, plus a digest of the uncommitted change when the tree is dirty) into `worker/build-id.mjs`, which is bundled
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
  # A dirty tree produces a change-digest build id, so it can never collide with a committed build's cached
  # pictures -- but a deployment nobody can point at a commit is not a deployment anyone can audit, so
  # it takes an explicit -AllowDirty.
  $dirty = (git status --porcelain) | Where-Object { $_ }
  if ($dirty -and -not $AllowDirty) {
    throw ("the tree is dirty (" + $dirty.Count + " path(s)). Commit first, or pass -AllowDirty to " +
           "ship a change-digest build id that no commit names.")
  }

  node scripts/build-id.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-id failed' }
  if (-not (Test-Path 'worker/build-id.mjs')) { throw 'worker/build-id.mjs missing - the renderer cache key and About would both read `dev`' }
  $buildId = (Select-String -Path 'worker/build-id.mjs' -Pattern 'SITE_BUILD\s*=\s*"([^"]+)"').Matches[0].Groups[1].Value
  # codex round 2, HIGH 2: `dev` is what the generator answers when there is no git at all, and what a
  # swallowed git failure used to answer. Two different trees can share it, so it is never deployable -
  # with or without -AllowDirty.
  if ($buildId -eq 'dev') {
    throw ("the build id is 'dev' - no commit and no change-digest name this artefact, so two different " +
           "trees would share one render cache identity. Deploy from a git checkout.")
  }
  if (-not $AllowDirty -and $buildId -notmatch '^[0-9a-f]{7,40}$') {
    throw "the build id is '$buildId' - a clean deploy must be named by a commit"
  }
  if ($AllowDirty -and $dirty) {
    # codex round 1 + 2, HIGH 2: a dirty id carries a DIGEST of the uncommitted change (tracked diff
    # AND untracked file contents), so two different dirty states are two different ids.
    # ⚠️ THE WARNING NAMES THE RESIDUAL THAT IS STILL OPEN - stand-in round 3, MEDIUM. It used to warn
    # about untracked-file contents, which codex round 2's fix CLOSED (git hash-object is in the digest),
    # so the operator was being warned about a shut hole and not about the live one.
    Write-Host "-AllowDirty: shipping build id $buildId, derived from $($dirty.Count) uncommitted path(s)." -ForegroundColor Yellow
    Write-Host 'No commit names this artefact. The digest covers tracked changes AND untracked file' -ForegroundColor Yellow
    Write-Host 'contents, but NOT gitignored build inputs (public/i18n/, public/api/) - which the three' -ForegroundColor Yellow
    Write-Host 'generators above regenerate deterministically from committed sources on every run.' -ForegroundColor Yellow
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
  # ⚠️ THE ARTEFACT MUST CARRY THE ID THE WORKER WILL CLAIM - codex round 2, MEDIUM 3. `npm run build`
  # and `build:vercel` both generate the id now, but wrangler has no build hook, so a hand-run
  # `npx wrangler deploy` can bundle a Worker whose SITE_BUILD is newer than the `dist/` beside it. The
  # renderer's page-build guard would then refuse every render (loudly, which is the right failure) -
  # but catching it HERE costs one grep and turns a broken deployment into a refused one.
  $inBundle = Select-String -Path 'dist/assets/*.js' -SimpleMatch $buildId -List -ErrorAction SilentlyContinue
  if (-not $inBundle) {
    throw ("no file in dist/assets names the build id $buildId - the built site and this Worker would " +
           "disagree about which build they are, and every render would be refused. Re-run the build.")
  }

  npx wrangler deploy -c worker/wrangler.toml
  if ($LASTEXITCODE -ne 0) { throw 'wrangler deploy failed' }

  Write-Host ''
  Write-Host "Deployed human-anatomy, build $buildId." -ForegroundColor Green
  Write-Host '  who answered:  https://anatomy.adrian.my/api/timing   (worker + build fields)' -ForegroundColor Green
  Write-Host '  the app:       https://anatomy.adrian.my/?select=FMA22315,FMA22314,FMA18060&isolate=1&view=back' -ForegroundColor Green
  Write-Host ''
  # ⚠️ THE ROLLBACK INSTRUCTION NAMES THE COMMIT STEP — codex round 1, MEDIUM 5. The first version
  # said "comment out the route and run this script again", which THROWS: editing the tracked TOML
  # dirties the tree and the guard above refuses it. Both honest routes are printed.
  Write-Host 'ROLLBACK (the route is the only thing that moves; Pages is still deployed underneath):' -ForegroundColor Yellow
  Write-Host '  1. comment out the [[routes]] block in worker/wrangler.toml' -ForegroundColor Yellow
  Write-Host '  2. git commit -F <msg> -- worker/wrangler.toml     (the clean-tree guard requires it)' -ForegroundColor Yellow
  Write-Host '  3. pwsh -File ./deploy.ps1                        (or, to skip step 2: -AllowDirty)' -ForegroundColor Yellow
} finally {
  $env:CLOUDFLARE_API_TOKEN = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $null
}
