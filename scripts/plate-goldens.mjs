/**
 * plate-goldens.mjs — pixel goldens for the teaching plate (L31 P0 item 6).
 *
 * usage: node scripts/plate-goldens.mjs <baseUrl> <outDir> <label>
 *
 * WHY IT EXISTS, and why it does not call the renderer. The v2 change touches `app/scene.tsx`,
 * which is on `deploy.ps1`'s render-path tripwire list, so the deploy asks: did a plate's PIXELS
 * change? Reasoning says no (v2 never sets `render`, the barrier is a new marker, the inset
 * branch is behind a field v1 never passes, and the snapshot renderer still waits on
 * `data-atlas-ready` = all 15 chunks) — but reasoning is not a measurement.
 *
 * It renders LOCALLY, in this session's own headless Chromium, driving the live host in snap
 * mode. That is deliberate: Cloudflare Browser Rendering minutes are EXHAUSTED on the Adrey
 * account (measured twice, worklog 2026-09-07), so `/api/snap` answers `rate_limited` and cannot
 * produce a plate at all right now. Screenshotting the same page the renderer screenshots is the
 * only instrument available, and it exercises the same code path — the scene effect, the focus
 * fit, the settle marker — which is the part under test.
 *
 * Run it BEFORE the deploy and AFTER, and diff the hashes. A changed hash means SITE_BUILD must
 * be bumped and every cached PNG retired; an unchanged hash means it must NOT be, because
 * retiring the cache while the renderer is rate-limited leaves ChatGPT with no picture at all.
 */
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {createHash} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodeScene, normalizeScene} from '../app/scene-codec.js';

/**
 * ══ COMPARE MODE (L31 v2.1a) ═══════════════════════════════════════════════════════════════════
 *   node scripts/plate-goldens.mjs compare <before.json> <after.json>
 *
 * Producing two artifacts and eyeballing them is not a gate. codex's plan review classified this
 * script as a "PRINTED-ONLY artifact producer, omitted from kickoff verification"
 * (codex-plan-review.md §C) and asked for a comparison that FAILS on missing or errored entries and
 * on unexplained camera/bounds/image changes, tolerating the documented ghost stochasticity.
 *
 * The three signals are deliberately NOT equal in authority:
 *   CAMERA and RECT are deterministic. Any change is a FAILURE — this is the framing regression the
 *     render-path tripwire actually cares about.
 *   THE PNG HASH is not deterministic for a scene carrying a GHOST. Measured on an UNCHANGED
 *     deployment (worklog 2026-09-07): forward-bend hashed f6d8f9e6 → 1b7a09da → f6d8f9e6, because
 *     alphaHash resolves transparency by a stochastic coverage dither. So for the ghost scenes a
 *     hash change is NOISE and is reported without failing; for the others it is a failure.
 *   A MISSING or ERRORED plate on either side is always a failure. An absent measurement reads as
 *     "nothing changed" and that is the one reading it must never produce.
 */
const GHOSTED = new Set(['forward-bend']);   // the only control scene with a `ghost` role
/** THE REQUIRED INVENTORY, named here rather than derived from the artifacts being compared.
 *  Deriving it meant a scene missing from BOTH sides simply vanished from verification — two empty
 *  manifests compared equal and passed (codex review, 2026-09-09, High 7). An absent measurement
 *  must never read as "nothing changed". */
const REQUIRED = ['forward-bend', 'hip-flexors', 'rotator-cuff', 'spine', 'knee', 'feet'];
/** A measurement is only usable if every field is present and finite. `{}` compared to `{}` is
 *  equal on every key and therefore silently green. */
const complete = (r) => !!r && ['l', 'r', 't', 'b', 'w', 'h'].every((k) => Number.isFinite(r[k])) && typeof r.cam === 'string' && r.cam.length > 0;

if (process.argv[2] === 'compare') {
  const {readFileSync} = await import('node:fs');
  const [beforePath, afterPath] = [process.argv[3], process.argv[4]];
  if (!beforePath || !afterPath) {
    console.error('usage: node scripts/plate-goldens.mjs compare <before.json> <after.json>');
    process.exit(2);
  }
  const before = JSON.parse(readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(readFileSync(afterPath, 'utf8'));
  const names = [...new Set([...REQUIRED, ...Object.keys(before.plates), ...Object.keys(after.plates)])];
  const failures = [], notes = [];
  for (const name of names) {
    const b = before.plates[name], a = after.plates[name];
    if (!b || !a) { failures.push(`${name}: present on only one side (before=${!!b} after=${!!a})`); continue; }
    if (b.error || a.error) { failures.push(`${name}: errored (before=${b.error ?? 'ok'} after=${a.error ?? 'ok'})`); continue; }
    if (!complete(b.rect) || !complete(a.rect)) {
      failures.push(`${name}: incomplete measurement — before=${JSON.stringify(b.rect)} after=${JSON.stringify(a.rect)}`);
      continue;
    }
    if (typeof b.hash !== 'string' || typeof a.hash !== 'string' || !b.hash || !a.hash) {
      failures.push(`${name}: a missing image hash on one side`); continue;
    }
    if (b.rect.cam !== a.rect.cam) failures.push(`${name}: CAMERA moved\n      before ${b.rect.cam}\n      after  ${a.rect.cam}`);
    for (const k of ['l', 'r', 't', 'b', 'w', 'h']) {
      if (b.rect[k] !== a.rect[k]) failures.push(`${name}: projected bounds ${k} ${b.rect[k]} -> ${a.rect[k]}`);
    }
    if (b.hash !== a.hash) {
      const line = `${name}: PNG hash ${b.hash} -> ${a.hash}`;
      // BOUNDED, not blanket. codex replaced only the ghost scene's hash with an arbitrary value
      // and the comparator still said IDENTICAL (review 2, Medium 8) — documented stochasticity
      // justifies a tolerance, not accepting every possible image. A coverage dither perturbs
      // individual pixels and barely moves the compressed size; a real appearance change (different
      // structures, a moved camera, a lost ghost) moves it a lot. Camera and projected bounds are
      // already asserted equal above, so this is the last remaining degree of freedom.
      if (GHOSTED.has(name)) {
        const drift = (b.bytes && a.bytes) ? Math.abs(a.bytes - b.bytes) / b.bytes : 1;
        if (drift <= 0.02) notes.push(`${line}  (TOLERATED: ghost dither, PNG size moved ${(drift * 100).toFixed(2)}% <= 2%)`);
        else failures.push(`${line}  — PNG size moved ${(drift * 100).toFixed(1)}%, far past the 2% a coverage dither explains`);
      }
      else failures.push(`${line}  — camera and bounds are identical, so the PIXELS changed on their own`);
    }
  }
  const missing = REQUIRED.filter((n) => !before.plates[n] || !after.plates[n]);
  console.log(`plate goldens: ${names.length} scenes compared, ${REQUIRED.length} required` +
    `${missing.length ? ` — MISSING: ${missing.join(', ')}` : ''}\n  before ${beforePath}\n  after  ${afterPath}\n`);
  for (const n of notes) console.log(`  note  ${n}`);
  for (const f of failures) console.log(`  FAIL  ${f}`);
  console.log(`\n${failures.length === 0 ? 'IDENTICAL within tolerance' : `${failures.length} DIFFERENCE(S)`} — ${notes.length} tolerated note(s)`);
  process.exit(failures.length === 0 ? 0 : 1);
}

const base = process.argv[2] ?? 'https://anatomy.adrian.my';
const outDir = process.argv[3] ?? 'E:/Agentic/.artifacts/L31/v2/goldens';
const label = process.argv[4] ?? 'run';
mkdirSync(outDir, {recursive: true});

/** Six control scenes, the benchmark set the audit resolved (audit-current.md:26-31). */
const SCENES = {
  'forward-bend': {structures: [['FMA22357', 'primary'], ['FMA22438', 'primary'], ['FMA45887', 'primary'], ['FMA16580', 'context'], ['FMA9611', 'context'], ['FMA16203', 'ghost']], view: 'side', focus: ['FMA22357']},
  'hip-flexors': {structures: [['FMA18060', 'primary'], ['FMA22310', 'primary'], ['FMA22430', 'context'], ['FMA16580', 'context'], ['FMA9611', 'context']], view: 'front', focus: ['FMA18060']},
  'rotator-cuff': {structures: [['FMA9629', 'primary'], ['FMA32546', 'primary'], ['FMA13394', 'context'], ['FMA13303', 'context']], view: 'back', focus: ['FMA9629']},
  spine: {structures: [['FMA13478', 'primary'], ['FMA10446', 'context'], ['FMA16202', 'context']], view: 'side', focus: ['FMA13478']},
  knee: {structures: [['FMA9611', 'primary'], ['FMA24476', 'context'], ['FMA24485', 'context']], view: 'front', focus: ['FMA9611']},
  feet: {structures: [['FMA24496', 'primary'], ['FMA9708', 'primary'], ['FMA22542', 'context']], view: 'side', focus: ['FMA24496']},
};

const headers = (process.env.CF_ID && process.env.CF_SECRET)
  ? {'CF-Access-Client-Id': process.env.CF_ID, 'CF-Access-Client-Secret': process.env.CF_SECRET}
  : {};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
// 960x720 is the plate default (scene-codec DEFAULTS), so the framing under test is the framing
// a real plate gets.
const context = await browser.newContext({viewport: {width: 960, height: 720}, deviceScaleFactor: 1});
if (Object.keys(headers).length) {
  const origin = new URL(base).origin;
  await context.route('**/*', (route) => {
    const r = route.request();
    if (r.url().startsWith(origin)) return route.continue({headers: {...r.headers(), ...headers}});
    return route.continue();
  });
}
const page = await context.newPage();
const out = {at: new Date().toISOString(), base, label, plates: {}};

for (const [name, spec] of Object.entries(SCENES)) {
  const scene = normalizeScene({
    mode: 'render', lang: 'en',
    structures: spec.structures.map(([id, role]) => ({id, role})),
    camera: {view: spec.view, focus: spec.focus, padding: 1.35, explode: 0},
    caption: {title: name, note: '', place: 'out'},
  });
  const blob = encodeScene(scene);
  const url = `${base}/?snap=1&scene=${blob}`;
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});
    // The renderer's own two waits, in its own order: all 15 chunks, then a settled camera.
    await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 300000});
    await page.waitForSelector('html[data-atlas-settled="1"]', {timeout: 120000});
    const buf = await page.screenshot({path: join(outDir, `${label}-${name}.png`)});
    const hash = createHash('sha256').update(buf).digest('hex').slice(0, 16);
    // The projected subject rect too: two renders can hash differently from one dithered pixel
    // while framing identically, and framing is what a regression would actually break.
    const rect = await page.evaluate((ids) => {
      const g = window.__atlasTargets(ids);
      const gs = Object.values(g.groups || {});
      if (!gs.length) return null;
      return {
        l: Math.round(Math.min(...gs.map((x) => x.left))), r: Math.round(Math.max(...gs.map((x) => x.right))),
        t: Math.round(Math.min(...gs.map((x) => x.top))), b: Math.round(Math.max(...gs.map((x) => x.bottom))),
        w: g.w, h: g.h, cam: [g.camera.x.toFixed(4), g.camera.y.toFixed(4), g.camera.z.toFixed(4), g.camera.tx.toFixed(4), g.camera.ty.toFixed(4), g.camera.tz.toFixed(4)].join(','),
      };
    }, spec.structures.map(([id]) => id));
    out.plates[name] = {hash, bytes: buf.length, rect, blob: blob.slice(0, 24)};
    console.log(`${name}  hash=${hash}  rect=${rect ? `${rect.l},${rect.t}-${rect.r},${rect.b}` : 'none'}  cam=${rect?.cam}`);
  } catch (e) {
    out.plates[name] = {error: String(e).slice(0, 200)};
    console.log(`${name}  ERROR ${String(e).slice(0, 160)}`);
  }
}

await browser.close();
writeFileSync(join(outDir, `goldens-${label}.json`), JSON.stringify(out, null, 1));
console.log(`\nwrote ${join(outDir, `goldens-${label}.json`)}`);
