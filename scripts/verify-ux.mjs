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
 *
 * L31 v2.1a — FOUR MORE, AND THEY EXIST BECAUSE THE OLD ONES PRINTED WITHOUT ASSERTING.
 * codex's plan review (codex-plan-review.md §C) classified five numbers this suite reports as
 * PRINTED-ONLY: `area`, `bytes.requests`, bottom/left/right clipping, the field rect, and the
 * dictionary request lane. A number in a template string is not a gate — `check()`'s pass
 * expression is the gate, and every one of those was outside it.
 *
 *  8  AREA          the subject's share of the field, ASSERTED, on the §9 scene and on a BARE
 *                   legacy `?select=` visit. `fill` (oracle 2) stays: it is the aspect-independent
 *                   reading and it is the one that protects thin anatomy. Area is the reading that
 *                   answers Adrian's actual complaint ("the body is tiny in a huge window"), and
 *                   `fill` cannot see it — 72.0% fill at 1440x900 was 9.37% of area.
 *  9  REQUESTS      `bytes.requests <= 4` as its own row (it lived inside oracle 3's `measured`
 *                   string), plus NON-MODEL request STARTS before the barrier — recorded from CDP
 *                   `Network.requestWillBeSent` (scripts/request-ledger.mjs), not from completed
 *                   Resource Timing entries and not from Playwright's own `request` event: an
 *                   in-flight 348 KB dictionary has no timing entry yet, and the driver suppresses
 *                   `/favicon.ico` starts outright (review 6, High 1). A fresh EN visit must not fetch a Chinese dictionary
 *                   before the palette would open; a zh visit keeps its entry load.
 * 10  SAFE RECT     EVERY intended frame member is DRAWN, and the union fits the declared safe
 *                   rectangle on all four edges rather than only at the top. The load-bearing half
 *                   is the membership check: a member that is absent entirely cannot pull the union
 *                   outside the field, so a union-only reading calls a missing structure "framed".
 * 11  DETENT        no horizontal overflow after each detent transition (peek->half->peek), not
 *                   only in the initial state.
 *
 * DEFERRED ROWS. A row whose target cannot be met by the increment under test is reported as
 * DEFER with its owner, never silently retuned (codex-plan-review.md §C: "Report infeasible
 * targets rather than tuning them silently"). It is excluded from the exit code and listed by
 * name in the summary, and it carries a RATCHET sibling that IS live — so the number cannot
 * quietly get worse while the target waits for its owning commit.
 */
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {encodeScene, normalizeScene, sceneFocusId, sceneFrameIds} from '../app/scene-codec.js';
import {LEDGER_EXCLUSION, attachRequestLedger, rowsByBarrier} from './request-ledger.mjs';

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
  // L31 v2.1a, critic gap 2 (v21-design.md:882): ADRIAN'S ACTUAL WINDOW. Every framing figure
  // in the design was computed at 1440x900; the screenshot he rejected was 1920x860, where the
  // field is wider and SHORTER, and the fit is height-bound in both paths. The tier that has to
  // answer his complaint was the one tier no oracle ever loaded.
  {name: '1920x860', width: 1920, height: 860, dpr: 1, coarse: false},
  // Critic gap 8 (v21-design.md:918): the >=1180-and-coarse tier — an iPad Pro landscape gets
  // desktop STRUCTURE and a 44 px target floor at the same time. `coarse` widths here were 768
  // and 1024 only, so the one tier that must satisfy both constraints was never measured.
  {name: '1366x1024', width: 1366, height: 1024, dpr: 2, coarse: true},
];

/** THE BARE LEGACY FIXTURE (codex-plan-review.md §C: "Add bare legacy fixtures"). No blob, no
 *  scene — the plain `?select=` visit that is
 *  (a) the shape of Adrian's rejected screenshot, and
 *  (b) the only path on which `synthesize()` returns early (app/url-state.ts:108), so `plate` is
 *      null, no focus fit is armed, and the DEFAULT fit's literal distance 4 (app/scene.tsx:278)
 *      is what draws the picture.
 *  FMA7485 is the sternum: three meshes, near the body centre, so a framing number taken on it is
 *  about the CAMERA and not about a limb hanging off the edge of a bounding box. */
const BARE_ID = 'FMA7485';
const BARE_EN = 'sternum';

/** `UX_VIEWPORTS=390x844,1920x860` runs a subset. The full sweep is six viewports x two pages and
 *  takes minutes; iterating on ONE failing viewport should not cost the other five. The default is
 *  every viewport, so a plain invocation is still the whole contract. */
const ONLY = (process.env.UX_VIEWPORTS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const SWEEP = ONLY.length ? VIEWPORTS.filter((v) => ONLY.includes(v.name)) : VIEWPORTS;
if (!SWEEP.length) { console.error(`UX_VIEWPORTS matched none of: ${VIEWPORTS.map((v) => v.name).join(', ')}`); process.exit(2); }

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
/**
 * One row. `defer` names the COMMIT that owns the target when the target is not reachable by the
 * increment under test: the row still runs, still prints its measured value, and is listed in the
 * summary — it just does not fail the build. That is the honest shape for a number whose fix is
 * out of scope; retuning the threshold to whatever the app currently does would delete the finding.
 */
const check = (viewport, oracle, pass, measured, want, defer) => {
  const state = pass ? 'pass' : defer ? 'defer' : 'fail';
  results.push({viewport, oracle, pass: !!pass, state, measured, want, ...(defer ? {defer} : {})});
  const tag = state === 'pass' ? 'PASS' : state === 'defer' ? 'DEFER' : 'FAIL';
  console.log(`${tag}  [${viewport}] ${oracle} :: measured=${measured}${want ? ` want=${want}` : ''}${defer ? ` owner=${defer}` : ''}`);
};

/**
 * WAIT FOR THE MARGIN TO STOP MOVING — never a fixed sleep.
 *
 * MEASURED FLAKE, 2026-09-09: the reachability rows failed at 390x844 with all six controls at
 * y=854 on an 844-tall viewport, and passed when the same viewport was run alone. y=854 is where
 * those controls sit while `.v2-margin`'s `max-height` transition (220 ms, v2.css:140) is still
 * expanding — so a 400 ms sleep is enough on an idle host and not enough when five other viewports
 * and a swiftshader renderer have been running ahead of it. The oracle was reading a layout that
 * existed for one frame, and the reported defect was the driver's.
 *
 * So: wait for the DETENT to be what was asked for, then for the margin's height to be the same on
 * two consecutive readings. Both waits are bounded and both fail soft — a timeout leaves the
 * assertion to measure whatever is there and report it, which is a red row rather than a hang.
 */
const settleMargin = async (pg, wantDetent) => {
  if (wantDetent) {
    await pg.waitForFunction((w) => document.querySelector('.v2')?.dataset.detent === w, wantDetent, {timeout: 5000}).catch(() => {});
  }
  await pg.evaluate(() => { delete window.__marginH; });
  await pg.waitForFunction(() => {
    const el = document.querySelector('.v2-margin');
    if (!el) return true;
    const h = Math.round(el.getBoundingClientRect().height);
    const previous = window.__marginH;
    window.__marginH = h;
    return previous === h;
  }, null, {timeout: 5000, polling: 120}).catch(() => {});
};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

/**
 * A FRESH PROFILE per pass, and that is load-bearing rather than tidy. The §9 fixture declares
 * `lang:'zh-Hans'`, and applying a scene writes `localStorage['atlas.lang']` (app/v2/page.tsx:255)
 * — which v1 shares. So a bare EN visit made in the same context would open in Chinese, and the
 * "a fresh EN visit fetches no Chinese dictionary" assertion would measure the previous fixture's
 * side effect instead of the entry it names.
 */
/**
 * THE REQUEST LEDGER LIVES IN `scripts/request-ledger.mjs`, AND IT READS THE PROTOCOL.
 *
 * Round 5 moved it out of the page and onto Playwright's `context.on('request')`. Round 6 found the
 * hole in THAT: Playwright 1.55.1 suppresses `/favicon.ico` starts before the context event exists
 * (network.js:122 + frames.js:229), so seventeen starts arrive as sixteen rows and a `<= 16` bound
 * passes on a page that issued seventeen — while the gate's own stated population names the
 * favicon. `Network.requestWillBeSent` is emitted by the browser, upstream of every driver-side
 * filter, so it sees the suppressed request; and its `wallTime` is ISSUANCE-side rather than
 * driver-receipt-side. Playwright's lane is kept beside it as an UNASSERTED cross-check.
 *
 * Both clocks, the barrier's conservative lateness and the `data:`/`blob:` exclusion are documented
 * at the top of that module. The exclusion is printed in every row that reads the ledger.
 */
const newContext = async (vp) => {
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
    window.__cls = 0; window.__clsSrc = []; window.__completed = [];
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

    // ⚠️ THE REQUEST LEDGER IS NOT HERE ANY MORE — it is in the DRIVER. See `newContext` below.
    //
    // Four rounds of adversarial review killed the in-page version, and the last finding was fatal
    // rather than fixable (codex review 5, High 1): a page can only observe its OWN fetch/XHR calls
    // at their start. Every other subresource — a script, a stylesheet, an image, a preload — enters
    // Resource Timing only when it COMPLETES, so a seventeenth request that starts before the
    // barrier and is still pending at measurement is INVISIBLE, and a `<= 16` budget passes on a
    // page that made seventeen. codex executed that delivery sequence: 16/pass before the delayed
    // completion, 17/fail after. No amount of in-page bookkeeping can supply a start event the page
    // never receives.
    //
    // It also mis-normalised `fetch(new URL(...))`: the wrapper read `input.url`, which a URL object
    // does not have, so it recorded `location.href` and the real request became a second row —
    // sixteen such fetches counted as thirty-two (review 5, Medium 2).
    //
    // Playwright's `request` event fires when the browser ISSUES a request, for every request, with
    // its real URL, whether or not it ever completes. That is the measurement this row always
    // wanted.
    // EVERY START IS ITS OWN ROW. The first version kept a Map keyed by URL, which collapses
    // repeated requests: twenty retries against one endpoint counted as ONE and could satisfy a
    // request budget while a polling regression ran underneath it (codex review, 2026-09-09,
    // High 5). An append-only ledger cannot do that, and de-duplication is left to the reader that
    // actually wants distinct URLs.
    try {
      new PerformanceObserver((l) => {
        // Kept ONLY as a cross-check that the page is doing what the driver observed; nothing
        // asserts on it. The authoritative ledger is the driver's `request` event.
        // ONLY for names the page never fetched BY HAND. A timestamp window was the first attempt
        // and it was too clever: a fetch start and its Resource Timing `startTime` can differ by
        // more than a millisecond, so the same dictionary was appended twice and "both dictionaries
        // requested" read 3 of 2. This lane exists solely to catch subresources with no JS call
        // behind them (the stylesheet, the module graph), so keying it on absence-from-the-other-
        // lanes is both simpler and exactly its purpose.
        // BY REQUEST IDENTITY, NOT BY URL. Both previous guards discarded on name alone, so twenty
        // Resource Timing entries for one endpoint still collapsed to a single row — codex executed
        // exactly that loop and measured 20 -> 1 (review 2, High 5). An append-only array does not
        // help if the dedupe happens BEFORE the append.
        //
        // A Resource Timing entry and the fetch that caused it are the same request and must not be
        // counted twice; two entries for the same URL at different start times are two requests and
        // must be. `startTime` is the discriminator: entries are distinct instances, and a fetch
        // start recorded by hand sits within a few ms of its own entry.
        // ONE-TO-ONE, NOT A PROXIMITY WINDOW. The 50 ms test searched every recorded row including
        // earlier RESOURCE rows, so it merged genuinely distinct entries whose URLs matched and
        // whose starts happened to be close. codex executed twenty entries for one URL and measured
        // 1 recorded request at 1 ms spacing, 10 at 49 ms and 20 at 50 ms (review 3, High 2) — a
        // burst could satisfy the <=16 budget by arriving quickly, which is precisely backwards.
        //
        // Each Resource Timing entry is one request instance. It is either the completion of a
        // fetch/XHR this ledger already recorded by hand — in which case it consumes THAT ONE row
        // and is not appended — or it is a subresource with no JS call behind it, in which case it
        // is its own row. A resource row is never matched against, so two entries can never collapse.
        for (const e of l.getEntries()) window.__completed.push({name: e.name, at: e.startTime, initiator: e.initiatorType});
      }).observe({type: 'resource', buffered: true});
    } catch { /* no resource timing */ }

    // ⚠️ NOTHING IN AN INIT SCRIPT MAY CAPTURE A DOM NODE. MEASURED HERE, 2026-09-09: an init
    // script's `document.documentElement` is NOT the element the page ends up with —
    // `window.__initRoot === document.documentElement` read **false** after load, so a
    // MutationObserver attached to it watched a discarded `<html>` and reported ZERO mutations
    // while `data-atlas-scene-ready` was demonstrably "1". The first version of this lane timed
    // the barrier that way and silently produced `at === null` at all six viewports — an
    // instrument that fails CLOSED, which is why it was caught, but the same mistake on a `<=`
    // bound would have failed OPEN.
    //
    // `window`-level things DO survive (the fetch wrapper and the PerformanceObserver above both
    // report real values, which is why the failure looked selective). So: patch WINDOW here, and
    // resolve every DOM read at use time from the driver.
    //
    // The barrier timestamp therefore comes from the driver, sampled the moment
    // `waitForSelector(READY_SEL)` resolves. That is a few milliseconds LATE, which counts a
    // little extra in-flight work — a conservative bias for a `<=` bound and for a
    // "no dictionary was requested" assertion, so it cannot manufacture a green.
  });
  return context;
};

/** A page with the ledger already attached. The CDP session must be open BEFORE the first
 *  navigation, or the document request itself is a start no ledger has. */
const newLedgerPage = async (context) => {
  const page = await context.newPage();
  const ledger = await attachRequestLedger(context, page);
  return {page, ledger};
};

for (const vp of SWEEP) {
  const context = await newContext(vp);
  const {page, ledger} = await newLedgerPage(context);
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 160)));

  const url = `${base}${path}?lang=zh-Hans&scene=${BLOB}`;
  try {
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});

    // ── 3 BYTES ────────────────────────────────────────────────────────────────────────────
    let readyMs = null, barrierAt = null;
    try {
      await page.waitForSelector(READY_SEL[variant], {timeout: 240000});
      readyMs = 1;
      // Sampled HERE, in the same turn the marker resolved — see the init-script warning above
      // for why this cannot be read from inside the page's own observer.
      barrierAt = Date.now();
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
    // FROZEN, FINITE AND POSITIVE — not merely "<= the ceiling". A live fallback sum taken before
    // many chunks completed satisfies a ceiling trivially, and zero satisfies it best of all
    // (codex review, 2026-09-09, Medium 6). On v2 the number MUST come from the barrier stamp.
    const bytesValid = Number.isFinite(bytes.encoded) && bytes.encoded > 0 && (variant !== 'v2' || bytes.frozen === true);
    check(vp.name, 'the byte reading is the frozen barrier stamp, not a live sum', bytesValid,
      `encoded=${bytes.encoded} frozen=${bytes.frozen}`, variant === 'v2' ? 'frozen, finite, > 0' : 'finite, > 0');
    check(vp.name, 'bytes before the view is usable', readyMs !== null && bytesValid && bytes.encoded <= BYTE_BUDGET,
      `${bytes.encoded} B / ${bytes.requests} chunk requests${readyMs === null ? ' (readiness marker never appeared)' : ''}`, `<= ${BYTE_BUDGET} B`);
    // ── 9 REQUESTS ─────────────────────────────────────────────────────────────────────────
    // Its own row, tied to the SAME frozen barrier. It used to live inside the string above, and
    // the design quoted it twice as if it were a gate (critic gap 9, v21-design.md:924). On v1
    // the request count is the whole atlas by construction, which is that variant's finding.
    const CHUNK_BUDGET = variant === 'v2' ? 4 : 15;
    check(vp.name, `model chunk requests before the view is usable <= ${CHUNK_BUDGET}`,
      readyMs !== null && bytesValid && bytes.requests > 0 && bytes.requests <= CHUNK_BUDGET,
      `${bytes.requests} chunk requests${bytes.frozen ? ' (frozen at the barrier)' : ' (live sum)'}`, `<= ${CHUNK_BUDGET}`);
    // NON-MODEL REQUESTS BEFORE THE BARRIER. The zh fixture below loads in zh-Hans, so its
    // dictionary request is EXPECTED here — that is the baseline the plan promises to preserve
    // ("Chinese UI already loads dictionaries on entry"). The negative half of this assertion,
    // "a fresh EN visit fetches no Chinese dictionary", is asserted on the bare EN page below,
    // because it is a claim about the EN entry and cannot be made from a zh one.
    const origin = new URL(base).origin;
    // THE ASSERTED LANE IS CDP. `pwRows` is Playwright's own `request` event over the same window,
    // printed beside it and asserted on by nothing: where the two disagree, the difference is what
    // the driver suppressed (a `/favicon.ico` start is the known member — review 6, High 1).
    const startedRows = rowsByBarrier(ledger, barrierAt, origin);
    const pwRows = (ledger.pw ?? [])
      .filter((r) => barrierAt === null || r.at <= barrierAt)
      .filter((r) => !/\/models\/body-/.test(r.url));
    const reqs = {
      at: barrierAt, total: startedRows.length,
      nonModel: startedRows.filter((n) => !/\/models\/body-/.test(n)),
      zhDicts: startedRows.filter((n) => /\/i18n\/zh-/.test(n)),
      // DISTINCT AMONG THE NON-MODEL ROWS, because that is the population the row beside it
      // reports on. The first version counted distinct URLs across EVERY row and printed
      // "9 non-model starts (23 distinct URLs)" — two numbers over different populations,
      // side by side, which is the denominator defect this suite exists to catch.
      distinct: new Set(startedRows.filter((n) => !/\/models\/body-/.test(n))).size,
    };
    // The floor is the entry's own graph: the document, the module chunks, the stylesheet,
    // atlas.json, the favicon, and (in zh) the two dictionaries. 16 is that with headroom; the
    // point of the bound is to catch a NEW eager fetch, not to pin the bundler's chunking.
    // THE FAVICON IS IN THAT POPULATION AND IS NOW ACTUALLY OBSERVED — a `/favicon.ico` start is
    // exactly the row Playwright's event hides, which is why the asserted lane is the protocol.
    check(vp.name, 'non-model requests before the barrier (protocol starts, not completions)',
      reqs.at !== null && reqs.nonModel.length <= 16,
      `${reqs.nonModel.length} non-model starts via CDP [${LEDGER_EXCLUSION}] (${reqs.distinct} distinct URLs), `
      + `${reqs.zhDicts.length} zh dictionaries; playwright cross-check ${pwRows.length} (unasserted)`
      + `${reqs.at === null ? ' (no barrier timestamp)' : ''}`, '<= 16');
    // DISTINCT FILES, because that is what the claim is: there are exactly two dictionaries and both
    // must have been asked for. Counting STARTS here would make a retry look like extra coverage —
    // the retry is visible in the non-model start count above, which is where it belongs.
    const zhDistinct = new Set(reqs.zhDicts).size;
    check(vp.name, 'zh entry still loads BOTH dictionaries on entry (baseline preserved)',
      zhDistinct === 2, `${zhDistinct} distinct zh dictionaries (${reqs.zhDicts.length} starts) by the barrier`, '2 distinct');

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
      // L31 v2.1a, oracle 10: PER MEMBER, not just the union. A member clipped off the left edge
      // while the union stays inside the field is invisible to a union-only reading, and
      // `sceneFrameIds` is precisely the list the camera was TOLD to contain — so "it was told to
      // contain this and it is off screen" is a checkable statement rather than a judgement.
      const members = ids.map((id) => {
        const g = (r.groups || {})[id];
        return g ? {id, drawn: true, left: g.left, right: g.right, top: g.top, bottom: g.bottom, n: g.n} : {id, drawn: false};
      });
      if (!groups.length) return {error: 'no groups drawn', w: r.w, h: r.h, members, fit: r.fit};
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
        members, fit: r.fit,
      };
    }, {ids: FRAME_IDS, fieldSel: FIELD_SEL[variant]});
    check(vp.name, 'framed union fills >= 45% of the field', !framing.error && framing.fill >= 0.45,
      framing.error || `${(framing.fill * 100).toFixed(1)}% (area ${(framing.area * 100).toFixed(2)}%) field ${framing.fw}x${framing.fh}`, '>= 45%');
    check(vp.name, 'no top-edge clipping', !framing.error && framing.touchesTop === false,
      framing.error || `touchesTop=${framing.touchesTop} touchesBottom=${framing.touchesBottom}`, 'touchesTop=false');

    // ── 8 AREA (was PRINTED-ONLY) ──────────────────────────────────────────────────────────
    // THE TARGET IS DEFERRED AND THE REASON IS MEASURED, NOT ASSUMED. codex-plan-review.md §C
    // asks for `area >= .12` on this scene at 1440x900. Measured on the candidate before any
    // v2.1a change: 21.82% at 390x844, 20.06% at 768x1024, 12.38% at 1024x768 and **9.37% at
    // 1440x900** — so the target is already unmet at the one viewport it names, and the cause is
    // structural rather than a tuning error: the focus fit's distance is
    // `max(size.y*h/availableHeight, size.x*w/availableWidth/aspect, size.z)` (app/scene.tsx:429),
    // which for a standing human is always the HEIGHT term, so widening the field lowers area
    // while `fill` stays flat. Closing it means giving the width to panels and framing the
    // selection — v2.1b's shell (C3), explicitly out of this session's scope. So the row runs,
    // prints and is owned by C3; the RATCHET below is the live gate that keeps it from getting
    // worse in the meantime.
    const AREA_TARGET = 0.12;
    check(vp.name, `subject area >= ${(AREA_TARGET * 100).toFixed(0)}% of the field (§9 scene)`,
      !framing.error && framing.area >= AREA_TARGET,
      framing.error || `${(framing.area * 100).toFixed(2)}% of a ${framing.fw}x${framing.fh} field`,
      `>= ${(AREA_TARGET * 100).toFixed(0)}%`, 'C3 (shell + fit-to-selection)');
    // THE RATCHET. Baselined from the pre-v2.1a candidate run on this same fixture, minus one
    // percentage point. The tolerance is for CAMERA SETTLING, not for the coverage dither: `area`
    // is computed from projected bounding boxes and never reads a pixel, so the alphaHash dither
    // cannot move it (codex review, 2026-09-09, Medium 5 — the earlier rationale here named the
    // wrong mechanism). Live, not deferred: C1 and C2 must not move framing at all.
    // MEASURED on the pre-v2.1a candidate at all six viewports (E:/Agentic/.artifacts/L31/v21a/):
    // 21.82 · 20.06 · 12.38 · 9.37 · 6.04 · 11.70 percent. Each floor is that figure minus one
    // percentage point. The 1920x860 and 1366x1024 numbers were GUESSED in the first draft of
    // this line and then replaced with the measurement — a guessed floor is a floor that passes
    // for the wrong reason.
    const AREA_FLOOR = {'390x844': 0.208, '768x1024': 0.190, '1024x768': 0.113, '1440x900': 0.084, '1920x860': 0.050, '1366x1024': 0.107}[vp.name] ?? 0.05;
    check(vp.name, 'subject area has not regressed below the v2.1a entry baseline',
      !framing.error && framing.area >= AREA_FLOOR,
      framing.error || `${(framing.area * 100).toFixed(2)}%`, `>= ${(AREA_FLOOR * 100).toFixed(1)}%`);

    // ── 10 SAFE RECT — every intended frame member, all four edges ──────────────────────────
    // The declared safe rectangle is FIELD_INSET (app/v2/page.tsx:45), the constant the fit is
    // handed. v1 has no declared inset — it measures chrome out of the viewport — so there the
    // rectangle is the field itself and the check degrades to "on screen", which is the only
    // honest form of it for that variant.
    const SAFE = variant === 'v2' ? 14 : 0;
    const clipped = (framing.members ?? []).filter((m) => !m.drawn
      || m.left < -1 || m.top < -1 || m.right > framing.fw + 1 || m.bottom > framing.fh + 1);
    check(vp.name, 'every intended frame member is drawn and on screen',
      !framing.error && (framing.members ?? []).length === FRAME_IDS.length && clipped.length === 0,
      framing.error || `${(framing.members ?? []).filter((m) => m.drawn).length}/${FRAME_IDS.length} drawn${clipped.length ? `, clipped: ${clipped.map((m) => m.id).join(',')}` : ''}`,
      `${FRAME_IDS.length} drawn, none clipped`);
    const outside = (framing.members ?? []).filter((m) => m.drawn
      && (m.left < SAFE || m.top < SAFE || m.right > framing.fw - SAFE || m.bottom > framing.fh - SAFE));
    check(vp.name, `every frame member fits the declared safe rectangle (inset ${SAFE}px, all 4 edges)`,
      !framing.error && outside.length === 0,
      framing.error || (outside.length
        ? outside.map((m) => `${m.id}[${Math.round(m.left)},${Math.round(m.top)},${Math.round(m.right)},${Math.round(m.bottom)}]`).join(' ')
        : `all ${(framing.members ?? []).length} inside ${SAFE}..${framing.fw - SAFE} x ${SAFE}..${framing.fh - SAFE}`),
      '0 outside');
    // WHICH FIT OWNS THE CAMERA (codex-plan-review.md §C: "Correct fit owns camera — MISSING").
    // A passing area figure that came from the DEFAULT fit by luck is a false green; `fit.key` is
    // the focus fit's own change key and is empty when it is not active (app/scene.tsx:144).
    check(vp.name, 'the focus fit owns the camera on a scene link',
      !framing.error && !!framing.fit?.key && framing.fit.focus > 0,
      framing.error || `fit.key=${framing.fit?.key ? 'set' : 'EMPTY'} focus=${framing.fit?.focus} frame=${framing.fit?.frame}`,
      'a non-empty fit key and focus > 0');

    // ── 2b THE ANGLE THE LINK ASKED FOR ────────────────────────────────────────────────────
    // ADDED AFTER LOOKING AT A SCREENSHOT THAT PASSED EVERY OTHER ORACLE. The scene declares
    // `camera.view:'side'`; v2's first build applied the scene's camera only on a hashchange, so
    // a cold chat link opened on a THREE-QUARTER view of the whole body — correctly framed,
    // correctly titled, correct bytes, and the wrong picture. Framing is not angle. This is the
    // "correctly sized but wrong" case the P0 gate asked the reviewer to invent, and it was real.
    const angle = await page.evaluate(() => {
      const g = window.__atlasTargets([]);
      const dx = g.camera.x - g.camera.tx, dy = g.camera.y - g.camera.ty, dz = g.camera.z - g.camera.tz;
      const n = Math.hypot(dx, dy, dz) || 1;
      return {x: dx / n, y: dy / n, z: dz / n};
    });
    // side ⇒ the camera sits on +X looking down the body's left-right axis; anything else means
    // the view was dropped. Tolerance is generous — this separates AXES, not degrees.
    check(vp.name, 'camera is on the axis the scene asked for (view: side)',
      angle.x > 0.9 && Math.abs(angle.z) < 0.3,
      `direction (${angle.x.toFixed(2)}, ${angle.y.toFixed(2)}, ${angle.z.toFixed(2)})`, 'x > 0.9, |z| < 0.3');

    // ── 4 CLS ──────────────────────────────────────────────────────────────────────────────
    const cls = await page.evaluate(() => ({v: window.__cls ?? null, src: window.__clsSrc ?? []}));
    check(vp.name, 'CLS through entry', cls.v !== null && cls.v < 0.001,
      `${cls.v}${cls.src.length ? ' from ' + cls.src.slice(0, 4).join(', ') : ''}`, '< 0.001');

    // ── 6 OVERFLOW ─────────────────────────────────────────────────────────────────────────
    const overflow = await page.evaluate(() => ({s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth}));
    check(vp.name, 'no horizontal scroll', overflow.s === overflow.c, `scrollWidth=${overflow.s} clientWidth=${overflow.c}`, 'equal');

    // ── 11 DETENT TRANSITIONS ──────────────────────────────────────────────────────────────
    // The old row inspected the INITIAL state only (codex-plan-review.md §C). The phone's two
    // detents are the thing v2.1b's shell is most likely to break, and the margin only reveals
    // its contents at HALF — so the wider rows (the views group, the set list, the search field)
    // have never been measured for overflow at all.
    //
    // MOUSE AT COORDINATES, never page.click: the L31 lesson (worklog "L31 v2 P0+P1") is that a
    // Playwright click retargets to the element's box and can miss a fixed overlay, so the drive
    // is a real pointer at a real point.
    const detents = [];
    if (variant === 'v2') {
      const handle = await page.$('.v2-handle');
      for (const step of ['half', 'peek']) {
        let measured = 'handle absent';
        if (handle) {
          const box = await handle.boundingBox();
          if (box) {
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
            await page.mouse.down(); await page.mouse.up();
            // Same settle-wait as the reachability rows: an overflow measurement taken while the
            // margin is still expanding is a measurement of a layout that lasts one frame.
            await settleMargin(page, step);
          }
        }
        const o = await page.evaluate(() => ({
          s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth,
          detent: document.querySelector('.v2')?.dataset.detent ?? null,
          handle: !!document.querySelector('.v2-handle') && getComputedStyle(document.querySelector('.v2-handle')).display !== 'none',
        }));
        // THE TRANSITION MUST HAVE HAPPENED. Checking only overflow meant a phone that opens to
        // half and cannot collapse still passed the "transition to peek" row — and deleting the
        // drive entirely left both rows green (codex review, 2026-09-09, High 6). Where there is no
        // handle (>=768, where the margin is a column) there is no transition to make, and the row
        // says so instead of claiming one succeeded.
        const applicable = o.handle;
        const reached = !applicable || o.detent === step;
        measured = applicable
          ? `detent=${o.detent} (wanted ${step}) scrollWidth=${o.s} clientWidth=${o.c}`
          : `not applicable: no detent handle at this width (detent=${o.detent}, margin is a column)`;
        detents.push({step, applicable, ok: reached && o.s === o.c, measured});
      }
      // At >=768 the handle is display:none by design (v2.css:229) and there are no detents to
      // transition — the margin is a column. `boundingBox()` returns null there, so the loop
      // measures the same state twice, which is the correct no-op rather than a skip.
      for (const d of detents) {
        check(vp.name, d.applicable
          ? `the margin reaches ${d.step} and stays free of horizontal scroll`
          : `detent transition to ${d.step} is not applicable at this width`,
        d.ok, d.measured, d.applicable ? `detent=${d.step}, no overflow` : 'n/a');
      }
    }

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

  // ══ PASS B — THE BARE EN LEGACY VISIT ═════════════════════════════════════════════════════
  // A separate profile and a separate page, because three of the assertions below are about the
  // ENTRY and cannot be made from a page that has already applied a scene: the default fit
  // (no blob ⇒ `synthesize()` returns early ⇒ no plate ⇒ distance 4), the reachability of the
  // desktop controls with NO selection, and the dictionary lane on a fresh English visit.
  const bareCtx = await newContext(vp);
  const {page: barePage, ledger: bareLedger} = await newLedgerPage(bareCtx);
  const bareErrors = [];
  barePage.on('console', (m) => { if (m.type() === 'error') bareErrors.push(m.text().slice(0, 160)); });
  barePage.on('pageerror', (e) => bareErrors.push('pageerror: ' + String(e).slice(0, 160)));
  try {
    await barePage.goto(`${base}${path}?select=${BARE_ID}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    let bareReady = false;
    try { await barePage.waitForSelector(READY_SEL[variant], {timeout: 240000}); bareReady = true; } catch { /* recorded below */ }
    await barePage.waitForTimeout(4000);

    // ── the dictionary lane, NEGATIVE half ───────────────────────────────────────────────────
    // Critic gap 9 / codex-plan-review.md §C. Today the palette is a margin panel rather than a
    // ⌘K overlay, so "before the palette would open" is "before any Find interaction" — which is
    // the state this page is in. The assertion is therefore exact now and stays exact when
    // v2.1b replaces the panel with the palette.
    const bareOrigin = new URL(base).origin;
    // No barrier on this pass: every row so far, from the protocol ledger.
    const bareStarted = rowsByBarrier(bareLedger, null, bareOrigin);
    const barePw = (bareLedger.pw ?? []).length;
    const bareReqs0 = await barePage.evaluate(() => {
      // The ledger is an APPEND-ONLY ARRAY of {name, at, via} — not a Map. The first version of this
      // reader called `.keys()` on it, got integer indices, and threw `n.replace is not a function`
      // inside the evaluate, which aborted the entire bare pass: 35 rows vanished from the sweep and
      // the totals simply got smaller. Caught by comparing the row count against the previous run.
      return {lang: document.documentElement.lang};
    });
    const bareReqs = {
      lang: bareReqs0.lang,
      zh: bareStarted.filter((n) => /\/i18n\/zh-/.test(n)),
      total: bareStarted.length,
    };
    check(vp.name, 'a fresh EN visit requests NO Chinese dictionary before the palette opens',
      bareReqs.lang === 'en' && bareReqs.zh.length === 0,
      `lang=${bareReqs.lang}, ${bareReqs.zh.length} zh dictionary requests of ${bareReqs.total} total CDP starts `
      + `[${LEDGER_EXCLUSION}]; playwright cross-check ${barePw} (unasserted)`, '0');

    // ── bare framing: the DEFAULT fit, which is the picture Adrian rejected ───────────────────
    const bareFrame = await barePage.evaluate(({id, fieldSel}) => {
      const get = window.__atlasTargets;
      if (!get) return {error: 'no __atlasTargets'};
      const r = get([id]);
      const g = (r.groups || {})[id];
      if (!g) return {error: 'the selected structure is not drawn', w: r.w, h: r.h, fit: r.fit};
      const el = document.querySelector(fieldSel);
      return {
        w: r.w, h: r.h, left: g.left, right: g.right, top: g.top, bottom: g.bottom, n: g.n, fit: r.fit,
        fill: Math.max((g.right - g.left) / r.w, (g.bottom - g.top) / r.h),
        area: ((g.right - g.left) * (g.bottom - g.top)) / (r.w * r.h),
        fieldRect: el ? {w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height)} : null,
      };
    }, {id: BARE_ID, fieldSel: FIELD_SEL[variant]});
    // DEFERRED, with the same discipline as the §9 area row above: codex-plan-review.md §C sets
    // 30% for a bare selection, and the number this fixture returns today is the literal
    // `normalDistance = 4` at app/scene.tsx:278 — a constant that ignores both the field aspect
    // and the subject. Closing it is v2.1b's fit-to-selection lever, not C1's, so the row prints
    // its measurement and names its owner instead of being retuned to whatever it happens to be.
    check(vp.name, 'bare selection area >= 30% of the field',
      !bareFrame.error && bareFrame.area >= 0.30,
      bareFrame.error || `${(bareFrame.area * 100).toFixed(2)}% (fill ${(bareFrame.fill * 100).toFixed(1)}%) field ${bareFrame.w}x${bareFrame.h}`,
      '>= 30%', 'C3 (fit-to-selection)');
    check(vp.name, 'the bare selection is drawn at all', !bareFrame.error && bareFrame.n > 0,
      bareFrame.error || `${bareFrame.n} meshes projected`, '> 0');
    // THE BARE RATCHET. The 30% target is deferred to C3, but without a floor the bare subject
    // could shrink to nothing while still reporting a positive mesh count and an empty fit key, and
    // the suite would stay green (codex review, 2026-09-09, Medium 5). Measured on the pre-v2.1a
    // candidate: 0.34 / 0.43 / 0.19 / 0.18 / 0.12 / 0.22 percent; each floor is that, less a fifth.
    const BARE_FLOOR = {'390x844': 0.0027, '768x1024': 0.0034, '1024x768': 0.0015,
      '1440x900': 0.0014, '1920x860': 0.0009, '1366x1024': 0.0017}[vp.name] ?? 0.0008;
    check(vp.name, 'the bare subject has not shrunk below the v2.1a entry baseline',
      !bareFrame.error && bareFrame.area >= BARE_FLOOR,
      bareFrame.error || `${(bareFrame.area * 100).toFixed(3)}%`, `>= ${(BARE_FLOOR * 100).toFixed(3)}%`);
    // WHICH FIT OWNS IT. On a bare legacy visit the DEFAULT fit must own the camera — an empty
    // `fit.key` here is the correct reading, and asserting it makes the C3 change detectable
    // rather than something a future run has to guess at.
    check(vp.name, 'a bare legacy visit is framed by the DEFAULT fit (no focus fit armed)',
      !bareFrame.error && !bareFrame.fit?.key && bareFrame.fit?.focus === 0,
      bareFrame.error || `fit.key=${bareFrame.fit?.key ? 'set' : 'empty'} focus=${bareFrame.fit?.focus}`,
      'an empty fit key');

    // ── DESKTOP REACHABILITY (codex-app-review.md §2 row 1, the first High) ──────────────────
    // Plain entry, no selection: Find, Systems and the four named views must be REACHABLE — a
    // visible rect with a real hit point — without the phone detent handle, which is
    // `display:none` at >=768 (v2.css:229). `display:none` on the scroll container hid all of
    // them behind a control that is not there, and selecting anatomy was the only escape.
    // Reachability, not presence: `elementFromPoint` at the rect's centre is what a finger or a
    // cursor actually resolves, so a control covered by an overlay fails here as it should.
    //
    // THE ASSERTION IS HANDLE-AWARE, and that distinction is the defect itself. On a phone the
    // controls being hidden at PEEK is the DESIGN — the 44 px handle is the affordance, and
    // hiding the half-clipped action row is what keeps the peek height honest (v2.css:150-154).
    // What R:25 reports is that at >=768 the stylesheet hides the scroll container AND the handle
    // (v2.css:154 has no desktop override, v2.css:229 removes the handle), leaving no affordance
    // at all. So: where a handle exists it must itself be reachable and must reveal the controls;
    // where it does not, the controls must already be reachable. Both tiers get a real assertion
    // and neither is asserted against the other's contract.
    if (variant === 'v2') {
      const reachOf = () => barePage.evaluate(() => {
        const wanted = ['Find', 'Systems', 'Three-quarter', 'Front', 'Side', 'Back'];
        const visible = (el) => {
          const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
          return r.width >= 1 && r.height >= 1 && cs.display !== 'none' && cs.visibility !== 'hidden';
        };
        // REACHABLE, not "already under the cursor". A control inside a bounded scroll container
        // (`.v2-margin-scroll`, v2.css:149) can legitimately start below the fold — a finger
        // scrolls to it, and calling that unreachable would report a defect the phone does not
        // have. So bring it into view FIRST and then hit-test. What this still catches is the real
        // thing: a control that cannot be revealed at all because its container is `display:none`
        // (rect 0x0, scrolling changes nothing) or because something is painted over it.
        const reachable = (el) => {
          el.scrollIntoView({block: 'nearest', inline: 'nearest'});
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return {ok: !!hit && (hit === el || el.contains(hit)), hit: hit ? `${hit.tagName.toLowerCase()}.${String(hit.className || '').split(' ')[0]}` : `nothing at (${Math.round(r.x + r.width / 2)},${Math.round(r.y + r.height / 2)})`};
        };
        const handle = document.querySelector('.v2-handle');
        const out = [];
        for (const label of wanted) {
          const el = [...document.querySelectorAll('button')]
            .find((b) => (b.textContent || '').trim() === label || (b.getAttribute('aria-label') || '').trim() === label);
          if (!el) { out.push({label, ok: false, why: 'absent from the DOM'}); continue; }
          if (!visible(el)) {
            const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
            out.push({label, ok: false, why: `not rendered (${Math.round(r.width)}x${Math.round(r.height)} display:${cs.display})`});
            continue;
          }
          const h = reachable(el);
          out.push({label, ok: h.ok, why: `hit ${h.hit}`});
        }
        // THE LAYOUT STATE TRAVELS WITH THE VERDICT. "hit nothing" on its own sent me hunting a
        // defect that was in the driver, not the app; the detent and the scroll port say which.
        const scroll = document.querySelector('.v2-margin-scroll');
        const sr = scroll?.getBoundingClientRect();
        return {
          rows: out,
          handle: handle && visible(handle) ? {...reachable(handle), rect: handle.getBoundingClientRect().toJSON()} : null,
          state: {
            detent: document.querySelector('.v2')?.dataset.detent ?? null,
            scrollPort: sr ? `${Math.round(sr.top)}..${Math.round(sr.bottom)}` : 'absent',
            scrollTop: scroll?.scrollTop ?? null, scrollHeight: scroll?.scrollHeight ?? null,
            viewportH: innerHeight,
          },
        };
      });

      let reach = await reachOf();
      if (reach.handle) {
        // A phone. The handle is the affordance, so IT is what must be reachable — and it must
        // actually work: drive it with a real pointer at a real point (never page.click) and
        // re-read.
        check(vp.name, 'plain entry: the detent handle is reachable (the phone affordance)',
          reach.handle.ok, `hit ${reach.handle.hit}`, 'the handle itself');
        const r = reach.handle.rect;
        await barePage.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
        await barePage.mouse.down(); await barePage.mouse.up();
        await settleMargin(barePage, 'half');
        reach = await reachOf();
      }
      const unreachable = reach.rows.filter((r) => !r.ok);
      // NAMED HONESTLY: this fixture is a BARE LEGACY visit (`?select=`), not a zero-selection one.
      // It is the right fixture — it is the shape of Adrian's screenshot and the path with no scene
      // — but the row used to say "no selection" while navigating with one (codex review,
      // 2026-09-09, Medium 4). The 1100/1179/1180 boundaries that review also asks for belong to
      // v2.1b: this stylesheet's tiers are 768 and 1200, so 1180 is not yet a boundary that exists.
      check(vp.name, `bare legacy entry: Find, Systems and the views are reachable${reach.handle === null ? ' with no handle present' : ' after the handle'}`,
        unreachable.length === 0,
        unreachable.length
          ? `${unreachable.map((r) => `${r.label}: ${r.why}`).join(' | ')} [detent=${reach.state.detent} scrollPort=${reach.state.scrollPort} scrollTop=${reach.state.scrollTop}/${reach.state.scrollHeight} viewportH=${reach.state.viewportH}]`
          : `all ${reach.rows.length} reachable (detent=${reach.state.detent})`,
        '0 unreachable');
    }

    const bareOverflow = await barePage.evaluate(() => ({s: document.documentElement.scrollWidth, c: document.documentElement.clientWidth}));
    check(vp.name, 'no horizontal scroll on a bare entry', bareOverflow.s === bareOverflow.c,
      `scrollWidth=${bareOverflow.s} clientWidth=${bareOverflow.c}`, 'equal');
    if (vp.coarse && variant === 'v2') {
      // The coarse sweep on a state the old suite never loaded. A hidden control makes the 44 px
      // sweep pass VACUOUSLY (codex-plan-review.md §C), so the reachability row above and this one
      // are a pair: revealing the desktop controls is exactly what can introduce a small target.
      const bareTargets = await barePage.evaluate(() => {
        const sel = 'button,a[href],input,select,textarea,[role=button],[role=option],[role=switch],[tabindex]:not([tabindex="-1"])';
        const small = [];
        let total = 0;
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          if (r.width < 1 || r.height < 1) continue;
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
          if (el.closest('[hidden],[aria-hidden="true"]')) continue;
          total += 1;
          if (r.width < 44 || r.height < 44) {
            small.push(`${((el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 20)) || el.className}@${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
        return {total, small};
      });
      check(vp.name, 'bare entry: every interactive target >= 44x44 (coarse pointer)', bareTargets.small.length === 0,
        `${bareTargets.small.length} of ${bareTargets.total} under 44px${bareTargets.small.length ? ': ' + bareTargets.small.slice(0, 5).join(', ') : ''}`, '0');
    }

    await barePage.screenshot({path: join(outDir, `${label}-bare-${vp.name}.png`)});
    check(vp.name, `bare entry reached readiness and logged no console error (${BARE_EN})`,
      bareReady && bareErrors.length === 0,
      `${bareReady ? 'ready' : 'READINESS MARKER NEVER APPEARED'}; ${bareErrors.slice(0, 2).join(' | ') || 'no console errors'}`, 'ready, none');
  } catch (e) {
    check(vp.name, 'bare entry run completed', false, String(e).slice(0, 220), 'no throw');
  } finally {
    await bareCtx.close();
  }
}

await browser.close();

const pass = results.filter((r) => r.state === 'pass').length;
const fail = results.filter((r) => r.state === 'fail');
const deferred = results.filter((r) => r.state === 'defer');

/** PER VIEWPORT AND PER SUITE, because "50/50" was read as a phone figure for months and it was
 *  the SUM over four viewports (codex-plan-review.md §9). A total with no denominator named is
 *  the same defect this suite exists to catch, one level up. */
const byViewport = SWEEP.map((vp) => {
  const rows = results.filter((r) => r.viewport === vp.name);
  return {
    viewport: vp.name, coarse: vp.coarse,
    pass: rows.filter((r) => r.state === 'pass').length,
    fail: rows.filter((r) => r.state === 'fail').length,
    defer: rows.filter((r) => r.state === 'defer').length,
    total: rows.length,
  };
});

const summary = {
  at: new Date().toISOString(), base, variant, path, label,
  scene: {blob: BLOB, primaries: PRIMARY_IDS, frame: FRAME_IDS, focus: FOCUS_ID},
  bare: {id: BARE_ID, en: BARE_EN},
  pass, fail: fail.length, defer: deferred.length, total: results.length,
  byViewport,
  deferred: deferred.map((r) => ({viewport: r.viewport, oracle: r.oracle, measured: r.measured, want: r.want, owner: r.defer})),
  results,
};
writeFileSync(join(outDir, `oracles-${label}.json`), JSON.stringify(summary, null, 1));

console.log('\nPER VIEWPORT');
for (const v of byViewport) {
  console.log(`  ${v.viewport.padEnd(10)} ${String(v.pass).padStart(2)}/${v.total} pass` +
    `${v.fail ? `  ${v.fail} FAIL` : ''}${v.defer ? `  ${v.defer} defer` : ''}${v.coarse ? '  (coarse)' : ''}`);
}
if (deferred.length) {
  console.log(`\nDEFERRED (${deferred.length}) — targets this increment cannot reach; owner named, threshold NOT retuned:`);
  for (const r of deferred) console.log(`  [${r.viewport}] ${r.oracle} :: ${r.measured} want=${r.want} owner=${r.defer}`);
}
if (fail.length) {
  console.log(`\nFAILED (${fail.length}):`);
  for (const r of fail) console.log(`  [${r.viewport}] ${r.oracle} :: ${r.measured} want=${r.want}`);
}
console.log(`\nSUITE ${label}: ${pass} pass · ${fail.length} fail · ${deferred.length} deferred  of ${results.length}` +
  `  ->  ${join(outDir, `oracles-${label}.json`)}`);
process.exit(fail.length === 0 ? 0 : 1);
