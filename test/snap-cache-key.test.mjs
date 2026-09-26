/**
 * THE CACHE KEY AND THE BUILD ID — L34.
 *
 * L34 deletes `deploy.ps1`'s render-path tripwire. That guard existed because `SITE_BUILD` was a
 * HAND-EDITED literal in `workers/snap/wrangler.toml`: a render-path edit that forgot to bump it
 * served the previous build's pictures for the new build, at HTTP 200, invisibly. The guard is only
 * safe to delete if the id can no longer be forgotten — so the id is now DERIVED (git short hash +
 * a dirty flag, written into `worker/build-id.mjs` by `scripts/build-id.mjs` before every build) and
 * the key computation is a pure function these rows can execute.
 *
 * WHAT MUST BE TRUE for the deletion to be honest:
 *   1. two DIFFERENT build ids over the same view produce two DIFFERENT keys (so a new build can
 *      never be served the old build's picture), and
 *   2. the SAME build id over the same view produces the SAME key (so the cache still works at all
 *      — a key that changed per request would spend metered browser minutes on every render).
 *
 * Both were previously true only by inspection of one template literal inside a module that imports
 * `@cloudflare/puppeteer` at module scope and therefore cannot be loaded by `node --test` at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { canonical, snapCacheKey } from '../worker/snap/helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = { width: 960, height: 720 };
const VIEW = new URLSearchParams('select=FMA22315,FMA22314&view=back&size=960x720');

test('two different build ids give two different cache keys for the SAME view', async () => {
  const a = await snapCacheKey('aaaaaaa', SIZE, canonical(VIEW));
  const b = await snapCacheKey('bbbbbbb', SIZE, canonical(VIEW));
  assert.notEqual(a, b, 'a new build would be served the previous build\'s cached picture');
  assert.match(a, /^[0-9a-f]{64}\.png$/);
  assert.match(b, /^[0-9a-f]{64}\.png$/);
});

test('the SAME build id gives the SAME key — the cache still works', async () => {
  const a = await snapCacheKey('aaaaaaa', SIZE, canonical(VIEW));
  const b = await snapCacheKey('aaaaaaa', SIZE, canonical(new URLSearchParams('view=back&select=FMA22315,FMA22314&size=960x720')));
  assert.equal(a, b, 'the same view under one build must be one R2 entry, or every render is cold');
});

test('the dirty flag is part of the id, so an uncommitted render-path edit cannot reuse a clean key', async () => {
  const clean = await snapCacheKey('36ccda0', SIZE, canonical(VIEW));
  const dirty = await snapCacheKey('36ccda0-0123456789', SIZE, canonical(VIEW));
  assert.notEqual(clean, dirty);
});

/**
 * ⚠️ codex ROUND 1, HIGH 2 — DIRTY vs A *DIFFERENT* DIRTY, which is the case the first version of this
 * file did not cover. With a boolean `-dirty` suffix, editing a render file at commit C, deploying
 * with -AllowDirty, editing it AGAIN and deploying again produced the SAME id both times — so the
 * second deployment was served the first one's picture, which is exactly the failure the derived id
 * exists to make impossible. The id's dirty segment is now a digest of the uncommitted change itself.
 */
test('two DIFFERENT dirty states of the same commit are two different ids and two different keys', async () => {
  const a = await snapCacheKey('36ccda0-aaaaaaaaaa', SIZE, canonical(VIEW));
  const b = await snapCacheKey('36ccda0-bbbbbbbbbb', SIZE, canonical(VIEW));
  assert.notEqual(a, b);
});

test('the generator really derives the dirty segment from the change, not from a boolean', () => {
  const src = readFileSync(join(ROOT, 'scripts', 'build-id.mjs'), 'utf8');
  assert.match(src, /createHash\(/, 'the dirty suffix must be a digest of the change');
  assert.match(src, /'diff',\s*'HEAD'/, 'the digest must cover the tracked diff, not only the status');
  assert.ok(!/`\$\{hash\}-dirty`/.test(src),
    'a literal `-dirty` suffix cannot distinguish two different dirty trees (codex round 1, HIGH 2)');
});

/**
 * ⚠️ codex ROUND 1, HIGH 1 — A REUSED TAB FROM ANOTHER BUILD. The renderer re-drives a warm tab
 * through `location.hash`, which applies with no reload, so a tab loaded before a deploy still runs
 * the PREVIOUS bundle while its pixels are stored under the NEW build's key. codex executed it with
 * mocked bindings: 200, tab=reused, zero navigations, build A's pixels under build B's key.
 *
 * `render.mjs` imports puppeteer at module scope and cannot be loaded by `node --test`, so these rows
 * assert the guard's PRESENCE and its two halves in the source. The behavioural proof is the live
 * `X-Snap-Build` / `X-Snap-Tab-Rejected` headers recorded in the L34 worklog.
 */
test('the renderer refuses a warm tab whose build is not its own, and an absent build counts as foreign', () => {
  const src = readFileSync(join(ROOT, 'worker', 'snap', 'render.mjs'), 'utf8');
  assert.match(src, /dataset\.atlasBuild/, 'the renderer never reads the page\'s build');
  assert.match(src, /if \(build !== SITE_BUILD\)/, 'acquire() does not compare a reused tab\'s build');
  assert.match(src, /if \(drawnBuild !== SITE_BUILD\)/,
    'a FRESH navigation is unchecked — a rollout or a rollback can serve another bundle');
  // The mismatch must be a 4xx that RETURNS, which is what skips the R2 put.
  const at = src.indexOf('if (drawnBuild !== SITE_BUILD)');
  assert.match(src.slice(at, at + 400), /return fail\(424/,
    'a build mismatch must return before the R2 put, or the foreign picture is cached anyway');
});

test('the page states its build, from the same constant About prints', () => {
  const src = readFileSync(join(ROOT, 'app', 'url-state.ts'), 'utf8');
  assert.match(src, /dataset\.atlasBuild=b/, 'app/url-state.ts does not publish the build');
  assert.match(src, /export function markReady\(\)\{markBuild\(\)/, '/ (v1, the render entry) never marks it');
  assert.match(src, /if\(on\)\{markBuild\(\);/, '/v2/ never marks it');
});

test('the size is part of the key — two sizes of one view are two pictures', async () => {
  const a = await snapCacheKey('36ccda0', { width: 960, height: 720 }, canonical(VIEW));
  const b = await snapCacheKey('36ccda0', { width: 1200, height: 900 }, canonical(VIEW));
  assert.notEqual(a, b);
});

/**
 * THE GENERATED FILE IS THE ONE THE RENDERER READS. A build id that is derived but not WIRED IN is
 * the same defect as a hand-edited one: `worker/snap/render.mjs` must take its id from
 * `worker/build-id.mjs`, not from an env var a config file could forget to set.
 */
test('the renderer reads the build id from the generated module, not from env', () => {
  const src = readFileSync(join(ROOT, 'worker', 'snap', 'render.mjs'), 'utf8');
  assert.match(src, /from '\.\.\/build-id\.mjs'/, 'render.mjs does not import the generated build id');
  assert.match(src, /snapCacheKey\(/, 'render.mjs does not use the tested key function');
  assert.ok(!/env\.SITE_BUILD/.test(src),
    'render.mjs still falls back to env.SITE_BUILD — a config var can be forgotten, which is the '
    + 'exact failure the tripwire existed to catch');
});

/**
 * THE GENERATOR IS RUN, NOT ASSUMED. `worker/build-id.mjs` is deliberately NOT tracked — the id is
 * the git hash of the tree, so its correct contents for a commit cannot exist before that commit
 * does, and tracking it would dirty the tree on every build (see .gitignore). So this row executes
 * `scripts/build-id.mjs` and then reads what it wrote: a fresh clone passes, and the generator itself
 * is under test rather than its output happening to be lying around.
 */
test('scripts/build-id.mjs writes a plausible derived id into worker/build-id.mjs', async () => {
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-id.mjs')], { cwd: ROOT, stdio: 'ignore' });
  const url = `file://${join(ROOT, 'worker', 'build-id.mjs').replace(/\\/g, '/')}?t=${Date.now()}`;
  const { SITE_BUILD } = await import(url);
  // `<hash>` when clean, `<hash>-<10 hex>` when dirty (the digest of the uncommitted change), `dev`
  // with no git at all.
  assert.match(SITE_BUILD, /^[0-9a-f]{7,40}(-[0-9a-f]{10})?$|^dev$/);
  // And it is idempotent: a second run must not change what the first one wrote (the renderer's cache
  // key would otherwise move for no reason between two builds of the same tree).
  const before = readFileSync(join(ROOT, 'worker', 'build-id.mjs'), 'utf8');
  execFileSync(process.execPath, [join(ROOT, 'scripts', 'build-id.mjs')], { cwd: ROOT, stdio: 'ignore' });
  assert.equal(readFileSync(join(ROOT, 'worker', 'build-id.mjs'), 'utf8'), before);
});
