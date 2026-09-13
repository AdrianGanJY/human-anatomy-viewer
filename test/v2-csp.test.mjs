/**
 * ══ THE CSP IS SET IN TWO PLACES AND THEY MAY NEVER DISAGREE — L31 v2.1b+c, S5b ═══════════════
 *
 * `public/_headers` and `functions/_middleware.js` both carry the policy, for the reason each file
 * states: `_headers` is documented as applying to STATIC ASSET responses, and every non-excluded
 * path on this project is routed to a Pages Function. Shipping both is the version that does not
 * require being right about which layer wins.
 *
 * The price of belt-and-braces is DRIFT — someone widens `connect-src` in one file and the origin
 * then enforces two different policies depending on which layer answered, which is worse than
 * either. So the two strings are compared here, byte for byte, and the directive set is asserted
 * against the contract in RC11 rather than against whatever the files currently say.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const HEADERS = readFileSync(ROOT + 'public/_headers', 'utf8').replace(/\r\n/g, '\n');
const MIDDLEWARE = readFileSync(ROOT + 'functions/_middleware.js', 'utf8').replace(/\r\n/g, '\n');

/** The policy as `_headers` states it: the value after `Content-Security-Policy:` on an indented
 *  line inside the `/*` block. Parsed rather than re-typed, so this test reads the shipped file. */
const fromHeaders = () => {
  const lines = HEADERS.split('\n');
  const at = lines.findIndex((l) => l.trim() === '/*');
  assert.ok(at >= 0, 'public/_headers has no `/*` rule block — the policy would apply to nothing');
  const row = lines.slice(at + 1).find((l) => /^\s+Content-Security-Policy:/.test(l));
  assert.ok(row, 'the `/*` block declares no Content-Security-Policy');
  return row.replace(/^\s*Content-Security-Policy:\s*/, '').trim();
};
/** The policy as the middleware states it. */
const fromMiddleware = () => {
  const m = /const CSP = "([^"]+)"/.exec(MIDDLEWARE);
  assert.ok(m, 'functions/_middleware.js declares no CSP constant');
  return m[1];
};

test('the two copies of the policy are byte-identical', () => {
  assert.equal(fromMiddleware(), fromHeaders(),
    'public/_headers and functions/_middleware.js declare DIFFERENT policies — the origin would then'
    + ' enforce whichever layer happened to answer, which is worse than having one of them');
});

test('the policy is exactly RC11\'s contract, directive by directive', () => {
  const policy = fromHeaders();
  const got = new Map(policy.split(';').map((d) => d.trim()).filter(Boolean)
    .map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v.join(' ')]; }));
  // Every directive RC11 / opus-plan-review-2.md §G.2 names, with the value it names.
  for (const [k, v] of [
    ['default-src', "'self'"],
    ['connect-src', "'self' https://api.openai.com"],
    ['script-src', "'self'"],
    ['object-src', "'none'"],
    ['base-uri', "'none'"],
    ['frame-ancestors', "'none'"],
  ]) assert.equal(got.get(k), v, `${k}`);
  // The three this app needs on top, each measured against `dist/` (see public/_headers).
  assert.equal(got.get('img-src'), "'self' data: blob:", 'plates and canvas blobs');
  assert.equal(got.get('font-src'), "'self'", 'the CJK stack is self-hosted');
  assert.equal(got.get('form-action'), "'none'");
});

test("NO 'unsafe-inline' and NO 'unsafe-eval', in either copy", () => {
  // RC11: "ONLY if the app's inline styles require it (measure … prefer no 'unsafe-inline')". The
  // measurement said no, so this is the assertion that keeps it no — the easy way to "fix" a CSP
  // violation is to add the word, and the whole value of the policy is in not having it.
  for (const [name, p] of [['_headers', fromHeaders()], ['_middleware.js', fromMiddleware()]]) {
    assert.ok(!p.includes("'unsafe-inline'"), `${name} contains 'unsafe-inline'`);
    assert.ok(!p.includes("'unsafe-eval'"), `${name} contains 'unsafe-eval'`);
    assert.ok(!/\*(?!\.)/.test(p.replace(/https:\/\/[^\s;]+/g, '')), `${name} contains a bare wildcard source`);
  }
});

test('connect-src names api.openai.com and NOTHING else off-origin', () => {
  // The single line that decides whether an injected script can post the key somewhere useful.
  const connect = fromHeaders().split(';').map((d) => d.trim()).find((d) => d.startsWith('connect-src'));
  const sources = connect.split(/\s+/).slice(1);
  assert.deepEqual(sources.filter((s) => s.includes('://')), ['https://api.openai.com']);
  assert.deepEqual(sources.filter((s) => !s.includes('://')), ["'self'"]);
});

test('the middleware sets the policy on HTML ONLY, and never overwrites an existing one', () => {
  // Read as source rather than executed: the Pages runtime is not available here, and the two
  // claims are about the CODE PATH, which is what the assertions below can see honestly.
  assert.match(MIDDLEWARE, /content-type/i, 'the middleware must scope on the response content-type');
  assert.match(MIDDLEWARE, /includes\('text\/html'\)/, 'HTML documents only — /mcp and /api answer JSON');
  assert.match(MIDDLEWARE, /res\.headers\.has\('Content-Security-Policy'\)/,
    'an existing policy (from _headers, if it survives next()) must win rather than be duplicated');
  assert.match(MIDDLEWARE, /new Response\(res\.body, res\)/,
    'a fetched Response has immutable headers; the policy must go on a copy');
});

test('the /* rule covers every path, and the excluded static paths are still same-origin', () => {
  assert.match(HEADERS, /^\/\*$/m, 'the rule block is `/*`');
  const routes = JSON.parse(readFileSync(ROOT + 'public/_routes.json', 'utf8'));
  // Those four are served straight from the CDN, so the middleware never sees them. They are all
  // same-origin subresources (`'self'`), which is why no directive needs widening for them.
  assert.deepEqual(routes.exclude, ['/models/*', '/assets/*', '/i18n/*', '/favicon.svg']);
});

/**
 * ══ NOTHING MAY WRITE A STYLE **ATTRIBUTE** — the guard this policy actually needed ═══════════
 *
 * S5b shipped `style-src 'self'` without `'unsafe-inline'`, on a measurement that was true and
 * incomplete: the BUILT HTML has zero `<style>` blocks and zero `style="` attributes, and React
 * writes through the CSSOM, which CSP does not govern. Both halves correct; the conclusion wrong.
 *
 * `app/capture.ts` is not React. It did `setAttribute('style', 'position:absolute;…')` on the plate
 * overlay — a style ATTRIBUTE, governed by `style-src-attr`, which falls back to `style-src`. The
 * browser dropped the declaration silently, the overlay was never positioned over the WebGL canvas,
 * and the renderer screenshotted the canvas underneath. Live for about twenty minutes; caught by
 * `verify-render` H4 against production, identical on three consecutive runs.
 *
 * TWO failures of method, and this test answers both:
 *   · the check was run over the BUILT OUTPUT, and the defect was in code that writes styles at
 *     RUNTIME — a grep over `dist/*.html` can never see it;
 *   · the grep was QUOTE-SHAPED (`'style'` / `"style"`), and the minifier emitted
 *     `setAttribute(`style`, …)`. It matched nothing and read as clean.
 *
 * So this reads SOURCE (where the quote form is ours) and accepts all three quotes.
 */
test('no source file writes a style ATTRIBUTE — style-src has no unsafe-inline', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(ROOT + dir, {withFileTypes: true})) {
      if (e.isDirectory()) { walk(`${dir}/${e.name}`); continue; }
      if (!/\.(ts|tsx|js|jsx|mjs)$/.test(e.name)) continue;
      const rel = `${dir}/${e.name}`;
      const src = readFileSync(ROOT + rel, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // All three quote forms, any whitespace, and `cssText` — which is CSSOM and therefore
      // allowed, but is listed here because it is the obvious "fix" someone reaches for and it
      // belongs in a reviewer's eye-line rather than in a surprise.
      if (/setAttribute\s*\(\s*(['"`])style\1/.test(src)) offenders.push(`${rel} (setAttribute style)`);
    }
  };
  for (const dir of ['app', 'web', 'functions']) walk(dir);
  assert.deepEqual(offenders, [],
    'a style ATTRIBUTE is blocked by style-src without unsafe-inline — assign the properties'
    + ' individually (el.style.position = …), which goes through the CSSOM and is not governed by CSP');
});

test('and the SHIPPED bundle carries none either, in any quote form', (t) => {
  // The source check above is the durable one. This is the belt: it reads `dist` when a build
  // happens to be present (it is absent in a review snapshot, and that is a SKIP with a reason,
  // never a silent pass).
  let files;
  try { files = readdirSync(ROOT + 'dist/assets').filter((f) => f.endsWith('.js')); }
  catch { t.skip('no dist/ in this tree — the source assertion above is the one that always runs'); return; }
  assert.ok(files.length > 0, 'dist/assets exists but has no JS — that is not a pass');
  const hits = [];
  for (const f of files) {
    const src = readFileSync(`${ROOT}dist/assets/${f}`, 'utf8');
    for (const m of src.matchAll(/setAttribute\s*\(\s*(['"`])style\1/g)) hits.push(`${f} @ ${m.index}`);
  }
  assert.deepEqual(hits, [], 'the built bundle writes a style attribute the CSP will drop');
});
