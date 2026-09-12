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
import {decodeScene, encodeScene, normalizeScene, sceneFocusId, sceneFrameIds} from '../app/scene-codec.js';
import {POPULATION, attachRequestLedger, populationCheck, rowsByBarrier} from './request-ledger.mjs';

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
/**
 * ── THE FOCUS-LESS SCENE ───────────────────────────────────────────────────────────────────────
 *
 * `scene-codec.js` defaults `camera.focus` to `[]` and only serialises it when non-empty, so a blob
 * naming five structures with no declared focus is legal and round-trips. Until round 3 **no
 * fixture in this suite was one** — the §9 scene declares a focus — so `studioFrame`'s whole path
 * was invisible to all 360 green rows, and the round-2 High that lived there (the ghost pulled into
 * the containment set) had zero coverage. A fixture that cannot reach a branch is not coverage of
 * that branch.
 */
const SCENE_NOFOCUS = normalizeScene({...SCENE_INPUT, camera: {...SCENE_INPUT.camera, focus: []}});
const BLOB_NOFOCUS = encodeScene(SCENE_NOFOCUS);
const GHOST_ID = 'FMA16203';
const FOCUS_ID = sceneFocusId(SCENE);
/** The names the atlas will show. `sceneFocusId` picks the focused primary. */
const EXPECTED_EN = 'left semitendinosus';

/**
 * ⚠️ SCREENSHOT TIMEOUT, RAISED FROM PLAYWRIGHT'S 30 s DEFAULT (L31 v2.1b+c, S1).
 *
 * `[1366x1024] bare entry run completed :: TimeoutError: page.screenshot: Timeout 30000ms exceeded`
 * took down a whole viewport's pass on an otherwise green run. It is the instrument, not the page:
 * 1366x1024 at dpr 2 is a 2732x2048 capture over a live WebGL canvas under SwiftShader, with
 * several other contexts open in the same browser — the largest single image this sweep takes, at
 * its slowest moment.
 *
 * Raised rather than re-rolled. A flaky row that is re-run until it passes is a row nobody trusts,
 * and the alternative (dropping the shot) would remove the picture at the one tier whose screenshots
 * caught a real defect in S0.
 */
const SHOT_MS = 120000;
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
/** ⚠️ TWO SELECTORS FOR v2 SINCE L31 v2.1b+c S0, and the CONTRACT is unchanged: "the visible name of
 *  the structure this link is about". On the phone that is `.v2-term b`. In the studio the term pair
 *  is gone and the same fact is the FIRST SELECTION CARD — the focused primary, first because the
 *  dock is role-ordered. The app bar deliberately shows the scene's CAPTION instead, which is a
 *  different fact and would have made this row assert the wrong thing. `querySelector` takes the
 *  first match of either, and only one of the two exists at any width. */
const TITLE_SEL = {v1: '.detail-sheet .structure-title', v2: '.v2-term b, .v2-card b'};
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
    // ── THE POPULATION GATE, BEFORE THE SNAPSHOT IS CONSUMED ────────────────────────────────
    // codex review 7, High 1: a page-session CDP ledger cannot see an out-of-process child
    // frame's requests, so a page that has one reports a budget over a population it does not
    // measure. Rather than chase every target type (iframe, then workers, then portals, each
    // with its own attach-before-first-request race), the population is NAMED and this row
    // REFUSES the budget when the page leaves it. Run here, and again at the end of the pass,
    // because a child target attaching later invalidates the snapshot retroactively.
    const popAtBarrier = await populationCheck(page, ledger);
    check(vp.name, 'the request budget’s population holds at the barrier (1 frame, no child targets, no service workers)',
      popAtBarrier.ok, popAtBarrier.measured, POPULATION);
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
      `${reqs.nonModel.length} non-model starts via CDP [population: ${POPULATION}] (${reqs.distinct} distinct URLs), `
      + `${reqs.zhDicts.length} zh dictionaries; playwright cross-check ${pwRows.length} (unasserted)`
      + `${reqs.at === null ? ' (no barrier timestamp)' : ''}`, '<= 16');
    // DISTINCT FILES, because that is what the claim is: there are exactly two dictionaries and both
    // must have been asked for. Counting STARTS here would make a retry look like extra coverage —
    // the retry is visible in the non-model start count above, which is where it belongs.
    const zhDistinct = new Set(reqs.zhDicts).size;
    check(vp.name, 'zh entry still loads BOTH dictionaries on entry (baseline preserved)',
      zhDistinct === 2,
      `${zhDistinct} distinct zh dictionaries (${reqs.zhDicts.length} starts) by the barrier [population: ${POPULATION}]`,
      '2 distinct');

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
    /**
     * ── RE-BASELINED AT THE END OF S1 (kickoff item 7 / RC4's closing clause) ──────────────────
     *
     * A ratchet baselined against the OLD behaviour protects nothing once the behaviour improves.
     * The studio floors were 0.084 / 0.050 / 0.107 against measurements that are now 16.27 /
     * 12.69 / 20.91 percent — so a change that reverted S1's framing entirely would have left this
     * row green at all three. The floor is the measured figure less one percentage point, which is
     * the convention the v2.1a line established and the tolerance is for camera settling.
     *
     * The phone and tablet numbers are UNCHANGED (21.82 / 20.06 / 12.38), so their floors are
     * unchanged too — re-deriving them from today's measurement produces the same three values.
     */
    const AREA_FLOOR = {'390x844': 0.208, '768x1024': 0.190, '1024x768': 0.113,
      '1440x900': 0.153, '1920x860': 0.117, '1366x1024': 0.199}[vp.name] ?? 0.05;
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
      /**
       * ⚠️ S3 — CLIPPED OUT OF A SCROLLER IS NOT ON SCREEN. THIS CORRECTS THE MEASUREMENT, NOT THE
       * CLAIM, and the distinction is the whole reason it is written out here.
       *
       * The claim these two rows make is "no VISIBLE target is under 44 px" and "no two VISIBLE
       * targets overlap". The measurement was `getBoundingClientRect()`, which reports where an
       * element WOULD be and knows nothing about an ancestor that clips it — so a row scrolled past
       * the bottom of a `overflow-y:auto` box still reports a rect down there, on top of whatever is
       * drawn below the box.
       *
       * It could not bite before S3: the tree had ONE interactive element per row and fifteen 36 px
       * rows fitted inside their scroller, so nothing was ever clipped. S3's rows are 52/54 px and
       * carry four controls each, so at 1366×1024 the fourteenth system row reported an overlap with
       * the sidebar's "Reset visibility" button — two controls a finger can never confuse, because
       * one of them is not painted at those coordinates at all.
       *
       * NARROW ON PURPOSE: an element is dropped ONLY when its rect lies ENTIRELY outside the client
       * box of a scrolling ancestor. A partially visible control is still measured in full, and a
       * genuinely overlapping pair inside the same scroller is still a defect. Red-proved in
       * `.artifacts/L31/v21bc/s3/clip-rule-proof.txt`: with the rule applied, a deliberately
       * mispositioned control inside the tree still reports its overlap.
       */
      const clippedAway = (el, r) => {
        /**
         * ⚠️ AN ELEMENT WHOSE CONTAINING BLOCK ESCAPES THE SCROLLER IS NOT CLIPPED BY IT — codex
         * round 3, Medium 6. The first version walked every overflow ancestor and assumed each one
         * clips each descendant. A `position:fixed` control is laid out against the VIEWPORT unless
         * an ancestor establishes a fixed containing block (transform / filter / perspective /
         * will-change / contain / backdrop-filter), so it stays visible outside a scroller that the
         * predicate would have said clipped it — and it would then vanish from BOTH the 44 px gate
         * and the overlap gate. codex executed the extracted predicate with an overflow-auto
         * ancestor at (0,200)-(264,500) and a fixed 20x20 button at (20,20): `CLIPPED true`.
         *
         * So the walk stops at the first ancestor that cannot contain this element. `sticky` is
         * deliberately NOT exempt: it is laid out in flow and IS clipped by its scroller.
         */
        /**
         * ⚠️ S3b — TWO CORRECTIONS, BOTH OF WHICH MADE THE GATE DROP VISIBLE CONTROLS (codex round
         * 4, Medium 1). A predicate that over-reports "clipped" is a FALSE GREEN: the element
         * disappears from the 44 px gate AND the overlap gate, so the two rows pass by measuring
         * fewer things.
         *
         * 1. THE FIXED-CONTAINING-BLOCK LIST WAS TOO WIDE. `will-change` and `contain` create one
         *    only for SPECIFIC values. `will-change: opacity` does not; `contain: size` and
         *    `contain: style` do not (only `layout`, `paint`, `strict`, `content` do). The round-3
         *    version accepted `willChange !== 'auto'` and `contain !== 'none'`, so any of those
         *    three made the predicate resume clipping a control that is laid out against the
         *    viewport. codex executed all three: `CLIPPED=true` where the truth is false.
         * 2. AN ANCESTOR'S POSITIONING LIFTS THE WHOLE SUBTREE, not just the element itself. The
         *    walk read only `el`'s own `position`, so a STATIC button inside a `position:fixed`
         *    wrapper — the commonest shape in this app, since every panel is a fixed wrapper full of
         *    static buttons — was treated as in-flow and reported clipped by a scroller it escapes.
         *
         * The walk therefore tracks the LAYOUT MODE of the subtree it is climbing out of, and
         * updates it at each ancestor. `sticky` is still deliberately not exempt: it is laid out in
         * flow and IS clipped by its scroller.
         */
        const FIXED_CB_WILLCHANGE = /(^|,|\s)(transform|perspective|filter|backdrop-filter|contain)(\s|,|$)/;
        const FIXED_CB_CONTAIN = /(^|\s)(layout|paint|strict|content)(\s|$)/;
        const fixedCB = (p) => {
          const pcs = getComputedStyle(p);
          return pcs.transform !== 'none' || pcs.perspective !== 'none' || pcs.filter !== 'none'
            || pcs.backdropFilter !== 'none'
            || FIXED_CB_WILLCHANGE.test(pcs.willChange || '')
            || FIXED_CB_CONTAIN.test(pcs.contain || '');
        };
        /** An absolutely positioned box is contained by the nearest POSITIONED ancestor — or by
         *  anything that would contain a fixed one. */
        const absCB = (p) => getComputedStyle(p).position !== 'static' || fixedCB(p);
        let mode = getComputedStyle(el).position;   // 'fixed' | 'absolute' | anything in-flow
        for (let p = el.parentElement; p; p = p.parentElement) {
          if (mode === 'fixed') {
            if (!fixedCB(p)) continue;              // laid out against the viewport: p cannot clip it
            mode = 'static';                        // p IS its containing block; clipping resumes
          } else if (mode === 'absolute') {
            if (!absCB(p)) continue;
            mode = 'static';
          }
          const pcs = getComputedStyle(p);
          if (/(auto|scroll|hidden)/.test(pcs.overflowY + pcs.overflowX)) {
            const pr = p.getBoundingClientRect();
            if (r.bottom <= pr.top || r.top >= pr.bottom || r.right <= pr.left || r.left >= pr.right) return true;
          }
          // p's OWN positioning decides how the subtree is laid out relative to everything above p.
          if (pcs.position === 'fixed') mode = 'fixed';
          else if (pcs.position === 'absolute') mode = 'absolute';
        }
        return false;
      };
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
        if (el.closest('[hidden],[aria-hidden="true"]')) continue;
        if (clippedAway(el, r)) continue;
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
        // ⚠️ THE PROBE MUST LAND ON A REAL TEXT ROW, AND IT MUST SAY WHICH ONE.
        //
        // This selector was `h1, .structure-title, .v2-term b` with `|| document.body`. The studio
        // renders neither an `h1` nor a `.v2-term` — the shell replaced both — so at 1440 / 1920 /
        // 1366 the probe silently fell through to `body`. A probe that measures `body` at three of
        // six viewports is measuring the wrong ELEMENT, whatever it then concludes: the guard exists
        // to prove the app's own text rows resolve the forked stack, and at those widths it was not
        // looking at one (stand-in review H2).
        //
        // ⚠️ WHAT IT IS **NOT**: a tier-sensitivity test. `v2.css` sets `font-family` on `body` from
        // `--v2-font-cjk`, which forks by `html:lang()` — by SCRIPT, never by width — so the measured
        // stack is byte-identical at every viewport BOTH BEFORE AND AFTER this fix, by design. An
        // earlier version of this comment claimed that identical reading was the tell; it was not,
        // and reasoning from it would send the next reader looking for a width dependency that has
        // never existed (round 2, M2 — the same species as the provenance claim round 1 found in
        // plate-goldens.mjs). The real gain is narrower and worth having: the guard now goes red if
        // the shell's text rows are ever renamed out from under it, instead of silently retargeting
        // `body` and passing.
        //
        // So: the studio's own rows are in the selector, and WHICH element matched is reported and
        // asserted. `body` is still the last resort — but reaching it is now a visible fact.
        const SEL = 'h1, .structure-title, .v2-term b, .v2-bar-text b, .v2-tree-name, .v2-card b';
        const el = document.querySelector(SEL) || document.body;
        const matched = el === document.body ? 'BODY (fell through — the probe found no text row)'
          : `${el.tagName.toLowerCase()}.${String(el.className || '').split(' ')[0] || '(no class)'}`;
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
        return {stack, matched, text, distinct, chars: sigs.length, inked};
      }, script);
      // THE PROBE'S OWN LANDING SITE IS AN ASSERTION NOW. Without it the rows below measure whatever
      // `body` happens to resolve, at three of six viewports, while reading as though they had
      // measured the app (stand-in review H2). This says which element they actually read.
      // ⚠️ It does NOT make the measurement tier-sensitive — the stack forks by script, not by
      // width, so the stack string is identical at every viewport by design. See the note above.
      check(vp.name, `${script}: the font probe landed on a real text row, not on <body>`,
        typeof font.matched === 'string' && !font.matched.startsWith('BODY'),
        `matched ${font.matched}`, 'a text element');
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

    await page.screenshot({path: join(outDir, `${label}-${vp.name}.png`), timeout: SHOT_MS});
    // AND AGAIN AT THE END. A child target that attaches after the barrier snapshot invalidates
    // the budget row above retroactively — the number was taken over a population the page had
    // already left. Checking only at the barrier would be a gate that closes before the hazard.
    const popAtEnd = await populationCheck(page, ledger);
    check(vp.name, 'the population still holds at the END of the pass (no child target attached later)',
      popAtEnd.ok, popAtEnd.measured, POPULATION);
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
    // Critic gap 9 / codex-plan-review.md §C. The palette IS the ⌘K overlay as of S2, so "before
    // the palette opens" is now literal rather than anticipatory: the effect that fetches is keyed
    // on `open` (find.tsx), and this page has not opened it. The POSITIVE half — both lanes arrive
    // on the first open — follows immediately below, because a negative alone is satisfied by a
    // palette that never loads a dictionary at all.
    const bareOrigin = new URL(base).origin;
    // The same population gate, because this pass consumes the same kind of ledger and makes a
    // NEGATIVE claim from it ("no Chinese dictionary was requested"). An absence measured over an
    // unknown population is the weakest reading in the suite, so it gets the gate first.
    const barePop = await populationCheck(barePage, bareLedger);
    check(vp.name, 'bare entry: the population holds before the ledger is read', barePop.ok, barePop.measured, POPULATION);
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
      + `[population: ${POPULATION}]; playwright cross-check ${barePw} (unasserted)`, '0');

    /**
     * ── the dictionary lane, POSITIVE half (S2) ──────────────────────────────────────────────
     *
     * ⚠️ THE NEGATIVE ROW ABOVE IS SATISFIED BY A PALETTE THAT NEVER LOADS ANYTHING. "Zero Chinese
     * dictionaries were requested" is exactly what a broken cross-script search looks like from the
     * ledger, and it is also what a palette that fails to open looks like. Measured alone it is the
     * weakest kind of green — an absence with no control arm.
     *
     * So the same page, with the same ledger, now OPENS the palette and the requests are counted
     * again. Both lanes must arrive, on an interface that is still English: that is the whole
     * cross-script claim expressed as network traffic, and it is the row that makes the absence
     * above mean "deferred" rather than "absent".
     */
    // ⚠️ v2 ONLY. The palette is v2's; pressing Ctrl+K on v1 opens nothing, so an unguarded row
    // here would report a RED against a page that was never claimed to have the feature — the
    // mirror image of the vacuous green the negative row above would give on its own.
    if (variant === 'v2') {
    await barePage.keyboard.down('Control');
    await barePage.keyboard.press('KeyK');
    await barePage.keyboard.up('Control');
    // Generous: two dictionaries at ~348 KB over a cold local server, plus the render.
    await barePage.waitForTimeout(3500);
    const afterOpen = rowsByBarrier(bareLedger, null, bareOrigin);
    const zhAfter = afterOpen.filter((n) => /\/i18n\/zh-/.test(n));
    const zhDistinctAfter = new Set(zhAfter.map((n) => n.replace(/^.*\/i18n\//, ''))).size;
    const paletteOpen = await barePage.evaluate(() => ({
      open: !!document.querySelector('.v2-modal.is-find'),
      lang: document.documentElement.lang,
    }));
    check(vp.name, 'and Ctrl+K THEN loads both dictionaries — the deferral is a deferral, not an absence',
      paletteOpen.open && paletteOpen.lang === 'en' && zhDistinctAfter === 2,
      `palette open=${paletteOpen.open}, lang=${paletteOpen.lang}, `
      + `${zhDistinctAfter} distinct zh dictionaries after the open (${zhAfter.length} starts), `
      + `${afterOpen.length - bareReqs.total} new CDP starts in total`,
      'open, lang=en, 2 distinct dictionaries');

    /**
     * ── THE CROSS-SCRIPT ROW, IN THE ONLY CONTEXT THAT CAN CARRY IT ─────────────────────────────
     *
     * ENGLISH interface (measured above: `lang=en`, and nothing has written `atlas.lang`), Chinese
     * query. A matcher that consulted only the active language's dictionary returns zero rows here
     * and looks exactly like a typo.
     *
     * THE SECOND HALF IS THE ONE THAT MATTERS: the RENDERED row must contain 胸骨体. "More than
     * zero results" passes on a palette that found the structure and then showed the reader an
     * English name with no visible reason to be in the list — which is the gap `t.alt` was added
     * for in v2.1a, and it is invisible in a screenshot unless you read Chinese.
     *
     * Every row is scanned, not the first six: ranking puts the exact match (胸骨 = Sternum) first,
     * so 胸骨体 is legitimately further down and a head-of-list check would fail on correct output.
     */
    await barePage.keyboard.type('胸骨');
    await barePage.waitForTimeout(800);
    const enCross = await barePage.evaluate(() => {
      const rows = [...document.querySelectorAll('.v2-find-list .v2-result')];
      const input = document.querySelector('.v2-find input');
      return {
        lang: document.documentElement.lang,
        // THE INPUT'S OWN VALUE. Without it this row cannot tell "the query found nothing" from
        // "the keystrokes never reached the field" — which is exactly the defect the autofocus fix
        // was for, and the reason it survived a green oracle once already.
        typed: input?.value ?? null,
        focused: document.activeElement === input,
        n: rows.length,
        body: rows.map((r) => r.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /胸骨体|胸骨體/.test(t)).slice(0, 2),
        first: rows[0]?.textContent.replace(/\s+/g, ' ').trim() ?? null,
      };
    });
    check(vp.name, 'the palette autofocuses its INPUT, so a reader can type without clicking first',
      enCross.focused && enCross.typed === '胸骨',
      `activeElement is the input=${enCross.focused}, input value="${enCross.typed}"`,
      'focused, and the query landed in it');
    check(vp.name, 'in an ENGLISH interface, 胸骨 returns matches AND a row shows the 胸骨体 it matched',
      enCross.lang === 'en' && enCross.n >= 1 && enCross.body.length >= 1,
      `lang=${enCross.lang}, ${enCross.n} rows, first: ${enCross.first ?? '(none)'}; 胸骨体 row: ${enCross.body[0] ?? 'ABSENT'}`,
      'lang=en, >= 1 row, and 胸骨体 rendered');
    await barePage.screenshot({path: join(outDir, `${label}-find-en-${vp.name}.png`), timeout: SHOT_MS});
    await barePage.keyboard.press('Escape');
    await barePage.waitForTimeout(300);
    }

    // ── bare framing: the DEFAULT fit, which is the picture Adrian rejected ───────────────────
    const bareFrame = await barePage.evaluate(({id, fieldSel}) => {
      const get = window.__atlasTargets;
      if (!get) return {error: 'no __atlasTargets'};
      const r = get([id]);
      const g = (r.groups || {})[id];
      if (!g) return {error: 'the selected structure is not drawn', w: r.w, h: r.h, fit: r.fit};
      const el = document.querySelector(fieldSel);
      return {
        // WHICH TIER IS ACTUALLY RENDERING, read off the DOM rather than assumed from the width.
        // The RC3 assertion below forks on it, so a viewport that silently stopped being the
        // studio would otherwise fall back to the WEAKER pre-S1 assertion and pass — a fork on an
        // unverified condition is a fork that hides the defect it was written to catch.
        studio: !!document.querySelector('.v2.v2-studio'),
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
    /**
     * ── RE-BASELINED AT THE END OF S1, and this one was the worse of the two ───────────────────
     *
     * The studio floors were 0.0014 / 0.0009 / 0.0017 — a fifth off the pre-v2.1a figures of
     * 0.20 / 0.15 / 0.25 PERCENT. Today those viewports measure 33.59 / 26.20 / 43.15 percent, so
     * the ratchet would have tolerated a COMPLETE revert of fit-to-selection, at every studio
     * width, without going red: a ratchet holding nothing at all. Re-derived by the same rule as
     * before (the measurement, less a fifth). Phone and tablet are unchanged and keep their floors.
     */
    const BARE_FLOOR = {'390x844': 0.0027, '768x1024': 0.0034, '1024x768': 0.0015,
      '1440x900': 0.268, '1920x860': 0.209, '1366x1024': 0.345}[vp.name] ?? 0.0008;
    check(vp.name, 'the bare subject has not shrunk below the v2.1a entry baseline',
      !bareFrame.error && bareFrame.area >= BARE_FLOOR,
      bareFrame.error || `${(bareFrame.area * 100).toFixed(3)}%`, `>= ${(BARE_FLOOR * 100).toFixed(3)}%`);
    /**
     * WHICH FIT OWNS IT — AND THIS IS THE ONE NAMED CHECK IN THE SUITE WHOSE POLARITY CHANGES.
     *
     * Until S1 this row asserted that a bare legacy visit is framed by the DEFAULT fit: an EMPTY
     * `fit.key` and `focus === 0` were the correct reading, everywhere. That was a faithful
     * description of the product and it was also a description of the defect — the default fit's
     * literal `distance = 4` is why a shared `?select=` link opened with its structure at 0.15% of
     * a 1920-wide field.
     *
     * S1 inverts it IN THE STUDIO TIER ONLY (opus-plan-review-2.md RC3, codex-plan-review.md §C):
     * at >=1180 a bare `?select=` now arms the focus fit against the selection, so the correct
     * reading there is a NON-EMPTY key with `focus > 0`. v1 and the phone/tablet keep the original
     * assertion verbatim, because their framing is unchanged and an oracle that relaxed everywhere
     * to accommodate one tier would stop protecting the others.
     *
     * ⚠️ CONSEQUENCE, AND IT IS A USER-VISIBLE ONE: a bare `?select=` link opened on a desktop now
     * arrives ZOOMED TO THE STRUCTURE rather than showing the whole standing figure. That is the
     * point — but it is a change to what an existing link does, so it is called out in the S1
     * #coord post rather than left for Adrian to discover.
     */
    const studioBare = variant === 'v2' && bareFrame.studio === true;
    check(vp.name, studioBare
      ? 'a bare legacy visit is framed by the FOCUS fit (studio: fit-to-selection on entry)'
      : 'a bare legacy visit is framed by the DEFAULT fit (no focus fit armed)',
      !bareFrame.error && (studioBare
        ? !!bareFrame.fit?.key && bareFrame.fit?.focus > 0
        : !bareFrame.fit?.key && bareFrame.fit?.focus === 0),
      bareFrame.error || `tier=${bareFrame.studio ? 'studio' : 'phone/tablet'} fit.key=${bareFrame.fit?.key ? 'set' : 'empty'} focus=${bareFrame.fit?.focus}`,
      studioBare ? 'a non-empty fit key and focus > 0' : 'an empty fit key');
    // THE CONTROL ARM for the fork above: the tier the fork READ must be the tier this viewport
    // IS. Without it, a studio viewport that stopped applying `.v2-studio` would quietly take the
    // phone branch and report a pass for the wrong product.
    if (variant === 'v2') {
      const wantStudio = vp.width >= 1180;
      check(vp.name, 'the bare page renders the tier this viewport is supposed to be',
        bareFrame.studio === wantStudio, `.v2-studio=${bareFrame.studio} at ${vp.width}px`,
        String(wantStudio));
    }

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
        // ⚠️ THE CONTROL NAMES ARE TIER-DEPENDENT AS OF L31 v2.1b+c S0, and the ASSERTION IS NOT.
      // R:25 is "on a plain `/v2/` visit the controls are reachable and work at 1100–1920" — it was
      // never about the string "Systems". At >=1180 the shell replaces the margin's Find/Systems
      // buttons with the tools row's panel toggles and the sidebar; the named views move from the
      // margin into the navigation pill and keep their names. So the studio asks for ITS equivalent
      // set, by the same rule: every control this visit needs, present and hit-testable. This is a
      // RELABELLING of the same requirement, not a relaxation of it — the count goes UP, from six
      // to eight.
      const studio = !!document.querySelector('.v2.v2-studio');
      const wanted = studio
        ? ['Layers', 'Selection', 'Info', 'Find', 'Three-quarter', 'Front', 'Side', 'Back']
        : ['Find', 'Systems', 'Three-quarter', 'Front', 'Side', 'Back'];
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

    const barePopEnd = await populationCheck(barePage, bareLedger);
    check(vp.name, 'bare entry: the population still holds at the END of the pass', barePopEnd.ok, barePopEnd.measured, POPULATION);
    await barePage.screenshot({path: join(outDir, `${label}-bare-${vp.name}.png`), timeout: SHOT_MS});
    check(vp.name, `bare entry reached readiness and logged no console error (${BARE_EN})`,
      bareReady && bareErrors.length === 0,
      `${bareReady ? 'ready' : 'READINESS MARKER NEVER APPEARED'}; ${bareErrors.slice(0, 2).join(' | ') || 'no console errors'}`, 'ready, none');
    /**
     * ══ S2 — THE MIRROR OF THE CROSS-SCRIPT ROW ═══════════════════════════════════════════════
     *
     * The studio pass asserts a CHINESE query in an ENGLISH interface. This is the other direction,
     * and it is not redundant: the two are served by different code. The first relies on the
     * dictionaries being searched at all in EN mode (`makeT` sets `zh = false` there, so `secondary`
     * returns null BY DESIGN and only `alt` can render the pairing). The second relies on the
     * ENGLISH name staying in the key set once a dictionary is loaded — a matcher that replaced the
     * English keys with the Chinese ones would pass the first row and fail this one.
     *
     * `?lang=zh-Hans` is the app's own entry point for a language, so this is the real interface,
     * not `documentElement.lang` poked from outside.
     */
    if (variant === 'v2') {
    await barePage.goto(`${base}${path}?lang=zh-Hans`, {waitUntil: 'domcontentloaded', timeout: 240000});
    try { await barePage.waitForSelector(READY_SEL[variant], {timeout: 240000}); } catch { /* reported by the row */ }
    await barePage.waitForTimeout(2500);
    await barePage.keyboard.down('Control');
    await barePage.keyboard.press('KeyK');
    await barePage.keyboard.up('Control');
    await barePage.waitForTimeout(900);
    await barePage.keyboard.type('gluteus');
    await barePage.waitForTimeout(700);
    const zhSide = await barePage.evaluate(() => {
      const rows = [...document.querySelectorAll('.v2-find-list .v2-result')];
      const input = document.querySelector('.v2-find input');
      return {
        lang: document.documentElement.lang,
        open: !!document.querySelector('.v2-modal.is-find'),
        // Same instrument lesson as the EN row: report what actually reached the field, so a red
        // here names its own cause instead of being read as "the matcher found nothing".
        typed: input?.value ?? null,
        n: rows.length,
        text: rows.slice(0, 4).map((r) => r.textContent.replace(/\s+/g, ' ').trim()),
      };
    });
    // THE SECOND HALF IS THE REAL CLAIM, again: the row must SHOW the English, or a Chinese-speaking
    // reader who typed a Latin word sees a list of Chinese names with no visible reason to trust it.
    const showsEnglish = zhSide.text.some((t) => /gluteus/i.test(t));
    check(vp.name, 'in a 简体 interface, "gluteus" returns matches AND the row shows the English name',
      zhSide.open && zhSide.lang === 'zh-Hans' && zhSide.typed === 'gluteus' && zhSide.n >= 1 && showsEnglish,
      `lang=${zhSide.lang} open=${zhSide.open} typed="${zhSide.typed}" ${zhSide.n} rows; first: ${zhSide.text[0] ?? '(none)'}`,
      '>= 1 row, and the English visible');
    await barePage.screenshot({path: join(outDir, `${label}-find-zh-${vp.name}.png`), timeout: SHOT_MS});
    }
  } catch (e) {
    check(vp.name, 'bare entry run completed', false, String(e).slice(0, 220), 'no throw');
  } finally {
    await bareCtx.close();
  }
}

/**
 * ══ THE S0 STUDIO PASS (L31 v2.1b+c) ═══════════════════════════════════════════════════════════
 *
 * Its own pass rather than rows bolted onto the six-viewport sweep, for one reason: the things S0
 * must get right are things LATER GROUPS CANNOT CHANGE — the grid, the tier boundaries, the dock
 * geometry, the collapse ladder, the persistence shape — and several of them are only observable at
 * viewports the sweep does not visit (1179 and 1180 are a pixel apart, and no sweep viewport is
 * within 240 px of the boundary). A boundary nobody measures is a boundary a mis-ordered `@media`
 * moves silently.
 *
 * Every row here asserts a COMPUTED or RENDERED value — `getComputedStyle(...).gridTemplateAreas`,
 * a `getBoundingClientRect` — never a token. `--v2-rail:45px` exists in this project precisely
 * because a token once lied about a rendered width.
 */
if (variant === 'v2') {
  /** The five tiers and their expected `grid-template-areas`, as STRINGS the browser computed. */
  const STUDIO_AREAS = '"bar bar bar" "tools tools tools" "side field dock" "status status status"';
  // ⚠️ `board` IS THE CONTRACT, IN THE PASS EXPRESSION. The first version of this pass named only
  // 390 / 1024 / 1179 / 1180 / 1920 and asserted `side === 264 && field.w >= 420` — so D1 (1440),
  // X6 (1366 coarse) and every field HEIGHT were measured at ZERO viewports while the commit claimed
  // "MEASURED GEOMETRY, matching mock/spec.md exactly". The numbers were right in the code and in
  // the screenshots and absent from the instrument, which inverts this project's own failure mode:
  // a correct picture over a suite that is not looking (stand-in review H4).
  const TIERS = [
    {name: '390x844', width: 390, height: 844, dpr: 3, coarse: true, tier: 'phone',
      areas: '"head head" "field rail" "margin margin"'},
    {name: '1024x768', width: 1024, height: 768, dpr: 2, coarse: true, tier: 'tablet',
      areas: '"head head head" "field rail margin"'},
    // THE BOUNDARY ITSELF (opus-plan-review-2.md RC7). 1180, not 1200: v2.css:265 still says 1200
    // for its own legacy rules, and the studio's own tier query is what has to be at 1180.
    {name: '1179x900', width: 1179, height: 900, dpr: 1, coarse: false, tier: 'tablet',
      areas: '"head head head" "field rail margin"'},
    {name: '1180x900', width: 1180, height: 900, dpr: 1, coarse: false, tier: 'studio', areas: STUDIO_AREAS,
      board: 'the 1180 floor', side: 264, field: [596, 772], dock: 320, panes: [320]},
    // D1 — mock-spec.md: side 264, field 856x772, dock 320.
    {name: '1440x900', width: 1440, height: 900, dpr: 1, coarse: false, tier: 'studio', areas: STUDIO_AREAS,
      board: 'D1', side: 264, field: [856, 772], dock: 320, panes: [320]},
    // D2 — side 264, field 1036x732, two docks 320 + 300 = 620.
    {name: '1920x860', width: 1920, height: 860, dpr: 1, coarse: false, tier: 'studio-wide', areas: STUDIO_AREAS,
      board: 'D2', side: 264, field: [1036, 732], dock: 620, panes: [320, 300]},
    // X6 — the >=1180 COARSE tier: desktop structure and a 44 px target floor at once. It was the
    // only studio board with no rows at all, in a commit that separately caught four 41x44 buttons
    // at this exact viewport.
    {name: '1366x1024', width: 1366, height: 1024, dpr: 2, coarse: true, tier: 'studio', areas: STUDIO_AREAS,
      board: 'X6 (coarse)', side: 264, field: [782, 896], dock: 320, panes: [320]},
  ];
  const STUDIO_V = 'S0-studio';

  for (const vp of TIERS) {
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const g = await page.evaluate(() => {
        const el = document.querySelector('.v2');
        const box = (sel) => { const n = document.querySelector(sel); if (!n) return null; const r = n.getBoundingClientRect(); return {w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x)}; };
        return {
          areas: getComputedStyle(el).gridTemplateAreas,
          tier: el.dataset.tier,
          studio: el.classList.contains('v2-studio'),
          bar: box('.v2-bar'), tools: box('.v2-tools'), status: box('.v2-status'),
          side: box('.v2-side'), field: box('.v2-field'), dock: box('.v2-dock'),
          // BOTH the column and the panes inside it. The pane rects alone re-measure a number the
          // component itself just wrote inline, and `.v2-dock{overflow:hidden}` can clip a wrong
          // COLUMN without moving a pane rect -- so the "every dock measured 319 px" defect this
          // commit fixed would not have been caught by a pane-only reading.
          panes: [...document.querySelectorAll('.v2-pane')].map((n) => Math.round(n.getBoundingClientRect().width)),
          // the phone's geometry constants, read back rather than assumed
          head: box('.v2-head'), rail: box('.v2-rail'), margin: box('.v2-margin'),
        };
      });
      // G8. The ONE line that detects a mis-ordered `@media`, and the only instrument that can.
      check(vp.name, `[${STUDIO_V}] the computed grid-template-areas is the ${vp.tier} tier`,
        g.areas === vp.areas, `tier=${g.tier} areas=${g.areas}`, vp.areas);
      check(vp.name, `[${STUDIO_V}] the tier the page believes it is in agrees with the grid it drew`,
        g.tier === vp.tier && g.studio === (vp.tier === 'studio' || vp.tier === 'studio-wide'),
        `data-tier=${g.tier} .v2-studio=${g.studio}`, `${vp.tier}, studio=${vp.tier.startsWith('studio')}`);

      if (vp.tier.startsWith('studio')) {
        // THE FIXED ROWS, RENDERED. 52 / 44 / 32 in every studio tier including coarse — `spec.md`
        // decision 4 fixes the synthesis's inconsistent heights rather than carrying them in.
        check(vp.name, `[${STUDIO_V}] the studio rows are 52 / 44 / 32 as rendered`,
          g.bar?.h === 52 && g.tools?.h === 44 && g.status?.h === 32,
          `bar=${g.bar?.h} tools=${g.tools?.h} status=${g.status?.h}`, '52 / 44 / 32');
        // THE BOARD, EXACTLY: side, field WIDTH **AND HEIGHT**, and the dock COLUMN. Every number
        // here is `mock-spec.md`'s own artboard table, and the field height is what proves the three
        // fixed rows actually consumed 52 + 44 + 32 of the viewport rather than merely rendering at
        // those heights somewhere.
        const want = `side ${vp.side} / field ${vp.field[0]}x${vp.field[1]} / dock ${vp.dock}`;
        const got = `side ${g.side?.w} / field ${g.field?.w}x${g.field?.h} / dock ${g.dock?.w ?? 0}`;
        check(vp.name, `[${STUDIO_V}] ${vp.board}: the rendered geometry IS the contract (${want})`,
          g.side?.w === vp.side && g.field?.w === vp.field[0] && g.field?.h === vp.field[1]
            && (g.dock?.w ?? 0) === vp.dock,
          got, want);
        check(vp.name, `[${STUDIO_V}] ${vp.board}: the field clears the 420 px floor`,
          (g.field?.w ?? 0) >= 420, `field ${g.field?.w}`, '>= 420');
        // AT MOST TWO DOCKS, EVER, each at its declared width, and the column is their sum. "Max
        // two, never three" is a layout invariant; a third column is what the eviction rule exists
        // to prevent.
        const total = g.panes.reduce((a, b) => a + b, 0);
        check(vp.name, `[${STUDIO_V}] ${vp.board}: the open docks are exactly [${vp.panes.join(', ')}] and fill the column`,
          g.panes.length === vp.panes.length && g.panes.every((w, i) => w === vp.panes[i])
            && total === (g.dock?.w ?? 0) && total <= 780,
          `${g.panes.length} pane(s) [${g.panes.join(', ')}] total ${total}, column ${g.dock?.w ?? 0}`,
          `[${vp.panes.join(', ')}], column ${vp.dock}`);
        check(vp.name, `[${STUDIO_V}] ${vp.board}: ${vp.tier === 'studio-wide' ? 'two docks' : 'one dock'} by default (G2)`,
          g.panes.length === (vp.tier === 'studio-wide' ? 2 : 1),
          `${g.panes.length} pane(s)`, vp.tier === 'studio-wide' ? '2' : '1');
        check(vp.name, `[${STUDIO_V}] the phone's head / rail / margin are GONE, not merely hidden`,
          g.head === null && g.rail === null && g.margin === null,
          `head=${!!g.head} rail=${!!g.rail} margin=${!!g.margin}`, 'absent');
      } else {
        // PHONE AND TABLET PRESERVATION, as a POSITIVE control rather than the absence of a change:
        // the constants are read back off the rendered page.
        check(vp.name, `[${STUDIO_V}] the shell did not render below 1180 — head / rail / margin intact`,
          !!g.head && !!g.rail && !!g.margin && g.bar === null && g.side === null && g.status === null,
          `head=${g.head?.h} rail=${g.rail?.w} margin=${g.margin?.h} bar=${!!g.bar} side=${!!g.side}`,
          'the pre-S0 tree');
        if (vp.tier === 'phone') {
          check(vp.name, `[${STUDIO_V}] the phone geometry constants are unchanged (56 / 45 / 108)`,
            g.head.h === 56 && g.rail.w === 45 && g.margin.h === 108,
            `head=${g.head.h} rail=${g.rail.w} margin=${g.margin.h}`, '56 / 45 / 108');
        }
      }

      // THE KEY MAP AT EVERY WIDTH, and its SHEET presentation below 768 — the sheet primitive's
      // only reachable invoker at S0, so without this row the primitive ships untested.
      await page.keyboard.press('?');
      await page.waitForTimeout(400);
      const modal = await page.evaluate(() => {
        const m = document.querySelector('.v2-modal');
        if (!m) return null;
        const r = m.getBoundingClientRect(), h = document.querySelector('.v2-sheet-handle');
        const hr = h?.getBoundingClientRect();
        return {
          sheet: m.classList.contains('is-sheet'), w: Math.round(r.width), h: Math.round(r.height),
          handle: hr ? Math.round(hr.height) : null,
          focusInside: m.contains(document.activeElement),
          rows: document.querySelectorAll('.v2-keys dt').length,
          // The KEYS as rendered, so the row below can assert that the map names the keys S1
          // actually bound rather than that it is merely long enough.
          keys: [...document.querySelectorAll('.v2-keys dt')].map((d) => d.textContent.trim()),
          // A row whose description still carries the strikethrough "arrives in S<n>" marker is a
          // key the map declares FORTHCOMING. Counting them is how "S1's keys stopped being
          // promises" becomes a measurement instead of a claim.
          // `owner` markers ONLY. The per-row "desktop only" mark is also an `<s>`, and counting
          // them together would have made the forthcoming-count drift with the tier (round 4).
          pending: [...document.querySelectorAll('.v2-keys dd s')].filter((e) => !e.hasAttribute('data-studio-only')).length,
          // The rows guard 7 withholds, as the map ADVERTISES them.
          desktopOnly: [...document.querySelectorAll('.v2-keys dd s[data-studio-only]')].length,
        };
      });
      /**
       * ⚠️ THE BOUND CHANGED FROM `>= 20` TO EXACTLY `KEY_ROWS`, AND THAT IS NOT A RETUNE TO MAKE
       * A RED GO GREEN. S1 DELETED a row: `+ −` was inert copy for a zoom command v2 does not
       * have and never planned to have (zoom IS the dolly, on ↑ ↓), so the map was advertising a
       * key nobody would ever bind — the exact defect `keys.ts` exists to prevent. Nineteen rows
       * is the whole map now, and asserting it EXACTLY also catches an accidental addition, which
       * `>= 20` never could.
       *
       * The row that does the real work is the one after it: `>= N rows` is a proxy for "lists
       * every binding" and a weak one, because it passes on nineteen rows of anything. Naming the
       * keys S1 bound is the direct reading.
       */
      /**
       * ⚠️ 20 -> 21, AND THAT IS S3 ADDING A ROW, NOT A RETUNE. The tree's eye had no keyboard path
       * at all (codex round 3, Medium 3), so S3 bound `V` and put it in `KEY_MAP` under the tree
       * group — a key the map must ADVERTISE, or it is a shortcut only the source knows about. The
       * exact bound is what makes an accidental addition visible too, which is why it is a literal
       * that has to be edited deliberately rather than a `>=`.
       */
      const KEY_ROWS = 21;
      check(vp.name, `[${STUDIO_V}] "?" opens the key map, traps focus inside it, and lists every binding`,
        !!modal && modal.focusInside && modal.rows === KEY_ROWS,
        modal ? `${modal.rows} rows, focusInside=${modal.focusInside}, sheet=${modal.sheet}` : 'no overlay opened',
        `open, focus inside, exactly ${KEY_ROWS} rows`);
      // S1's OWN BINDINGS, BY NAME, and NONE of them still marked as forthcoming. At S0 every one
      // of these rows carried "arrives in S1"; if a later edit dropped a binding but left its row,
      // or kept the row's owner marker after wiring it, this is what says so.
      const S1_KEYS = ['W A S D', '← →', '↑ ↓', 'Q E', 'O P', '1 2 3 4', 'F / Shift F', 'H', 'R', 'Shift P / Shift S'];
      /**
       * S2's TWO, added to the same arithmetic rather than beside it (the S1 worklog's handover
       * item 2). Wiring Find drops the forthcoming count 8 -> 6, and the only way to make that a
       * MEASUREMENT instead of a literal is to subtract the group that bound them: the expression
       * below now reads "20 rows, minus the 2 live at S0, minus S1's, minus S2's".
       *
       * Both spellings are listed because the map advertises both and only one of them is a chord —
       * a future edit that dropped the bare `/` binding but kept its row would leave a key the map
       * promises and nothing answers, which is the defect keys.ts exists to prevent.
       */
      const S2_KEYS = ['Ctrl K / ⌘K', '/'];
      /**
       * S3's THREE, on the same arithmetic. The tree's arrows and Space stopped being promises when
       * the tree became real, and `V` is new. Wiring them drops the forthcoming count 6 -> 4, and
       * the expression below is what makes that a MEASUREMENT rather than a literal: "21 rows,
       * minus the 2 live at S0, minus S1's, minus S2's, minus S3's".
       */
      const S3_KEYS = ['↑ ↓ ← →', 'Space', 'V'];
      const BOUND = [...S1_KEYS, ...S2_KEYS, ...S3_KEYS];
      const missingKeys = BOUND.filter((k) => !(modal?.keys ?? []).includes(k));
      /**
       * ⚠️ AND THE MAP SAYS WHICH KEYS THIS TIER ACTUALLY HAS. Guard 7 withholds the seven
       * studio-only camera rows below 1180; `1 2 3 4` and `R` are controller dispatches that work
       * everywhere and have on-screen buttons there. The first version of the note covered the
       * whole group, so it told a phone reader that `1 2 3 4` was desktop-only — round 2's High
       * inverted, inside the fix for round 3's Medium, with no oracle on it at all (round 4,
       * Mediums 1 and 3). EXACT counts, both directions.
       */
      const WITHHELD = 7;
      check(vp.name, `[${STUDIO_V}] the key map marks exactly the ${WITHHELD} withheld rows as desktop-only ${vp.width >= 1180 ? '(none, in the studio)' : ''}`,
        modal?.desktopOnly === (vp.width >= 1180 ? 0 : WITHHELD),
        `${modal?.desktopOnly} rows marked desktop-only at ${vp.width}px`,
        String(vp.width >= 1180 ? 0 : WITHHELD));
      check(vp.name, `[${STUDIO_V}] the key map names every binding S1 and S2 wired, and marks none of them forthcoming`,
        !!modal && missingKeys.length === 0 && modal.pending === (KEY_ROWS - 2 - BOUND.length),
        modal ? `${modal.keys.length} keys${missingKeys.length ? `, MISSING: ${missingKeys.join(' / ')}` : ''}, ${modal.pending} still marked forthcoming`
          : 'no overlay opened',
        `all ${BOUND.length} present, ${KEY_ROWS - 2 - BOUND.length} forthcoming (the S3/S4/S5/S6 rows)`);
      check(vp.name, `[${STUDIO_V}] it presents as a ${vp.width < 768 ? 'SHEET with a 44 px handle' : 'centred modal'}`,
        vp.width < 768 ? (modal?.sheet === true && modal?.handle === 44) : (modal?.sheet === false && modal?.handle === null),
        `sheet=${modal?.sheet} handle=${modal?.handle}`, vp.width < 768 ? 'sheet, handle 44' : 'modal, no handle');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const closed = await page.evaluate(() => !document.querySelector('.v2-modal'));
      // ⚠️ CONDITIONED ON IT HAVING OPENED. `!document.querySelector('.v2-modal')` is trivially true
      // when `?` never opened anything -- so this row went GREEN in precisely the scenario where the
      // row above had just failed (stand-in review M9).
      check(vp.name, `[${STUDIO_V}] Escape closes it (the only other binding S0 installs)`,
        !!modal && closed, modal ? (closed ? 'opened, then closed' : 'opened and STAYED OPEN') : 'it never opened, so Escape proves nothing',
        'opened, then closed');

      /**
       * ══ S2 — THE FIND PALETTE ═══════════════════════════════════════════════════════════════
       *
       * Six claims, every one of which is invisible in a screenshot. The palette LOOKS right in all
       * of the states below — the defects are about which rows came back, in what order, whether a
       * request was made, and where the focus went.
       *
       * It runs at EVERY viewport, including 390x844, because the palette is one component with two
       * presentations and the phone's is the one that replaced a working surface. These are the
       * APPENDED phone rows RC5(c) permits; none of the pre-existing ones is touched.
       */
      const openFind = async () => {
        // Ctrl+K rather than clicking the button: the chord is the claim, and it is also the only
        // spelling allowed to fire from inside an editor, which the row below depends on.
        await page.keyboard.down('Control'); await page.keyboard.press('KeyK'); await page.keyboard.up('Control');
        await page.waitForTimeout(350);
      };
      await openFind();
      const find1 = await page.evaluate(() => {
        const m = document.querySelector('.v2-modal.is-find');
        const input = m?.querySelector('input');
        return m ? {
          open: true, sheet: m.classList.contains('is-sheet'),
          // `.v2-search input` is the selector verify-regress.mjs:1140 has asserted since v2 P0.
          // The phone's Find used to open an in-margin list; it now opens THIS. Keeping the class
          // is what lets the existing regression row keep testing the claim it was written about.
          legacySelector: !!m.querySelector('.v2-search input'),
          focusedIsInput: document.activeElement === input,
          w: Math.round(m.getBoundingClientRect().width),
        } : {open: false};
      });
      check(vp.name, `[${STUDIO_V}] Ctrl+K opens the palette, autofocuses its input, and keeps the .v2-search contract`,
        find1.open && find1.focusedIsInput && find1.legacySelector,
        `open=${find1.open} focusedInput=${find1.focusedIsInput} .v2-search input=${find1.legacySelector} width=${find1.w}`,
        'open, input focused, legacy selector intact');
      check(vp.name, `[${STUDIO_V}] it presents as a ${vp.width < 768 ? 'SHEET (spec A4)' : 'centred modal (spec D3, 640 wide)'}`,
        vp.width < 768 ? find1.sheet === true : (find1.sheet === false && find1.w === 640),
        `sheet=${find1.sheet} width=${find1.w}`, vp.width < 768 ? 'sheet' : 'modal, 640');

      /**
       * ⚠️ THIS PASS IS **zh-Hans**, NOT ENGLISH, AND SAYING OTHERWISE WAS AN INSTRUMENT DEFECT.
       *
       * The first version of this row was titled "in an ENGLISH interface" and asserted the
       * cross-script claim here. It is the wrong context to assert it in: the studio pass drives the
       * §9 SCENE FIXTURE, which declares `lang: 'zh-Hans'` (verify-ux.mjs:88), and applying a scene
       * writes `localStorage['atlas.lang']` (app/v2/page.tsx:255). The measured lane headings came
       * back as 结构 / 独立网格 — Chinese — under a row claiming to prove English behaviour.
       *
       * Nothing about the product was wrong there; the LABEL was, and a row whose name misdescribes
       * its own context is the kind of green that is worth less than no row at all. The EN half of
       * the cross-script claim now lives in the bare pass, which measures `lang=en` before asserting
       * it, and the zh half in the `?lang=zh-Hans` sub-pass beside it. What stays here is the claim
       * this context CAN carry: the denominators, which are language-independent.
       */
      await page.keyboard.type('胸骨');
      await page.waitForTimeout(500);
      const cross = await page.evaluate(() => {
        /**
         * ⚠️ THE HEADING'S GEOMETRY, NOT ONLY ITS TEXT.
         *
         * The first version of this row read `h3.textContent` and nothing else. It passed at every
         * viewport while each lane heading was rendering as a flex SIBLING beside its own result
         * list — squeezed into a ~40 px left column and vertically centred, so on the phone it read
         * as a stray "of 32" in the gutter. The text was correct the whole time; the LAYOUT was not,
         * and a text assertion is structurally incapable of seeing that. Found by looking at the
         * screenshot, which is why they are read rather than filed.
         *
         * So the heading must now be ABOVE its first row and must span the list, which is the thing
         * that was actually false.
         */
        const groups = [...document.querySelectorAll('.v2-find-group')];
        const geom = groups.map((g) => {
          const h = g.querySelector('h3'), first = g.querySelector('.v2-result');
          if (!h || !first) return null;
          const hr = h.getBoundingClientRect(), fr = first.getBoundingClientRect(), gr = g.getBoundingClientRect();
          return {
            above: Math.round(hr.bottom) <= Math.round(fr.top) + 1,
            spans: gr.width > 0 && hr.width / gr.width >= 0.5,
            hw: Math.round(hr.width), gw: Math.round(gr.width),
          };
        }).filter(Boolean);
        return {
          n: document.querySelectorAll('.v2-find-list .v2-result').length,
          lang: document.documentElement.lang,
          // The per-lane denominators, as rendered. Three populations, never one.
          lanes: [...document.querySelectorAll('.v2-find-group > h3')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()),
          geom,
        };
      });
      check(vp.name, `[${STUDIO_V}] each lane heading sits ABOVE its rows and spans the list, not beside them`,
        cross.geom.length >= 1 && cross.geom.every((g) => g.above && g.spans),
        cross.geom.length
          ? cross.geom.map((g) => `above=${g.above} width ${g.hw}/${g.gw}`).join(' | ')
          : '(no lane groups rendered)',
        'every heading above its first row, >= 50% of the group width');

      /**
       * ⚠️ THE ARROW KEYS WALK THE ORDER THE EYE READS (stand-in review S2 r1, H3).
       *
       * `rows = res.all` drives the keyboard; the list is drawn grouped by lane. When `all` was
       * sorted rank-first those were two different orders: one ArrowDown moved the highlight 29
       * screen rows, and after 77 presses it sat above where it had been at 47 — and `Enter` commits
       * `rows[at]`, so the committing row was not reliably the highlighted one. 75 of 169 sampled
       * queries disagreed.
       *
       * The row measures the ONE thing that was false: pressing ArrowDown n times must leave the
       * highlight on the (n+1)th row IN DOM ORDER. Two distinct lanes are required, or the check
       * cannot fail — a single-lane list agrees with itself under any sort.
       */
      const navOk = await page.evaluate(async () => {
        const list = document.querySelector('.v2-find-list');
        if (!list) return {error: 'no list'};
        const domIndex = () => [...list.querySelectorAll('.v2-result')]
          .findIndex((el) => el.classList.contains('is-at'));
        const lanes = new Set([...list.querySelectorAll('[data-lane]')].map((el) => el.dataset.lane));
        const input = document.querySelector('.v2-find input');
        const steps = [];
        for (let i = 0; i < 12; i++) {
          input.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true, cancelable: true}));
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          steps.push(domIndex());
        }
        return {lanes: lanes.size, steps, rows: list.querySelectorAll('.v2-result').length};
      });
      const walk = navOk.steps ?? [];
      const monotonic = walk.length > 0 && walk.every((v, i) => v === Math.min(i + 1, (navOk.rows ?? 1) - 1));
      check(vp.name, `[${STUDIO_V}] ArrowDown walks the rows in the order they are DRAWN, one at a time`,
        navOk.lanes >= 2 && monotonic,
        navOk.error ?? `${navOk.lanes} lanes, ${navOk.rows} rows, DOM positions after each ArrowDown: ${walk.join(',')}`,
        '>= 2 lanes (or the check cannot fail), and positions 1,2,3,…');

      /**
       * ⚠️ THE SAME WALK, WITH THE POINTER RESTING ON THE LIST — the state the row above cannot see.
       *
       * The row above dispatches synthetic key events and never places a pointer, so it asserted the
       * ordering claim in the one posture where it held. With a real cursor parked over a row, a
       * keyboard-driven `scrollIntoView` slides a DIFFERENT row under it, Chromium fires
       * `mouseenter`, and the hover handler clobbered the keyboard's index: 25 ArrowDowns netted +6
       * rows, jumping backwards every fourth press (stand-in review S2 r2, HIGH-1). That is the
       * ordinary desktop posture — the palette opens under the hand already on the mouse.
       *
       * So this arm parks a REAL pointer over the list once, never moves it again, and drives real
       * key presses. It is the control arm's opposite: same claim, adversarial state.
       */
      /**
       * ⚠️ PARK ON THE LIST'S OWN RECT, NOT ON ROW 0 — AND PROVE THE POINTER IS ACTUALLY OVER IT.
       *
       * The first version parked on `.v2-find-list .v2-result`, the FIRST row. By this point the
       * 12-press walk above has already scrolled it off the top: the park point measured y = -104
       * (also -70, -124 at other viewports), `elementFromPoint` returned null, and ZERO mouseover
       * events fired during the entire walk. The row therefore established no adversarial state and
       * could not go red on the defect it exists to prevent — a FALSE GREEN at five viewports, in
       * the guard written to stop HIGH-1 coming back (stand-in review S2 r3, HIGH-2).
       *
       * THE LOAD-BEARING HALF IS PARKING ON THE LIST'S RECT rather than on a row that may have
       * scrolled away. The re-seed below is belt-and-braces and was MEASURED to be a no-op here
       * (list `scrollTop` 409 before and after; an A/B with it removed is byte-identical) — it is
       * kept so the walk starts from a defined query rather than inheriting the previous one, and
       * it is described as what it is rather than as a scroll reset it does not perform (stand-in
       * review S2 r4, L2).
       *
       * The row also ASSERTS that the pointer really is over the list and that hover events fired
       * during the walk. An arm that cannot be armed is not a control arm — and round 4 proved this
       * one can, by injecting a 1 px pointer move mid-walk and watching it go red.
       */
      await page.keyboard.press('Backspace');           // re-seed: shortens then restores the query,
      await page.waitForTimeout(250);                   // which resets active to 0 and scrolls to top
      await page.keyboard.type('骨');
      await page.waitForTimeout(500);
      const listBox = await page.$('.v2-find-list');
      let hoverWalk = {error: 'no list to park on'};
      if (listBox) {
        const bb = await listBox.boundingBox();
        if (bb) {
          await page.evaluate(() => {
            window.__hoverN = 0;
            document.querySelector('.v2-find-list')
              ?.addEventListener('mouseover', () => { window.__hoverN++; }, {capture: true});
          });
          await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await page.waitForTimeout(150);
          // ⚠️ ZEROED AFTER PARKING. The listener is installed before the move, so the park itself
          // fires one `mouseover` — which satisfied `hoverN >= 1` on its own while the row's message
          // claimed the hovers happened DURING the walk (stand-in review S2 r4, L1). Measured
          // `park=1` at all seven tiers. Now the count is exactly what the message says it is.
          await page.evaluate(() => { window.__hoverN = 0; });
          const total = await page.evaluate(() => document.querySelectorAll('.v2-find-list .v2-result').length);
          const seq = [];
          for (let i = 0; i < 14; i++) {
            await page.keyboard.press('ArrowDown');
            await page.waitForTimeout(60);
            seq.push(await page.evaluate(() => [...document.querySelectorAll('.v2-find-list .v2-result')]
              .findIndex((el) => el.classList.contains('is-at'))));
          }
          /**
           * ⚠️ "STALLED AT THE LAST ROW" IS NOT A DEFECT, AND THE FIRST VERSION OF THIS COUNTED IT
           * AS ONE. It scored every `v <= seq[i-1]` as backwards, so a walk that legitimately
           * reached the END of the list and stayed there — `13,14,15,16,16,16,…` on the studio
           * pass's 17-row 胸骨 query — was reported as 10 backwards steps at five viewports. An
           * instrument that reds correct output is the same failure as one that greens a defect,
           * and this one would have been read as HIGH-1 reopening.
           *
           * The claim is precise: each press advances by one UNTIL the last row, and then holds.
           * So a violation is a step BACKWARDS, or a stall while there is still somewhere to go.
           */
          const last = total - 1;
          const backwards = seq.filter((v, i) => {
            if (i === 0) return false;
            if (v < seq[i - 1]) return true;                    // moved backwards: the defect
            return v === seq[i - 1] && v < last;                // stalled before the end: also wrong
          }).length;
          // THE ARM, ARMED. Zero hover events means the pointer was not over the list and the walk
          // proved nothing — which is exactly how this row was passing before.
          const hoverN = await page.evaluate(() => window.__hoverN ?? 0);
          const onList = await page.evaluate(({x, y}) => {
            const el = document.elementFromPoint(x, y);
            return !!el?.closest?.('.v2-find-list');
          }, {x: Math.round(bb.x + bb.width / 2), y: Math.round(bb.y + bb.height / 2)});
          hoverWalk = {seq, backwards, total, hoverN, onList};
        }
      }
      check(vp.name, `[${STUDIO_V}] ArrowDown still advances with the POINTER RESTING on the list`,
        Array.isArray(hoverWalk.seq) && hoverWalk.seq.length > 0
          && hoverWalk.onList && hoverWalk.hoverN >= 1 && hoverWalk.backwards === 0,
        hoverWalk.error ?? `positions: ${hoverWalk.seq.join(',')} of ${hoverWalk.total} rows `
          + `(${hoverWalk.backwards} backwards-or-stalled steps); pointer over the list=${hoverWalk.onList}, `
          + `${hoverWalk.hoverN} hover events fired during the walk`,
        'pointer really over the list (>=1 hover event), and it advances one per press to the end');

      /**
       * ⚠️ THE LIST IS THE SCROLLER, NOT THE BODY — asserted AFTER scrolling, which is the only
       * state in which it was ever false.
       *
       * `.v2-find-list{flex:1;overflow-y:auto}` is written under a comment promising the input and
       * the footer stay on screen at every list length. Both were false: `.v2-modal-body` is a plain
       * block, so the palette grew to content height and the BODY scrolled. The capped footer
       * rendered ~6,000 px below the visible modal and was never on screen in ANY evidence
       * screenshot; after 40 ArrowDowns the search input had left the modal entirely.
       *
       * Screenshots could not have caught this — they are taken before any scroll. So the row
       * measures the rects AFTER driving the list, which is where the claim lives.
       */
      const scroller = await page.evaluate(() => {
        const modal = document.querySelector('.v2-modal.is-find');
        const list = document.querySelector('.v2-find-list');
        const input = document.querySelector('.v2-find input');
        const foot = document.querySelector('.v2-find-foot');
        const body = document.querySelector('.v2-modal.is-find .v2-modal-body');
        if (!modal || !list || !input || !foot || !body) return {error: 'palette parts missing'};
        const m = modal.getBoundingClientRect();
        const inside = (el) => {
          const r = el.getBoundingClientRect();
          return r.top >= m.top - 1 && r.bottom <= m.bottom + 1;
        };
        return {
          listScrolls: list.scrollHeight > list.clientHeight + 1,
          bodyScroll: body.scrollTop,
          bodyOverflows: body.scrollHeight > body.clientHeight + 1,
          inputInside: inside(input), footInside: inside(foot),
          footTop: Math.round(foot.getBoundingClientRect().top), modalBottom: Math.round(m.bottom),
        };
      });
      check(vp.name, `[${STUDIO_V}] after scrolling the results, the input and the footer are STILL inside the modal`,
        !scroller.error && scroller.inputInside && scroller.footInside && !scroller.bodyOverflows,
        scroller.error ?? `inputInside=${scroller.inputInside} footInside=${scroller.footInside} `
          + `listScrolls=${scroller.listScrolls} bodyOverflows=${scroller.bodyOverflows} `
          + `foot.top=${scroller.footTop} modal.bottom=${scroller.modalBottom}`,
        'input and footer inside the modal, the body does not overflow');
      check(vp.name, `[${STUDIO_V}] a Chinese query returns matches in the studio (interface: ${cross.lang})`,
        cross.n >= 1, `${cross.n} rows at lang=${cross.lang}`, '>= 1 row');
      /**
       * THE DENOMINATORS, AS RENDERED. `3,432` and `2,234` are not hardcoded here — the assertion is
       * that each lane heading carries its OWN "n of total" pair, in whichever language is up. What
       * it forbids is the one number `spec.md` names: a single merged total across three unrelated
       * populations.
       */
      check(vp.name, `[${STUDIO_V}] each lane reports its OWN denominator, never one merged total`,
        cross.lanes.length >= 1
          && cross.lanes.every((l) => /\d[\d,]*\s*(of|中的)\s*[\d,]+/.test(l))
          // ⚠️ THE DENOMINATOR IS CAPTURED, NOT PATTERN-GUESSED (stand-in review S2 r1, L5). The
          // first version keyed uniqueness on `/[\d,]{4,}/`, which returns '' for any lane under
          // 1,000 — and the systems lane's population is 15. Two small lanes would both have keyed
          // on '' and RED a perfectly correct palette. Both orders are matched because the zh copy
          // puts the total first ("{total} 中的 {n}").
          && new Set(cross.lanes.map((l) => {
            const en = l.match(/of\s*([\d,]+)/); if (en) return en[1];
            const zh = l.match(/([\d,]+)\s*中的/); return zh ? zh[1] : null;
          })).size === cross.lanes.length,
        cross.lanes.join(' | ') || '(no lane headings)',
        'every lane heading carries "n of total", and no two lanes share a denominator');

      /**
       * THE GUARD ROW, WITH ITS CONTROL ARM. Typing "wasd" into the palette must not pan the camera
       * — but "the camera did not move" passes trivially on a page where the renderer never came up,
       * so the pose is read before and after AND the same keys are proved live afterwards by the S1
       * rows in this same suite. Guard 1 (editors) is what does the work; this is the reachable case
       * that proves it is installed on the palette too.
       */
      const poseBefore = await page.evaluate(() => window.__atlasNav?.pose() ?? null);
      await page.keyboard.type('wasd');
      await page.waitForTimeout(450);
      const poseAfter = await page.evaluate(() => window.__atlasNav?.pose() ?? null);
      const moved = poseBefore && poseAfter &&
        ['x', 'y', 'z', 'tx', 'ty', 'tz'].some((k) => Math.abs(poseBefore[k] - poseAfter[k]) > 1e-4);
      check(vp.name, `[${STUDIO_V}] typing W A S D into the palette does NOT move the camera`,
        !!poseBefore && !moved,
        poseBefore ? (moved ? `pose MOVED: ${JSON.stringify(poseAfter)}` : 'pose unchanged to 1e-4') : 'no renderer, so nothing was proved',
        'a renderer exists, and the pose is unchanged');

      /**
       * FOCUS RETURNS TO THE INVOKER. `spec.md`: "Escape and close return focus to invoker." A
       * palette that drops focus to `<body>` strands a keyboard reader at the top of the document,
       * which is the single most common overlay defect and is completely invisible to a screenshot.
       *
       * The invoker here is the BODY-level focus the chord was pressed from, so the assertion is the
       * weaker true one: focus is somewhere real and is no longer inside the (now absent) palette.
       */
      await page.keyboard.press('Escape');
      await page.waitForTimeout(350);
      const afterClose = await page.evaluate(() => ({
        gone: !document.querySelector('.v2-modal.is-find'),
        active: document.activeElement?.tagName ?? null,
        inPalette: !!document.activeElement?.closest?.('.v2-find'),
      }));
      check(vp.name, `[${STUDIO_V}] Escape closes the palette and focus leaves it`,
        afterClose.gone && !afterClose.inPalette,
        `closed=${afterClose.gone} activeElement=${afterClose.active} stillInside=${afterClose.inPalette}`,
        'closed, focus outside');

      /**
       * ⚠️ THE SURFACE THE PALETTE REPLACED IS GONE, AND NOTHING ELSE ASSERTED IT (stand-in review
       * S2 r1, M3). The palette reuses `.v2-search` on its own container so the long-standing
       * regression row keeps matching — which is honest, but it also means a regression that
       * restored the phone's in-margin list would satisfy every row in this suite, including that
       * one. The distinguishing fact is WHERE the element lives: inside `.v2-margin` is the old
       * surface, inside `.v2-modal` is the new one. With the palette closed, neither should exist.
       */
      const leftovers = await page.evaluate(() => ({
        inMargin: document.querySelectorAll('.v2-margin .v2-search').length,
        anywhere: document.querySelectorAll('.v2-search').length,
      }));
      check(vp.name, `[${STUDIO_V}] the old in-margin search list is GONE — .v2-search exists only inside the palette`,
        leftovers.inMargin === 0 && leftovers.anywhere === 0,
        `.v2-margin .v2-search=${leftovers.inMargin}, .v2-search anywhere (palette closed)=${leftovers.anywhere}`,
        '0 and 0');

      if (vp.tier.startsWith('studio')) {
        await page.screenshot({path: join(outDir, `${label}-studio-${vp.name}.png`), timeout: SHOT_MS});
        // The palette, open and populated, as its own shot — the thing Adrian reacts to.
        await openFind();
        await page.keyboard.type('胸骨');
        await page.waitForTimeout(600);
        await page.screenshot({path: join(outDir, `${label}-find-${vp.name}.png`), timeout: SHOT_MS});
        await page.keyboard.press('Escape');
      } else if (vp.width < 768) {
        await openFind();
        await page.keyboard.type('gluteus');
        await page.waitForTimeout(600);
        await page.screenshot({path: join(outDir, `${label}-find-sheet-${vp.name}.png`), timeout: SHOT_MS});
        await page.keyboard.press('Escape');
      }
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the studio pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  /**
   * ══ S1 — NAVIGATION AND FRAMING ═══════════════════════════════════════════════════════════════
   *
   * Every claim below is paired with the CONTROL ARM that would have gone red before S1. A
   * navigation suite is unusually easy to write as a set of tautologies — "the camera did not move
   * while we did nothing" passes on a dispatcher that was never installed — so each guard row has
   * beside it a row proving the same key DOES fire where it should.
   */
  const S1_V = 'S1-nav';
  /** Six coordinates to 4 dp — the same reading the plate goldens take. A pose is position AND
   *  target: a check on position alone passes an orbit that silently re-centred the target. */
  const POSE = `(() => {
    const n = window.__atlasNav; if (!n) return null; const p = n.pose();
    return {k: [p.x, p.y, p.z, p.tx, p.ty, p.tz].map((v) => v.toFixed(4)).join(','), manual: p.manual};
  })()`;

  /**
   * ══ HOLD A KEY UNTIL THE STATE SAYS SO — NEVER FOR A FIXED NUMBER OF MILLISECONDS ═════════════
   * (S3 PRELUDE. The defect this replaces is an INSTRUMENT defect, and it gated a deploy.)
   *
   * Every S1 held-key row used to be `down(code)` → `waitForTimeout(400…500)` → `up(code)` → assert
   * the pose changed. In a sweep that opens a dozen browser contexts, a context that opens DURING
   * those 400 ms sends this page a `blur`; `keys.ts` guard 6 then clears the held set (correctly —
   * a keyup delivered to an unfocused window never arrives, and the camera would otherwise pan for
   * ever), the rAF loop stops, and the pose never moves. The row goes red on a product that is
   * working perfectly. Measured across the S2 gate: red on 2 of 5 sweep runs, a DIFFERENT row each
   * time (`s1-r1-fixes`, then `s1-pose-1440`, then `s1-pose-1920` + `s1-r1-fixes`, then none) and
   * green 3/3 in isolation. S1 tried `bringToFront()`, which narrows the window and does not close
   * it: the steal happens after the call.
   *
   * A NONDETERMINISTIC RED IN A DEPLOY-GATING SUITE IS ITSELF A DEFECT — it trains its reader to
   * re-run until green, which is how a real red gets waved through. So the fix is not a longer
   * sleep and not a retuned guard; it is to stop measuring TIME and start measuring the STATE the
   * row is actually asserting about.
   *
   * THE WAIT TARGET IS THE PRODUCT'S OWN REFLECTION OF THE HELD SET. The on-screen pad renders
   * `aria-pressed` straight off `dispRef.current.held` (`shell.tsx` `PAD`, `use-shell.ts` `held`),
   * so `.v2-cap-key[aria-label="<code>"][aria-pressed="true"]` IS the dispatcher's set, observed —
   * not a test-only back door, and the same fact S1's own pad row already asserts. Two consequences
   * worth stating: the helper needs no new product API, and if a later group removes the pad this
   * instrument fails LOUDLY (a timeout naming the selector) rather than silently measuring nothing.
   *
   * WHAT IT DOES WITH A LOST HOLD. It does not paper over it: the second wait resolves to `lost` the
   * moment the pad goes unpressed before the pose moved, and the attempt is retried from a re-focused
   * page, bounded at three. The number of attempts travels into the row's measured string, so
   * "green after 2 attempts" is visible as environment noise while "3 attempts, never held" stays a
   * red about the product. A silent retry would be a different kind of lie.
   */
  const padSel = (code) => `.v2-cap-key[aria-label="${code}"]`;
  const padPressed = (page, code) =>
    page.evaluate((s) => document.querySelector(s)?.getAttribute('aria-pressed') ?? 'absent', padSel(code));
  /**
   * Hold `code` until the camera pose LEAVES `baseline`, then release and wait for the release to be
   * observed too. Returns `{moved, attempts, pose, note}` — never throws, because a timeout here is
   * a finding to report, not a pass to abandon.
   */
  async function holdUntilMoved(page, code, baseline, {attempts = 3, timeout = 6000} = {}) {
    let note = '';
    /** Every attempt's OUTCOME, verbatim — see the note-building comment below (codex r3, M5). */
    const history = [];
    for (let n = 1; n <= attempts; n++) {
      await page.bringToFront().catch(() => {});
      await page.mouse.move(200, 200).catch(() => {});
      await page.keyboard.down(code);
      // 1. THE DISPATCHER REALLY TOOK IT. Without this the second wait cannot distinguish "the key
      //    never registered" from "it registered and the camera is not answering".
      // ⚠️ `polling: 60`, NOT the default `raf`. Playwright polls `waitForFunction` on
      // requestAnimationFrame by default, and Chromium THROTTLES rAF in a page that is not the
      // frontmost one — so in a multi-context sweep the wait can time out on a condition that became
      // true immediately. That is the same class of defect as the timer this helper replaced: a
      // measurement whose result depends on which window the OS happened to be showing.
      const held = await page.waitForFunction(
        (s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', padSel(code),
        {timeout: 3000, polling: 60},
      ).then(() => true).catch(() => false);
      if (!held) {
        await page.keyboard.up(code).catch(() => {});
        history.push(`#${n} the dispatcher never reported ${code} held`);
        note = `attempt ${n}: the dispatcher never reported ${code} held`;
        continue;
      }
      // 2. THE POSE MOVES, or the hold is LOST. One wait, two outcomes, so a blur is diagnosed
      //    rather than timing out as if the camera were dead.
      const outcome = await page.waitForFunction(([s, k]) => {
        if (document.querySelector(s)?.getAttribute('aria-pressed') !== 'true') return 'lost';
        const nav = window.__atlasNav; if (!nav) return false;
        const p = nav.pose();
        const cur = [p.x, p.y, p.z, p.tx, p.ty, p.tz].map((v) => v.toFixed(4)).join(',');
        return cur !== k ? 'moved' : false;
      }, [padSel(code), baseline], {timeout, polling: 60}).then((h) => h.jsonValue()).catch(() => 'timeout');
      await page.keyboard.up(code).catch(() => {});
      // 3. AND IT LET GO. A row that leaves a key down poisons every row after it in the same page.
      // ⚠️ S3b — THE RELEASE IS NO LONGER SWALLOWED (codex round 4, Medium 2). This was
      // `.catch(() => {})`: a key that never came back up produced a clean pass and then poisoned
      // every subsequent row in the same page with an invisible cause. codex executed it — "movement
      // reported but timed out waiting for release: moved=true, attempts=1, note '1 attempt'".
      const released = await page.waitForFunction(
        (s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'false', padSel(code),
        {timeout: 3000, polling: 60},
      ).then(() => true).catch(() => false);
      if (!released) {
        const pose = await page.evaluate(POSE);
        return {moved: false, released: false, attempts: n, pose,
          note: `${code} was still held 3 s after keyup — the measurement is unsound and every row after it in this page is suspect`};
      }
      if (outcome === 'moved') {
        const pose = await page.evaluate(POSE);
        /**
         * ⚠️ THE NOTE REPORTS WHAT HAPPENED, NOT ONE ASSUMED CAUSE — codex round 3, Medium 5.
         *
         * It used to read "the hold was lost Nx to a blur" for EVERY retry, including retries where
         * the hold was never lost and the CAMERA simply did not move within six seconds. codex
         * executed the helper against an adapter that reported held-then-timeout on attempt 1 and
         * held-then-moved on attempt 2, with ZERO blur events, and got
         * `"2 attempts (the hold was lost 1x to a blur)"`. A real first-press failure would have
         * been laundered into a deploy-gating pass with a fabricated environmental explanation —
         * which is the same class of defect as the flake this helper was written to end, one level
         * up. The outcomes are now carried verbatim.
         */
        const detail = n > 1 ? ` (attempt ${n} of ${attempts}; earlier: ${history.join(', ')})` : '';
        return {moved: true, released: true, attempts: n, pose, note: `${n} attempt${n > 1 ? 's' : ''}${detail}`};
      }
      const why = outcome === 'lost'
        ? 'the hold was cleared before the camera moved (blur)'
        : outcome === 'timeout' ? 'the camera did not move within 6 s' : String(outcome);
      history.push(`#${n} ${why}`);
      note = `attempt ${n}: ${why}`;
      /**
       * ⚠️ S3b — ONLY A LOST HOLD IS RETRIED (codex round 4, Medium 2).
       *
       * The retry exists for ONE cause: a `blur` clearing the dispatcher's held set, which is an
       * environment fact (another browser context opening mid-sweep) and not a claim about the
       * product. A `timeout` is the opposite — the key WAS held, the dispatcher said so, and the
       * camera did not move in six seconds. That is a product finding, and retrying it until one
       * attempt happens to move laundered it into a deploy-gating pass. codex executed exactly that
       * sequence (attempt 1 held-then-timeout, attempt 2 held-then-moved, ZERO blurs) and got
       * `moved=true`. So a camera timeout ends the loop where it happens.
       */
      if (outcome === 'timeout') break;
    }
    const pose = await page.evaluate(POSE);
    return {moved: false, released: true, attempts: history.length || attempts, pose,
      note: `${history.length || attempts} attempt${(history.length || attempts) > 1 ? 's' : ''} — ${history.join(' · ') || note}`};
  }
  /** The same discipline for a hold whose POINT is to be held while something else is measured:
   *  wait until the dispatcher reports it, rather than assuming 200 ms was enough. */
  async function holdDown(page, code, {timeout = 3000, attempts = 3} = {}) {
    /**
     * ⚠️ THE SAME BOUNDED RETRY AS `holdUntilMoved`, and its absence was a measured defect.
     *
     * The first version pressed once and waited. It fed two PREMISE rows in `s1-r1-fixes`, and on
     * one sweep `S is really held before the modified-while-held events` went red with "KeyS never
     * registered as held" while passing on the sweep before and the sweep after — the identical
     * blur race the helper beside it exists to absorb. A premise row that flakes is worse than one
     * that fails: it makes the sub-test beneath it measure the UNHELD case and report it as the
     * held one.
     */
    for (let n = 1; n <= attempts; n++) {
      await page.bringToFront().catch(() => {});
      await page.keyboard.down(code);
      const ok = await page.waitForFunction(
        (s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'true', padSel(code),
        {timeout, polling: 60},
      ).then(() => true).catch(() => false);
      if (ok) return true;
      await page.keyboard.up(code).catch(() => {});
    }
    return false;
  }
  async function releaseKey(page, code, {timeout = 3000} = {}) {
    await page.keyboard.up(code).catch(() => {});
    await page.waitForFunction(
      (s) => document.querySelector(s)?.getAttribute('aria-pressed') === 'false', padSel(code),
      {timeout, polling: 60},
    ).catch(() => {});
  }

  // ── S1.1 A MANUAL POSE SURVIVES A DOCK TOGGLE ────────────────────────────────────────────────
  // The defect this is written against: `resize()` cleared the focus key and ended in an
  // unconditional `fit()`, so opening a dock threw away whatever the reader had set up. In the
  // studio a dock toggle is a one-click everyday action, which is what makes it worth a row.
  for (const vp of [{name: 's1-pose-1440', width: 1440, height: 900, dpr: 1, coarse: false},
    {name: 's1-pose-1920', width: 1920, height: 860, dpr: 1, coarse: false}]) {
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      /**
       * ⚠️ FOCUS THE PAGE BEFORE TOUCHING THE KEYBOARD, and this is an INSTRUMENT fix for a
       * PRODUCT behaviour that is correct.
       *
       * This row failed intermittently in the full sweep and passed every time in isolation — at
       * 1440 but not 1920, on one run and not the next. The cause is `keys.ts` guard 6: the held
       * set is cleared on `blur`, because a keyup delivered while the window is not focused never
       * reaches the page and the camera would otherwise pan for ever. An unfocused page receives
       * exactly that blur mid-hold, the set clears, and the animation loop stops — the guard doing
       * its job on a page no human is looking at.
       *
       * So the fix is to make the measurement resemble the situation being measured, NOT to weaken
       * the guard. A flake chased into the product would have cost the one protection against a
       * stuck camera key.
       *
       * ⚠️ S3 PRELUDE: `bringToFront()` ALONE WAS NOT THE FIX, and the correction is worth keeping.
       * S1 stopped here, and the flake survived into the S2 gate — red on 2 of 5 sweep runs, a
       * different row each time. Measured on 2026-09-12: with NO adversary at all the old
       * timer-based arm was green only 8 of 10, and a blur delivered 12 ms after the keydown left it
       * 8 of 10 as well; the state-waiting helper was 10 of 10 in BOTH conditions. `bringToFront()`
       * narrows the window in which focus can be lost; it cannot close it, because the steal happens
       * after the call returns. Only waiting on the STATE closes it. Kept here because the reasoning
       * above is right and the conclusion drawn from it was not.
       * Evidence: `.artifacts/L31/v21bc/s3/held-key-flake-proof.txt`.
       */
      await page.bringToFront();
      const before = await page.evaluate(POSE);
      check(vp.name, `[${S1_V}] the navigation surface exists`, !!before,
        before ? 'window.__atlasNav present' : 'ABSENT', 'present');

      // POSED THROUGH THE KEYS A HUMAN WOULD USE, never by writing the camera directly — a test
      // that sets `camera.position` passes over a dispatcher that never fires.
      await page.mouse.move(vp.width / 2, vp.height / 2);
      // S3 PRELUDE: state-waiting, not a 500 ms sleep. See `holdUntilMoved` above.
      const orbit = await holdUntilMoved(page, 'ArrowLeft', before?.k ?? '');
      const posed = orbit.pose;
      check(vp.name, `[${S1_V}] a held arrow key actually orbits the camera (the control arm)`,
        orbit.moved && !!posed && !!before && posed.k !== before.k && posed.manual === true,
        `${before?.k} -> ${posed?.k} (manual=${posed?.manual}) · ${orbit.note}`, 'a different pose, flagged manual');

      const fieldW = () => page.evaluate(() => Math.round(document.querySelector('.v2-field').getBoundingClientRect().width));
      const w0 = await fieldW();
      const toggled = await page.evaluate(() => {
        const b = [...document.querySelectorAll('.v2-tools .v2-tbtn[aria-pressed]')].find((x) => x instanceof HTMLButtonElement);
        if (!b) return null;
        b.click();
        return true;
      });
      await page.waitForTimeout(1100);
      const after = await page.evaluate(POSE);
      const w1 = await fieldW();
      /**
       * THE SECOND CONTROL ARM: the toggle must really have RESIZED THE FIELD, or "the pose
       * survived a resize" is a claim about a resize that never happened.
       *
       * ⚠️ IT ASSERTS THE FIELD WIDTH, NOT `aria-pressed`, and the first version got that wrong in
       * a way worth recording: it read the attribute back in the SAME evaluate as the click, before
       * React had re-rendered, so it measured `true -> true` and failed while the field had in fact
       * gone 856 -> 1076. A control arm that reads a value the framework has not written yet
       * reports the instrument's timing as the product's behaviour.
       */
      check(vp.name, `[${S1_V}] the dock toggle really changed the field (the second control arm)`,
        !!toggled && w0 !== w1, `field ${w0} -> ${w1} px`, 'a different field width');
      check(vp.name, `[${S1_V}] a MANUAL pose survives a dock toggle, all six coordinates`,
        !!after && !!posed && after.k === posed.k, `${posed?.k} -> ${after?.k}`, 'identical to 4 dp');
    } catch (e) {
      check(vp.name, `[${S1_V}] the pose pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── S1.2 THE DISPATCHER DOES NOT FIRE WHILE SOMEBODY IS TYPING ───────────────────────────────
  // Guard 1 of `keys.ts`, measured on the product rather than on the unit. The Ask dock is seeded
  // open through the persistence layer because it holds the only real `textarea` in the studio,
  // and typing "was ddd" into it is exactly the case: six camera commands, or none.
  {
    const vp = {name: 's1-typing', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.addInitScript(() => {
        localStorage.setItem('atlas.dock', JSON.stringify({v: 1, open: ['ask'], side: 264, sideCollapsed: false}));
      });
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();   // see the note in S1.1 — guard 6 clears held keys on blur
      const box = await page.$('.v2-askbox');
      check(vp.name, `[${S1_V}] the Ask box is reachable (the typing fixture exists)`, !!box,
        box ? '.v2-askbox present' : 'ABSENT — the guard below would be vacuous', 'present');
      if (box) {
        const bb = await box.boundingBox();
        await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
        await page.mouse.down(); await page.mouse.up();
        const before = await page.evaluate(POSE);
        await page.keyboard.type('was ddd', {delay: 60});
        await page.waitForTimeout(700);
        const after = await page.evaluate(POSE);
        const typed = await page.evaluate(() => document.querySelector('.v2-askbox')?.value ?? '');
        check(vp.name, `[${S1_V}] the text actually went into the box (the control arm)`,
          typed === 'was ddd', `"${typed}"`, '"was ddd"');
        check(vp.name, `[${S1_V}] typing W/A/S/D into the Ask box does NOT move the camera`,
          !!after && !!before && after.k === before.k && after.manual === false,
          `${before?.k} -> ${after?.k} (manual=${after?.manual})`, 'unmoved, still not manual');
        // AND THE SAME KEY OUTSIDE THE BOX DOES. Without this the row above passes on a
        // dispatcher that was never installed.
        await page.evaluate(() => document.querySelector('.v2-askbox')?.blur());
        await page.mouse.move(vp.width / 2, vp.height / 2);
        const outsideHold = await holdUntilMoved(page, 'KeyD', after?.k ?? '');
        const outside = outsideHold.pose;
        check(vp.name, `[${S1_V}] the same D key OUTSIDE the box pans (the second control arm)`,
          outsideHold.moved && !!outside && !!after && outside.k !== after.k,
          `${after?.k} -> ${outside?.k} · ${outsideHold.note}`, 'a different pose');
      }
    } catch (e) {
      check(vp.name, `[${S1_V}] the typing pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── S1.3 HOME FRAMES THE WHOLE BODY ──────────────────────────────────────────────────────────
  // G3's formula, measured at the two desktop widths Adrian actually uses. 20% is the kickoff's
  // bar, and it is well above the 6.04% that 1920x860 opened at before S0.
  for (const vp of [{name: 's1-home-1440', width: 1440, height: 900, dpr: 1, coarse: false},
    {name: 's1-home-1920', width: 1920, height: 860, dpr: 1, coarse: false}]) {
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 300000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();   // see the note in S1.1 — guard 6 clears held keys on blur
      // PRESSED, not called — so this covers the binding as well as the formula.
      await page.mouse.move(vp.width / 2, vp.height / 2);
      await page.keyboard.press('h');
      await page.waitForTimeout(1600);
      /**
       * ⚠️ MEASURED OVER EVERY DRAWN PART, NOT OVER THE SCENE'S FRAME SET — and the first version
       * of this row got that wrong, which is worth keeping because the failure was CONVINCING. It
       * unioned `FRAME_IDS` (the §9 scene's hamstrings and femur) and read 2.36%, then reported
       * that Home had failed its target by a factor of eight. Home's whole job is to pull the
       * camera OUT to the whole body, so those few structures becoming a small part of the picture
       * is the command working, not failing. The population a framing number is taken over is the
       * number.
       */
      const framed = await page.evaluate(() => {
        const r = window.__atlasTargets([]);
        const ps = r.parts || [];
        if (!ps.length) return {error: 'nothing drawn'};
        const left = Math.min(...ps.map((p) => p.left)), right = Math.max(...ps.map((p) => p.right));
        const top = Math.min(...ps.map((p) => p.top)), bottom = Math.max(...ps.map((p) => p.bottom));
        return {area: ((right - left) * (bottom - top)) / (r.w * r.h), touchesTop: top <= 1,
          fill: Math.max((right - left) / r.w, (bottom - top) / r.h),
          w: r.w, h: r.h, n: ps.length, box: `${Math.round(right - left)}x${Math.round(bottom - top)}`};
      });
      /**
       * ══ THE ≥20% AREA BAR IS UNREACHABLE AT 1920x860, AND THE ARITHMETIC SAYS SO ══════════════
       *
       * The kickoff asks Home to reach `area >= 0.20`. A standing human is ~0.26 as wide as it is
       * tall, and AREA is a product of both dimensions, so with the subject filling fraction `f` of
       * the field HEIGHT (the governing term — the figure is always height-bound) the ceiling is
       *
       *     area_max = f^2 * 0.26 * fieldH / fieldW
       *
       *   1440x900 (field 856x772): f=1.0 -> 23.4%   · f=0.87 (padding 1.15) -> 17.7%
       *   1920x860 (field 1036x732): f=1.0 -> 18.4%  · f=0.87 -> 13.9%
       *
       * At 1920x860 the ceiling is 18.4% WITH THE BODY TOUCHING ALL FOUR EDGES — i.e. below the
       * target before any padding exists at all, and reaching even that would require clipping,
       * which the safe-rectangle oracle forbids for good reason. The bar is not tight, it is
       * geometrically impossible at that field aspect, and no value of the studio padding constant
       * reaches it.
       *
       * SO THE ROW IS REPORTED, NOT RETUNED AND NOT DELETED: it runs, prints its measurement, and
       * is DEFERRED to Adrian with the ceiling named, exactly as the §9 and bare rows were before
       * S1 closed them. The LIVE gate beside it is `fill` — the suite's own aspect-independent
       * reading (oracle 2's "critic's rule"), which is what "Home frames the body" actually means
       * and which the geometry can satisfy.
       */
      const CEIL = (0.26 * framed.h / framed.w * 100);
      check(vp.name, `[${S1_V}] Home (H) frames the whole drawn body at >= 20% of the field`,
        !framed.error && framed.area >= 0.20,
        framed.error || `${(framed.area * 100).toFixed(2)}% of a ${framed.w}x${framed.h} field `
          + `(subject ${framed.box} px over ${framed.n} drawn parts; this field's ceiling at f=1.0 is ${CEIL.toFixed(1)}%)`,
        '>= 20%', 'ESCALATED to Adrian — a ~0.26-aspect subject cannot reach 20% of AREA in this field');
      check(vp.name, `[${S1_V}] Home fills >= 80% of the field's governing dimension`,
        !framed.error && framed.fill >= 0.80,
        framed.error || `${(framed.fill * 100).toFixed(1)}% (area ${(framed.area * 100).toFixed(2)}%)`, '>= 80%');
      check(vp.name, `[${S1_V}] Home does not clip the top of the subject`,
        !framed.error && framed.touchesTop === false,
        framed.error || `touchesTop=${framed.touchesTop}`, 'false');

      // ── ?stage=1 KEEPS THE STUDIO'S FRAMING ────────────────────────────────────────────────
      // `stage` strips the CHROME; it does not change the TIER. The first version of the `studio`
      // prop read `shell.studio && !stage`, which handed the renderer back to v1's `distance = 4`
      // at the exact moment the reader asked for the biggest possible picture — a presentation
      // mode that framed WORSE than the app it was launched from. Measured on the transition, not
      // asserted about the flag, because the flag is not what anybody sees.
      await page.keyboard.down('Shift'); await page.keyboard.press('KeyS'); await page.keyboard.up('Shift');
      await page.waitForTimeout(1600);
      const staged = await page.evaluate(() => {
        const r = window.__atlasTargets([]);
        const ps = r.parts || [];
        if (!ps.length) return {error: 'nothing drawn'};
        const left = Math.min(...ps.map((p) => p.left)), right = Math.max(...ps.map((p) => p.right));
        const top = Math.min(...ps.map((p) => p.top)), bottom = Math.max(...ps.map((p) => p.bottom));
        return {fill: Math.max((right - left) / r.w, (bottom - top) / r.h),
          staged: document.body.classList.contains('v2-stage'), w: r.w, h: r.h};
      });
      check(vp.name, `[${S1_V}] Shift+S really enters the stage (the control arm)`,
        staged.staged === true, `body.v2-stage=${staged.staged}, field ${staged.w}x${staged.h}`, 'staged');
      check(vp.name, `[${S1_V}] ?stage=1 keeps the studio framing (the subject does not shrink)`,
        !staged.error && staged.staged === true && staged.fill >= 0.80,
        staged.error || `${(staged.fill * 100).toFixed(1)}% fill staged, against ${(framed.fill * 100).toFixed(1)}% unstaged`,
        '>= 80%');
    } catch (e) {
      check(vp.name, `[${S1_V}] the Home pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── S1.4 THE ON-SCREEN PAD AND THE PHYSICAL KEY ARE ONE CONTROL ──────────────────────────────
  // `spec.md`'s requirement, and the reason the pad presses a physical CODE into the dispatcher
  // rather than calling the navigation surface itself. Read in BOTH directions: a finger on the
  // pad moves the camera, and a physical key lights the pad.
  {
    const vp = {name: 's1-pad', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();   // see the note in S1.1 — guard 6 clears held keys on blur
      const before = await page.evaluate(POSE);
      const key = await page.$('.v2-cap-key[aria-label="KeyD"]');
      check(vp.name, `[${S1_V}] the pad's D key is a real control`, !!key,
        key ? 'present, labelled by its physical code' : 'ABSENT', 'present');
      if (key) {
        // MOUSE AT COORDINATES, never page.click — this suite's own standing lesson.
        const b = await key.boundingBox();
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(450);
        const midDown = await page.evaluate(() => document.querySelector('.v2-cap-key[aria-label="KeyD"]')?.getAttribute('aria-pressed'));
        await page.mouse.up();
        await page.waitForTimeout(600);
        const after = await page.evaluate(POSE);
        check(vp.name, `[${S1_V}] holding the pad's D pans the camera`,
          !!after && !!before && after.k !== before.k, `${before?.k} -> ${after?.k}`, 'a different pose');
        check(vp.name, `[${S1_V}] the pad key reports itself pressed while held`,
          midDown === 'true', `aria-pressed=${midDown} mid-hold`, 'true');
        // OBSERVED, not slept past. A fixed wait here caught the phantom second press that a
        // mouse `click` used to fire after `pointerup` and reported it as a stuck key; the cause
        // is fixed in `shell.tsx` (keyboard-only click), and the row now waits for the condition
        // so a slow render cannot resurrect the same false reading.
        let releaseSeen = true;
        // `polling: 60` for the same reason as `holdUntilMoved`: this row reported red with a
        // MEASURED value of `false` — i.e. the condition was true and the rAF-throttled wait never
        // saw it. A wait that can time out on a satisfied condition is not measuring the product.
        await page.waitForFunction(() => document.querySelector('.v2-cap-key[aria-label="KeyD"]')?.getAttribute('aria-pressed') === 'false',
          null, {timeout: 5000, polling: 60}).catch(() => { releaseSeen = false; });
        const released = await page.evaluate(() => document.querySelector('.v2-cap-key[aria-label="KeyD"]')?.getAttribute('aria-pressed'));
        check(vp.name, `[${S1_V}] and released afterwards (no key left stuck down)`,
          releaseSeen && released === 'false', `aria-pressed=${released}${releaseSeen ? '' : ' after a 5 s wait'}`, 'false');
      }
      // THE PHYSICAL KEY LIGHTS THE ON-SCREEN ONE — the direction that proves they share ONE set
      // rather than merely both working.
      await page.mouse.move(vp.width / 2, vp.height / 2);
      // S3 PRELUDE: the two readings WAIT for the attribute rather than sleeping 300 ms past it. The
      // claim is unchanged; what changed is that a slow render now costs a wait instead of a red.
      await holdDown(page, 'KeyW');
      const lit = await padPressed(page, 'KeyW');
      await releaseKey(page, 'KeyW');
      const unlit = await padPressed(page, 'KeyW');
      check(vp.name, `[${S1_V}] a PHYSICAL W lights the on-screen W, and goes out on release`,
        lit === 'true' && unlit === 'false', `held=${lit}, released=${unlit}`, 'true then false');
    } catch (e) {
      check(vp.name, `[${S1_V}] the pad pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  /**
   * ══ S1 ROUND-1 CORRECTIVES — one row per High, each able to go red ════════════════════════════
   *
   * The stand-in review found three Highs and the suite was GREEN over all three. These are the
   * rows that would have caught them. Each is written against the DEFECT, not against the fix.
   */
  {
    const vp = {name: 's1-r1-fixes', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();

      // ── H1: a modified camera key is neither consumed nor held ─────────────────────────────
      // The defect: `bindingFor` returns null for every modified event (that IS guard 5), and the
      // hold branch read "no binding" as "hold it" — so Ctrl+A / Ctrl+S / Ctrl+D / Alt+arrow were
      // preventDefault'd AND started the camera. Select-all, Save, Bookmark and Back/Forward were
      // swallowed on every /v2/ page, at every width.
      const modPose = await page.evaluate(POSE);
      const mod = await page.evaluate(() => {
        const out = [];
        for (const [label, init] of [
          ['Ctrl+A', {code: 'KeyA', key: 'a', ctrlKey: true}],
          ['Ctrl+S', {code: 'KeyS', key: 's', ctrlKey: true}],
          ['Ctrl+D', {code: 'KeyD', key: 'd', ctrlKey: true}],
          ['Alt+ArrowLeft', {code: 'ArrowLeft', key: 'ArrowLeft', altKey: true}],
          ['Meta+A', {code: 'KeyA', key: 'a', metaKey: true}],
        ]) {
          const ev = new KeyboardEvent('keydown', {...init, bubbles: true, cancelable: true});
          window.dispatchEvent(ev);
          out.push({label, prevented: ev.defaultPrevented});
        }
        return out;
      });
      await page.waitForTimeout(500);
      const modAfter = await page.evaluate(POSE);
      const swallowed = mod.filter((m) => m.prevented).map((m) => m.label);
      check(vp.name, `[${S1_V}] a modified camera key (Ctrl/Cmd/Alt + WASD or arrow) is NOT consumed`,
        swallowed.length === 0, swallowed.length ? `swallowed: ${swallowed.join(', ')}` : `${mod.length} combinations, none prevented`, 'none prevented');
      check(vp.name, `[${S1_V}] and it does not move the camera`,
        !!modAfter && !!modPose && modAfter.k === modPose.k && modAfter.manual === false,
        `${modPose?.k} -> ${modAfter?.k} (manual=${modAfter?.manual})`, 'unmoved');
      // THE CONTROL ARM: the same codes UNMODIFIED still pan, so the row above is not passing
      // because the dispatcher is dead.
      await page.mouse.move(vp.width / 2, vp.height / 2);
      const bareHold = await holdUntilMoved(page, 'KeyA', modAfter?.k ?? '');
      const bareKey = bareHold.pose;
      check(vp.name, `[${S1_V}] the same A key UNMODIFIED still pans (the control arm)`,
        bareHold.moved && !!bareKey && bareKey.k !== modAfter.k,
        `${modAfter?.k} -> ${bareKey?.k} · ${bareHold.note}`, 'a different pose');

      /**
       * ⚠️ AND THE SAME THING WHILE A CAMERA KEY IS HELD — the case the rows above are STRUCTURALLY
       * BLIND TO, because they fire their synthetic modified events with the held set EMPTY.
       *
       * Round 2's Medium 2 added an early "a held code is consumed on every repeat" branch, and for
       * one commit it ran before the modifier was re-checked — so `Ctrl+S` pressed while `S` was
       * down was swallowed again: round 1's H1, reopened by the fix for a different finding, and
       * invisible to round 1's own oracle. A guard added in a corrective round needs a case that
       * reaches IT, not the previous round's case.
       */
      // S3 PRELUDE: the hold is OBSERVED before the synthetic events are fired. A 200 ms sleep that
      // lost the race left this sub-test firing its modified events with the held set EMPTY — i.e.
      // measuring the case the rows ABOVE already cover, and reporting it as the held case.
      const sHeld = await holdDown(page, 'KeyS');
      check(vp.name, `[${S1_V}] S is really held before the modified-while-held events (the premise)`,
        sHeld, sHeld ? 'the dispatcher reports KeyS held' : 'KeyS never registered as held', 'held');
      const heldMod = await page.evaluate(() => {
        const out = [];
        for (const [label, init] of [
          ['Ctrl+S (while S held)', {code: 'KeyS', key: 's', ctrlKey: true}],
          ['Ctrl+A (while S held)', {code: 'KeyA', key: 'a', ctrlKey: true}],
          ['Alt+ArrowLeft (while S held)', {code: 'ArrowLeft', key: 'ArrowLeft', altKey: true}],
        ]) {
          const ev = new KeyboardEvent('keydown', {...init, bubbles: true, cancelable: true});
          window.dispatchEvent(ev);
          out.push({label, prevented: ev.defaultPrevented});
        }
        return out;
      });
      await releaseKey(page, 'KeyS');
      const heldSwallowed = heldMod.filter((m) => m.prevented).map((m) => m.label);
      check(vp.name, `[${S1_V}] a modified key is NOT consumed even while a camera key is HELD`,
        heldSwallowed.length === 0,
        heldSwallowed.length ? `swallowed: ${heldSwallowed.join(', ')}` : `${heldMod.length} combinations, none prevented`,
        'none prevented');

      // ── H2: the snapshot does not leave the capture overlay painted over the field ──────────
      // The defect: `__atlasCapture` appends a `.atlas-shot` 2D canvas over the WebGL canvas and
      // only `__atlasCaptureRelease` removes it. Its one caller was v1. In /v2/ a single Shift+P
      // froze the viewport: the renderer kept drawing underneath a static bitmap, and
      // `pointer-events:none` let every gesture through, so the app was live and the picture dead.
      const shots0 = await page.evaluate(() => document.querySelectorAll('canvas.atlas-shot').length);
      check(vp.name, `[${S1_V}] no capture overlay before the snapshot (the premise)`,
        shots0 === 0, `${shots0} .atlas-shot canvases`, '0');
      // Driven through the KEYBOARD, so this covers the binding as well as the handler. The
      // download itself is suppressed: a real `a.click()` in headless Chromium would either write a
      // file or raise, and neither is what this row is about.
      await page.evaluate(() => {
        window.__shotHref = null;
        const realClick = HTMLAnchorElement.prototype.click;
        HTMLAnchorElement.prototype.click = function () { window.__shotHref = this.href; };
        window.__restoreClick = () => { HTMLAnchorElement.prototype.click = realClick; };
      });
      await page.keyboard.down('Shift'); await page.keyboard.press('KeyP'); await page.keyboard.up('Shift');
      await page.waitForTimeout(900);
      const shot = await page.evaluate(() => {
        const href = window.__shotHref;
        window.__restoreClick?.();
        return {overlays: document.querySelectorAll('canvas.atlas-shot').length,
          png: typeof href === 'string' && href.startsWith('data:image/png;base64,'),
          bytes: typeof href === 'string' ? href.length : 0};
      });
      check(vp.name, `[${S1_V}] Shift+P leaves NO capture overlay over the field`,
        shot.overlays === 0, `${shot.overlays} .atlas-shot canvases after the snapshot`, '0');
      check(vp.name, `[${S1_V}] and it produced a real PNG (not a blank read of a cleared buffer)`,
        shot.png && shot.bytes > 20000, `data URL ${shot.png ? 'png' : 'MISSING'}, ${shot.bytes} chars`, 'a png data URL of real size');
      // THE VIEWPORT IS STILL LIVE afterwards — the actual user-visible consequence.
      const preMove = await page.evaluate(POSE);
      const postHold = await holdUntilMoved(page, 'KeyD', preMove?.k ?? '');
      const postMove = postHold.pose;
      // ⚠️ NAMED FOR WHAT IT MEASURES. It reads `__atlasNav.pose()`, which a DOM overlay cannot
      // affect — so it passed UNDER the defect and is NOT the row that catches H2 (round 2, Medium
      // 4). The row above it, counting `.atlas-shot` canvases, is the one that bites. This one says
      // the command did not leave the dispatcher wedged, which is a different and smaller claim.
      check(vp.name, `[${S1_V}] the dispatcher still answers after a snapshot (NOT a test of the overlay)`,
        postHold.moved && !!postMove && !!preMove && postMove.k !== preMove.k,
        `${preMove?.k} -> ${postMove?.k} · ${postHold.note}`, 'a different pose');

      // ── M7: a modifier pressed while a camera key is HELD must not fire its discrete twin ────
      // Holding `S` to pan and then pressing Shift used to enter presentation mode mid-pan. No
      // oracle covered it in round 1 (round 2, Low e).
      /**
       * ⚠️ THE SHIFTED REPEAT IS SYNTHESISED, because Playwright cannot produce it. Round 3 proved
       * the first version of this row could not go red: `keyboard.down('Shift')` sends `ShiftLeft`
       * and nothing else, so no `KeyS`-with-shift keydown ever reached the dispatcher and the row
       * was green with the guard deleted. A real keyboard sends exactly that event — the auto-repeat
       * of a held key, now carrying `shiftKey` — so the oracle sends it too.
       */
      // S3 PRELUDE: observed, not slept. If `KeyS` is not really held the synthetic shifted repeat
      // below measures the UNHELD case, which is the opposite of what this row claims to test.
      const sHeld2 = await holdDown(page, 'KeyS');
      check(vp.name, `[${S1_V}] S is really held before the shifted repeat (the premise)`,
        sHeld2, sHeld2 ? 'the dispatcher reports KeyS held' : 'KeyS never registered as held', 'held');
      const midPan = await page.evaluate(() => {
        const ev = new KeyboardEvent('keydown', {code: 'KeyS', key: 'S', shiftKey: true, repeat: true, bubbles: true, cancelable: true});
        window.dispatchEvent(ev);
        return {staged: document.body.classList.contains('v2-stage'), prevented: ev.defaultPrevented};
      });
      await releaseKey(page, 'KeyS');
      const stagedAfter = await page.evaluate(() => document.body.classList.contains('v2-stage'));
      check(vp.name, `[${S1_V}] Shift arriving while S is HELD does not enter the stage`,
        midPan.staged === false && stagedAfter === false,
        `v2-stage mid-hold=${midPan.staged}, after release=${stagedAfter} (prevented=${midPan.prevented})`, 'false');
      // THE CONTROL ARM: the same Shift+S with NOTHING held does enter the stage, so the row above
      // is not passing because `stage` is unreachable in general.
      await page.keyboard.down('Shift'); await page.keyboard.press('KeyS'); await page.keyboard.up('Shift');
      await page.waitForTimeout(700);
      const stagedFree = await page.evaluate(() => document.body.classList.contains('v2-stage'));
      check(vp.name, `[${S1_V}] and Shift+S with nothing held DOES enter it (the control arm)`,
        stagedFree === true, `v2-stage=${stagedFree}`, 'true');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // ── M6: Escape leaves the stage ────────────────────────────────────────────────────────
      // ⚠️ THE HELD SET IS CLEARED FIRST, and the clear is ASSERTED. In round 2 this row failed in
      // the H1 red build for a reason that had nothing to do with M6: the synthetic `Ctrl+S` above
      // has no matching keyup, so under the defect it left `KeyS` stuck in `held`, and the new
      // "a held code belongs to its hold" rule then blocked `stage`. The row was order-coupled to
      // the sub-test above it and could not go red for M6 alone. `blur` is the product's own
      // clearing path (guard 6), so this uses it rather than inventing a back door.
      await page.evaluate(() => window.dispatchEvent(new Event('blur')));
      await page.waitForTimeout(200);
      const padsLit = await page.evaluate(() => [...document.querySelectorAll('.v2-cap-key[aria-pressed="true"]')].length);
      check(vp.name, `[${S1_V}] the held set is empty before the stage sub-test (no order coupling)`,
        padsLit === 0, `${padsLit} pad keys still lit`, '0');
      await page.keyboard.down('Shift'); await page.keyboard.press('KeyS'); await page.keyboard.up('Shift');
      await page.waitForTimeout(900);
      const inStage = await page.evaluate(() => document.body.classList.contains('v2-stage'));
      await page.keyboard.press('Escape');
      await page.waitForTimeout(900);
      const outStage = await page.evaluate(() => document.body.classList.contains('v2-stage'));
      check(vp.name, `[${S1_V}] Shift+S enters the stage and Escape leaves it`,
        inStage === true && outStage === false, `entered=${inStage}, still staged after Escape=${outStage}`,
        'entered, then left');
    } catch (e) {
      check(vp.name, `[${S1_V}] the round-1 corrective pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  /**
   * ── A SCENE THAT DECLARES NO `camera.focus` ──────────────────────────────────────────────────
   *
   * The branch three review rounds kept finding defects in, and which no fixture reached. Two
   * claims, and the second is the one round 3's High was about.
   */
  {
    const vp = {name: 's1-nofocus', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB_NOFOCUS}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 300000}).catch(() => {});
      await page.waitForTimeout(1600);
      await page.bringToFront();
      const r = await page.evaluate(() => {
        const t = window.__atlasTargets([]);
        return {fitKey: t.fit?.key ?? '', focus: t.fit?.focus ?? 0, frame: t.fit?.frame ?? 0};
      });
      // 1. THE SCENE REALLY DECLARES NO FOCUS — the premise. Without it the two rows below would be
      //    measuring the ordinary focus-bearing path under a different name.
      const declared = await page.evaluate(() => {
        const b = new URLSearchParams(location.search).get('scene');
        if (!b) return null;
        try { return JSON.parse(atob(b.replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
      });
      check(vp.name, `[${S1_V}] the fixture really declares no camera.focus (the premise)`,
        !!declared && !(declared.camera?.focus ?? []).length,
        `camera.focus=${JSON.stringify(declared?.camera?.focus ?? null)}`, 'absent or empty');
      // 2. THE STUDIO STILL ARMS THE FOCUS FIT. Without `studioFrame` covering this case, F fell
      //    through to Home and the scene opened on the whole body.
      check(vp.name, `[${S1_V}] a focus-less scene still arms the focus fit in the studio`,
        !!r.fitKey && r.focus > 0, `fit.key=${r.fitKey ? 'set' : 'empty'} focus=${r.focus} frame=${r.frame}`,
        'a non-empty key and focus > 0');
      // 3. AND THE GHOST IS NOT PULLED INTO THE CONTAINMENT SET. `sceneFrameIds` excludes ghosts by
      //    measured design (L31 D04); `studioFrame` is built from the selection, which includes
      //    them, and spreading it over the plate clobbered `plate.frame`. Round 3, High 2.
      /**
       * The renderer does not expose the frame set BY NAME, so this compares its SIZE against every
       * part the scene draws. The ghost (`FMA16203`, the lumbar column) is 10 of those parts, so a
       * clobbered frame set equals the drawn total and a correct one is strictly smaller. Derived
       * from the page rather than hardcoded, so re-curating the atlas cannot make it lie.
       */
      const framed = await page.evaluate((id) => {
        const t = window.__atlasTargets([id]);
        return {frame: t.fit?.frame ?? 0, drawn: (t.parts || []).length, ghostDrawn: !!(t.groups || {})[id]};
      }, GHOST_ID);
      check(vp.name, `[${S1_V}] the ghost IS drawn (so excluding it from the frame set is meaningful)`,
        framed.ghostDrawn === true, `ghost drawn=${framed.ghostDrawn}, ${framed.drawn} parts on screen`, 'drawn');
      check(vp.name, `[${S1_V}] the ghost is NOT pulled into the frame set of a focus-less scene`,
        framed.frame > 0 && framed.frame < framed.drawn,
        `${framed.frame} frame members of ${framed.drawn} drawn parts`,
        'strictly fewer than every drawn part');
    } catch (e) {
      check(vp.name, `[${S1_V}] the focus-less scene pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── M5: THE CAMERA KEYS BELONG TO THE STUDIO TIER ────────────────────────────────────────────
  // Below 1180 there is no pill, no key pad, and `manual` is never read — so W/A/S/D panned and `H`
  // ran G3's whole-body formula on a tier it was never tuned for, after which the next resize threw
  // the pose away. The keys did not feel absent, they felt broken.
  for (const vp of [{name: 's1-tier-1100', width: 1100, height: 900, dpr: 1, coarse: false, studio: false},
    {name: 's1-tier-1180', width: 1180, height: 900, dpr: 1, coarse: false, studio: true}]) {
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();
      const isStudio = await page.evaluate(() => !!document.querySelector('.v2.v2-studio'));
      check(vp.name, `[${S1_V}] the tier is what this viewport is supposed to be (the premise)`,
        isStudio === vp.studio, `.v2-studio=${isStudio} at ${vp.width}px`, String(vp.studio));
      const before = await page.evaluate(POSE);
      await page.mouse.move(vp.width / 2, vp.height / 2);
      /**
       * S3 PRELUDE, AND THE ONE ROW WHERE THE TWO TIERS NEED TWO INSTRUMENTS.
       *
       * In the studio the claim is "it moved", so it waits on the state (`holdUntilMoved`). Below
       * 1180 the claim is "it did NOT move" and there IS no pad — guard 7 withholds the camera
       * commands and `StudioField` is unmounted — so there is no held-set reflection to wait on and
       * nothing to wait FOR. A bounded hold is the honest instrument for a negative: hold for longer
       * than the studio arm needs to move, then read. (Using the state-waiting helper here would
       * spend three timeouts proving the absence of a DOM node and report it as if the camera were
       * the thing being measured.)
       */
      let after, note;
      if (vp.studio) {
        const hold = await holdUntilMoved(page, 'KeyD', before?.k ?? '');
        after = hold.pose; note = hold.note;
      } else {
        await page.keyboard.down('KeyD'); await page.waitForTimeout(900); await page.keyboard.up('KeyD');
        await page.waitForTimeout(400);
        after = await page.evaluate(POSE);
        note = 'a bounded 900 ms hold — there is no pad below 1180 to observe';
      }
      await page.keyboard.press('h');
      await page.waitForTimeout(900);
      const settled = await page.evaluate(POSE);
      const moved = !!settled && !!before && settled.k !== before.k;
      check(vp.name, `[${S1_V}] the camera keys ${vp.studio ? 'WORK in the studio' : 'are WITHHELD below 1180'}`,
        moved === vp.studio, `${before?.k} -> ${after?.k} -> ${settled?.k} (moved=${moved}) · ${note}`,
        vp.studio ? 'the camera moved' : 'the camera did not move');

      /**
       * ⚠️ AND THE NAMED VIEWS AND RESET STILL WORK AT EVERY TIER — the row that would have caught
       * round 2's High.
       *
       * Guard 7 was written for the camera KEYS (W/A/S/D, the arrows, `H`), whose only surface is
       * the studio. The first version also withheld `1 2 3 4` and `R`, which are controller
       * dispatches with real on-screen buttons on the phone and the tablet: they worked on every
       * tier before S1 and were dead below 1180 for one commit. The key-map row went on passing at
       * 390×844, because those rows carry no `owner` and therefore read as live — a green suite
       * certifying a product claim that had just become false.
       *
       * `view` is read off the CONTROLLER rather than off the camera, because at a tier where the
       * camera keys are withheld the camera is the wrong instrument for "did the command land".
       */
      // ⚠️ `2` (FRONT), NOT `3` (side). The §9 fixture declares `view: 'side'`, so a row that
      // pressed 3 read "side -> side" and failed its own precondition at BOTH tiers — including the
      // studio, where the command works. It could go red, but not for the reason it named, which is
      // the same defect class as everything else this pass is about. Caught in the red proof.
      const viewBefore = await page.evaluate(() => window.atlas?.state?.()?.view ?? null);
      await page.keyboard.press('2');          // Digit2 -> front
      await page.waitForTimeout(700);
      const viewAfter = await page.evaluate(() => window.atlas?.state?.()?.view ?? null);
      check(vp.name, `[${S1_V}] the named views (1 2 3 4) work at THIS tier, studio or not`,
        viewAfter === 'front' && viewBefore !== 'front',
        `view ${viewBefore} -> ${viewAfter}`, 'front (and it was not already)');
    } catch (e) {
      check(vp.name, `[${S1_V}] the tier-gate pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── THE COLLAPSE LADDER, DRIVEN ───────────────────────────────────────────────────────────────
  // Not the pure function (that is unit-tested) — the RENDERED consequence, seeded through the very
  // persistence layer a human's browser would carry: a 420 px sidebar and two docks at 1180, which
  // is `spec.md`'s own worked example and does not fit.
  {
    const vp = {name: 'ladder-1180', width: 1180, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.addInitScript(() => {
        localStorage.setItem('atlas.dock', JSON.stringify({v: 1, open: ['json', 'selection'], side: 420, sideCollapsed: false}));
      });
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const g = await page.evaluate(() => {
        const f = document.querySelector('.v2-field').getBoundingClientRect();
        const s = document.querySelector('.v2-side')?.getBoundingClientRect();
        return {
          field: Math.round(f.width), side: s ? Math.round(s.width) : null,
          panes: document.querySelectorAll('.v2-pane').length,
          announced: !!document.querySelector('.v2-status .is-warn'),
          announceText: document.querySelector('.v2-status .is-warn')?.textContent ?? '',
          togglesStillThere: document.querySelectorAll('.v2-tools .v2-tbtn[aria-pressed]').length,
        };
      });
      // 1180 - 420 - (360 + 320) = 80. The ladder closes the last-opened dock (selection, 320) to
      // reach 400 — still short — then the remaining json (360) to reach 760. The sidebar stays.
      check(vp.name, `[${STUDIO_V}] a 420 px sidebar + two docks at 1180 collapses to a >= 420 field, deterministically`,
        g.field >= 420 && g.panes === 0 && g.side === 420,
        `field=${g.field} side=${g.side} panes=${g.panes}`, 'field 760, side 420, 0 docks');
      check(vp.name, `[${STUDIO_V}] and it ANNOUNCES the automatic collapse rather than doing it silently`,
        g.announced, g.announced ? `announced: "${g.announceText.slice(0, 60)}"` : 'no announcement', 'announced');
      check(vp.name, `[${STUDIO_V}] the panel toggles survive the collapse (the way back is never removed)`,
        g.togglesStillThere >= 4, `${g.togglesStillThere} toggles`, '>= 4');
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the ladder pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── H1 — A NARROW FIRST VISIT MUST NOT CLOSE THE >=1600 DEFAULT ───────────────────────────────
  // The defect the S0 stand-in review executed: the shell seeded the tier's DEFAULT into
  // `atlas.dock` on the first visit at any width, so a human whose first visit was 1440 (or a
  // phone) had `['selection']` on disk, and every later 1920 visit read it back as a CHOICE and
  // served one dock forever. G2's two-panel board became unreachable, permanently.
  //
  // THE UNIT TESTS CANNOT SEE THIS: the write lived in a React hook. So it is asserted here, in the
  // only place the whole sequence exists — one browser profile, two visits, localStorage between
  // them. The control arm is the SAME profile continuing to honour a REAL choice.
  {
    const vp = {name: 'dock-default-1920', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      // VISIT 1, narrow. This is the visit that used to write the narrow default to disk.
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const firstVisit = await page.evaluate(() => ({
        panes: document.querySelectorAll('.v2-pane').length,
        stored: localStorage.getItem('atlas.dock'),
      }));
      check(vp.name, `[${STUDIO_V}] H1: a narrow visit shows one dock and WRITES NOTHING to atlas.dock`,
        firstVisit.panes === 1 && firstVisit.stored === null,
        `${firstVisit.panes} pane(s), atlas.dock=${firstVisit.stored === null ? 'absent' : firstVisit.stored}`,
        '1 pane, key absent');

      // VISIT 2, wide, SAME PROFILE. Two docks, because nothing was ever chosen.
      await page.setViewportSize({width: 1920, height: 860});
      await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const wide = await page.evaluate(() => ({
        panes: [...document.querySelectorAll('.v2-pane')].map((n) => Math.round(n.getBoundingClientRect().width)),
        dock: Math.round(document.querySelector('.v2-dock')?.getBoundingClientRect().width ?? 0),
      }));
      check(vp.name, `[${STUDIO_V}] H1: the SAME profile then gets D2's two docks at 1920`,
        wide.panes.length === 2 && wide.dock === 620,
        `[${wide.panes.join(', ')}] column ${wide.dock}`, '[320, 300], column 620');

      // THE CONTROL ARM. A real choice must still win, or the fix has simply stopped persisting.
      const closeBtn = await page.$('.v2-pane-x');
      if (closeBtn) { const r = await closeBtn.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
      await page.waitForTimeout(500);
      await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const chosen = await page.evaluate(() => ({
        panes: document.querySelectorAll('.v2-pane').length,
        stored: localStorage.getItem('atlas.dock'),
      }));
      check(vp.name, `[${STUDIO_V}] H1 control arm: an ACTUAL choice persists and beats the tier default`,
        chosen.panes === 1 && typeof chosen.stored === 'string' && /"open":\s*\[/.test(chosen.stored),
        `${chosen.panes} pane(s) after a reload, atlas.dock=${String(chosen.stored).slice(0, 70)}`,
        '1 pane, and the key now holds a real ARRAY');
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the dock-default pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── H3 — THE SYSTEM CHECKBOX SHOWS THE HUMAN'S SET, NOT THE SCENE'S GHOST ─────────────────────
  // The controller keeps the two facts apart; the UI has to READ the right one. Before the fix the
  // phone's systems panel displayed `render.visible`, so after a ghost link the human's own choice
  // rendered as unticked — and the handler recomputed the next set from what it displayed, writing
  // the ghost into the intent on the first click. A reducer test cannot see any of that: the defect
  // was in JSX. One navigation reproduces it: `system=` sets the intent, the scene's skeletal rest
  // overrides what is DRAWN, and the two must disagree on screen in exactly one direction.
  {
    const vp = {name: 'systems-intent', width: 390, height: 844, dpr: 3, coarse: true};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      const ghost = encodeScene(normalizeScene({...SCENE, rest: {include: 'skeletal', opacity: 0.08}}));
      await page.goto(`${base}${path}?system=muscular,nervous&scene=${ghost}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(1200);
      // Open the margin, then the Systems panel — real pointer at a real point, never page.click.
      const press = async (el) => { const r = await el.boundingBox(); if (!r) return false; await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(500); return true; };
      const handle = await page.$('.v2-handle');
      if (handle) await press(handle);
      const sysBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.v2-actions button')]
        .find((b) => (b.textContent || '').trim() === 'Systems' || (b.textContent || '').trim() === '系统' || (b.textContent || '').trim() === '系統') ?? null);
      const sysEl = sysBtn.asElement();
      if (sysEl) await press(sysEl);
      /**
       * ⚠️ S3 MOVED THE SURFACE, NOT THE FACT — and this pass is re-pointed rather than retired.
       *
       * The claim is about `visibleIntent`: after a GHOST scene, the control that represents the
       * HUMAN's system set must still show the human's set and not the scene's. Below 768 that
       * control used to be `.v2-systems label` (a flat checkbox list); S3 replaced it with the tree,
       * where the same fact is the SYSTEM ROW'S EYE (`aria-pressed` is the inverse of "in the
       * intent", because the button's pressed state means HIDDEN). The tablet keeps the old list, so
       * both spellings are read and whichever exists is measured.
       *
       * Re-pointing an oracle at a moved surface is legitimate; deleting it because the selector
       * stopped matching would have silently retired the guard for H3.
       */
      const seen = await page.evaluate(() => {
        const legacy = [...document.querySelectorAll('.v2-systems label')].map((l) => ({
          name: (l.querySelector('span:not(.v2-box):not(.v2-dot)')?.textContent || '').trim(),
          checked: !!l.querySelector('input')?.checked,
        }));
        const tree = [...document.querySelectorAll('.v2-tree-row.is-system')].map((r) => ({
          name: (r.querySelector('.v2-tree-name b')?.textContent || '').trim(),
          /**
           * ⚠️ RE-POINTED AGAIN AT S3b, AND THE FACT MOVED OFF THE EYE — codex round 4, High 4.
           *
           * S3 read the eye's `aria-pressed`, which was `visibleIntent`. Round 4 proved that
           * WRONG AS AN EYE: the renderer draws `render.visible`, a ghost scene's arrival rewrites
           * it to `['skeletal']`, and `system=` serialises the render value — so the eye reported
           * "skeletal hidden" over a drawn skeleton and produced a link that said `system=skeletal`.
           * The eye now reads what is drawn.
           *
           * The INTENT did not disappear; it moved to the row's `data-intent`, which is the fact
           * this pass has always been about. Reading it here is not a weakening — it is STRONGER,
           * because `eye` is captured beside it and the row below asserts the two DIVERGE, which is
           * the divergence the whole pass exists to prove and which S3's spelling could only infer.
           */
          checked: r.getAttribute('data-intent') === 'on',
          eye: r.querySelector('.v2-eye')?.getAttribute('aria-pressed') === 'false',
        }));
        const rows = legacy.length ? legacy : tree;
        return {rows, count: rows.length, surface: legacy.length ? 'v2-systems (tablet)' : 'the tree (phone, S3)',
          blob: window.atlas?.plate?.()?.blob ?? ''};
      });
      const ticked = seen.rows.filter((r) => r.checked).map((r) => r.name).sort();
      // THE FIXTURE IS A zh-Hans SCENE, so the rows are labelled in Chinese — the first version of
      // this row asserted the English names and failed on its own fixture while the app was right.
      // Both spellings, because the assertion is about WHICH SYSTEMS, not about which language.
      const isMuscle = (n) => /Muscles|肌肉/.test(n);
      const isNerve = (n) => /Nervous system|神经系统|神經系統/.test(n);
      check(vp.name, `[${STUDIO_V}] H3: after a GHOST scene the systems panel still shows the human's own set`,
        seen.count > 0 && ticked.length === 2 && ticked.some(isMuscle) && ticked.some(isNerve),
        seen.count ? `${seen.count} rows on ${seen.surface}, ticked: [${ticked.join(', ')}]` : 'the systems panel never opened',
        'exactly Muscles + Nervous system ticked');
      check(vp.name, `[${STUDIO_V}] H3: and the SKELETON the ghost draws is NOT ticked (two facts, two sources)`,
        seen.count > 0 && !seen.rows.some((r) => r.checked && /Skeleton|骨骼/.test(r.name)),
        `Skeleton ticked=${seen.rows.some((r) => r.checked && /Skeleton|骨骼/.test(r.name))}`,
        'not ticked');
      // ⚠️ THE CONTROL ARM, and without it the two rows above prove nothing. They assert what the
      // INTENT shows; if the ghost ever silently stopped applying — `normalizeScene` dropping
      // `rest.include`, the scene failing for an unrelated reason — the two facts would be EQUAL and
      // both rows would go green while the divergence they exist to test had disappeared. That is
      // the fake-green shape round 1 found elsewhere, landing inside the fix for H3 (round 2, M1).
      //
      // The RENDER's visibility set is deliberately not on the public tool surface, so the control
      // arm reads the SCENE the page is actually holding — through `atlas.plate()`, decoded here —
      // and asserts it declares the skeletal rest. That is the fact `apply-scene` turns into
      // `render.visible = ['skeletal']` (controller.ts), so proving it present proves there was
      // something for the intent to diverge FROM.
      // ⚠️ S3b — THE DIVERGENCE ITSELF, asserted directly for the first time. The two rows above say
      // what the INTENT shows; this says the EYE shows the other thing, on the same rows, in the
      // same reading. It is the row that would go red if a future change re-pointed the eye back at
      // the intent (the round-4 High) or the intent at the render value (the row above would pass
      // vacuously if both collapsed onto one fact — this one would not).
      const eyed = seen.rows.filter((r) => r.eye).map((r) => r.name).sort();
      check(vp.name, `[${STUDIO_V}] H4: the EYE shows what the ghost DRAWS (skeleton), not the human's set`,
        seen.count > 0 && eyed.some((n) => /Skeleton|骨骼/.test(n)) && !eyed.some(isMuscle),
        `eyes on: [${eyed.join(', ')}] · intent: [${ticked.join(', ')}]`,
        'Skeleton eye on, Muscles eye off — the inverse of the intent');
      const held = seen.blob ? decodeScene(seen.blob) : null;
      check(vp.name, `[${STUDIO_V}] H3 control arm: the scene on screen really does declare the skeletal ghost`,
        held?.rest?.include === 'skeletal',
        `rest.include=${held?.rest?.include ?? 'no scene decoded'}`,
        "'skeletal' — otherwise there was nothing to diverge from");
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the systems-intent pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── D10 — THE MANUALLY COLLAPSED BOARD ────────────────────────────────────────────────────────
  // `mock-spec.md` D10: side 44, field 1396x772, docks zero. The ladder's 44 px stub branch had no
  // rendered oracle at all -- the driven ladder above seeds `sideCollapsed:false`, so the stub was
  // reachable only through a path nothing took. D10 is also the state that proves the difference
  // between a HUMAN collapse and an automatic one: `status.autoCollapsed` must stay SILENT here.
  {
    const vp = {name: 'collapsed-1440', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      await page.addInitScript(() => {
        localStorage.setItem('atlas.dock', JSON.stringify({v: 1, open: [], side: 264, sideCollapsed: true}));
      });
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const g = await page.evaluate(() => {
        const r = (sel) => { const n = document.querySelector(sel); return n ? Math.round(n.getBoundingClientRect().width) : 0; };
        return {
          side: r('.v2-side'), field: r('.v2-field'), dock: r('.v2-dock'),
          fieldH: Math.round(document.querySelector('.v2-field')?.getBoundingClientRect().height ?? 0),
          stub: !!document.querySelector('.v2-side.is-stub'),
          announced: !!document.querySelector('.v2-status .is-warn'),
          restore: !!document.querySelector('.v2-side .v2-tbtn'),
        };
      });
      check(vp.name, `[${STUDIO_V}] D10: a collapsed sidebar is 44 / field 1396x772 / no docks`,
        g.side === 44 && g.field === 1396 && g.fieldH === 772 && g.dock === 0 && g.stub,
        `side ${g.side} / field ${g.field}x${g.fieldH} / dock ${g.dock} / stub=${g.stub}`,
        'side 44, field 1396x772, dock 0');
      check(vp.name, `[${STUDIO_V}] D10: a HUMAN collapse is not announced as an automatic one`,
        g.announced === false, `status.autoCollapsed shown=${g.announced}`, 'silent');
      check(vp.name, `[${STUDIO_V}] D10: the stub keeps the control that restores it`,
        g.restore, `restore control present=${g.restore}`, 'present');
      await page.screenshot({path: join(outDir, `${label}-studio-collapsed.png`), timeout: SHOT_MS});
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the collapsed pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── A CORRUPT PERSISTED VALUE IN EVERY KEY STILL RENDERS THE SHELL (RC12) ─────────────────────
  {
    const vp = {name: 'corrupt-prefs', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
    try {
      await page.addInitScript(() => {
        for (const k of ['atlas.dock', 'atlas.pinyin', 'atlas.scenes', 'atlas.openai']) {
          localStorage.setItem(k, '{"v":99,"open":"not-an-array","side":"wide"');   // unparseable AND wrong-shaped
        }
      });
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const g = await page.evaluate(() => ({
        bar: !!document.querySelector('.v2-bar'), side: Math.round(document.querySelector('.v2-side')?.getBoundingClientRect().width ?? 0),
        field: Math.round(document.querySelector('.v2-field')?.getBoundingClientRect().width ?? 0),
        panes: document.querySelectorAll('.v2-pane').length,
      }));
      check(vp.name, `[${STUDIO_V}] a corrupt value in EVERY persisted key still renders the shell at its defaults`,
        g.bar && g.side === 264 && g.field >= 420 && g.panes === 1 && errs.length === 0,
        `bar=${g.bar} side=${g.side} field=${g.field} panes=${g.panes} pageerrors=${errs.length ? errs[0] : 0}`,
        'bar, side 264, one dock, no page error');
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the corrupt-prefs pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── THE PROBE PANEL SURVIVES THE SHELL, AND STAGE STILL HIDES IT (G5 / RC6) ───────────────────
  // `?probe=1` is the only real-device timing lane this project has, and v2.1b's shell deletes the
  // container it used to live in. It was lifted into `.v2-chrome` in v2.1a; this proves the lift
  // holds at the two studio widths and that the stage fence still covers it.
  for (const w of [1440, 1920]) {
    const vp = {name: `probe-${w}`, width: w, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    let shownUnstaged = false;
    try {
      for (const q of ['probe=1', 'stage=1&probe=1']) {
        await page.goto(`${base}${path}?${q}&scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
        await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
        await page.waitForTimeout(1400);
        const seen = await page.evaluate(() => {
          const el = document.querySelector('.v2-probe');
          if (!el) return {shown: false, close: false};
          const cs = getComputedStyle(el), r = el.getBoundingClientRect();
          return {
            shown: cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0,
            close: !!document.querySelector('.v2-probe-close'),
            w: Math.round(r.width),
          };
        });
        const staged = q.startsWith('stage');
        if (!staged) shownUnstaged = seen.shown && seen.close;
        // ⚠️ THE HIDDEN CASE IS CONDITIONED ON THE SHOWN CASE. "`.v2-probe` is not visible" is
        // satisfied by a probe that is broken, unrendered or renamed -- so the fence row would pass
        // for reasons that have nothing to do with the fence. It only means anything once the same
        // panel has been seen to render one navigation earlier (stand-in review M9).
        check(vp.name, `[${STUDIO_V}] ?${q}: the probe panel is ${staged ? 'HIDDEN by the stage fence (having just been shown unstaged)' : 'reachable at the studio tier, with its close control'}`,
          staged ? (shownUnstaged && !seen.shown) : (seen.shown && seen.close),
          `shown=${seen.shown} close=${seen.close}${seen.w ? ` w=${seen.w}` : ''}${staged ? ` [unstaged control: ${shownUnstaged}]` : ''}`,
          staged ? 'shown unstaged, hidden staged' : 'shown, closable');
      }
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the probe pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  // ── THE CJK GUARD, EXTENDED TO THE STUDIO'S OWN ROWS ──────────────────────────────────────────
  // The existing guard covers `.v2-term b`, which the studio does not render. A Tailwind import or
  // a stray `:root` would pull v1's Latin stack over the forked CJK stacks — invisible in 简体,
  // WRONG CHARACTERS in 繁體 (Simplified glyph variants), in a vocabulary-teaching tool.
  {
    const vp = {name: 'cjk-studio', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      // ⚠️ `?lang=` LOSES TO THE SCENE'S OWN `lang`. `BLOB` declares zh-Hans, so `?lang=zh-Hant` on
      // it leaves the page in Simplified and this row measured the SC stack while claiming to test
      // TC — a check that could never have gone red for the reason it names. The blob carries the
      // language, so the fixture has to.
      const hantBlob = encodeScene(normalizeScene({...SCENE, lang: 'zh-Hant'}));
      await page.goto(`${base}${path}?scene=${hantBlob}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForTimeout(900);
      const fonts = await page.evaluate(() => {
        const out = {};
        for (const sel of ['.v2-bar-text b', '.v2-tree-name', '.v2-card b', '.v2-status > span']) {
          const el = document.querySelector(sel);
          out[sel] = el ? getComputedStyle(el).fontFamily : null;
        }
        return {out, lang: document.documentElement.lang};
      });
      const rows = Object.entries(fonts.out);
      const bad = rows.filter(([, v]) => !v || !/PingFang TC|Noto Sans (CJK )?TC|Source Han Sans TC|JhengHei/i.test(v));
      check(vp.name, `[${STUDIO_V}] every studio text row resolves the zh-Hant CJK stack, not v1's Latin one`,
        fonts.lang === 'zh-Hant' && bad.length === 0,
        bad.length ? `${bad.map(([k, v]) => `${k}: ${String(v).slice(0, 60)}`).join(' | ')}` : `${rows.length} rows, all TC (lang=${fonts.lang})`,
        'the TC stack on every row');
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the CJK pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  /**
   * ══ S3b — `?lang=` SURVIVES A SCENE THAT NEVER DECLARED ONE ════════════════════════════════════
   *
   * The defect, reproduced on the LIVE S2 deploy before it was touched: a link carrying BOTH a valid
   * `scene=` and an explicit `?lang=` reverted to English ~900 ms after entry and then dropped
   * `lang=` from the address bar. Root cause is one line — `page.tsx applySceneState` did
   * `if (sc.lang) applyLang(sc.lang)` while `scene-codec.js normalizeScene` DEFAULTS `lang` to
   * `'en'`, so the guard was always true and a scene that said nothing about language asserted
   * English over the reader's explicit choice.
   *
   * FOUR CASES, and three of them were already green — which is exactly why the fourth survived:
   * every obvious spelling of "does `?lang=` work" passed.
   *
   *   `?lang=`                  ✅ before and after
   *   `?select=…&lang=`         ✅ before and after
   *   `?scene=<garbage>&lang=`  ✅ before and after (no scene arrives, so nothing overrides)
   *   `?scene=<valid>&lang=`    ❌ before · ✅ after   ← the row that bites
   *
   * ⚠️ AND THE CONTROL ARM, which is what stops this passing for the wrong reason: a scene that DOES
   * declare a language must still win. Without that row, "never apply a scene's language" would pass
   * all four above and silently break every teaching plate authored in Chinese.
   *
   * ⚠️ ON THE S2 SUITE: the S3 worklog predicted this fix would flip named palette rows, because
   * they "rely on the fixture scene forcing zh-Hans". MEASURED, and the prediction was WRONG: the §9
   * fixture DECLARES `lang: 'zh-Hans'` (verify-ux.mjs:88), so it is on the winning side of the new
   * rule and every one of those rows keeps its expectation and its value. The declaring-scene row
   * below pins that, so the claim is a measurement and not a memory.
   */
  {
    const vp = {name: 'lang-vs-scene', width: 1440, height: 900, dpr: 1, coarse: false};
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    try {
      // A scene with NO `lang` key at all — the case the whole defect is about. `?select=` ids so it
      // is a real, applicable view rather than a curiosity.
      const mute = encodeScene(normalizeScene({mode: 'render', structures: SCENE.structures.map((s) => ({id: s.id, role: s.role}))}));
      const declaring = encodeScene(normalizeScene({...SCENE, lang: 'zh-Hant'}));
      const cases = [
        ['?lang= alone', `?lang=zh-Hans`, 'zh-Hans'],
        ['?select= + ?lang=', `?select=FMA22359&lang=zh-Hans`, 'zh-Hans'],
        ['a GARBAGE scene + ?lang=', `?scene=not-a-real-blob&lang=zh-Hans`, 'zh-Hans'],
        ['a VALID scene that declares NOTHING + ?lang=', `?scene=${mute}&lang=zh-Hans`, 'zh-Hans'],
        ['a scene that DOES declare, + a different ?lang=', `?scene=${declaring}&lang=zh-Hans`, 'zh-Hant'],
      ];
      for (const [label, query, want] of cases) {
        await page.goto(`${base}${path}${query}`, {waitUntil: 'domcontentloaded', timeout: 180000});
        await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
        // ⚠️ WAIT PAST THE REVERT, don't race it. The old behaviour was zh-Hans at 400 ms and English
        // at 3 s — a probe that read early would have reported the defect as fixed.
        await page.waitForTimeout(2600);
        const seen = await page.evaluate(() => ({
          lang: document.documentElement.lang,
          stored: (() => { try { return localStorage.getItem('atlas.lang'); } catch { return null; } })(),
          url: location.search + location.hash,
        }));
        check(vp.name, `[${STUDIO_V}] ${label} -> ${want}`,
          seen.lang === want,
          `document.lang=${seen.lang} · localStorage=${seen.stored} · url=${String(seen.url).replace(/scene=[^&]{12}[^&]*/, 'scene=<blob>').slice(0, 90)}`,
          want);
        // The second half of the same defect: the serializer dropped `lang=` once the scene had
        // overridden it, so the link could not be re-read even by hand.
        if (want !== 'en') {
          check(vp.name, `[${STUDIO_V}] ${label} -> the URL still carries lang=${want} after the debounced write`,
            new RegExp(`lang=${want}`).test(String(seen.url)),
            String(seen.url).replace(/scene=[^&]{12}[^&]*/, 'scene=<blob>').slice(0, 120),
            `lang=${want} present`);
        }
      }
    } catch (e) {
      check(vp.name, `[${STUDIO_V}] the lang-vs-scene pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
  }

  /**
   * ══ S3 — THE LAYERS / SYSTEMS TREE AND THE LIVE SELECTION DOCK ═════════════════════════════════
   *
   * Every row below is about a fact the tree CLAIMS, and each is measured against the thing that
   * owns that fact rather than against the tree's own rendering of it:
   *   a TICK   → `window.atlas.state().ids` / the scene blob, not the checkbox's class
   *   an EYE   → the serialised `system=` key, the scene's `styles`, or the DRAWN set
   *   a REFUSAL→ the state being UNCHANGED, not the message being present
   * That last one is the S3-specific discipline the kickoff names: "assert the UNCHANGED state —
   * picks, blob, camera — not the message". A refusal that printed its sentence and committed half
   * the operation would pass a message-shaped assertion.
   */
  const S3_V = 'S3-tree';
  for (const vp of [{name: 's3-tree-1440', width: 1440, height: 900, dpr: 1, coarse: false},
    {name: 's3-tree-390', width: 390, height: 844, dpr: 3, coarse: true}]) {
    const ctx = await newContext(vp);
    const page = await ctx.newPage();
    const phone = vp.width < 768;
    try {
      await page.goto(`${base}${path}?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForSelector(READY_SEL.v2, {timeout: 240000}).catch(() => {});
      await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 300000}).catch(() => {});
      await page.waitForTimeout(1200);
      await page.bringToFront();
      /** The phone keeps the tree in the margin's high detent behind the Systems button (spec A3);
       *  the studio has it in the sidebar at rest. Opening it is a PREMISE, asserted as one. */
      if (phone) {
        await page.evaluate(() => document.querySelector('.v2-handle')?.click());
        await page.waitForTimeout(400);
        await page.evaluate(() => {
          const b = [...document.querySelectorAll('.v2-actions button')].find((x) => x.textContent && /Systems|系统|系統/.test(x.textContent));
          b?.click();
        });
        await page.waitForTimeout(600);
      }
      const present = await page.evaluate(() => ({
        tree: !!document.querySelector('[role="tree"]'),
        box: !!document.querySelector('.v2-tree-box'),
        filter: !!document.querySelector('.v2-side-filter input'),
      }));
      check(vp.name, `[${S3_V}] the tree is a real \`role="tree"\` with a filter (the premise — every row below is vacuous without it)`,
        present.tree && present.box && present.filter,
        `tree=${present.tree} box=${present.box} filter=${present.filter}`, 'all three');

      // ── S3.1 VIRTUALISED, AND THE SCROLLER IS THE THING THAT IS MEASURED ──────────────────────
      // The defect this catches is the one the phone build actually had: an unbounded box grew to
      // its content, the MARGIN scrolled instead, and the virtualiser's `scrollTop` never changed —
      // so expanding a system would have drawn one window and then thousands of pixels of blank.
      /**
       * ⚠️ EXPANDED THROUGH THE CONTROL THAT EXISTS AT THIS TIER. On a coarse pointer the disclosure
       * chevron is presentational and the NAME owns the command (four 44 px controls do not fit a
       * 264 px sidebar — see `TreeProps.coarse`). The first version clicked `.v2-tw` unconditionally,
       * which on the phone clicked a `<span>`, expanded nothing, and then reported "canvas 780px"
       * and "no unticked structure row on screen" as if the TREE were at fault. An instrument must
       * drive the surface the reader has.
       */
      await page.evaluate(() => {
        const row = document.querySelector('.v2-tree-row.is-system');
        (row?.querySelector('.v2-tw[type=button]') ?? row?.querySelector('.v2-tree-name'))?.click();
      });
      await page.waitForTimeout(600);
      const virt = await page.evaluate(() => {
        const box = document.querySelector('.v2-tree-box');
        const rows = [...document.querySelectorAll('.v2-tree-row')];
        return {h: Math.round(box?.clientHeight ?? 0), scrollH: Math.round(box?.scrollHeight ?? 0), mounted: rows.length};
      });
      check(vp.name, `[${S3_V}] one expanded system virtualises: the canvas is far taller than the box, and a handful of rows are mounted`,
        virt.scrollH > virt.h * 4 && virt.mounted > 0 && virt.mounted < 60 && virt.h > 0,
        `box ${virt.h}px, canvas ${virt.scrollH}px, ${virt.mounted} rows mounted`,
        'canvas >> box, < 60 rows mounted');
      // AND THE WINDOW REALLY MOVES. Without this the row above passes on a list that renders its
      // first window and nothing else — which is exactly the blank-below-the-fold defect.
      const scrolled = await page.evaluate(async () => {
        const box = document.querySelector('.v2-tree-box');
        const before = document.querySelector('.v2-tree-row:last-child')?.textContent ?? '';
        box.scrollTop = Math.round(box.scrollHeight / 2);
        await new Promise((r) => setTimeout(r, 400));
        const rows = [...document.querySelectorAll('.v2-tree-row')];
        return {before, after: rows[rows.length - 1]?.textContent ?? '', n: rows.length,
          top: Math.round(rows[0]?.getBoundingClientRect().top ?? 0)};
      });
      check(vp.name, `[${S3_V}] scrolling the box mounts a DIFFERENT window (the virtualiser reads the element that scrolls)`,
        scrolled.after !== scrolled.before && scrolled.n > 0,
        `last row "${String(scrolled.before).slice(0, 22)}" -> "${String(scrolled.after).slice(0, 22)}", ${scrolled.n} mounted`,
        'a different last row');

      /**
       * ⚠️ A VIRTUALISED LIST MUST BE PUT BACK IN A KNOWN STATE BETWEEN SUB-TESTS, and forgetting
       * that was an instrument defect this block found in itself TWICE.
       *
       * S3.1 scrolls to the middle of an expanded 634-concept system to prove the window moves.
       * Every row after it then queried `.v2-tree-row.is-system` and found NONE — not because the
       * tree has no systems, but because the virtualiser had correctly unmounted them. The failures
       * read "no UNTICKED system with more than 24 structures on screen", which is a true statement
       * about the DOM and a false one about the product.
       *
       * So: collapse everything and scroll home first. Stated as a helper rather than repeated,
       * because the next sub-test added to this block will need it too.
       */
      const treeHome = async () => {
        await page.evaluate(() => {
          // Collapse via the control the tier actually has (the chevron is a span on coarse).
          for (const r of [...document.querySelectorAll('.v2-tree-row.is-system')]) {
            if (r.getAttribute('aria-expanded') === 'true') {
              (r.querySelector('.v2-tw[type=button]') ?? r.querySelector('.v2-tree-name'))?.click();
            }
          }
          const box = document.querySelector('.v2-tree-box');
          if (box) box.scrollTop = 0;
        });
        await page.waitForTimeout(500);
        return page.evaluate(() => document.querySelectorAll('.v2-tree-row.is-system').length);
      };

      // ── S3.2 A CHILD TICK ADDS EXACTLY THAT ID ───────────────────────────────────────────────
      // Measured on the CONTROLLER (`window.atlas.state()`), not on the checkbox: a tick that
      // painted itself and dispatched nothing would pass any DOM-shaped assertion.
      const sysRowsBack = await treeHome();
      check(vp.name, `[${S3_V}] the tree returns to a known state between sub-tests (system rows are mounted again)`,
        sysRowsBack > 0, `${sysRowsBack} system rows mounted after collapse + scroll home`, '> 0');
      // One system open again, so there is a structure row to tick.
      await page.evaluate(() => {
        const row = document.querySelector('.v2-tree-row.is-system');
        (row?.querySelector('.v2-tw[type=button]') ?? row?.querySelector('.v2-tree-name'))?.click();
      });
      await page.waitForTimeout(500);
      const tick = await page.evaluate(async () => {
        // ⚠️ `atlas.state()` REPORTS `ids`, NOT `selected` (app/v2/tools.ts:30). The first version
        // of this row read `.selected` and threw inside the evaluate, which surfaced as "the tree
        // pass ran = false" — an instrument error reported in the shape of a product failure.
        const before = window.atlas.state();
        const row = [...document.querySelectorAll('.v2-tree-row.is-concept')]
          .find((r) => r.getAttribute('aria-checked') === 'false');
        if (!row) return {error: 'no unticked structure row on screen'};
        const id = row.getAttribute('aria-describedby')?.replace('v2-cov-', '') ?? null;
        const name = row.querySelector('.v2-tree-name b')?.textContent ?? '';
        row.querySelector('.v2-tick')?.click();
        await new Promise((r) => setTimeout(r, 500));
        const after = window.atlas.state();
        const added = after.ids.filter((x) => !before.ids.includes(x));
        const removed = before.ids.filter((x) => !after.ids.includes(x));
        return {name, id, beforeN: before.ids.length, afterN: after.ids.length,
          added: added.length, removed: removed.length,
          checkedNow: row.getAttribute('aria-checked'),
          inSelectionDock: [...document.querySelectorAll('.v2-card b')].some((b) => b.textContent === name),
          blobChanged: before.blob !== after.blob};
      });
      check(vp.name, `[${S3_V}] ticking a structure adds EXACTLY one requested id — nothing else moves`,
        !tick.error && tick.added === 1 && tick.removed === 0 && tick.checkedNow === 'true',
        tick.error || `picks ${tick.beforeN} -> ${tick.afterN} (+${tick.added} / -${tick.removed}), aria-checked=${tick.checkedNow}`,
        'exactly +1, -0, checked');
      check(vp.name, `[${S3_V}] and the same tick reaches the Selection dock and the scene blob (one fact, every surface)`,
        !tick.error && tick.blobChanged === true && (phone || tick.inSelectionDock === true),
        tick.error || `blob changed=${tick.blobChanged}, in Selection dock=${tick.inSelectionDock}`,
        'the blob re-encoded, the card present');

      // ── S3.3 THE PARENT'S TRI-STATE AGGREGATES THAT MEMBERSHIP ───────────────────────────────
      await treeHome();
      const tri = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.v2-tree-row.is-system')];
        const out = rows.map((r) => ({
          name: r.querySelector('.v2-tree-name b')?.textContent ?? '',
          checked: r.getAttribute('aria-checked'),
        }));
        return {out, mixed: out.filter((x) => x.checked === 'mixed').length, total: out.length};
      });
      check(vp.name, `[${S3_V}] the §9 scene puts at least one system in MIXED and none in fully-checked (24 picks cannot fill a 634-concept system)`,
        tri.mixed >= 1 && tri.out.every((x) => x.checked !== 'true'),
        `${tri.mixed} mixed of ${tri.total} system rows on screen: ${tri.out.filter((x) => x.checked === 'mixed').map((x) => x.name).join(', ') || 'none'}`,
        '>= 1 mixed, 0 fully checked');

      // ── S3.4 A BULK TICK OVER THE LIMIT REFUSES, AND THE STATE IS IDENTICAL ──────────────────
      /**
       * ⚠️ THE ASSERTION IS THE UNCHANGED STATE, NOT THE MESSAGE. A refusal that printed its
       * sentence and still committed the first 24 would satisfy any "is the refusal visible?"
       * check — and committing a truncated set is precisely the failure the controller's atomic
       * bound exists to prevent. So picks, blob AND the camera pose are compared before and after.
       */
      /**
       * ⚠️ IT MUST DRIVE THE **ADD** DIRECTION, and the first version did not — which is how this
       * row found a defect in ITSELF rather than in the product.
       *
       * A system row's tick is a toggle: `off` → add every descendant (which for a 634-concept
       * system is refused whole), `mixed`/`on` → remove the ones that are picked (which succeeds,
       * because removal has no bound). The first version picked the first system with >24 concepts
       * and clicked it — and on the §9 fixture that system is MIXED, so it measured a successful
       * REMOVAL and reported "picks identical=false" as a failure to refuse. The state had changed
       * because the product did the right thing.
       *
       * So the row now requires an UNTICKED system, which is the only state from which the refusal
       * is reachable — and the removal path gets its own row below rather than being tested by
       * accident.
       */
      await treeHome();
      const bulk = await page.evaluate(async () => {
        const pose = () => { const n = window.__atlasNav; return n ? JSON.stringify(n.pose()) : 'no-nav'; };
        const before = {...window.atlas.state(), pose: pose()};
        const row = [...document.querySelectorAll('.v2-tree-row.is-system')]
          .find((r) => Number((r.querySelector('em')?.textContent ?? '0').replace(/[^0-9]/g, '')) > 24
            && r.getAttribute('aria-checked') === 'false');
        if (!row) return {error: 'no UNTICKED system with more than 24 structures on screen'};
        const n = row.querySelector('em')?.textContent ?? '?';
        row.querySelector('.v2-tick')?.click();
        await new Promise((r) => setTimeout(r, 600));
        const after = {...window.atlas.state(), pose: pose()};
        return {n,
          picksSame: JSON.stringify(before.ids) === JSON.stringify(after.ids),
          blobSame: before.blob === after.blob,
          poseSame: before.pose === after.pose,
          refusalShown: !!document.querySelector('.v2-refused, [role="alert"]'),
          count: after.ids.length};
      });
      check(vp.name, `[${S3_V}] a bulk tick of a ${bulk.n ?? '?'}-structure system REFUSES and leaves picks, blob and camera IDENTICAL`,
        !bulk.error && bulk.picksSame && bulk.blobSame && bulk.poseSame,
        bulk.error || `picks identical=${bulk.picksSame}, blob identical=${bulk.blobSame}, pose identical=${bulk.poseSame} (${bulk.count} selected)`,
        'all three identical');
      check(vp.name, `[${S3_V}] and it SAYS so (the refusal is visible, not silent)`,
        !bulk.error && bulk.refusalShown === true,
        bulk.error || `a refusal element is present=${bulk.refusalShown}`, 'visible');
      /**
       * THE OTHER DIRECTION, which the first version of the row above measured by accident and which
       * deserves its own assertion: unticking a MIXED system removes exactly its picked members and
       * leaves every other pick alone. It is the bulk operation that routinely SUCCEEDS.
       */
      await treeHome();
      const unbulk = await page.evaluate(async () => {
        const before = window.atlas.state().ids.slice();
        const row = [...document.querySelectorAll('.v2-tree-row.is-system')]
          .find((r) => r.getAttribute('aria-checked') === 'mixed');
        if (!row) return {error: 'no mixed system on screen'};
        const name = row.querySelector('.v2-tree-name b')?.textContent ?? '';
        row.querySelector('.v2-tick')?.click();
        await new Promise((r) => setTimeout(r, 600));
        const after = window.atlas.state().ids.slice();
        return {name, before: before.length, after: after.length,
          removed: before.filter((x) => !after.includes(x)).length,
          added: after.filter((x) => !before.includes(x)).length,
          checkedNow: row.getAttribute('aria-checked')};
      });
      check(vp.name, `[${S3_V}] unticking a MIXED system removes its members and adds nothing`,
        !unbulk.error && unbulk.removed > 0 && unbulk.added === 0 && unbulk.checkedNow === 'false',
        unbulk.error || `${unbulk.name}: picks ${unbulk.before} -> ${unbulk.after} (-${unbulk.removed} / +${unbulk.added}), aria-checked=${unbulk.checkedNow}`,
        'members removed, nothing added, now unchecked');

      // ── S3.5 THE SYSTEM EYE ROUND-TRIPS THROUGH `system=` ────────────────────────────────────
      // RC8's first eye. The claim is the SERIALISATION, so it is read off the address bar the
      // reader would copy — not off the button's own aria-pressed.
      await treeHome();
      const sysEye = await page.evaluate(async () => {
        const row = [...document.querySelectorAll('.v2-tree-row.is-system')][0];
        if (!row) return {error: 'no system row'};
        const name = row.querySelector('.v2-tree-name b')?.textContent ?? '';
        const eye = row.querySelector('.v2-eye');
        const title = eye?.getAttribute('title') ?? '';
        eye?.click();
        // The URL write is debounced at 200 ms; wait on the URL, never on a longer sleep.
        const t0 = Date.now();
        while (Date.now() - t0 < 4000 && !/[?&]system=/.test(location.search)) await new Promise((r) => setTimeout(r, 60));
        return {name, title, search: location.search.match(/[?&]system=[^&]*/)?.[0] ?? '(no system= key)',
          pressed: eye?.getAttribute('aria-pressed'),
          visible: window.atlas.state().view};
      });
      check(vp.name, `[${S3_V}] the SYSTEM eye writes the serialised \`system=\` key the link carries`,
        !sysEye.error && /system=/.test(sysEye.search),
        sysEye.error || `${sysEye.name}: ${sysEye.search} (aria-pressed=${sysEye.pressed})`, 'a system= key');
      // RC8 REFUSES TO SHIP AN EYE WHOSE TOOLTIP DOES NOT NAME ITS SERIALISATION. This is that row.
      check(vp.name, `[${S3_V}] and its tooltip NAMES that serialisation (RC8: an eye that does not is refused)`,
        !sysEye.error && /system=/.test(sysEye.title),
        sysEye.error || `title="${String(sysEye.title).slice(0, 70)}"`, 'the tooltip contains "system="');

      // ── S3.6 EVERY EYE ON SCREEN STATES ITS OWN SERIALISATION ────────────────────────────────
      // A session eye lives on a STRUCTURE row that is not a scene member, so one system has to be
      // open for any to exist. Without this the sub-test ran against fifteen collapsed system rows
      // and asserted a tooltip on a row type that was not on screen — it measured "" and reported it
      // as the product saying nothing.
      await treeHome();
      await page.evaluate(() => {
        const row = document.querySelector('.v2-tree-row.is-system');
        (row?.querySelector('.v2-tw[type=button]') ?? row?.querySelector('.v2-tree-name'))?.click();
      });
      await page.waitForTimeout(500);
      const eyes = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('.v2-tree-row')];
        const out = rows.map((r) => {
          const eye = r.querySelector('.v2-eye');
          const kind = eye ? [...eye.classList].find((c) => ['is-system', 'is-member', 'is-session'].includes(c)) : null;
          return {kind, title: eye?.getAttribute('title') ?? '', label: eye?.getAttribute('aria-label') ?? ''};
        }).filter((x) => x.kind);
        const silent = out.filter((x) => !x.title.trim());
        const kinds = [...new Set(out.map((x) => x.kind))];
        return {n: out.length, silent: silent.length, kinds,
          hasSession: out.some((x) => x.kind === 'is-session'),
          session: out.find((x) => x.kind === 'is-session')?.title ?? '(NO SESSION EYE ON SCREEN)'};
      });
      check(vp.name, `[${S3_V}] EVERY eye on screen carries a tooltip (${eyes.n} eyes, kinds: ${eyes.kinds.join('/')})`,
        eyes.n > 0 && eyes.silent === 0,
        `${eyes.silent} of ${eyes.n} eyes have no title`, '0 silent');
      check(vp.name, `[${S3_V}] the SESSION eye's tooltip says it is not saved in the link`,
        eyes.hasSession && /not saved|仅|僅/.test(eyes.session),
        `"${String(eyes.session).slice(0, 70)}"`, 'it says session-only');

      // ── S3.7 THE FILTER NARROWS BOTH LANES, WITH BOTH DENOMINATORS ───────────────────────────
      const filtered = await page.evaluate(async () => {
        const box = document.querySelector('.v2-side-filter input');
        const subBefore = document.querySelector('.v2-side-sub')?.textContent ?? '';
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(box, 'femur');
        box.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise((r) => setTimeout(r, 600));
        const subAfter = document.querySelector('.v2-side-sub')?.textContent ?? '';
        const rows = [...document.querySelectorAll('.v2-tree-row')];
        // ⚠️ BOTH LINES OF THE ROW. In a Chinese interface a row matched on its ENGLISH name renders
        // 股骨 as its title and "femur" as its PAIRED line — the first version read only the title
        // and reported "a femur row present=false" for a filter that had worked perfectly. The
        // §9 fixture forces zh-Hans, so the English-only reading was wrong on its own fixture.
        const names = rows.map((r) => ((r.querySelector('.v2-tree-name b')?.textContent ?? '') + ' ' +
          (r.querySelector('.v2-tree-name i')?.textContent ?? '')).toLowerCase());
        const kids = rows.filter((r) => r.classList.contains('is-concept'));
        return {subBefore, subAfter, rows: rows.length, kids: kids.length,
          hit: names.some((n) => n.includes('femur')),
          posinset: rows[0]?.getAttribute('aria-posinset'), setsize: rows[0]?.getAttribute('aria-setsize')};
      });
      check(vp.name, `[${S3_V}] the filter narrows the tree and reports BOTH denominators (systems and structures are two populations)`,
        /\bof\b|中的/.test(filtered.subAfter) && filtered.subAfter !== filtered.subBefore && filtered.hit,
        `"${filtered.subBefore}" -> "${filtered.subAfter}" (${filtered.rows} rows, ${filtered.kids} structures, a femur row present=${filtered.hit})`,
        'two named denominators and a match');
      check(vp.name, `[${S3_V}] aria-setsize reports the FILTERED collection, not the mounted window`,
        Number(filtered.setsize) > 0 && Number(filtered.setsize) >= filtered.rows,
        `posinset=${filtered.posinset} setsize=${filtered.setsize} against ${filtered.rows} mounted`,
        'setsize >= mounted');

      /**
       * ══ S3.9 — THE codex ROUND-3 CORRECTIVES, one row per finding, each written against the
       *    DEFECT rather than against the fix ══════════════════════════════════════════════════
       */
      await treeHome();
      // ── H1: in an EXPLORE scene the codec draws every member solid, so a member row's eye must
      //    be the SESSION eye. The defect had it claim "saved in this view" over a visible mesh.
      /**
       * ⚠️ REACHED THROUGH THE FILTER, because the tree is VIRTUALISED. The first version expanded
       * each system and looked for a ticked child — but a 634-row system mounts its first fifteen
       * rows, and the §9 scene's structures are nowhere near the top of `atlas.concepts` order. It
       * measured "no ticked structure row reachable in the tree" for a tree in which all of them are
       * perfectly reachable, which is a statement about the mounted window and not about the
       * product. The filter is the surface a reader would use, so the oracle uses it too.
       */
      const h1 = await page.evaluate(async () => {
        const st = window.atlas.state();
        const mode = window.atlas.plate?.()?.scene?.mode ?? 'explore';
        const name = st.nameEn || st.name;
        if (!name) return {error: 'the page reports no focused structure', mode};
        const box = document.querySelector('.v2-side-filter input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(box, name);
        box.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise((x) => setTimeout(x, 700));
        const row = [...document.querySelectorAll('.v2-tree-row.is-concept')]
          .find((c) => c.getAttribute('aria-checked') === 'true');
        if (!row) return {error: `no ticked structure row after filtering to "${name}"`, mode, ids: st.ids.length};
        const eye = row.querySelector('.v2-eye');
        const kind = [...eye.classList].find((c) => c.startsWith('is-') && c !== 'is-off');
        return {mode, kind, title: eye.getAttribute('title') ?? '', ids: st.ids.length, via: name};
      });
      check(vp.name, `[${S3_V}] in an EXPLORE scene a MEMBER row gets the SESSION eye (the codec draws members solid there)`,
        !h1.error && h1.mode !== 'render' && h1.kind === 'is-session',
        h1.error || `scene mode=${h1.mode}, eye kind=${h1.kind}`, 'is-session in explore mode');
      check(vp.name, `[${S3_V}] and its tooltip does NOT claim the link reproduces it`,
        !h1.error && !/saved in this view|保存在本视图|保存在本視圖/.test(h1.title) && h1.title.length > 0,
        h1.error || `title="${String(h1.title).slice(0, 64)}"`, 'no "saved in this view" claim');

      // ── M1: the BOTTOM of an expanded system must not be blank. The defect returned an empty
      //    window because `firstAt` answered 0 past the end.
      /**
       * ⚠️ S3b — THIS ROW WAS A FALSE GREEN AND MEASURED NOTHING (codex round 4, Medium 3).
       *
       * It ran straight after the H1 probe, which leaves its NAME FILTER active — so the collection
       * it scrolled was two rows in a box nothing overflows. The retained evidence says so in its
       * own measured string: `scrollTop 0 of 544: 2 mounted, 2 inside the box`, desktop AND phone.
       * codex executed the DEFECTIVE `firstAt` against exactly those two rows: `from=0, to=2,
       * mounted=2, wouldPass=true`. The row guarding M1 could not have gone red for M1.
       *
       * Three things are now REQUIRED rather than incidentally true, and each is asserted:
       *   · the filter is CLEARED first (the probe owns its own preconditions);
       *   · the system expanded is the LARGEST one, so the collection is hundreds of rows;
       *   · the box must actually OVERFLOW and the scroll must actually MOVE — `scrollTop > 0` and
       *     `scrollHeight > clientHeight`. Under the defective `firstAt` this lands `from` past `to`
       *     and mounts the pinned row alone, which the `inView` count then sees as blank.
       */
      const bottom = await page.evaluate(async () => {
        const box0 = document.querySelector('.v2-side-filter input') ?? document.querySelector('.v2-find-filter input');
        if (box0 && box0.value) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(box0, '');
          box0.dispatchEvent(new Event('input', {bubbles: true}));
          await new Promise((r) => setTimeout(r, 500));
        }
        // THE BIGGEST SYSTEM, read off the row's own count — never the first row, whose size is an
        // accident of atlas order.
        const systems = [...document.querySelectorAll('.v2-tree-row.is-system')];
        const sized = systems.map((r) => ({r, n: Number((r.querySelector('em')?.textContent ?? '0').replace(/[^\d]/g, '')) || 0}))
          .sort((a, b) => b.n - a.n);
        const pick = sized[0];
        if (!pick || pick.n < 50) return {error: `the largest system has ${pick?.n ?? 0} children — not enough to overflow`, filterValue: box0?.value ?? ''};
        (pick.r.querySelector('.v2-tw[type=button]') ?? pick.r.querySelector('.v2-tree-name'))?.click();
        await new Promise((r) => setTimeout(r, 500));
        const box = document.querySelector('.v2-tree-box');
        box.scrollTop = box.scrollHeight;            // all the way down, not halfway
        await new Promise((r) => setTimeout(r, 500));
        const rows = [...document.querySelectorAll('.v2-tree-row')];
        const inView = rows.filter((r) => {
          const a = r.getBoundingClientRect(), b = box.getBoundingClientRect();
          return a.bottom > b.top && a.top < b.bottom;
        });
        return {scrollTop: Math.round(box.scrollTop), scrollH: Math.round(box.scrollHeight),
          clientH: Math.round(box.clientHeight), kids: pick.n, filterValue: box0?.value ?? '',
          mounted: rows.length, inView: inView.length};
      });
      check(vp.name, `[${S3_V}] the bottom probe reaches a REAL scrolling boundary (its own precondition, not the previous probe's leftovers)`,
        !bottom.error && bottom.filterValue === '' && bottom.kids >= 50
          && bottom.scrollH > bottom.clientH && bottom.scrollTop > 0,
        bottom.error || `filter="${bottom.filterValue}" largest system=${bottom.kids} children · scrollTop ${bottom.scrollTop} of ${bottom.scrollH} in a ${bottom.clientH} px box`,
        'no filter, >=50 children, scrollHeight > clientHeight, scrollTop > 0');
      check(vp.name, `[${S3_V}] the BOTTOM of an expanded system is not blank (the window boundary, not its middle)`,
        !bottom.error && bottom.mounted > 0 && bottom.inView > 0,
        bottom.error || `scrollTop ${bottom.scrollTop} of ${bottom.scrollH}: ${bottom.mounted} mounted, ${bottom.inView} inside the box`,
        '> 0 rows visible');

      // ── M3: the eye has a keyboard path of its own, and Space on a focused eye is left alone.
      await treeHome();
      const vKey = await page.evaluate(() => {
        const row = document.querySelector('.v2-tree-row[tabindex="0"]') ?? document.querySelector('.v2-tree-row');
        row?.focus();
        const eye = row?.querySelector('.v2-eye');
        return {before: eye?.getAttribute('aria-pressed'), name: row?.querySelector('.v2-tree-name b')?.textContent ?? ''};
      });
      await page.keyboard.press('v');
      await page.waitForTimeout(400);
      const vAfter = await page.evaluate(() => {
        const row = document.activeElement?.closest?.('.v2-tree-row') ?? document.querySelector('.v2-tree-row');
        return row?.querySelector('.v2-eye')?.getAttribute('aria-pressed');
      });
      check(vp.name, `[${S3_V}] V toggles the focused row's visibility (the eye's only keyboard path)`,
        !!vKey.before && vAfter !== vKey.before,
        `${vKey.name}: eye aria-pressed ${vKey.before} -> ${vAfter}`, 'it changed');

      // ── S3.8 THE KEYBOARD MOVES WITHIN THE FILTERED TREE AND NEVER ORBITS ────────────────────
      /**
       * Guard 4 of `keys.ts` declines every arrow while focus is inside `[role="tree"]`, and until
       * S3 that guard protected a tree that did not exist. The camera pose is the instrument: if
       * the arrows reached the dispatcher the pose would move, and the assertion is that it did
       * not WHILE the highlight did — a control arm on each side of one keypress.
       */
      const keys = await page.evaluate(async () => {
        const box = document.querySelector('.v2-side-filter input');
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(box, '');
        box.dispatchEvent(new Event('input', {bubbles: true}));
        await new Promise((r) => setTimeout(r, 400));
        const row = document.querySelector('.v2-tree-row[tabindex="0"]');
        row?.focus();
        return {focused: document.activeElement?.getAttribute('role') ?? 'none',
          at: row?.getAttribute('aria-posinset') ?? null,
          pose: window.__atlasNav ? JSON.stringify(window.__atlasNav.pose()) : 'no-nav'};
      });
      check(vp.name, `[${S3_V}] a tree row is focusable through a roving tabindex (the premise for the keys below)`,
        keys.focused === 'treeitem', `activeElement role=${keys.focused}, posinset=${keys.at}`, 'treeitem');
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(250);
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(250);
      const afterArrows = await page.evaluate(() => ({
        at: document.activeElement?.getAttribute('aria-posinset') ?? null,
        role: document.activeElement?.getAttribute('role') ?? 'none',
        pose: window.__atlasNav ? JSON.stringify(window.__atlasNav.pose()) : 'no-nav',
      }));
      check(vp.name, `[${S3_V}] ArrowDown walks the tree — and the CAMERA does not move (guard 4, measured on the pose)`,
        afterArrows.role === 'treeitem' && Number(afterArrows.at) === Number(keys.at) + 2 && afterArrows.pose === keys.pose,
        `posinset ${keys.at} -> ${afterArrows.at}, pose ${afterArrows.pose === keys.pose ? 'unchanged' : 'MOVED'}`,
        '+2 rows, an unchanged pose');
      /**
       * ⚠️ SPACE MUST LAND ON A STRUCTURE ROW. On a SYSTEM row Space is the bulk tick, which for any
       * system over 24 concepts correctly REFUSES and leaves membership exactly where it was — and
       * the first version of this row read that correct refusal as "Space does nothing". The
       * keyboard walk therefore continues until the focused row is a `treeitem` at level 2.
       */
      let onConcept = await page.evaluate(() => document.activeElement?.getAttribute('aria-level') === '2');
      for (let i = 0; i < 12 && !onConcept; i++) {
        await page.keyboard.press('ArrowRight');   // opens a system, or moves into it
        await page.waitForTimeout(180);
        await page.keyboard.press('ArrowDown');
        await page.waitForTimeout(180);
        onConcept = await page.evaluate(() => document.activeElement?.getAttribute('aria-level') === '2');
      }
      check(vp.name, `[${S3_V}] the keyboard can reach a STRUCTURE row from a system row (Right opens, Down enters)`,
        onConcept, `aria-level of the focused row = ${await page.evaluate(() => document.activeElement?.getAttribute('aria-level') ?? 'none')}`, '2');
      const beforeSpace = await page.evaluate(() => window.atlas.state().ids.length);
      await page.keyboard.press('Space');
      await page.waitForTimeout(500);
      const afterSpace = await page.evaluate(() => ({n: window.atlas.state().ids.length,
        checked: document.activeElement?.getAttribute('aria-checked')}));
      if (phone) {
        /**
         * ⚠️ MEASURED WITH THE TREE OPEN — codex round 3, Medium 4. The suite's own §5 TARGETS pass
         * runs on the ENTRY state, where the tree is behind the Systems button and none of its
         * controls exist; it reported "0 under 44px" while the phone's membership tick was 24x24.
         * A target gate that never sees the surface is not a gate for it.
         */
        const small = await page.evaluate(() => {
          const out = [];
          for (const el of document.querySelectorAll('.v2-tree-phone button, .v2-tree-phone input')) {
            const r = el.getBoundingClientRect();
            if (r.width < 1 || r.height < 1) continue;
            if (r.width < 44 || r.height < 44) {
              out.push(`${(el.getAttribute('aria-label') || el.className || el.tagName).slice(0, 26)}@${Math.round(r.width)}x${Math.round(r.height)}`);
            }
          }
          return {small: out, total: document.querySelectorAll('.v2-tree-phone button, .v2-tree-phone input').length};
        });
        check(vp.name, `[${S3_V}] every control in the OPEN phone tree is >= 44x44`,
          small.small.length === 0,
          `${small.small.length} of ${small.total} under 44px${small.small.length ? ': ' + small.small.slice(0, 5).join(', ') : ''}`, '0');
      }
      check(vp.name, `[${S3_V}] Space toggles membership on the focused row`,
        afterSpace.n !== beforeSpace || afterSpace.checked === 'mixed',
        `picks ${beforeSpace} -> ${afterSpace.n} (aria-checked=${afterSpace.checked})`, 'membership moved');
    } catch (e) {
      check(vp.name, `[${S3_V}] the tree pass ran`, false, String(e).slice(0, 200), 'no throw');
    } finally { await ctx.close(); }
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
