/**
 * verify-ux.mjs — THE L31 ACCEPTANCE ORACLES (P0).
 *
 * usage: node scripts/verify-ux.mjs <baseUrl> <outDir> <v1|v2> [label]
 *
 * Built BEFORE the v2 code and run against v1 FIRST, because a suite that has never been red
 * is not a suite — it is a description of whatever the app happens to do. The v1 run is kept as
 * `oracles-v1.json` and is the baseline every v2 claim is measured against.
 *
 * WHAT IT DOES NOT DO: it does not report a millisecond. Every wall-clock number available to a
 * headless run on this host comes from `--use-gl=swiftshader` and is a slow-CPU upper bound
 * (audit-current.md:125). Bytes, DOM rects, projected subject rects, CLS and font resolution
 * are device-independent and are what this file asserts. Real timings arrive from
 * `/v2/?probe=1` opened on the actual phone; see functions/api/timing.js.
 *
 * THE SEVEN ORACLES
 *  1  ORIENTATION   the visible title names the scene's role=PRIMARY structure, not whatever
 *                   sorted first. (A ghost that is alphabetically first is the false-green case
 *                   the P0 gate asks about, so the fixture below is built to BE that case:
 *                   FMA16203 is the ghost and sorts first.)
 *  2  FRAMING       the framed union (primary+context) fills the field, and does not touch its
 *                   top edge. Aspect-independent: largest subject dimension against the
 *                   corresponding field dimension, per the critic's ruling — never '% of area',
 *                   which penalises long thin anatomy.
 *  3  BYTES         model bytes on the wire before the view is usable. On v1 'usable' can only
 *                   mean data-atlas-ready (all 15 chunks); on v2 it means data-atlas-scene-ready
 *                   (the phase barrier). The gap between those two numbers IS the P1 claim.
 *  4  CLS           cumulative layout shift through the entry, excluding user-caused shifts.
 *  5  TARGETS       every visible interactive rect >= 44x44 on a coarse pointer, and no two
 *                   overlapping.
 *  6  OVERFLOW      scrollWidth === clientWidth. No horizontal scroll at any viewport.
 *  7  CJK           the zh-Hant stack asks for a TRADITIONAL face (v1 serves one SC-only stack
 *                   to both scripts, globals.css:212), and the rendered CJK string is not tofu.
 */
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodeScene, normalizeScene, sceneFocusId, sceneFrameIds} from '../app/scene-codec.js';

const base = process.argv[2];
const outDir = process.argv[3];
const variant = process.argv[4] ?? 'v1';
const label = process.argv[5] ?? variant;
if (!base || !outDir) { console.error('usage: node scripts/verify-ux.mjs <baseUrl> <outDir> <v1|v2> [label]'); process.exit(2); }
mkdirSync(outDir, {recursive: true});

const PATHS = {v1: '/', v2: '/v2/'};
const path = PATHS[variant];
if (!path) { console.error(`unknown variant ${variant}`); process.exit(2); }

/** THE §9 FORWARD-BEND SCENE, and it is deliberately the adversarial case the P0 gate names.
 *  FMA16203 (lumbar vertebral column) is the GHOST and sorts FIRST alphabetically, so an
 *  orientation check that reads basket[0] passes on the wrong structure — which is exactly the
 *  defect L31's hotfix fixed and exactly the false green this fixture exists to prevent. */
const SCENE_INPUT = {
  mode: 'explore', lang: 'zh-Hans',
  structures: [
    {id: 'FMA22359', role: 'primary'},   // left semitendinosus
    {id: 'FMA22449', role: 'primary'},   // left biceps femoris
    {id: 'FMA16580', role: 'context'},   // hip bone
    {id: 'FMA9611', role: 'context'},    // femur
    {id: 'FMA16203', role: 'ghost'},     // lumbar vertebral column — sorts first
  ],
  camera: {view: 'side', focus: ['FMA22359'], padding: 1.35, explode: 0},
  caption: {title: '腘绳肌与骨盆', note: '前屈时腘绳肌被拉长，骨盆随之后倾。', place: 'in'},
};
const SCENE = normalizeScene(SCENE_INPUT);
const BLOB = encodeScene(SCENE);
const PRIMARY_IDS = SCENE.structures.filter((s) => s.role === 'primary').map((s) => s.id);
const FRAME_IDS = sceneFrameIds(SCENE);
const FOCUS_ID = sceneFocusId(SCENE);
/** The names the atlas will show. `sceneFocusId` picks the focused primary. */
const EXPECTED_EN = 'left semitendinosus';

const VIEWPORTS = [
  {name: '390x844', width: 390, height: 844, dpr: 3, coarse: true},
  {name: '768x1024', width: 768, height: 1024, dpr: 2, coarse: true},
  {name: '1024x768', width: 1024, height: 768, dpr: 2, coarse: true},
  {name: '1440x900', width: 1440, height: 900, dpr: 1, coarse: false},
];

/** Where the title lives in each entry. Two selectors, one contract: "the visible name of the
 *  structure this link is about". */
const TITLE_SEL = {v1: '.detail-sheet .structure-title', v2: '.v2-term b'};
/** The element the camera actually draws into — the whole viewport in v1, the grid cell in v2.
 *  This is the measurement that makes 'the field is a layout cell' checkable. */
const FIELD_SEL = {v1: '.scene', v2: '.v2-field'};
/** The marker that means "this view is usable". v1 has only one; that IS oracle 3's finding. */
const READY_SEL = {v1: 'html[data-atlas-ready="1"]', v2: 'html[data-atlas-scene-ready="1"]'};

const headers = (process.env.CF_ID && process.env.CF_SECRET)
  ? {'CF-Access-Client-Id': process.env.CF_ID, 'CF-Access-Client-Secret': process.env.CF_SECRET}
  : {};

const results = [];
const check = (viewport, oracle, pass, measured, want) => {
  results.push({viewport, oracle, pass: !!pass, measured, want});
  console.log(`${pass ? 'PASS' : 'FAIL'}  [${viewport}] ${oracle} :: measured=${measured}${want ? ` want=${want}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: {width: vp.width, height: vp.height},
    deviceScaleFactor: vp.dpr,
    // hasTouch drives `@media (pointer:coarse)`, which is the query the 44 px tier is keyed on.
    // Emulating the size without the pointer would measure the desktop stylesheet and report a
    // touch defect that is not there — or miss one that is.
    hasTouch: vp.coarse, isMobile: vp.coarse,
  });
  if (Object.keys(headers).length) {
    const origin = new URL(base).origin;
    await context.route('**/*', (route) => {
      const r = route.request();
      // Scope the Access headers to the target origin only — sending them cross-origin turns
      // third-party subresource loads into failed CORS preflights, an error the instrument
      // manufactures. NOTE: route interception ALSO bypasses Chromium's HTTP cache, so every
      // byte number below is a COLD number. That is the number this suite wants, and it is the
      // instrument artefact the audit caught (audit-current.md:123) — recorded, not hidden.
      if (r.url().startsWith(origin)) return route.continue({headers: {...r.headers(), ...headers}});
      return route.continue();
    });
  }
  // The CLS observer must be installed before any page script runs, or the entry's own shifts
  // are missed and every run reports a comfortable zero.
  await context.addInitScript(() => {
    window.__cls = 0; window.__clsSrc = [];
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          if (e.hadRecentInput) continue;
          window.__cls += e.value;
          // NAME WHAT MOVED. A CLS number with no source is a complaint, not a finding.
          for (const s of e.sources || []) {
            const n = s.node;
            if (n && n.nodeType === 1) window.__clsSrc.push(`${n.tagName.toLowerCase()}.${String(n.className || '').split(' ')[0]}=${e.value.toFixed(5)}`);
          }
        }
      }).observe({type: 'layout-shift', buffered: true});
    } catch { /* no layout-shift support */ }
  });

  const page = await context.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));

  const url = `${base}${path}?lang=zh-Hans&scene=${BLOB}`;
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});

    // ── 3 BYTES ────────────────────────────────────────────────────────────────────────────
    let readyMs = null;
    try {
      await page.waitForSelector(READY_SEL[variant], {timeout: 240000});
      readyMs = 1;
    } catch { /* the marker never arrived; recorded below as a null, not as a pass */ }
    const bytes = await page.evaluate(() => {
      // PREFER THE FROZEN NUMBER. v2 stamps the byte count at the phase barrier itself; reading
      // it live here would race the background chunks that keep arriving while this script
      // awaits, which is exactly what made the first run report three different figures for one
      // page. v1 has no barrier, so it falls through to the live sum — which is the whole atlas
      // by then, and that IS its measurement.
      const frozen = document.documentElement.dataset.atlasSceneBytes;
      let transfer = 0, encoded = 0, requests = 0;
      for (const e of performance.getEntriesByType('resource')) {
        if (!/\/models\/body-/.test(e.name)) continue;
        transfer += e.transferSize || 0; encoded += e.encodedBodySize || 0; requests += 1;
      }
      if (frozen !== undefined) {
        return {transfer, encoded: Number(frozen), requests: Number(document.documentElement.dataset.atlasSceneRequests || 0), frozen: true};
      }
      return {transfer, encoded, requests, frozen: false};
    });
    // 9,053,527 B is the measured chunk-granular requirement of THIS scene (audit-current.md:26)
    // plus the fixed prefix; 9.6 MB is that with headroom. v1 must fetch all 33 MB before its
    // only readiness marker, so this is red there by construction — which is the point.
    const BYTE_BUDGET = 9.6e6;
    check(vp.name, 'bytes before the view is usable', readyMs !== null && bytes.encoded <= BYTE_BUDGET,
      `${bytes.encoded} B / ${bytes.requests} chunk requests${readyMs === null ? ' (readiness marker never appeared)' : ''}`, `<= ${BYTE_BUDGET} B`);

    // ── 1 ORIENTATION ──────────────────────────────────────────────────────────────────────
    let titleText = '';
    try { titleText = ((await page.textContent(TITLE_SEL[variant], {timeout: 30000})) || '').trim(); } catch { /* absent */ }
    // In zh-Hans the title is the Chinese name, so assert against what the app itself resolves
    // for the expected id rather than against a hard-coded translation.
    const expected = await page.evaluate(async (id) => {
      const r = await fetch('/models/atlas.json'); const a = await r.json();
      const c = a.concepts.find((x) => x.id === id) || a.parts.find((x) => x.id === id);
      return c ? c.name : null;
    }, FOCUS_ID);
    // INSTRUMENT ARTEFACT CAUGHT (first v1 run, 2026-09-07): this read `d.names[id]`, which is
    // not the dictionary's shape — the file is {concepts:{}, parts:{}, ...} — so `zh` was always
    // null, `want` fell back to English, and all four viewports reported a FALSE RED against a
    // title that was in fact correct ("左半腱肌", the primary). The oracle was wrong, not the app.
    // It is fixed here rather than quietly, because a suite whose reds are its own bugs is worse
    // than no suite: it manufactures work and it hides the real ones.
    const zh = await page.evaluate(async (id) => {
      try {
        const r = await fetch('/i18n/zh-Hans.json'); const d = await r.json();
        return (d.concepts && d.concepts[id]) || (d.parts && d.parts[id]) || null;
      } catch { return null; }
    }, FOCUS_ID);
    const want = zh || expected || EXPECTED_EN;
    const titleOk = !!titleText && [zh, expected, EXPECTED_EN].filter(Boolean)
      .some((w) => titleText.toLowerCase() === String(w).toLowerCase());
    check(vp.name, 'title names the scene PRIMARY (not the alphabetically-first ghost)',
      titleOk, `"${titleText}"`, `"${want}"`);

    // ── 2 FRAMING ──────────────────────────────────────────────────────────────────────────
    // Give the camera fit time to fly and settle; damping makes the first frame after ready an
    // unfinished picture, and measuring it would report a framing defect that is not there.
    await page.waitForTimeout(4000);
    const framing = await page.evaluate(({ids, fieldSel}) => {
      const get = window.__atlasTargets;
      if (!get) return {error: 'no __atlasTargets'};
      const el = document.querySelector(fieldSel);
      const r = get(ids);
      const groups = Object.values(r.groups || {});
      if (!groups.length) return {error: 'no groups drawn', w: r.w, h: r.h};
      const left = Math.min(...groups.map((g) => g.left)), right = Math.max(...groups.map((g) => g.right));
      const top = Math.min(...groups.map((g) => g.top)), bottom = Math.max(...groups.map((g) => g.bottom));
      const fw = r.w, fh = r.h;
      return {
        left, right, top, bottom, fw, fh,
        fieldRect: el ? {w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height)} : null,
        // The critic's aspect-independent rule: the subject's LARGER dimension against the
        // corresponding field dimension. '% of the shorter side' and '% of area' both penalise
        // long, narrow anatomy and disagree with each other by ~7x.
        fill: Math.max((right - left) / fw, (bottom - top) / fh),
        area: ((right - left) * (bottom - top)) / (fw * fh),
        touchesTop: top <= 1, touchesBottom: bottom >= fh - 1,
        touchesLeft: left <= 1, touchesRight: right >= fw - 1,
      };
    }, {ids: FRAME_IDS, fieldSel: FIELD_SEL[variant]});
    check(vp.name, 'framed union fills >= 45% of the field', !framing.error && framing.fill >= 0.45,
      framing.error || `${(framing.fill * 100).toFixed(1)}% (area ${(framing.area * 100).toFixed(2)}%) field ${framing.fw}x${framing.fh}`, '>= 45%');
    check(vp.name, 'no top-edge clipping', !framing.error && framing.touchesTop === false,
      framing.error || `touchesTop=${framing.touchesTop} touchesBottom=${framing.touchesBottom}`, 'touchesTop=false');

    // ── 4 CLS ──────────────────────────────────────────────────────────────────────────────
    const cls = await page.evaluate(() => ({v: window.__cls ?? null, src: window.__clsSrc ?? []}));
    check(vp.name, 'CLS through entry', cls.v !== null && cls.v < 0.001,
      `${cls.v}${cls.src.length ? ' from ' + cls.src.slice(0, 4).join(', ') : ''}`, '< 0.001');

    // ── 6 OVERFLOW ─────────────────────────────────────────────────────────────────────────
    const overflow = await page.evaluate(() => ({s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth}));
    check(vp.name, 'no horizontal scroll', overflow.s === overflow.c, `scrollWidth=${overflow.s} clientWidth=${overflow.c}`, 'equal');

    // ── 5 TARGETS ──────────────────────────────────────────────────────────────────────────
    const targets = await page.evaluate(() => {
      const sel = 'button,a[href],input,select,textarea,[role=button],[role=option],[role=switch],[tabindex]:not([tabindex="-1"])';
      const seen = [];
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.closest('[hidden],[aria-hidden="true"]')) continue;
        seen.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className && String(el.className).slice(0, 40)) || '',
          label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28),
          w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y),
        });
      }
      const small = seen.filter((t) => t.w < 44 || t.h < 44);
      const overlaps = [];
      for (let i = 0; i < seen.length; i++) for (let j = i + 1; j < seen.length; j++) {
        const a = seen[i], b = seen[j];
        // A nested control legitimately sits inside its parent's box; only SIBLING overlap is a
        // defect, so require a genuine partial intersection rather than containment.
        const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ix <= 0 || iy <= 0) continue;
        const inter = ix * iy;
        if (inter >= Math.min(a.w * a.h, b.w * b.h) * 0.98) continue; // containment
        overlaps.push({a: a.label || a.cls, b: b.label || b.cls, inter});
      }
      return {total: seen.length, small, overlaps: overlaps.slice(0, 8), overlapCount: overlaps.length};
    });
    if (vp.coarse) {
      check(vp.name, 'every interactive target >= 44x44 (coarse pointer)', targets.small.length === 0,
        `${targets.small.length} of ${targets.total} under 44px${targets.small.length ? ': ' + targets.small.slice(0, 5).map((t) => `${t.label || t.cls}@${t.w}x${t.h}`).join(', ') : ''}`, '0');
      check(vp.name, 'no overlapping interactive rects', targets.overlapCount === 0,
        `${targets.overlapCount} overlapping pairs${targets.overlapCount ? ': ' + targets.overlaps.slice(0, 3).map((o) => `${o.a} x ${o.b}`).join(', ') : ''}`, '0');
    }

    // ── 7 CJK ──────────────────────────────────────────────────────────────────────────────
    for (const script of ['zh-Hans', 'zh-Hant']) {
      const font = await page.evaluate((s) => {
        document.documentElement.lang = s;
        const el = document.querySelector('h1, .structure-title, .v2-term b') || document.body;
        const stack = getComputedStyle(el).fontFamily;
        // TOFU PROBE — BY PIXELS, NOT BY WIDTH.
        //
        // INSTRUMENT ARTEFACT CAUGHT (first v1 run, 2026-09-07): the width version of this probe
        // reported real == fallback == monospace == 144.0 at every viewport and read as "CJK
        // never renders". It is structurally incapable of the measurement: CJK glyphs are
        // FULLWIDTH (1 em) and a tofu box is ALSO 1 em, so the two are identical by definition.
        // Every one of those reds was the instrument. (Same family as L30's "a probe cannot tell
        // present from tofu here", worklog.md:696.)
        //
        // What does distinguish them: tofu boxes are all the SAME picture. Draw each character
        // separately and compare the bitmaps — real glyphs differ from one another, tofu does
        // not. A blank result (nothing inked) is reported too, and is its own failure.
        const text = s === 'zh-Hant' ? '膕繩肌與骨盆' : '腘绳肌与骨盆';
        const cv = document.createElement('canvas'); cv.width = 32; cv.height = 32;
        const c = cv.getContext('2d', {willReadFrequently: true});
        const sigs = [];
        let inked = 0;
        for (const ch of text) {
          c.clearRect(0, 0, 32, 32);
          c.fillStyle = '#000'; c.font = `24px ${stack}`; c.textBaseline = 'top';
          c.fillText(ch, 2, 2);
          const d = c.getImageData(0, 0, 32, 32).data;
          let h = 2166136261, on = 0;
          for (let i = 3; i < d.length; i += 4) { const v = d[i] > 40 ? 1 : 0; on += v; h = ((h ^ (v + (i % 7))) * 16777619) >>> 0; }
          sigs.push(h); inked += on;
        }
        const distinct = new Set(sigs).size;
        return {stack, text, distinct, chars: sigs.length, inked};
      }, script);
      const wantsTC = /TC\b|JhengHei|MingLiU|Traditional/i.test(font.stack);
      // The v1 defect is structural: ONE SC-only stack serves both scripts (globals.css:212), so
      // 繁體 renders in Simplified glyph variants on iOS. Assert the FORK, because that is the
      // thing that is wrong — a width probe on a Windows host cannot see a glyph-variant swap.
      if (script === 'zh-Hant') {
        check(vp.name, 'zh-Hant asks for a TRADITIONAL face', wantsTC, font.stack.slice(0, 110), 'a TC family in the stack');
      }
      // At least half the characters must be visually distinct from one another. Six identical
      // boxes is tofu; six distinct pictures is type. (This measures THIS host's font set, which
      // is not Adrian's iPhone — it proves the CSS resolves to a real face somewhere, and the
      // zh-Hant FORK above is the assertion that carries the actual defect.)
      check(vp.name, `${script} renders (not tofu)`, font.inked > 0 && font.distinct >= Math.ceil(font.chars / 2),
        `${font.distinct}/${font.chars} distinct glyph bitmaps, ${font.inked} inked px`, `>= ${Math.ceil(font.chars / 2)} distinct`);
    }
    // Put the language back so the screenshot matches the link.
    await page.evaluate(() => { document.documentElement.lang = 'zh-Hans'; });

    await page.screenshot({path: join(outDir, `${label}-${vp.name}.png`)});
    check(vp.name, 'no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'none', 'none');
  } catch (e) {
    check(vp.name, 'run completed', false, String(e).slice(0, 220), 'no throw');
  } finally {
    await context.close();
  }
}

await browser.close();

const pass = results.filter((r) => r.pass).length;
const summary = {
  at: new Date().toISOString(), base, variant, path, label,
  scene: {blob: BLOB, primaries: PRIMARY_IDS, frame: FRAME_IDS, focus: FOCUS_ID},
  pass, total: results.length, results,
};
writeFileSync(join(outDir, `oracles-${label}.json`), JSON.stringify(summary, null, 1));
console.log(`\n${pass}/${results.length} ORACLES PASS  (${label})  ->  ${join(outDir, `oracles-${label}.json`)}`);
process.exit(pass === results.length ? 0 : 1);
