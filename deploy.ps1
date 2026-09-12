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
  # L30 P4 -- THE STALE-CACHE GUARD.
  #
  # The renderer keys every cached PNG on sha256(SITE_BUILD | size | canonical params), and
  # SITE_BUILD is a static literal in workers/snap/wrangler.toml. The comment beside it used
  # to claim it was "set at deploy time"; it never was, because THIS script does not deploy
  # the Worker at all. So it sat at "p2" while the site shipped P3 and then P3r, and every
  # cache hit served a pre-P3 picture for a post-P3r view, at HTTP 200, for 24 hours.
  #
  # Nothing about that failure is visible: the picture is plausible, just old. This is the
  # tripwire. If any file that changes what a plate LOOKS like is newer than the last commit
  # that touched SITE_BUILD, the deploy stops.
  $renderPaths = @(
    'app/scene.tsx', 'app/page.tsx', 'app/globals.css', 'app/url-state.ts',
    'app/scene-codec.js', 'app/anatomy.ts',
    'workers/snap/src/index.mjs', 'workers/snap/src/helpers.mjs'
  )
  $lastRender = (git log -1 --format=%ct -- $renderPaths) 2>$null
  $lastBuildId = (git log -1 --format=%ct -- 'workers/snap/wrangler.toml') 2>$null
  if ($lastRender -and $lastBuildId -and ([int]$lastRender -gt [int]$lastBuildId)) {
    throw ("the render path changed after SITE_BUILD was last bumped. Bump SITE_BUILD in " +
           "workers/snap/wrangler.toml and redeploy the Worker (cd workers/snap; npx wrangler deploy), " +
           "or every cached PNG will be served for the new build at HTTP 200.")
  }

  node scripts/build-zh.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-zh failed' }

  # 1b. L31 v2.1b+c S4 -- scripts/build-pinyin.mjs writes public/i18n/pinyin.json from the zh-Hans
  #     dictionary step 1 has just produced. AFTER build-zh (it reads that file) and BEFORE
  #     build-index (the ordering the increment specifies), offline and deterministic: its only
  #     inputs are that JSON and a version-pinned devDependency, and it exits non-zero on an empty
  #     or half-converted map rather than shipping a toggle that does nothing.
  node scripts/build-pinyin.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-pinyin failed' }

  node scripts/build-index.mjs
  if ($LASTEXITCODE -ne 0) { throw 'build-index failed' }

  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'vite build failed' }

  if (-not (Test-Path 'dist/api/index.json'))     { throw 'dist/api/index.json missing - the /mcp tools would all fail' }
  if (-not (Test-Path 'dist/_routes.json'))       { throw 'dist/_routes.json missing - the SPA would swallow /mcp' }
  if (-not (Test-Path 'dist/i18n/zh-Hans.json'))  { throw 'dist/i18n/zh-Hans.json missing - the language switch would 404' }
  if (-not (Test-Path 'dist/i18n/zh-Hant.json'))  { throw 'dist/i18n/zh-Hant.json missing - the language switch would 404' }
  # S4: the pinyin toggle fetches this. A 404 here is answered by Pages with the SPA shell at HTTP
  # 200 (the trap app/i18n/dict.ts documents), so the loader's content-type guard rejects it and the
  # toggle silently shows nothing. Asserted in the deploy rather than discovered by a reader.
  if (-not (Test-Path 'dist/i18n/pinyin.json'))   { throw 'dist/i18n/pinyin.json missing - the pinyin toggle would silently show nothing' }

  npx wrangler pages deploy --project-name human-anatomy-viewer --branch main --commit-dirty=true
  if ($LASTEXITCODE -ne 0) { throw 'wrangler pages deploy failed' }

  Write-Host ''
  Write-Host 'Deployed. Verify on the real host (behind CF Access):' -ForegroundColor Green
  Write-Host '  https://anatomy.adrian.my/?select=FMA22315,FMA22314,FMA18060&isolate=1&view=back' -ForegroundColor Green
  Write-Host ''
  Write-Host 'THIS SCRIPT DOES NOT DEPLOY THE RENDERER. If SITE_BUILD or workers/snap changed:' -ForegroundColor Yellow
  Write-Host '  cd workers/snap; npx wrangler deploy' -ForegroundColor Yellow
} finally {
  $env:CLOUDFLARE_API_TOKEN = $null
  $env:CLOUDFLARE_ACCOUNT_ID = $null
}
