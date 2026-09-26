/**
 * THE MERGED WORKER'S CONFIG, ASSERTED — L34.
 *
 * Three things in `worker/wrangler.toml` are security or correctness facts that a reader is otherwise
 * expected to notice, and each one has a measured incident behind it:
 *
 *   1. `workers_dev = false`. L30 P1 measured `adrian-anatomy.pages.dev` serving the whole app to
 *      anyone at HTTP 200 — the `*.adrian.my` Access wildcard does not cover a second hostname. Under
 *      Pages a 301 in `functions/_middleware.js` closed it. Under Workers ASSETS it cannot: with
 *      `run_worker_first` scoped to `/mcp` and `/api/*`, a document request never reaches Worker
 *      code, so no redirect can see it. This line is the only thing that closes it.
 *   2. `account_id` pinned. A multi-account box must not be able to deploy this elsewhere.
 *   3. No `SITE_BUILD` var, and no service binding to the old renderer. The cache-key salt is the
 *      derived build id in the bundle (`worker/build-id.mjs`); a config var could be forgotten, which
 *      is the exact failure the deleted `deploy.ps1` tripwire existed to catch.
 *
 * And one fact about the OTHER two configs, which this increment must not disturb: the Pages toml and
 * the old renderer's toml are the rollback, so they must still be there and still say what they said.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, ...p.split('/')), 'utf8').replace(/\r\n/g, '\n');
const WORKER = read('worker/wrangler.toml');
const PAGES = read('wrangler.toml');
/** Config lines with the comments stripped — a rule inside a `#` comment is not a rule. */
const live = (src) => src.split('\n').map((l) => l.replace(/^\s*#.*$/, '')).join('\n');
const WORKER_LIVE = live(WORKER);

test('the merged Worker is named human-anatomy and runs worker/index.mjs', () => {
  assert.match(WORKER_LIVE, /^name = "human-anatomy"$/m);
  assert.match(WORKER_LIVE, /^main = "\.\/index\.mjs"$/m);
});

test('workers_dev is FALSE — there is no second hostname outside Access (L30 P1)', () => {
  assert.match(WORKER_LIVE, /^workers_dev = false$/m,
    'a *.workers.dev hostname would serve the whole app outside Cloudflare Access, and no redirect in '
    + 'index.mjs can stop it because run_worker_first means a document never reaches Worker code');
});

test('the account is pinned to Adrey', () => {
  assert.match(WORKER_LIVE, /^account_id = "a135de78aaa95d36ee634b81267625c6"/m);
});

test('the assets binding serves ../dist with the Worker first ONLY for /mcp and /api/*', () => {
  assert.match(WORKER_LIVE, /^directory = "\.\.\/dist"$/m);
  assert.match(WORKER_LIVE, /^binding = "ASSETS"$/m);
  assert.match(WORKER_LIVE, /^run_worker_first = \["\/mcp", "\/api\/\*"\]$/m);
});

test('Browser Rendering and the R2 snapshot bucket are bound directly — no service hop', () => {
  assert.match(WORKER_LIVE, /^browser = \{ binding = "BROWSER" \}$/m);
  assert.match(WORKER_LIVE, /^bucket_name = "human-anatomy-snaps"$/m);
  assert.ok(!/\[\[services\]\]/.test(WORKER_LIVE),
    'the merged Worker must not carry a SNAP service binding — the renderer is in-process');
});

test('the vars match the Pages project exactly, and SITE_BUILD is NOT among them', () => {
  for (const key of ['ACCESS_TEAM_DOMAIN', 'ACCESS_AUD', 'OWNER_EMAILS', 'OWNER_TOKEN_IDS']) {
    const want = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(live(PAGES));
    const got = new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, 'm').exec(WORKER_LIVE);
    assert.ok(want && got, `${key} is missing from one of the two configs`);
    assert.equal(got[1], want[1], `${key} differs between the Pages config and the merged Worker`);
  }
  assert.ok(!/^SITE_BUILD\s*=/m.test(WORKER_LIVE),
    'SITE_BUILD must not be a config var — it is a build-time constant in worker/build-id.mjs');
});

test('ACCESS_AUD is the /mcp path app, never the *.adrian.my wildcard', () => {
  // The wildcard aud starts c1abeb31…; pinning it would accept a JWT minted for any adrian.my host.
  assert.ok(!/ACCESS_AUD\s*=\s*"c1abeb31/.test(WORKER_LIVE));
  assert.match(WORKER_LIVE, /ACCESS_AUD\s*=\s*"[0-9a-f]{64}"/);
});

/**
 * THE ROLLBACK MUST STILL EXIST. If the Pages config stops naming its output directory, or the old
 * renderer's config stops being a deployable Worker config, "remove the route and Pages answers
 * again" is no longer true — and that sentence is the only reason this cutover is safe to do in one
 * session.
 */
test('the Pages project config is untouched and still deployable', () => {
  assert.match(live(PAGES), /^name = "human-anatomy-viewer"$/m);
  assert.match(live(PAGES), /^pages_build_output_dir = "dist"$/m);
  assert.match(live(PAGES), /service = "human-anatomy-snap"/);
});

test('the old renderer Worker config is untouched', () => {
  const snap = read('workers/snap/wrangler.toml');
  assert.match(live(snap), /^name = "human-anatomy-snap"$/m);
  assert.match(live(snap), /^workers_dev = false$/m);
});
