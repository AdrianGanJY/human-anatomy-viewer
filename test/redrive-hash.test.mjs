/**
 * THE WARM-TAB RE-DRIVE CONTRACT. L31 v2.1a.
 *
 * `reDriveHash()` and `canonical()` are the whole cache-correctness surface of the snapshot
 * renderer (workers/snap/src/helpers.mjs), and both of their failure modes are silent: a key
 * missing from `canonical()` collides two different pictures on one R2 entry, and a key missing
 * from `reDriveHash()` makes a REUSED tab render the previous request's value. Neither returns an
 * error. Both return HTTP 200 and a plausible picture.
 *
 * codex-app-review.md §2 row 10 (R:34) found `lang` and `system` missing from the legacy branch.
 * These are the assertions that keep them there — plus the frozen `canonical()` strings that prove
 * the repair did NOT move any existing cache key, which is the claim the SITE_BUILD note makes.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canonical, reDriveHash, DEFAULT_SYSTEMS} from '../workers/snap/src/helpers.mjs';

const params = (s) => new URLSearchParams(s);
const hash = (s) => new URLSearchParams(reDriveHash(params(s)).replace(/^#/, ''));

test('the legacy branch writes EVERY key, so nothing can survive from the previous request', () => {
  const h = hash('select=FMA9611&view=front');
  // The full key list. A key absent here is a value a warm tab keeps — which is the defect class.
  for (const k of ['scene', 'select', 'view', 'isolate', 'explode', 'title', 'note', 'mode', 'focus', 'contextOpacity', 'lang', 'system', 'snap']) {
    assert.equal(h.has(k), true, `reDriveHash omitted "${k}" — a warm tab would keep the previous request's value`);
  }
});

test('lang defaults to en, in BOTH directions (R:34)', () => {
  // Out of a language. `lang=''` would NOT do this: app/url-state.ts:74 guards on `if(lang && …)`,
  // so an empty value is ignored and the warm tab stays in Chinese.
  assert.equal(hash('select=FMA9611').get('lang'), 'en');
  assert.equal(hash('select=FMA9611&view=side').get('lang'), 'en');
  // And into one — which was ALSO broken: the key was never written at all, so a request that
  // carried `lang=zh-Hant` did not apply it either.
  assert.equal(hash('select=FMA9611&lang=zh-Hant').get('lang'), 'zh-Hant');
  assert.equal(hash('select=FMA9611&lang=zh-Hans').get('lang'), 'zh-Hans');
});

test('system defaults to the FULL default list, because no shorter spelling resets it', () => {
  const h = hash('select=FMA9611');
  assert.equal(h.get('system'), DEFAULT_SYSTEMS.join(','));
  // `''` is ignored by the parser and `none` means the opposite of a reset — hide everything.
  assert.notEqual(h.get('system'), '');
  assert.notEqual(h.get('system'), 'none');
  // A request that names its own systems keeps them.
  assert.equal(hash('select=FMA9611&system=skeletal').get('system'), 'skeletal');
  assert.equal(hash('select=FMA9611&system=none').get('system'), 'none');
});

test('DEFAULT_SYSTEMS has not drifted from app/anatomy.ts DEFAULT_VISIBLE', () => {
  // The Worker module cannot IMPORT the app's constant (zero imports by design), so the duplicate
  // is guarded instead of tolerated: adding a system in one place must break the build rather than
  // quietly change what a warm re-drive resets to.
  const src = readFileSync(new URL('../app/anatomy.ts', import.meta.url), 'utf8');
  const m = /DEFAULT_VISIBLE\s*:\s*SystemId\[\]\s*=\s*\[([^\]]*)\]/.exec(src);
  assert.ok(m, 'could not find DEFAULT_VISIBLE in app/anatomy.ts — this guard needs updating');
  const appList = m[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.deepEqual(DEFAULT_SYSTEMS, appList,
    'workers/snap/src/helpers.mjs DEFAULT_SYSTEMS drifted from app/anatomy.ts DEFAULT_VISIBLE');
});

test('the scene branch is untouched — a valid blob is still authoritative', () => {
  // The scene branch is safe for a different reason: a valid `scene=` makes the page's apply
  // authoritative over every field the scene owns, so it needs no per-key reset. It must therefore
  // NOT grow the two new keys, or a scene request would start carrying a legacy system list.
  const h = new URLSearchParams(reDriveHash(params('scene=abc&select=FMA9611&lang=zh-Hant')).replace(/^#/, ''));
  assert.equal(h.get('scene'), 'abc');
  assert.equal(h.has('lang'), false);
  assert.equal(h.has('system'), false);
  assert.equal(h.get('title'), '');
  assert.equal(h.get('note'), '');
  assert.equal(h.get('snap'), '1');
});

test('CACHE IDENTITY IS FROZEN — canonical() output is byte-identical to before the repair', () => {
  // If any of these strings changes, every cached PNG for that view is orphaned and every claim in
  // the SITE_BUILD note about "no existing key moves" is false. They are literals on purpose: a
  // recomputed expectation would move with the bug.
  assert.equal(canonical(params('select=FMA9611&view=front')), 'select=FMA9611&view=front');
  assert.equal(
    canonical(params('select=FMA22359&view=side&isolate=1&explode=0.5&system=skeletal&lang=zh-Hans')),
    'explode=0.5&isolate=1&lang=zh-Hans&select=FMA22359&system=skeletal&view=side');
  assert.equal(canonical(params('scene=abc&select=FMA9611&size=960x720&lang=zh-Hant')),
    'scene=abc&select=FMA9611&size=960x720');
  // Order-independence and empty-value dropping, the two properties the key relies on.
  assert.equal(canonical(params('view=front&select=FMA9611')), canonical(params('select=FMA9611&view=front')));
  assert.equal(canonical(params('select=FMA9611&title=')), 'select=FMA9611');
});
