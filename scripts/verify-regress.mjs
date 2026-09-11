/**
 * verify-regress.mjs — THE SIX HIGH DEFECTS FROM codex's APP REVIEW, AS EXECUTABLE CASES. L31 v2.1a.
 *
 * usage: node scripts/verify-regress.mjs <baseUrl> <outDir> <c1|c2> [label]
 *
 * WHY THIS FILE EXISTS SEPARATELY FROM verify-ux.mjs. That suite measures the ENTRY — one fixture,
 * six viewports, geometry and bytes. These are BEHAVIOURAL cases: each one drives the app through
 * a sequence (cold link, re-drive, edit, reload) and asserts on renderer and controller state
 * afterwards. codex's review classified all six as "MISSING as exact v2/Worker cases"
 * (codex-plan-review.md §C) and its §F.1 asks that the evidence and the review agree, so they get
 * their own runner, their own artifact, and their own owning commit per case.
 *
 * ══ THE EXPECTED-RED CONTRACT ══════════════════════════════════════════════════════════════════
 * Every case declares the COMMIT that owns its fix. The runner takes the stage under test and:
 *
 *   owner <= stage   the case MUST PASS. A failure fails the build.
 *   owner >  stage   the case MUST FAIL. It is reported EXPECTED-RED — and if it PASSES, that is
 *                    reported as a finding too, because a repro that no longer reproduces the
 *                    defect is not evidence of anything. codex-app-review.md §8 line 4-5 splits
 *                    these six across two commits (four in C1, two through the controller in C2),
 *                    so at stage c1 the two controller cases are red BY CONTRACT and the run is
 *                    still green.
 *
 * That is what makes "watch it go red, then green" checkable by someone who was not here: the red
 * is a recorded, named, expected state rather than a claim in a worklog.
 *
 * ══ THE PLAYWRIGHT LESSON (worklog "L31 v2 P0+P1") ═════════════════════════════════════════════
 * MOUSE AT COORDINATES, NEVER page.click(). `page.click` re-resolves the element and scrolls to
 * it, which silently retargets past fixed overlays and past a control that is present but covered
 * — exactly the class of defect case 2 is about. Every interaction below reads a boundingBox and
 * moves a real pointer to a real point.
 */
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {decodeScene, encodeScene, normalizeScene} from '../app/scene-codec.js';
import {attachRequestLedger, populationCheck, targetHistory} from './request-ledger.mjs';

const base = process.argv[2];
const outDir = process.argv[3];
const stage = (process.argv[4] ?? 'c1').toLowerCase();
const label = process.argv[5] ?? `regress-${stage}`;
if (!base || !outDir || !['c1', 'c2'].includes(stage)) {
  console.error('usage: node scripts/verify-regress.mjs <baseUrl> <outDir> <c1|c2> [label]');
  process.exit(2);
}
mkdirSync(outDir, {recursive: true});
const STAGE_RANK = {C1: 1, C2: 2};
const rank = STAGE_RANK[stage.toUpperCase()];

/** `REGRESS_CASES=readiness-generations,plural` runs a subset. The full run is eight cases and
 *  many full atlas loads; iterating on one case — or RED-PROVING one gate by reverting its fix —
 *  should not cost the other seven. Default is every case, so a plain invocation is still the
 *  whole contract, and the summary says which set actually ran. */
const ONLY = (process.env.REGRESS_CASES ?? '').split(',').map((s) => s.trim()).filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);

const headers = (process.env.CF_ID && process.env.CF_SECRET)
  ? {'CF-Access-Client-Id': process.env.CF_ID, 'CF-Access-Client-Secret': process.env.CF_SECRET}
  : {};

/** THE §9 FORWARD-BEND SCENE, the same fixture verify-ux.mjs uses — the ghost sorts first, so a
 *  check that reads basket[0] passes on the wrong structure. Kept identical on purpose: two suites
 *  disagreeing about the fixture is two suites measuring different apps. */
const SCENE = normalizeScene({
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
});
const BLOB = encodeScene(SCENE);
/** A SECOND scene, deliberately a different structure in a different system, for the re-drive
 *  generation cases. Its chunk set is asserted disjoint from the first at runtime. */
const SCENE_B = normalizeScene({
  mode: 'explore', lang: 'en',
  structures: [{id: 'FMA7088', role: 'primary'}],   // heart
  camera: {view: 'front', focus: ['FMA7088'], explode: 0},
  caption: {title: 'The heart', note: '', place: 'in'},
});
const BLOB_B = encodeScene(SCENE_B);

const cases = [];
let current = null;
const openCase = (id, owner, title, ref) => {
  current = {id, owner, title, ref, checks: [], error: null};
  cases.push(current);
  return current;
};
/**
 * One assertion inside a case.
 *
 * `prereq` marks an assertion that establishes the case actually RAN — a control was found and
 * pressed, the fixture loaded, the page did not throw. It is NOT part of the defect claim.
 *
 * THAT DISTINCTION IS LOAD-BEARING, and its absence was a real hole. Adversarial review (codex
 * gpt-6-astra, 2026-09-09, High 4) pointed out that classifying on "did ANY assertion fail" lets a
 * driver failure masquerade as defect reproduction — and it had already happened here: in the
 * pre-fix run the `edited-scene-persists` case never pressed Remove (the desktop controls were
 * hidden, which is R:25), so its EXPECTED-RED was proof of nothing at all. A prereq failure now
 * makes the case BROKEN and fails the suite whatever the stage, because a case that did not
 * exercise its defect is not evidence either way.
 */
const assert = (name, pass, measured, want, prereq = false) => {
  current.checks.push({name, pass: !!pass, measured: String(measured), want: want ?? '', prereq: !!prereq});
  console.log(`    ${pass ? 'ok  ' : 'NOT ok'} ${prereq ? '[prereq] ' : ''}${name} :: ${measured}${want ? ` want=${want}` : ''}`);
};
/** Shorthand for the assertions that only say "the case ran". */
const prereq = (name, pass, measured, want) => assert(name, pass, measured, want, true);

/** Named, because CASE 12 launches a SECOND browser with two extra flags and the difference
 *  between the two arg lists has to be readable rather than retyped. */
const CHROME_EXE = 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe';
const CHROME_ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const browser = await chromium.launch({executablePath: CHROME_EXE, args: CHROME_ARGS});

/** A clean profile every time. `atlas.lang` is written to localStorage on every scene apply and is
 *  SHARED with v1 (app/v2/page.tsx:255), so a reused profile makes the language cases measure the
 *  previous case's side effect. */
const fresh = async (width = 1440, height = 900, coarse = false) => {
  const context = await browser.newContext({
    viewport: {width, height}, deviceScaleFactor: 1, hasTouch: coarse, isMobile: coarse,
  });
  if (Object.keys(headers).length) {
    const origin = new URL(base).origin;
    await context.route('**/*', (route) => {
      const r = route.request();
      if (r.url().startsWith(origin)) return route.continue({headers: {...r.headers(), ...headers}});
      return route.continue();
    });
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  return {context, page, errors};
};

const SETTLE = 3500;
const waitScene = (page, ms = 240000) => page.waitForSelector('html[data-atlas-scene-ready="1"]', {timeout: ms});
const waitAll = (page, ms = 240000) => page.waitForSelector('html[data-atlas-ready="1"]', {timeout: ms});
/** The renderer's own introspection, not the DOM and not React state: `__atlasTargets` reads the
 *  live camera and the bytes actually uploaded to the GPU (app/scene.tsx:117-148), which is the
 *  only vantage point from which "the camera obeyed the link" is a fact rather than an inference. */
const targets = (page, ids = []) => page.evaluate((x) => window.__atlasTargets(x), ids);
const atlasState = (page) => page.evaluate(() => window.atlas?.state?.() ?? null);
const axis = (t) => {
  const dx = t.camera.x - t.camera.tx, dy = t.camera.y - t.camera.ty, dz = t.camera.z - t.camera.tz;
  const n = Math.hypot(dx, dy, dz) || 1;
  return {x: dx / n, y: dy / n, z: dz / n};
};
/** Click by POINTER at a POINT. See the header note on page.click. */
const clickAt = async (page, handle) => {
  const box = await handle.boundingBox();
  if (!box) return false;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.up();
  return true;
};
/** Open the phone/desktop margin so the set list and the action rows are laid out. Harmless where
 *  the handle does not exist (>=768), which is the tier that must not need it. */
const openMargin = async (page) => {
  const handle = await page.$('.v2-handle');
  if (!handle) return;
  await clickAt(page, handle);
  // WAIT FOR THE GEOMETRY TO STOP MOVING, not for a fixed 400 ms. `.v2-margin`'s max-height
  // transition is 220 ms (v2.css:140) and the React commit is ahead of it, so on a loaded host a
  // sleep reads a layout that exists for one frame — measured as six controls at y=854 on an
  // 844-tall viewport in verify-ux.mjs, which is mid-expansion. Two equal heights means settled.
  await page.waitForFunction((w) => document.querySelector('.v2')?.dataset.detent === w, 'half', {timeout: 5000}).catch(() => {});
  await page.evaluate(() => { delete window.__marginH; });
  await page.waitForFunction(() => {
    const el = document.querySelector('.v2-margin');
    if (!el) return true;
    const h = Math.round(el.getBoundingClientRect().height);
    const previous = window.__marginH;
    window.__marginH = h;
    return previous === h;
  }, null, {timeout: 5000, polling: 120}).catch(() => {});
};

// ══ CASE 1 — COLD LEGACY LINK: camera AND visibility, before and after the debounce ════════════
// codex-app-review.md §2 row 2 (R:26). `?select=…&view=side&isolate=1&system=none&explode=0.5` is
// the P1–P3 contract and the shape `/mcp` emitted for three releases. On v2 the picks initialise
// and NOTHING else does: `synthesize()` returns early unless `mode==='render'`
// (app/url-state.ts:108), so `scene` is null, `applySceneState` never runs, and `baseState`'s
// three-quarter / not-isolated / all-systems-visible is what draws. Then the 200 ms debounced
// `writeUrlState` REWRITES the URL from that default state, so the requested settings are gone
// from the address bar too and a reload cannot recover them.
//
// ASSERTED ON RENDERER STATE, NOT ON THE URL (codex-plan-review.md §D). A URL check would pass on
// a page that had merely echoed the query back.
if (want('cold-legacy')) {
  openCase('cold-legacy', 'C1', 'a cold legacy link applies camera + visibility on /v2/', 'R:26');
  const {context, page, errors} = await fresh();
  try {
    const url = `${base}/v2/?select=FMA22359&view=side&isolate=1&system=none&explode=0.5`;
    await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(SETTLE);

    const t1 = await targets(page, ['FMA22359']);
    const s1 = await atlasState(page);
    const a1 = axis(t1);
    assert('view=side reached the renderer (camera on +X)', a1.x > 0.9 && Math.abs(a1.z) < 0.3,
      `direction (${a1.x.toFixed(2)}, ${a1.y.toFixed(2)}, ${a1.z.toFixed(2)})`, 'x > 0.9, |z| < 0.3');
    assert('view=side reached the controller', s1?.view === 'side', `state.view=${s1?.view}`, 'side');
    // isolate=1 + system=none ⇒ ONLY the requested structure may be drawn. The parts list is the
    // set the GPU was actually given, so a stray system still being visible is visible here.
    // THE SELECTION MUST BE DRAWN BEFORE "nothing else is" MEANS ANYTHING. `__atlasTargets` returns
    // `parts` from the frame loop's cached projection, which is EMPTY unless the body is exploded or
    // a plate is rendering — so the pre-fix run reported "nothing else is drawn" with a total of
    // ZERO parts, which is a vacuous green (codex review, 2026-09-09, Medium 3). The group lane is
    // computed on demand and is the one that answers "is the requested structure on screen".
    const selfDrawn = (t1.groups?.FMA22359?.n ?? 0);
    prereq('the requested structure is actually drawn', selfDrawn > 0,
      `${selfDrawn} meshes of FMA22359 projected, parts lane = ${t1.parts.length}`, '> 0');
    const drawnOutside = t1.parts.filter((p) => p.concept !== 'FMA22359' && p.id !== 'FMA22359').length;
    assert('isolate=1 & system=none ⇒ nothing else is drawn', t1.parts.length > 0 && drawnOutside === 0,
      t1.parts.length === 0
        ? 'the projection lane was EMPTY, so this assertion would have been vacuous'
        : `${drawnOutside} parts drawn outside the selection (of ${t1.parts.length})`,
      '0 outside, and a non-empty projection');
    assert('isolate=1 reached the controller', s1?.framing?.isolate === true, `framing.isolate=${s1?.framing?.isolate}`, 'true');

    // AFTER THE DEBOUNCE AND A RELOAD. writeUrlState fires 200 ms after the atlas arrives; a link
    // that survives the first paint but not the rewrite is not fixed.
    await page.waitForTimeout(1200);
    const written = await page.evaluate(() => location.search);
    assert('the debounced URL write kept the requested settings',
      /view=side/.test(written) && /isolate=1/.test(written) && /system=none/.test(written) && /explode=0\.50?/.test(written),
      written.slice(0, 160), 'view, isolate, system and explode all present');
    await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(SETTLE);
    const t2 = await targets(page, ['FMA22359']);
    const a2 = axis(t2);
    const s2 = await atlasState(page);
    assert('the settings survive a reload', a2.x > 0.9 && s2?.view === 'side' && s2?.framing?.isolate === true,
      `direction x=${a2.x.toFixed(2)} view=${s2?.view} isolate=${s2?.framing?.isolate}`, 'side, isolated');
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 2 — STAGE / PROBE RETENTION, and the stage chrome fence ═══════════════════════════════
// codex-app-review.md §2 row 7 (R:31) + §8 line 10 (R:110). `writeUrlState` builds the query from
// a fixed key list (app/url-state.ts:135-149) that has no `stage` and no `probe`, so 200 ms after
// entry the flags are gone; the page keeps its React state, so nothing looks wrong until a reload
// brings the chrome back. `?stage=1` is the L32 display client's whole contract.
if (want('stage-probe')) {
  openCase('stage-probe', 'C1', '?stage=1 and ?probe=1 survive entry, debounce, reload and exit', 'R:31, R:110');
  const {context, page, errors} = await fresh();
  try {
    // WAIT ON THE WRITE, NOT ON A CLOCK (codex r9, the stage-probe Medium). The old line here was
    // `waitForTimeout(1400)` — "past the 200 ms debounce with room to spare" — which is a guess
    // about someone else's timing, and a guess is a flake with a grace period. `writeUrlState` ends
    // in exactly one `history.replaceState` (app/url-state.ts:206), so counting that call is a
    // DIRECT observation of the event under test. It is also not vacuous: the counter says the write
    // HAPPENED, and says nothing about what it wrote, which is what the assertions below are for.
    //
    // The one case the counter cannot see: `writeUrlState` skips `replaceState` when the serialized
    // URL is byte-identical to the current one, so a hypothetical no-op write never increments. That
    // degrades to the old sleep — but it is now RECORDED as the path taken, instead of being the
    // silent default.
    await page.addInitScript(() => {
      window.__urlWrites = 0;
      const real = history.replaceState.bind(history);
      history.replaceState = (...a) => { window.__urlWrites += 1; return real(...a); };
    });
    await page.goto(`${base}/v2/?stage=1&probe=1&scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    let urlWriteSeen = true;
    await page.waitForFunction(() => (window.__urlWrites ?? 0) > 0, null, {timeout: 20000})
      .catch(() => { urlWriteSeen = false; });
    if (!urlWriteSeen) await page.waitForTimeout(1400);
    prereq('the debounced URL write was OBSERVED (replaceState), not slept through',
      urlWriteSeen,
      urlWriteSeen ? `history.replaceState fired ${await page.evaluate(() => window.__urlWrites)} time(s)`
        : 'no replaceState within 20 s — fell back to the legacy 1400 ms sleep',
      'observed');

    const afterDebounce = await page.evaluate(() => location.search);
    assert('stage=1 survives the debounced URL write', /(\?|&)stage=1(&|$)/.test(afterDebounce), afterDebounce.slice(0, 160), 'stage=1 present');
    assert('probe=1 survives the debounced URL write', /(\?|&)probe=1(&|$)/.test(afterDebounce), afterDebounce.slice(0, 160), 'probe=1 present');

    // THE FENCE: stage hides every chrome surface. Asserted per surface rather than by screenshot,
    // and it includes the probe panel — which is the one that moved in v2.1a and is therefore the
    // one a future edit is most likely to leak (v21-design.md:900, critic gap 5).
    const fence = await page.evaluate(() => {
      const shown = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el), r = el.getBoundingClientRect();
        return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0;
      };
      return {
        stageClass: document.body.classList.contains('v2-stage'),
        head: shown('.v2-head'), rail: shown('.v2-rail'), margin: shown('.v2-margin'),
        probe: shown('.v2-probe'), chrome: shown('.v2-chrome'),
        field: (() => { const el = document.querySelector('.v2-field'); const r = el?.getBoundingClientRect(); return r ? {w: Math.round(r.width), h: Math.round(r.height)} : null; })(),
      };
    });
    const leaked = Object.entries({head: fence.head, rail: fence.rail, margin: fence.margin, probe: fence.probe, chrome: fence.chrome})
      .filter(([, v]) => v === true).map(([k]) => k);
    assert('stage hides every chrome surface (head, rail, margin, probe panel)',
      fence.stageClass && leaked.length === 0, leaked.length ? `still shown: ${leaked.join(', ')}` : 'all hidden', 'none shown');
    assert('stage gives the field the whole viewport',
      !!fence.field && fence.field.h >= 800, `field ${fence.field?.w}x${fence.field?.h}`, 'the full 900-tall viewport');

    // RELOAD — the actual failure the review describes ("chrome returns because the serializer
    // omitted stage").
    await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(800);
    const afterReload = await page.evaluate(() => ({
      search: location.search, stage: document.body.classList.contains('v2-stage'),
      // `.v2-head` on the phone/tablet, `.v2-bar` in the studio -- one claim, two trees.
      head: (() => { const el = document.querySelector('.v2-head, .v2-bar'); return !!el && getComputedStyle(el).display !== 'none'; })(),
    }));
    assert('stage still applies after a reload', afterReload.stage && !afterReload.head,
      `stage=${afterReload.stage} headShown=${afterReload.head} search=${afterReload.search.slice(0, 80)}`, 'staged, no chrome');

    // EXIT restores the chrome and must clear the flag from the URL, or the next reload re-stages
    // the page a human just left.
    const exit = await page.$('.v2-stage-exit');
    prereq('the stage exit control exists', !!exit, exit ? 'present' : 'absent', 'present');
    if (exit) {
      await clickAt(page, exit);
      await page.waitForTimeout(1200);
      const afterExit = await page.evaluate(() => ({
        search: location.search, stage: document.body.classList.contains('v2-stage'),
        // `.v2-head` on the phone/tablet, `.v2-bar` in the studio -- one claim, two trees.
      head: (() => { const el = document.querySelector('.v2-head, .v2-bar'); return !!el && getComputedStyle(el).display !== 'none'; })(),
      }));
      assert('exit restores the chrome and drops stage from the URL',
        !afterExit.stage && afterExit.head && !/stage=1/.test(afterExit.search),
        `stage=${afterExit.stage} headShown=${afterExit.head} search=${afterExit.search.slice(0, 100)}`, 'unstaged, no stage=1');
      assert('exit keeps probe=1 (it is a separate flag)', /probe=1/.test(afterExit.search), afterExit.search.slice(0, 100), 'probe=1 retained');
    }
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 3 — EXPLICIT SCENE CLEARING ═══════════════════════════════════════════════════════════
// codex-app-review.md §2 row 6 (R:30) + §1 (R:7). `#scene=&select=…` is how the snapshot renderer
// gets a warm tab OUT of a scene, and `readUrlState` already models it — `clearScene:true`
// (app/url-state.ts:84). v2's hashchange handler throws that away: `if (!u.scene) return`
// (app/v2/page.tsx:345), so the previous scene keeps drawing while the URL says otherwise, and the
// legacy keys in the new hash are ignored.
if (want('scene-clear')) {
  openCase('scene-clear', 'C1', '#scene= (empty) clears the previous scene and applies the legacy keys', 'R:7, R:30');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await waitAll(page);
    await page.waitForTimeout(SETTLE);
    const before = await atlasState(page);
    prereq('the scene is on screen to begin with', !!before?.blob, `blob=${(before?.blob || '').slice(0, 12)}…`, 'a blob');

    await page.evaluate(() => { location.hash = 'scene=&select=FMA9611&view=front'; });
    await page.waitForTimeout(SETTLE);
    const after = await atlasState(page);
    const t = await targets(page, ['FMA9611']);
    const a = axis(t);
    assert('the scene blob is cleared', after?.blob === '', `blob="${(after?.blob || '').slice(0, 16)}"`, 'empty');
    // Report the ATTRIBUTE, not a sentence about it: the first draft of this line passed the
    // literal string 'no data-atlas-scene' as the measured value, so a failing row printed the
    // opposite of what it had found — an instrument that lies in its own failure output.
    const sceneAttr = await page.evaluate(() => document.documentElement.getAttribute('data-atlas-scene'));
    assert('the scene marker is removed from the DOM', sceneAttr === null,
      sceneAttr === null ? 'attribute absent' : `data-atlas-scene="${sceneAttr}"`, 'absent');
    assert('the legacy select in the clearing hash is applied',
      Array.isArray(after?.ids) && after.ids.length === 1 && after.ids[0] === 'FMA9611',
      `ids=${JSON.stringify(after?.ids)}`, '["FMA9611"]');
    assert('the legacy view in the clearing hash is applied (camera on +Z)',
      after?.view === 'front' && a.z > 0.9, `view=${after?.view} direction z=${a.z.toFixed(2)}`, 'front, z > 0.9');
    // AND THE SCENE'S OWN FRAMING IS GONE. `rest.include` and the role opacities came from the
    // blob; a clear that leaves the focus fit armed is a half-clear.
    assert('the cleared scene no longer supplies a focus set', (after?.framing?.focus ?? 0) === 0,
      `framing.focus=${after?.framing?.focus}`, '0');
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 4 — RE-DRIVE READINESS IS GENERATION-AWARE ════════════════════════════════════════════
// codex-app-review.md §2 row 5 (R:29), the subtlest of the six and the one with two opposite
// failure modes in one line of code:
//
//   markSceneReady(phase === 'atlas')            app/v2/page.tsx (before v2.1a)
//
// (a) BETWEEN THE BARRIER AND FULL LOAD, `phase` is 'scene', so a re-drive cleared readiness and
//     published false — and nothing ever restored it, because `onProgress(100)` calls `markReady`
//     and never `markSceneReady`. The marker the renderer waits on was gone for the life of the tab.
// (b) BEFORE THE FIRST BARRIER, the pending barrier belonged to the PREVIOUS scene's priority set.
//     It fired, published readiness, and the page was showing a different scene whose meshes had
//     not arrived — readiness true for the wrong generation.
//
// ══ WHY THIS CASE HOLDS CHUNKS INSTEAD OF RACING THEM ══════════════════════════════════════════
// The first version of (b) navigated with `waitUntil:'commit'` and wrote the hash immediately,
// hoping to land inside the window. Adversarial review (codex gpt-6-astra, 2026-09-09, High 3)
// showed why that is not a gate: the write can precede the app's own initialisation (making B the
// INITIAL scene rather than a re-drive), the middle timing silently accepted an atlas that had
// already finished loading, and the geometry check read `__atlasTargets` group counts — which are
// projected from atlas METADATA and visibility flags and are therefore not proof that a mesh was
// ever uploaded.
//
// So the window is CONSTRUCTED, not awaited. The driver intercepts `/models/body-*.bin` and holds
// chosen chunks indefinitely, which makes every step deterministic:
//   · hold one of A's priority chunks  ⇒ A's first phase CANNOT complete
//   · hold all of B's own chunks       ⇒ B can never be satisfied, and `ready` never becomes true
// and the assertion becomes the one that actually matters and needs no geometry inference:
// **the marker must be ABSENT while the current scene's geometry is missing.** That is exactly the
// sequence review High 2 found in the first draft of the repair, where A's first-phase completion
// armed the barrier unconditionally and published it for B.
if (want('readiness-generations')) {
  openCase('readiness-generations', 'C1', 'readiness is published only when the CURRENT scene has its chunks', 'R:29');
  const {context, page, errors} = await fresh();
  let chunks = null;
  try {
    await page.goto(`${base}/v2/`, {waitUntil: 'domcontentloaded', timeout: 180000});
    chunks = await page.evaluate(async (ids) => {
      const a = await (await fetch('/models/atlas.json')).json();
      const parts = new Map(a.parts.map((p) => [p.id, p]));
      const concepts = new Map(a.concepts.map((c) => [c.id, c]));
      const of = (list) => {
        const out = new Set();
        for (const id of list) for (const el of (concepts.get(id)?.elements ?? [id])) {
          const p = parts.get(el); if (p) out.add(p.chunk);
        }
        return [...out].sort((x, y) => x - y);
      };
      return {a: of(ids.a), b: of(ids.b), total: a.chunks.length};
    }, {a: SCENE.structures.map((s) => s.id), b: SCENE_B.structures.map((s) => s.id)});
  } catch (e) { current.error = String(e).slice(0, 240); }
  finally { await context.close(); }

  const onlyB = chunks ? chunks.b.filter((c) => !chunks.a.includes(c)) : [];
  prereq('the two fixtures need DIFFERENT chunks (or the generation cases cannot fail)',
    onlyB.length > 0, chunks ? `A=[${chunks.a}] B=[${chunks.b}] onlyB=[${onlyB}]` : `atlas read failed: ${current.error}`,
    'B needs at least one chunk A does not');

  if (onlyB.length) {
    // ── (b) THE HELD-CHUNK INVARIANT — the decisive one ────────────────────────────────────────
    const {context: cx, page: pg, errors: er} = await fresh();
    const holdA = chunks.a[chunks.a.length - 1];
    const hold = new Set([holdA, ...onlyB]);
    const parked = [];
    try {
      await cx.route(/\/models\/body-\d+\.bin(\.gz)?$/, (route) => {
        const n = Number(/body-(\d+)\.bin/.exec(route.request().url())[1]);
        if (hold.has(n)) { parked.push({n, route}); return; }   // held: deliberately never continued
        return route.continue();
      });
      const release = async (n) => {
        hold.delete(n);
        for (const p of parked.filter((x) => x.n === n)) { try { await p.route.continue(); } catch { /* gone */ } }
      };
      const marker = () => pg.evaluate(() => document.documentElement.dataset.atlasSceneReady ?? null);
      // WHICH CHUNKS ACTUALLY CAME BACK. codex r9 Medium 3: "marker absence does not prove the
      // intended A request was parked, or that A's phase completed after release." Absence is the
      // weakest evidence there is — it is equally consistent with the hold working and with the
      // request never having been made. These two instruments make both halves positive facts.
      const served = new Set();
      pg.on('response', (r) => { const m = /\/models\/body-(\d+)\.bin/.exec(r.url()); if (m) served.add(Number(m[1])); });

      await pg.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      // A's first phase cannot complete while one of ITS chunks is held, so the marker must not
      // exist yet. This also proves the hold is working — without it everything below is vacuous.
      await pg.waitForTimeout(7000);
      const m0 = await marker();
      // THE INTENDED REQUEST, NAMED. `parked.length > 0` was satisfied by any parked chunk at all —
      // including one belonging only to B — which would leave A unheld and every assertion below
      // vacuous. Assert that A's OWN chunk is the one sitting in the queue, and that it has not been
      // served.
      prereq('the intended chunk of A is parked and unserved (not merely "something is parked")',
        parked.some((p) => p.n === holdA) && !served.has(holdA),
        `holdA=${holdA}, parked=[${parked.map((p) => p.n).join(',')}], served=[${[...served].join(',')}]`,
        `body-${holdA} parked, not served`);
      prereq('the chunk hold works: A’s barrier has NOT fired while one of A’s chunks is held',
        m0 === null, `data-atlas-scene-ready=${m0}, ${parked.length} requests parked`, 'absent');

      // Re-drive to B BEFORE A's barrier — the exact window review High 2 identified.
      await pg.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B);
      await pg.waitForTimeout(700);
      const m1 = await marker();
      assert('a re-drive withdraws readiness', m1 === null, `data-atlas-scene-ready=${m1}`, 'absent');

      // Release A's chunk. A's first phase completes now — and it must NOT publish readiness,
      // because the page is showing B and B's geometry is still held.
      await release(holdA);
      await pg.waitForTimeout(7000);
      // POSITIVE EVIDENCE THAT A'S PHASE COULD COMPLETE. Without this the next assertion reads
      // "the marker is absent" — which is also what you get if the release silently failed and A
      // is still starved. The response event says the geometry actually arrived.
      prereq('A’s held chunk was released AND its response arrived (so A’s phase had its geometry)',
        served.has(holdA), `served=[${[...served].join(',')}] want ${holdA}`, `body-${holdA} served`);
      const m2 = await marker();
      const shown = await atlasState(pg);
      assert('A’s completing first phase does NOT publish readiness for B',
        m2 === null, `data-atlas-scene-ready=${m2}, on screen=${(shown?.blob || '').slice(0, 12)}…`, 'absent');

      // Release B's chunks. NOW readiness is owed, and it must describe B.
      for (const n of [...onlyB]) await release(n);
      let arrived = true;
      try { await waitScene(pg, 90000); } catch { arrived = false; }
      const after = await atlasState(pg);
      assert('once B’s chunks arrive, readiness IS published', arrived,
        arrived ? 'the marker appeared' : 'the marker never appeared within 90 s of release', 'published');
      assert('and it describes B, not the superseded scene', after?.blob === BLOB_B,
        `state.blob=${(after?.blob || '').slice(0, 12)}… want=${BLOB_B.slice(0, 12)}…`, 'scene B');
      prereq('no page error (held-chunk case)', er.length === 0, er.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the held-chunk case ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { for (const p of parked) { try { await p.route.continue(); } catch { /* gone */ } } await cx.close(); }

    // ── (a) re-drive BETWEEN the barrier and full load ─────────────────────────────────────────
    // Constructed the same way rather than raced: holding one chunk NEITHER fixture needs keeps
    // `ready` false for the whole case, so "between the barrier and full load" is a state the run
    // is IN rather than one it hopes to catch. The old version accepted an already-complete atlas
    // and said so in its own measured string, which is not a gate.
    const spare = Array.from({length: chunks.total}, (_, i) => i)
      .find((i) => !chunks.a.includes(i) && !chunks.b.includes(i));
    const {context: cx2, page: p2, errors: e2} = await fresh();
    const parked2 = [];
    try {
      prereq('a chunk exists that neither fixture needs (so full load can be withheld)',
        spare !== undefined, `spare=${spare} of ${chunks.total} chunks`, 'one spare chunk');
      await cx2.route(/\/models\/body-\d+\.bin(\.gz)?$/, (route) => {
        const n = Number(/body-(\d+)\.bin/.exec(route.request().url())[1]);
        if (n === spare) { parked2.push(route); return; }
        return route.continue();
      });
      await p2.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitScene(p2);
      const fullyLoaded = await p2.evaluate(() => document.documentElement.dataset.atlasReady === '1');
      prereq('the atlas is NOT fully loaded, so this really is the middle window',
        fullyLoaded === false, `data-atlas-ready=${fullyLoaded ? '1' : 'absent'}`, 'absent');
      await p2.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B);
      let restored = true;
      try { await waitScene(p2, 90000); } catch { restored = false; }
      assert('readiness returns after a re-drive between the barrier and full load', restored,
        restored ? 'the marker came back' : 'the marker NEVER came back within 90 s', 'the marker returns');
      const sB = await atlasState(p2);
      assert('and it is published for the CURRENT scene', sB?.blob === BLOB_B,
        `state.blob=${(sB?.blob || '').slice(0, 12)}…`, 'scene B');
      prereq('no page error (middle-window case)', e2.length === 0, e2.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the middle-window case ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { for (const r of parked2) { try { await r.continue(); } catch { /* gone */ } } await cx2.close(); }

    // ── (c) re-drive AFTER full load ──────────────────────────────────────────────────────────
    const {context: cx3, page: p3, errors: e3} = await fresh();
    try {
      await p3.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitAll(p3);
      await p3.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B);
      let post = true;
      try { await waitScene(p3, 60000); } catch { post = false; }
      const s3 = await atlasState(p3);
      assert('readiness is republished after a post-load re-drive', post && s3?.blob === BLOB_B,
        `${post ? 'marker present' : 'marker MISSING'}, blob=${(s3?.blob || '').slice(0, 12)}…`, 'present, scene B');
      prereq('no page error (post-load case)', e3.length === 0, e3.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the post-load case ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { await cx3.close(); }
  }
}


// ══ CASE 5 — WARM LEGACY RE-DRIVE, THROUGH A REUSED PAGE ═══════════════════════════════════════
// codex-app-review.md §2 row 10 (R:34). The renderer re-drives a WARM tab by setting the hash
// `reDriveHash()` builds (workers/snap/src/helpers.mjs:75-104). The legacy branch writes no `lang`
// and only writes `system` when the request has one, and the page only overwrites what the URL
// mentions — so a Hant request after a Hans one keeps Hans, and a request with no `system` after a
// `system=skeletal` one keeps skeletal. The cache key describes the NEW request. HTTP 200, a
// plausible picture, the wrong language.
//
// THIS CASE RUNS ON `/` (v1), because that is the page the renderer loads. The pure-function half
// (every key present, cache identity unchanged) is a unit test — test/redrive-hash.test.mjs — and
// this is the end-to-end half codex asked for: "through a reused renderer page, both transition
// directions".
if (want('warm-legacy-redrive')) {
  openCase('warm-legacy-redrive', 'C1', 'a warm legacy re-drive resets language and system in both directions', 'R:34');
  const {context, page, errors} = await fresh();
  try {
    const {reDriveHash} = await import('../workers/snap/src/helpers.mjs');
    // Direction 1: zh-Hans + skeletal, then a plain request with neither.
    await page.goto(`${base}/?select=FMA22359&lang=zh-Hans&system=skeletal&snap=1`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitAll(page);
    await page.waitForTimeout(1500);
    // `isolate=0` matters: the legacy re-drive defaults `isolate` to 1, and an isolated view draws
    // only the selection, which would hide the very thing a system-visibility assertion measures.
    // ASKED THROUGH THE GROUP LANE, NOT THE PARTS LANE. `parts` comes from the frame loop's cached
    // projection and is EMPTY unless the body is exploded or a plate is rendering — the first
    // version of this assertion read it and compared 0 with 0, which is the very vacuity codex
    // flagged one finding earlier. `groups` is computed on demand and only contains ids whose
    // meshes passed the visibility filter, so presence there means DRAWN.
    //
    // FMA7088 (the heart) is the probe because it is CARDIAC: `system=skeletal` excludes it, and the
    // default system set includes it. The femur would prove nothing — it is skeletal in both states.
    const heartDrawn = () => page.evaluate(async (id) => {
      const g = window.__atlasTargets ? window.__atlasTargets([id]) : null;
      return g ? (g.groups?.[id]?.n ?? 0) : null;
    }, 'FMA7088');
    const warm = await page.evaluate(() => ({lang: document.documentElement.lang}));
    prereq('the warm tab really is in zh-Hans first', warm.lang === 'zh-Hans', `lang=${warm.lang}`, 'zh-Hans');

    // ── THE SYSTEM RESET, asserted on what is DRAWN rather than on the URL ──────────────────
    // The Worker's legacy branch now writes an explicit default system list; without it a warm tab
    // that had rendered `system=skeletal` kept the skeleton. Measured through the renderer: with
    // `isolate=0` and one muscle selected, a skeletal-only tab draws far fewer parts than one whose
    // systems have been reset to the default. (codex review, 2026-09-09, Medium 2 — the first
    // version of this case asserted language only, and its `systems` variable actually read
    // `data-atlas-selected`.)
    const skeletalOnly = reDriveHash(new URLSearchParams('select=FMA22359&system=skeletal&isolate=0'));
    await page.evaluate((h) => { location.hash = h.replace(/^#/, ''); }, skeletalOnly);
    await page.waitForTimeout(3000);
    const restricted = await heartDrawn();
    prereq('the skeletal-only re-drive really hides the cardiac probe', restricted === 0,
      `${restricted} heart meshes drawn under system=skeletal`, '0');
    const resetSystems = reDriveHash(new URLSearchParams('select=FMA22359&isolate=0'));
    await page.evaluate((h) => { location.hash = h.replace(/^#/, ''); }, resetSystems);
    await page.waitForTimeout(3000);
    const restored = await heartDrawn();
    assert('a re-drive with no system= restores the DEFAULT systems, not the previous skeletal-only view',
      typeof restored === 'number' && restored > 0,
      `${restored} heart meshes drawn after the reset (was ${restricted} under system=skeletal)`,
      '> 0 — the cardiac system is visible again');

    const hash1 = reDriveHash(new URLSearchParams('select=FMA9611&view=front'));
    await page.evaluate((h) => { location.hash = h.replace(/^#/, ''); }, hash1);
    await page.waitForTimeout(2500);
    const after1 = await page.evaluate(() => ({
      lang: document.documentElement.lang,
      selected: document.documentElement.dataset.atlasSelected,
      visible: window.__atlasTargets ? window.__atlasTargets([]).parts.length : null,
    }));
    assert('a re-drive with no lang resets the page to English', after1.lang === 'en', `lang=${after1.lang}`, 'en');
    assert('the re-drive applied its own selection', after1.selected === 'FMA9611', `selected=${after1.selected}`, 'FMA9611');

    // Direction 2: back INTO a language and a system, so the reset is not one-way.
    const hash2 = reDriveHash(new URLSearchParams('select=FMA22359&lang=zh-Hant&system=skeletal&view=side'));
    await page.evaluate((h) => { location.hash = h.replace(/^#/, ''); }, hash2);
    await page.waitForTimeout(2500);
    const after2 = await page.evaluate(() => ({lang: document.documentElement.lang, selected: document.documentElement.dataset.atlasSelected}));
    assert('a re-drive that DOES carry lang applies it', after2.lang === 'zh-Hant', `lang=${after2.lang}`, 'zh-Hant');

    // Direction 3: and out again, which is the direction the review names as the defect.
    const hash3 = reDriveHash(new URLSearchParams('select=FMA7088'));
    await page.evaluate((h) => { location.hash = h.replace(/^#/, ''); }, hash3);
    await page.waitForTimeout(2500);
    const after3 = await page.evaluate(() => ({lang: document.documentElement.lang, selected: document.documentElement.dataset.atlasSelected}));
    assert('and a plain request after a zh-Hant one is English again', after3.lang === 'en', `lang=${after3.lang}`, 'en');
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 6 — "1 pieces" ════════════════════════════════════════════════════════════════════════
// v21-design.md:912, critic gap 7. It is on the screenshot Adrian sent. `'{n} pieces'`
// (app/v2/copy.ts:35) with one mesh selected prints "1 pieces", and the design's own wireframe
// draws "1 piece" — so the spec and the picture disagreed and the code matched neither.
// FMA7487 "body of sternum" has exactly one element, which is what makes n===1 reachable at all.
if (want('plural')) {
  openCase('plural', 'C1', 'the selection count reads "1 piece", not "1 pieces"', 'G7');
  const {context, page, errors} = await fresh(390, 844, true);
  try {
    await page.goto(`${base}/v2/?select=FMA7487`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(1500);
    await openMargin(page);
    const count = await page.evaluate(() => document.querySelector('.v2-count')?.textContent?.trim() ?? null);
    assert('one selected mesh prints the singular', count === '1 piece', `"${count}"`, '"1 piece"');
    // And the plural still works, or "fix the singular" becomes "break the plural".
    await page.goto(`${base}/v2/?select=FMA7485`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(1500);
    await openMargin(page);
    const many = await page.evaluate(() => document.querySelector('.v2-count')?.textContent?.trim() ?? null);
    assert('three selected meshes still print the plural', many === '3 pieces', `"${many}"`, '"3 pieces"');
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 7 — AN EDITED SCENE IS WHAT RELOAD AND plate() SEE ════════════════════════════════════
// codex-app-review.md §2 row 3 (R:27). OWNED BY C2: the repair is the canonical controller, and a
// C1 patch would build a throwaway one that C2 replaces (codex-plan-review.md §A.2). Today
// `writeUrlState` writes `lastBlob` VERBATIM (app/url-state.ts:149) — deliberately, so a copied
// plate URL reproduces the same picture — but nothing updates `lastBlob` when the human edits the
// scene, so the URL, `plate()` and a reload all describe the scene as it ARRIVED.
if (want('edited-scene-persists')) {
  openCase('edited-scene-persists', 'C2', 'removing a structure changes the blob, the URL, plate() and a reload', 'R:27');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await waitAll(page);
    await page.waitForTimeout(SETTLE);
    await openMargin(page);

    const before = await atlasState(page);
    prereq('the scene starts with all five structures', (before?.ids ?? []).length === 5,
      `${(before?.ids ?? []).length} ids`, '5');

    // Remove the femur (a CONTEXT member, so the primary and the focus are untouched and the
    // assertion is about membership rather than about focus fallback).
    const removed = 'FMA9611';
    const xs = await page.$$('.v2-row-x, .v2-card-x');
    let clicked = false;
    for (const x of xs) {
      const owns = await x.evaluate((el, id) => {
        const row = el.closest('.v2-row, .v2-card');
        const label = el.getAttribute('aria-label') || '';
        return !!row && (label.includes('femur') || label.includes('股骨') || row.textContent.includes(id));
      }, removed);
      if (owns) { clicked = await clickAt(page, x); break; }
    }
    if (!clicked && xs.length) clicked = await clickAt(page, xs[xs.length - 1]);
    prereq('a remove control was found and pressed', clicked, `${xs.length} remove controls in the set list`, 'one pressed');
    await page.waitForTimeout(1500);

    const after = await atlasState(page);
    const plate = await page.evaluate(() => window.atlas?.plate?.() ?? null);
    const urlBlob = await page.evaluate(() => new URLSearchParams(location.search).get('scene'));
    assert('the controller dropped the structure', !(after?.ids ?? []).includes(removed),
      `ids=${JSON.stringify(after?.ids)}`, `without ${removed}`);
    const decodedPlate = plate?.blob ? decodeScene(plate.blob) : null;
    assert('plate() returns a blob that no longer names it',
      !!decodedPlate && !decodedPlate.structures.some((s) => s.id === removed),
      decodedPlate ? decodedPlate.structures.map((s) => s.id).join(',') : 'plate blob did not decode', `without ${removed}`);
    const decodedUrl = urlBlob ? decodeScene(urlBlob) : null;
    assert('the URL blob no longer names it',
      !!decodedUrl && !decodedUrl.structures.some((s) => s.id === removed),
      decodedUrl ? decodedUrl.structures.map((s) => s.id).join(',') : 'url blob did not decode', `without ${removed}`);
    // UNTOUCHED SUPPORTED FIELDS SURVIVE. The controller PATCHES the authoritative scene; it does
    // not rebuild one from React state, which is where the caption, the padding and the background
    // would quietly go missing (codex-plan-review.md §A.3).
    assert('the caption survives the edit',
      decodedUrl?.caption?.title === SCENE.caption.title, `title="${decodedUrl?.caption?.title}"`, `"${SCENE.caption.title}"`);
    assert('the camera padding survives the edit',
      decodedUrl?.camera?.padding === SCENE.camera.padding, `padding=${decodedUrl?.camera?.padding}`, String(SCENE.camera.padding));
    assert('the declared focus survives the edit',
      JSON.stringify(decodedUrl?.camera?.focus) === JSON.stringify(SCENE.camera.focus),
      JSON.stringify(decodedUrl?.camera?.focus), JSON.stringify(SCENE.camera.focus));

    // AND A RELOAD. The hash must not resurrect the arrival scene (app/url-state.ts:120,151).
    await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(SETTLE);
    const reloaded = await atlasState(page);
    assert('a reload shows the EDITED scene', !(reloaded?.ids ?? []).includes(removed) && (reloaded?.ids ?? []).length === 4,
      `ids=${JSON.stringify(reloaded?.ids)}`, `4 ids, without ${removed}`);
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 8 — FOCUS CHANGE RETARGETS THE CAMERA ═════════════════════════════════════════════════
// codex-app-review.md §2 row 4 (R:28). OWNED BY C2. `focusPick` sets `focusId` and bumps `reset`,
// but the renderer's focus set comes from `plate.focus`, which is derived from
// `scene.camera.focus` (app/v2/page.tsx:157,166) — the scene as it arrived. So the label under the
// figure changes and the camera does not move: the rail reads as decoration.
//
// MEMBERSHIP MUST NOT CHANGE. Retargeting is a camera operation; if the fix also drops the other
// structures it has traded one defect for a worse one, so that is asserted alongside.
if (want('focus-retargets-camera')) {
  openCase('focus-retargets-camera', 'C2', 'focusing another declared member moves the camera target, not just the label', 'R:28');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await waitAll(page);
    await page.waitForTimeout(SETTLE);

    const t0 = await targets(page, ['FMA22359', 'FMA16203']);
    const s0 = await atlasState(page);
    const target0 = {x: t0.camera.tx, y: t0.camera.ty, z: t0.camera.tz};
    prereq('the scene declares a focus to begin with', (s0?.framing?.focus ?? 0) > 0,
      `framing.focus=${s0?.framing?.focus}`, '> 0');

    // FMA16203 is the GHOST and the alphabetically-first member — the structure L31's hotfix
    // stopped the page opening on. Focusing it deliberately is a different operation from
    // defaulting to it, and it is far from the hamstrings, so a real retarget is unmistakable.
    // TIER-AWARE SINCE L31 v2.1b+c S0. `fresh()` opens at 1440x900, which is now the STUDIO tier,
    // where the phone's rail / margin / set-list do not exist -- the same product facts are carried
    // by the Selection dock. The lookups below name BOTH trees, so one case asserts one behaviour
    // across both rather than two cases drifting apart. The PRODUCT claim is unchanged.
    const notches = await page.$$('.v2-rail .v2-notch');
    let moved = false;
    for (const n of notches) {
      const isGhost = await n.evaluate((el) => el.className.includes('role-ghost'));
      if (isGhost) { moved = await clickAt(page, n); break; }
    }
    if (notches.length) {
      prereq('the ghost notch was found and pressed', moved, `${notches.length} notches in the rail`, 'one pressed');
    } else {
      // THE STUDIO. The ghost is identified by its ROLE BADGE -- the same fact the rail's
      // `role-ghost` class carries -- never by position, which would silently follow whatever
      // order the dock happens to render in.
      const cards = await page.$$('.v2-card');
      let ghosts = 0;
      for (const c of cards) {
        const isGhost = await c.evaluate((el) => !!el.querySelector('.v2-badge.role-ghost'));
        if (!isGhost) continue;
        ghosts += 1;
        const btn = await c.$('.v2-card-focus');
        if (btn) { moved = await clickAt(page, btn); break; }
      }
      prereq('the ghost focus control was found and pressed (studio Selection dock)', moved,
        `${cards.length} selection cards, ${ghosts} carrying the ghost badge`, 'one pressed');
    }
    await page.waitForTimeout(SETTLE);

    const t1 = await targets(page, ['FMA22359', 'FMA16203']);
    const s1 = await atlasState(page);
    const target1 = {x: t1.camera.tx, y: t1.camera.ty, z: t1.camera.tz};
    const delta = Math.hypot(target1.x - target0.x, target1.y - target0.y, target1.z - target0.z);
    // 3 cm on a 1.75 m subject: far above the 1e-6 float noise the settle test uses and far below
    // anything that could be damping overshoot, which has settled by now.
    assert('the camera TARGET moved to the newly focused member', delta > 0.03,
      `|Δtarget| = ${delta.toFixed(4)} m (from ${target0.y.toFixed(3)} to ${target1.y.toFixed(3)} in y)`, '> 0.03 m');
    const g = t1.groups?.FMA16203;
    if (g) {
      const cx = (g.left + g.right) / 2, cy = (g.top + g.bottom) / 2;
      const off = Math.hypot(cx - t1.w / 2, cy - t1.h / 2);
      assert('and the newly focused member is near the centre of the field', off < Math.max(t1.w, t1.h) * 0.35,
        `${Math.round(off)} px from the field centre (${t1.w}x${t1.h})`, `< ${Math.round(Math.max(t1.w, t1.h) * 0.35)} px`);
    }
    assert('membership is unchanged by a focus change', (s1?.ids ?? []).length === (s0?.ids ?? []).length,
      `${(s0?.ids ?? []).length} -> ${(s1?.ids ?? []).length} ids`, 'unchanged');
    assert('the focus is recorded on the controller', s1?.focus === 'FMA16203', `focus=${s1?.focus}`, 'FMA16203');
    prereq('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); prereq('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}


// ══ CASE 9 — THE THREE PATHS codex's SECOND REVIEW REPRODUCED ══════════════════════════════════
// Every assertion here corresponds to a defect codex executed against the shipped tree (review 2,
// Highs 1, 2 and 4). They are grouped in one case because they share a shape: each was a path the
// existing suite did not walk, next to a path it did.
if (want('review2-paths')) {
  openCase('review2-paths', 'C2', 'Clear, a percent-encoded hash, and plain-entry readiness', 'codex review 2 H1/H2/H4');

  // ── H1: the CLEAR BUTTON, not `#scene=` ──────────────────────────────────────────────────────
  // `clearSceneState` called `markScene('')` by hand, so the `#scene=` case passed while the Clear
  // button and `atlas.clear()` left the serializer's cached blob intact — and the next debounced
  // write put `scene=` back, so a reload resurrected the cleared scene.
  {
    const {context, page, errors} = await fresh();
    try {
      await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitScene(page); await waitAll(page);
      await page.waitForTimeout(SETTLE);
      await openMargin(page);
      const clearBtn = (await page.$('.v2-clear-all')) ?? (await page.$$('.v2-set-foot button')).at(-1);
      prereq('the Clear control was found', !!clearBtn, clearBtn ? 'present' : 'absent', 'present');
      if (clearBtn) await clickAt(page, clearBtn);
      await page.waitForFunction(() => !/(\?|&)scene=/.test(location.search), null, {timeout: 15000})
        .catch(() => { /* leave it to the assertion to report what it actually found */ });
      await page.waitForTimeout(400);
      const afterClear = await page.evaluate(() => ({
        search: location.search,
        marker: document.documentElement.getAttribute('data-atlas-scene'),
        ids: window.atlas?.state?.().ids ?? null,
        blob: window.atlas?.state?.().blob ?? null,
      }));
      assert('Clear empties the controller', (afterClear.ids ?? []).length === 0 && afterClear.blob === '',
        `ids=${JSON.stringify(afterClear.ids)} blob="${afterClear.blob}"`, 'empty');
      assert('Clear drops scene= from the URL', !/(\?|&)scene=/.test(afterClear.search),
        afterClear.search.slice(0, 120) || '(empty)', 'no scene=');
      assert('Clear drops the DOM scene marker', afterClear.marker === null,
        afterClear.marker === null ? 'absent' : `data-atlas-scene="${afterClear.marker}"`, 'absent');
      await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
      await page.waitForTimeout(4000);
      // THE API MUST BE THERE FOR "EMPTY" TO MEAN ANYTHING. codex review 6, Medium: this read
      // `window.atlas?.state?.().ids ?? null`, so a page on which the atlas never mounted returned
      // `null`, `(null ?? []).length === 0` held, and MISSING EVIDENCE passed as an empty
      // selection — the assertion was green in exactly the case it could not see. Absence of the
      // API is now its own loud failure, reported separately from the emptiness claim.
      const afterReloadState = await page.evaluate(() => ({
        hasApi: typeof window.atlas?.state === 'function',
        ids: typeof window.atlas?.state === 'function' ? (window.atlas.state().ids ?? null) : null,
      }));
      assert('the atlas API is present after the reload (so "empty" is a reading, not a silence)',
        afterReloadState.hasApi, `window.atlas.state ${afterReloadState.hasApi ? 'present' : 'MISSING'}`, 'present');
      const afterReload = afterReloadState.ids;
      assert('a reload does NOT resurrect the cleared scene',
        afterReloadState.hasApi && Array.isArray(afterReload) && afterReload.length === 0,
        `ids=${JSON.stringify(afterReload)}`, 'still empty');
      prereq('no page error (clear path)', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the clear path ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { await context.close(); }
  }

  // ── H2: a PERCENT-ENCODED key name in the spent hash ─────────────────────────────────────────
  // `URLSearchParams` decodes `%73cene` to `scene`, so `#%73cene=X` is a scene hash to every reader
  // in url-state — but the fence was a regex on the RAW string and did not see it. The stale hash
  // then outranked the edited query on reload and restored the removed structure.
  {
    const {context, page, errors} = await fresh();
    try {
      // IN THE INITIAL URL, not set afterwards. The first version assigned `location.hash` right
      // after `goto`, before the atlas had loaded — so the hashchange listener was not registered
      // yet (it is created only once `atlas` exists) and the mount-time `readUrlState` had already
      // run. The scene never applied and the case measured its own race.
      await page.goto(`${base}/v2/#%73cene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitScene(page); await waitAll(page);
      await page.waitForTimeout(SETTLE);
      await openMargin(page);
      const before = await atlasState(page);
      prereq('the percent-encoded hash really applied the scene', (before?.ids ?? []).length === 5,
        `${(before?.ids ?? []).length} ids from #%73cene=`, '5');
      // remove a member, then reload
      const xs = await page.$$('.v2-row-x, .v2-card-x');
      prereq('a remove control was found', xs.length > 0, `${xs.length} remove controls`, '> 0');
      if (xs.length) await clickAt(page, xs[xs.length - 1]);
      await page.waitForFunction(() => (window.atlas?.state?.().ids ?? []).length === 4, null, {timeout: 15000})
        .catch(() => { /* the assertion reports what it found */ });
      await page.waitForTimeout(600);
      const edited = await atlasState(page);
      assert('the edit applied', (edited?.ids ?? []).length === 4, `${(edited?.ids ?? []).length} ids`, '4');
      const hashAfter = await page.evaluate(() => location.hash);
      assert('the spent percent-encoded hash is dropped', !/cene=/i.test(decodeURIComponent(hashAfter)),
        hashAfter.slice(0, 60) || '(empty)', 'no scene key');
      await page.reload({waitUntil: 'domcontentloaded', timeout: 180000});
      await waitScene(page);
      await page.waitForTimeout(SETTLE);
      const reloaded = await atlasState(page);
      assert('a reload keeps the EDIT, not the encoded hash’s original scene',
        (reloaded?.ids ?? []).length === 4, `${(reloaded?.ids ?? []).length} ids after reload`, '4');
      prereq('no page error (encoded hash path)', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the encoded-hash path ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { await context.close(); }
  }

  // ── H4: PLAIN `/v2/` — no selection at all, with every model chunk held ──────────────────────
  // The bare sweep selects a sternum, so it never exercised an EMPTY requirement. `apply-legacy`
  // raises the epoch with empty `requiredIds`, and the corrective pass's `if(!ids.length) return
  // true` then armed readiness with zero chunks loaded, freezing a zero-byte metric.
  {
    const {context: cx, page: pg, errors: er} = await fresh();
    const parked = [];
    try {
      // A RELEASE FLAG, because chunks keep being requested after the hold is lifted. The first
      // version parked every request unconditionally, so the loader could never finish and the
      // "and once released it becomes ready" row failed on the harness rather than on the app.
      let holding = true;
      await cx.route(/\/models\/body-\d+\.bin(\.gz)?$/, (route) => {
        if (holding) { parked.push(route); return; }
        return route.continue();
      });
      await pg.goto(`${base}/v2/`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await pg.waitForTimeout(8000);
      const held = await pg.evaluate(() => ({
        marker: document.documentElement.getAttribute('data-atlas-scene-ready'),
        bytes: document.documentElement.dataset.atlasSceneBytes ?? null,
      }));
      prereq('every model chunk is held, so nothing can legitimately be ready',
        parked.length > 0, `${parked.length} chunk requests parked`, '> 0');
      assert('a plain visit does NOT publish readiness before any model byte arrives',
        held.marker === null,
        `data-atlas-scene-ready=${held.marker}, frozen bytes=${held.bytes}`, 'absent');
      // release, and it must then become ready normally
      holding = false;
      for (const r of parked) { try { await r.continue(); } catch { /* gone */ } }
      let ok = true;
      try { await waitScene(pg, 120000); } catch { ok = false; }
      const bytes = await pg.evaluate(() => Number(document.documentElement.dataset.atlasSceneBytes ?? 0));
      assert('and once the chunks are released it becomes ready with a non-zero byte reading',
        ok && bytes > 0, `${ok ? 'ready' : 'never ready'}, frozen bytes=${bytes}`, 'ready, > 0 bytes');
      prereq('no page error (plain entry)', er.length === 0, er.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the plain-entry path ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { for (const r of parked) { try { await r.continue(); } catch { /* gone */ } } await cx.close(); }
  }
}


// ══ CASE 10 — PLAIN `/v2/`, NO SELECTION AT ALL, AT THE REQUIRED WIDTHS ════════════════════════
// codex asked for this twice (plan review §D, and review 2 Medium 7) and I under-delivered twice:
// the sweep's "bare" fixture navigates with `?select=FMA7485`, so the ZERO-selection entry — the
// literal case R:25 describes — was never loaded, and reachability was hit-tested without ever
// pressing anything. The widths 1100/1179/1180 are also named explicitly. My earlier disposition
// said 1180 "is not yet a boundary that exists"; that was answering a different question. The point
// is not that the stylesheet has a rule there, it is that the CONTROLS MUST WORK there, and that is
// an existing-behaviour acceptance check whichever tier the width happens to land in.
//
// So this loads plain `/v2/` and actually USES the controls: Find opens a search field, Systems
// opens the system list, and a view button moves the camera onto the axis it names.
if (want('plain-entry-widths')) {
  openCase('plain-entry-widths', 'C1', 'plain /v2/ with NO selection: the controls are reachable AND work at 1100–1920', 'R:25');
  for (const width of [1100, 1179, 1180, 1440, 1920]) {
    const {context, page, errors} = await fresh(width, 900);
    try {
      await page.goto(`${base}/v2/`, {waitUntil: 'domcontentloaded', timeout: 180000});
      // No scene and no selection, so there is no scene barrier to wait for — wait for the atlas.
      await waitAll(page);
      await page.waitForTimeout(2500);
      await openMargin(page);

      const find = async (label) => {
        const handle = await page.evaluateHandle((l) => [...document.querySelectorAll('button')]
          .find((b) => (b.textContent || '').trim() === l || (b.getAttribute('aria-label') || '').trim() === l) ?? null, label);
        const el = handle.asElement();
        return el;
      };
      const reachable = async (label) => {
        const el = await find(label);
        if (!el) return {ok: false, why: 'absent'};
        const box = await el.boundingBox();
        if (!box) return {ok: false, why: 'not rendered'};
        const hit = await el.evaluate((node) => {
          node.scrollIntoView({block: 'nearest'});
          const r = node.getBoundingClientRect();
          const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return !!top && (top === node || node.contains(top));
        });
        return {ok: hit, why: hit ? 'reachable' : 'covered', el};
      };

      const missing = [];
      // TIER-AWARE, SAME REQUIREMENT (R:25). In the studio the margin's Find/Systems buttons become
      // the tools row's Find and the left Layers sidebar; 'Reset view' and the four named views keep
      // their names in the navigation pill. Seven controls either way.
      const inStudio = await page.evaluate(() => !!document.querySelector('.v2.v2-studio'));
      const WANT = inStudio
        ? ['Find', 'Layers', 'Reset view', 'Three-quarter', 'Front', 'Side', 'Back']
        : ['Find', 'Systems', 'Reset view', 'Three-quarter', 'Front', 'Side', 'Back'];
      for (const label of WANT) {
        const r = await reachable(label);
        if (!r.ok) missing.push(`${label}: ${r.why}`);
      }
      assert(`[${width}px] every control on a ZERO-selection entry is reachable`,
        missing.length === 0, missing.length ? missing.join(' | ') : 'all 7 reachable', '0 unreachable');

      // AND THEY WORK. Reachability without operation is the vacuous half of the check.
      // FIND IS INERT IN THE STUDIO AT S0 (the palette is S2), so 'it opens a search field' is a
      // claim about the phone/tablet tree only. Asserting it in the studio would assert that an
      // unbuilt feature works; asserting nothing would let a broken phone search through. So the
      // operation check runs where the feature exists, and the studio gets its own: present,
      // focusable, and declaring itself inert rather than merely looking broken.
      const findBtn = await reachable('Find');
      if (findBtn.ok && inStudio) {
        const st = await findBtn.el.evaluate((el) => ({inert: el.getAttribute('aria-disabled') === 'true', owner: el.getAttribute('title'), focusable: el.tabIndex >= 0}));
        assert(`[${width}px] Find declares itself inert and names the group that brings it`,
          st.inert && st.owner === 'S2' && st.focusable,
          `aria-disabled=${st.inert} title=${st.owner} focusable=${st.focusable}`, 'inert, S2, focusable');
      }
      if (findBtn.ok && !inStudio) {
        await clickAt(page, findBtn.el);
        await page.waitForTimeout(500);
        const searchOpen = await page.evaluate(() => !!document.querySelector('.v2-search input'));
        assert(`[${width}px] Find opens a search field`, searchOpen, `search input present=${searchOpen}`, 'true');
        await clickAt(page, findBtn.el);   // close it again
        await page.waitForTimeout(300);
      }
      if (inStudio) {
        // The studio's Layers sidebar is OPEN by default, so the system list is on screen without a
        // press -- and the toggle must still work, so it is pressed twice and the list counted both
        // times. Fifteen rows either way, which is also a check that the tree is the real inventory
        // and not a placeholder that happens to render.
        const openRows = await page.evaluate(() => document.querySelectorAll('.v2-tree-row').length);
        const layersBtn = await reachable('Layers');
        let stubbed = null, back = null;
        if (layersBtn.ok) {
          await clickAt(page, layersBtn.el); await page.waitForTimeout(400);
          stubbed = await page.evaluate(() => !!document.querySelector('.v2-side.is-stub'));
          await clickAt(page, layersBtn.el); await page.waitForTimeout(400);
          back = await page.evaluate(() => document.querySelectorAll('.v2-tree-row').length);
        }
        assert(`[${width}px] the Layers sidebar lists the systems, and its toggle collapses and restores it`,
          openRows === 15 && stubbed === true && back === 15,
          `${openRows} rows open, collapsed=${stubbed}, ${back} rows after restoring`, '15, collapsed, 15');
      } else {
        const sysBtn = await reachable('Systems');
        if (sysBtn.ok) {
          await clickAt(page, sysBtn.el);
          await page.waitForTimeout(500);
          const rows = await page.evaluate(() => document.querySelectorAll('.v2-systems label').length);
          assert(`[${width}px] Systems opens the system list`, rows > 0, `${rows} system rows`, '> 0');
          await clickAt(page, sysBtn.el);
          await page.waitForTimeout(300);
        }
      }
      const sideBtn = await reachable('Side');
      if (sideBtn.ok) {
        await clickAt(page, sideBtn.el);
        await page.waitForTimeout(3000);
        const t = await targets(page, []);
        const a = axis(t);
        assert(`[${width}px] the Side view actually moves the camera onto +X`,
          a.x > 0.9 && Math.abs(a.z) < 0.3,
          `direction (${a.x.toFixed(2)}, ${a.y.toFixed(2)}, ${a.z.toFixed(2)})`, 'x > 0.9');
      }
      prereq(`[${width}px] no page error`, errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq(`[${width}px] the case ran`, false, String(e).slice(0, 200), 'no throw'); }
    finally { await context.close(); }
  }
}

// ══ CASE 11 — THE REQUEST LEDGER SEES A REQUEST THE DRIVER SUPPRESSES ═════════════════════════
// codex review 6, High 1. This is a case about the INSTRUMENT, not about the app, and it belongs
// here because the instrument is the thing every request budget in verify-ux.mjs rests on.
//
// Playwright 1.55.1 flags any URL ending in `/favicon.ico` (`Request._isFavicon`,
// playwright-core/lib/server/network.js:122) and `FrameManager.requestStarted()` returns BEFORE
// emitting the context `request` event for it — and, with interception installed,
// `route.abort('aborted')`s it before any custom route handler runs (frames.js:229). So the ledger
// that round 5 moved onto `context.on('request')` records sixteen rows for seventeen starts, and a
// `<= 16` budget passes on a page that issued seventeen — while the gate's stated population names
// the favicon explicitly (verify-ux.mjs). An instrument that cannot see a member of the population
// it claims to measure is an acceptance defect, whatever the app happens to do.
//
// THE FIXTURE IS SERVED LOCALLY, not from `base`, because the claim is about the DRIVER and must
// not depend on what the app under test happens to link. Five ordinary starts (the document plus
// four scripts) and one `/favicon.ico`: an honest ledger reads N+1 = 6.
//
// RUN TWICE — interception OFF and ON — because the two code paths differ (the second one ABORTS
// the request), and because the review asked for both by name.
if (want('favicon-ledger')) {
  openCase('favicon-ledger', 'C1', 'the request ledger counts a start Playwright suppresses (/favicon.ico)', 'codex review 6 H1');
  const ORDINARY = 4;
  /** Established by the interception-OFF pass against the fixture server's own log, then required
   *  exactly by the interception-ON pass. Interception must not change what the browser ISSUES. */
  let expectedFav = -1;
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(req.url);
    if (req.url === '/favicon.ico') { res.writeHead(200, {'content-type': 'image/x-icon'}); return res.end(Buffer.alloc(8)); }
    if (req.url.startsWith('/ord-')) { res.writeHead(200, {'content-type': 'text/javascript'}); return res.end('/* ordinary */\n'); }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>ledger fixture</title>'
      // An EXPLICIT element, not the browser's automatic tab icon: automatic favicon fetching is
      // headless-mode-dependent, and a fixture whose subject may not be requested at all is not a
      // fixture. The suppression is keyed on the URL suffix regardless of initiator, so an <img>
      // is suppressed exactly as the tab icon would be.
      + '<img src="/favicon.ico" width="1" height="1" alt="">'
      + Array.from({length: ORDINARY}, (_, i) => `<script src="/ord-${i + 1}.js"></script>`).join(''));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const fixture = `http://127.0.0.1:${port}/`;
  try {
    for (const intercept of [false, true]) {
      const tag = intercept ? 'interception ON' : 'interception OFF';
      hits.length = 0;   // per-run, or the second pass reports the first pass's server hits
      const cx = await browser.newContext({viewport: {width: 800, height: 600}});
      try {
        if (intercept) {
          // The same shape verify-ux.mjs installs when CF credentials are present. It must not
          // change the protocol-level count — that is half of what this case is here to show.
          await cx.route('**/*', (route) => route.continue());
        }
        const page = await cx.newPage();
        const ledger = await attachRequestLedger(cx, page);
        await page.goto(fixture, {waitUntil: 'load', timeout: 30000});
        // The favicon start is the last one to arrive; poll for it rather than sleeping, and let
        // the timeout expire into a red assertion rather than a hang.
        await page.waitForTimeout(200);
        for (let i = 0; i < 40 && !ledger.cdp.some((r) => r.url.endsWith('/favicon.ico')); i++) {
          await page.waitForTimeout(100);
        }
        const isFav = (u) => u.endsWith('/favicon.ico');
        const cdpFav = ledger.cdp.filter((r) => isFav(r.url));
        const cdpOrdinary = ledger.cdp.filter((r) => !isFav(r.url));
        const pwFav = ledger.pw.filter((r) => isFav(r.url));

        const serverFav = hits.filter((u) => u === '/favicon.ico').length;
        // EXACT, ANCHORED ON A SECOND INSTRUMENT. codex review 7, Low 2: the first version accepted
        // any total `>= 6` while the kept green run recorded 7, so the row proved the favicon was
        // VISIBLE without proving the count was RIGHT — and a budget is a count. With interception
        // OFF the fixture server's own request log is ground truth and the ledger must equal it to
        // the row (the second favicon start is the tab icon; the fixture does not need to know how
        // many there are, only that both instruments agree). With interception ON, Playwright
        // aborts the favicon so the server sees none — the expected count is then the one the OFF
        // pass established on the identical fixture, which is why the two passes run in that order.
        if (!intercept) expectedFav = cdpFav.length;

        prereq(`[${tag}] the fixture page loaded`, cdpOrdinary.length > 0,
          `${cdpOrdinary.length} ordinary starts`, '> 0');
        assert(`[${tag}] the ledger counts the ordinary starts EXACTLY (document + ${ORDINARY} scripts)`,
          cdpOrdinary.length === ORDINARY + 1, `${cdpOrdinary.length} ordinary starts`, `exactly ${ORDINARY + 1}`);
        assert(`[${tag}] the ledger contains the /favicon.ico start`,
          cdpFav.length >= 1, `${cdpFav.length} favicon starts`, '>= 1');
        assert(`[${tag}] the favicon count is EXACT, not merely non-zero`,
          cdpFav.length === expectedFav,
          intercept
            ? `${cdpFav.length} favicon starts vs ${expectedFav} on the identical fixture without interception`
            : `${cdpFav.length} favicon starts vs ${serverFav} hits in the fixture server's own log`,
          `exactly ${expectedFav}`);
        assert(`[${tag}] the ledger totals EXACTLY ordinary + favicon = ${ORDINARY + 1} + ${expectedFav}`,
          ledger.cdp.length === (ORDINARY + 1) + expectedFav,
          `${ledger.cdp.length} total starts (${cdpOrdinary.length} ordinary + ${cdpFav.length} favicon)`,
          `exactly ${(ORDINARY + 1) + expectedFav}`);
        // The cross-check lane, stated as an invariant that stays true whatever the driver does:
        // the protocol can only see MORE than the driver's filtered event, never less. Today the
        // difference is exactly the suppressed favicon, and that number is printed.
        assert(`[${tag}] the protocol lane sees at least as much as Playwright's lane`,
          ledger.cdp.length >= ledger.pw.length,
          `cdp=${ledger.cdp.length} playwright=${ledger.pw.length} (playwright favicon rows: ${pwFav.length})`,
          'cdp >= playwright');
        // Interception must not change the count. With it on, Playwright ABORTS the favicon — the
        // request is still ISSUED, so the protocol still has its row and the budget still bites.
        assert(`[${tag}] the browser really issued the favicon (or the driver aborted it after issuance)`,
          cdpFav.length >= 1 && (intercept ? serverFav === 0 : serverFav === cdpFav.length),
          `server saw ${serverFav} favicon hits, ledger has ${cdpFav.length}`,
          intercept ? 'issued, then aborted before the wire' : 'issued and served');
        prereq(`[${tag}] every clock is the wall clock`,
          ledger.cdp.every((r) => Number.isFinite(r.at) && r.at > 1.7e12),
          `${ledger.cdp.filter((r) => !(r.at > 1.7e12)).length} rows with a non-epoch timestamp`, '0');
      } catch (e) { prereq(`[${tag}] the case ran`, false, String(e).slice(0, 200), 'no throw'); }
      finally { await cx.close(); }
    }
  } finally { await new Promise((r) => server.close(r)); }
}

// ══ CASE 12 — THE BUDGET REFUSES A PAGE WHOSE TRAFFIC IT CANNOT SEE ══════════════════════════
// codex review 7, High 1. `context.newCDPSession(page)` attaches to ONE target. An out-of-process
// child frame is its own target: its `Network.requestWillBeSent` events go to ITS session
// (crConnection.js:65 dispatches by session id, crPage.js:595 handles iframe targets separately)
// and never reach this ledger. Sixteen page-session starts plus one child-session start is sixteen
// rows, and `<= 16` passes — round 6's defect wearing a different hat.
//
// TWO REMEDIES WERE OFFERED AND THIS TAKES THE SECOND. Attaching to every child target converges on
// nothing: OOPIFs, then dedicated workers, then shared workers, then service workers, then portals
// and prerenders, each with its own attach-before-first-request race, each a new place for the same
// silent omission. Naming the population and REFUSING to report a budget outside it terminates:
// there is one gate, it is checked twice per pass, and a page that leaves the population produces a
// red row instead of a number.
//
// So this case proves the gate BITES (a real out-of-process iframe makes it refuse) and that it is
// not merely a switch welded to "no" (the app's own page passes it).
//
// THE FIXTURE IS GENUINELY CROSS-SITE. A second PORT is the same site to Chromium's site isolation
// (a site is scheme + eTLD+1; the port is not part of it), so two ports on 127.0.0.1 would share a
// process and this case would test nothing. `--host-resolver-rules=MAP *.test 127.0.0.1` gives the
// two servers genuinely different sites (`parent.test` / `child.test`), and `--site-per-process`
// forces the out-of-process split rather than hoping for it. BOTH FLAGS ARE FOR THIS CASE ONLY —
// they are the difference between `CHROME_ARGS` and this launch, and the whole suite otherwise runs
// on the same browser configuration as before.
if (want('oopif-population')) {
  openCase('oopif-population', 'C1', 'the request budget refuses a page with an out-of-process child frame, and accepts the app', 'codex review 7 H1');
  const childHits = [];
  const childSrv = createServer((req, res) => {
    childHits.push(req.url);
    if (req.url.startsWith('/kid-')) { res.writeHead(200, {'content-type': 'text/javascript'}); return res.end('/* child subresource */\n'); }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>child</title>'
      + '<script src="/kid-1.js"></script><script src="/kid-2.js"></script>child');
  });
  await new Promise((r) => childSrv.listen(0, '127.0.0.1', r));
  const childPort = childSrv.address().port;
  const parentSrv = createServer((req, res) => {
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>oopif fixture</title>'
      + `<iframe src="http://child.test:${childPort}/" width="200" height="120"></iframe>`);
  });
  await new Promise((r) => parentSrv.listen(0, '127.0.0.1', r));
  const parentPort = parentSrv.address().port;

  const oopifBrowser = await chromium.launch({
    executablePath: CHROME_EXE,
    args: [...CHROME_ARGS, '--site-per-process', `--host-resolver-rules=MAP *.test 127.0.0.1`],
  });
  try {
    // ── the fixture: the gate must REFUSE ──────────────────────────────────────────────────────
    const cx = await oopifBrowser.newContext({viewport: {width: 800, height: 600}});
    try {
      const page = await cx.newPage();
      const ledger = await attachRequestLedger(cx, page);
      await page.goto(`http://parent.test:${parentPort}/`, {waitUntil: 'load', timeout: 30000});
      // Poll for the child's own traffic rather than sleeping: the child target attaches, and its
      // two subresources are requested, after the parent's load event.
      for (let i = 0; i < 60 && childHits.length < 3; i++) await page.waitForTimeout(100);
      await page.waitForTimeout(500);

      const iframeTargets = ledger.targets.filter((t) => t.type === 'iframe');
      prereq('the cross-site child really became a SEPARATE target (an OOPIF materialised)',
        iframeTargets.length > 0,
        `${ledger.targets.length} attached targets: ${ledger.targets.map((t) => t.type).join(', ') || 'none'}`,
        '>= 1 iframe target');
      prereq('the child frame actually issued its own requests',
        childHits.length >= 3, `${childHits.length} hits on the child origin (${childHits.join(', ')})`, '>= 3');

      // THE DEFECT ITSELF, IN A REAL BROWSER. codex could only execute this at transport level
      // ("not a browser reproduction"); here the child's requests are on the wire and simply are
      // not in the ledger. This is WHY the gate exists — if it ever becomes false, the population
      // can be widened, and this row is where that news arrives.
      //
      // BE EXACT ABOUT WHICH ROWS GO MISSING — the first version of this row asserted that ALL
      // THREE child requests were absent and measured 1, because the iframe's DOCUMENT request is
      // initiated by the PARENT and therefore does appear on the page session. It is the child's
      // own SUBRESOURCES, issued from inside the child target after it exists, that vanish. Two
      // requests on the wire, zero rows — and a `<= N` budget that cannot see them.
      const childDoc = ledger.cdp.filter((r) => r.url === `http://child.test:${childPort}/`);
      const childSub = ledger.cdp.filter((r) => /\/kid-\d\.js$/.test(r.url));
      const childSubHits = childHits.filter((u) => u.startsWith('/kid-')).length;
      assert('the child target’s SUBRESOURCES are invisible to the page-session ledger (its parent-initiated document is not)',
        childSub.length === 0 && childDoc.length === 1 && childSubHits === 2,
        `${childDoc.length} child document row(s), ${childSub.length} of the child’s ${childSubHits} subresource requests in the ledger`,
        '1 document row, 0 of 2 subresource rows');

      // THE GATE. This is the assertion that fails against the round-6 ledger, which had no
      // population check at all and would have reported a budget over a page it half-measured.
      const pop = await populationCheck(page, ledger);
      assert('the population gate REFUSES this page', pop.ok === false,
        pop.measured.slice(0, 200), 'refused');
      assert('the refusal NAMES the out-of-ledger target (type and url), not just "failed"',
        /iframe/.test(pop.measured) && pop.measured.includes('child.test'),
        pop.measured.slice(0, 200), 'names the iframe target');
      assert('the refusal also reports the second frame', pop.frames === 2, `${pop.frames} frames`, '2');
    } catch (e) { prereq('the OOPIF fixture ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { await cx.close(); }
  } finally {
    await oopifBrowser.close();
    await new Promise((r) => parentSrv.close(r));
    await new Promise((r) => childSrv.close(r));
  }

  // ── the app's own page: the gate must ACCEPT ─────────────────────────────────────────────────
  // A gate that refuses everything is not a gate. This is the control arm, on the ordinary browser
  // and the real app, and it is the same call the acceptance suite makes before every budget row.
  {
    const {context, page, errors} = await fresh();
    try {
      const ledger = await attachRequestLedger(context, page);
      await page.goto(`${base}/v2/`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitAll(page);
      await page.waitForTimeout(SETTLE);
      const pop = await populationCheck(page, ledger);
      assert('the population gate ACCEPTS the app’s own page', pop.ok, pop.measured.slice(0, 200), 'inside the population');
      assert('the app has exactly one frame and attached no child target',
        pop.frames === 1 && pop.targets.length === 0,
        `${pop.frames} frames, ${pop.targets.length} attached targets`, '1 frame, 0 targets');
      prereq('no page error (control arm)', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
    } catch (e) { prereq('the control arm ran', false, String(e).slice(0, 200), 'no throw'); }
    finally { await context.close(); }
  }
}

// ══ CASE 13 — A SHARED WORKER IS A BROWSER-LEVEL TARGET, AND THE PAGE SESSION CANNOT SEE IT ═══
// codex review 8, H1.1. Page-session `Target.setAutoAttach` observes only targets DIRECTLY RELATED
// to the page. A shared worker is not one of them: it is owned by the browser context, it can be
// shared by several pages, and it never attaches to this page's session. Its fetches are real and
// they are on nobody's ledger.
//
// MEASURED BEFORE IT WAS WRITTEN (2026-09-10): the fixture below produced ZERO page-session
// attachments while its worker script fetched two files that the fixture server logged. That is
// the counterexample codex could only execute through the transport, reproduced in a browser.
//
// The independent instrument is the fixture server's own request log — the assertions do not take
// the browser's word for what the worker fetched.
if (want('shared-worker-population')) {
  openCase('shared-worker-population', 'C1', 'a shared worker (a browser-level target) is discovered and refused', 'codex review 8 H1.1');
  const swHits = [];
  const srv = createServer((req, res) => {
    swHits.push(req.url);
    if (req.url === '/shared-worker.js') {
      res.writeHead(200, {'content-type': 'text/javascript'});
      // Two fetches from INSIDE the worker: this is the traffic the page-session ledger misses.
      return res.end("fetch('/sw-a.txt');fetch('/sw-b.txt');self.onconnect=()=>{};\n");
    }
    if (req.url.startsWith('/sw-')) { res.writeHead(200, {'content-type': 'text/plain'}); return res.end('x'); }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>shared worker fixture</title>'
      + '<script>new SharedWorker("/shared-worker.js");</script>parent');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const cx = await browser.newContext({viewport: {width: 800, height: 600}});
  try {
    const page = await cx.newPage();
    const ledger = await attachRequestLedger(cx, page);
    await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load', timeout: 30000});
    for (let i = 0; i < 80 && !(swHits.includes('/sw-a.txt') && swHits.includes('/sw-b.txt')); i++) await page.waitForTimeout(100);
    await page.waitForTimeout(500);

    const history = targetHistory(ledger);
    const shared = history.filter((t) => t.type === 'shared_worker');
    const workerFetches = swHits.filter((u) => u.startsWith('/sw-')).length;

    prereq('the worker really ran and fetched (the fixture server’s own log)',
      workerFetches === 2, `${workerFetches} worker fetches logged by the server (${swHits.join(', ')})`, '2');
    prereq('browser-level discovery reported the shared worker',
      shared.length === 1, `${shared.length} shared_worker target(s) discovered`, '1');

    // THE HOLE, MEASURED. The page-session lane — the whole of round 7's detector — sees nothing,
    // and the worker's requests are not in the ledger either.
    assert('the page-session attach lane is BLIND to the shared worker (why round 7 was insufficient)',
      ledger.targets.length === 0,
      `${ledger.targets.length} page-session attachments for a worker the browser lane saw`, '0');
    const workerRows = ledger.cdp.filter((r) => /\/sw-[ab]\.txt$/.test(r.url));
    assert('the worker’s two requests are absent from the page-session ledger',
      workerRows.length === 0, `${workerRows.length} of ${workerFetches} worker requests in the ledger`, '0');

    const pop = await populationCheck(page, ledger);
    assert('the population gate REFUSES the page', pop.ok === false, pop.measured.slice(0, 220), 'refused');
    assert('the refusal NAMES shared_worker and its url',
      /shared_worker/.test(pop.measured) && pop.measured.includes('shared-worker.js'),
      pop.measured.slice(0, 220), 'names shared_worker + url');
    // LIFECYCLE HISTORY SURVIVES DESTRUCTION: the worker is gone once the page closes, but the
    // refusal must not be. Read the history again after navigating away from the fixture.
    await page.goto('about:blank', {waitUntil: 'load', timeout: 30000});
    await page.waitForTimeout(1500);
    const popAfter = await populationCheck(page, ledger);
    assert('the refusal SURVIVES the worker’s destruction (lifecycle history, not a live snapshot)',
      popAfter.ok === false && /shared_worker/.test(popAfter.measured),
      popAfter.measured.slice(0, 200), 'still refused');
    // codex r9 LOW 1. The assertion above proves the refusal CONTINUES; it does not prove the thing
    // it is named after — that the worker was destroyed. A worker that simply outlived the
    // navigation would satisfy it identically, and then this case would be testing nothing but the
    // passage of 1.5 seconds. The lifecycle entry is where destruction is actually recorded
    // (request-ledger.mjs:206), so read it.
    const swHistory = targetHistory(ledger).filter((t) => t.type === 'shared_worker');
    assert('and the worker’s lifecycle entry records destroyed === true (the premise, not just the consequence)',
      swHistory.length === 1 && swHistory[0].destroyed === true,
      `${swHistory.length} shared_worker entr(ies): ${swHistory.map((t) => `destroyed=${t.destroyed}`).join(', ') || 'none'}`,
      '1 entry, destroyed=true');
  } catch (e) { prereq('the shared-worker fixture ran', false, String(e).slice(0, 200), 'no throw'); }
  finally { await cx.close(); await new Promise((r) => srv.close(r)); }
}

// ══ CASE 14 — PRERENDER: WHAT THIS BUILD ACTUALLY DOES, NOT WHAT THE CONTRACT ASSUMES ═════════
// codex review 8, H1.2 named `page`+subtype `prerender` as the type the round-7 allowlist let
// through. The gate is now default-deny, so such a target WOULD be refused — but a gate nobody can
// fire is not tested, so this case establishes empirically what a speculation rule does here.
//
// MEASURED (2026-09-10, this Chromium, under CDP): the browser's OWN `Preload` domain reports
//   Preload.prerenderStatusUpdated -> status "Failure", prerenderStatus "PrerenderingDisabledByDevTools"
// so no prerender TARGET is ever created while a debugger is attached — confirmed against
// `Target.getTargets({filter:[{}]})`, which lists only the page and its tab. The speculation rule
// degrades to a PREFETCH issued by the page's own loader, which lands in this ledger like any other
// row. So `/next.html` IS fetched (the fixture server logs it) and the prerendered document never
// runs, so `/next-res.js` is never fetched.
//
// THE REFUSAL BRANCH IS THEREFORE SKIPPED WITH A REASON, NOT PASSED VACUOUSLY. The case asserts the
// reason (from the browser, not from me), asserts that the traffic which DID occur is inside the
// ledger, and keeps the refusal assertion armed behind a condition so that the day this build
// prerenders under CDP, the branch fires instead of silently never running.
if (want('prerender-population')) {
  openCase('prerender-population', 'C1', 'speculation-rules prerender: refused if it materialises, SKIPPED WITH REASON if the build cannot', 'codex review 8 H1.2');
  const preHits = [];
  const srv = createServer((req, res) => {
    preHits.push(req.url);
    if (req.url === '/next.html') {
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      return res.end('<!doctype html><meta charset="utf-8"><title>next</title><script src="/next-res.js"></script>next');
    }
    if (req.url === '/next-res.js') { res.writeHead(200, {'content-type': 'text/javascript'}); return res.end('//x\n'); }
    res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
    res.end('<!doctype html><meta charset="utf-8"><title>prerender fixture</title>'
      + '<script type="speculationrules">{"prerender":[{"source":"list","urls":["/next.html"]}]}</script>parent');
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const port = srv.address().port;
  const cx = await browser.newContext({viewport: {width: 800, height: 600}});
  try {
    const page = await cx.newPage();
    const ledger = await attachRequestLedger(cx, page);
    // The browser's own account of what it did with the speculation rule — an instrument
    // independent of both the ledger and the server log.
    const preload = [];
    for (const ev of ['Preload.ruleSetUpdated', 'Preload.prerenderStatusUpdated', 'Preload.prefetchStatusUpdated']) {
      ledger.session.on(ev, (e) => preload.push({ev, status: e.status ?? '', why: e.prerenderStatus ?? e.prefetchStatus ?? ''}));
    }
    let preloadEnabled = true;
    await ledger.session.send('Preload.enable').catch(() => { preloadEnabled = false; });
    await page.goto(`http://127.0.0.1:${port}/`, {waitUntil: 'load', timeout: 30000});
    for (let i = 0; i < 80 && !preHits.includes('/next.html'); i++) await page.waitForTimeout(100);
    await page.waitForTimeout(2000);

    const history = targetHistory(ledger);
    const prerenderTargets = history.filter((t) => t.subtype === 'prerender' || (t.type === 'page' && t.targetId !== ledger.self?.targetId));
    const disabled = preload.filter((p) => p.why === 'PrerenderingDisabledByDevTools');
    const pop = await populationCheck(page, ledger);

    prereq('the Preload domain answered (the browser’s own account is available)',
      preloadEnabled && preload.length > 0, `Preload.enable=${preloadEnabled}, ${preload.length} events`, 'enabled, > 0 events');
    prereq('the speculation rule was parsed and acted on (the fixture server saw /next.html)',
      preHits.includes('/next.html'), `server log: ${preHits.join(', ')}`, '/next.html fetched');

    if (prerenderTargets.length > 0) {
      // THE ARMED BRANCH. If this build ever prerenders under CDP, default-deny must refuse it and
      // name it — the exact hole review 8 identified in the round-7 allowlist.
      // codex r9 LOW 2. `/prerender/.test(pop.measured)` matched the CASE NAME inside the
      // population boilerplate, so a refusal caused by an entirely unrelated stray target satisfied
      // it. Read the structured `violations` instead and require that the refused target is the
      // prerender one — the same objects `prerenderTargets` was computed from.
      const refusedPrerender = (pop.violations ?? []).filter((t) =>
        t.subtype === 'prerender' || (t.type === 'page' && t.targetId !== ledger.self?.targetId));
      assert('a prerender target materialised, and the population gate REFUSES that target by identity',
        pop.ok === false && refusedPrerender.length > 0
          && prerenderTargets.every((p) => refusedPrerender.some((v) => v.targetId === p.targetId)),
        `${prerenderTargets.length} prerender target(s) discovered, ${refusedPrerender.length} of them in pop.violations: `
          + refusedPrerender.map((t) => `${t.type}${t.subtype ? `/${t.subtype}` : ''} ${t.targetId}`).join(', '),
        'every discovered prerender target is a named violation');
    } else {
      // THE SKIP, WITH ITS REASON QUOTED FROM THE BROWSER. Not a pass about prerendering — a
      // recorded finding that prerendering cannot occur while this suite is watching.
      assert('SKIPPED WITH REASON: no prerender target can exist here — the browser reports PrerenderingDisabledByDevTools',
        disabled.length > 0,
        `0 prerender targets; Preload says: ${preload.map((p) => `${p.ev.replace('Preload.', '')}=${p.status}${p.why ? `/${p.why}` : ''}`).join(' | ').slice(0, 200)}`,
        'the browser states the reason');
      // And the traffic that DID occur is accounted for, which is the part that matters for a
      // request budget: the degraded PREFETCH is issued by the page's own loader and is in the
      // ledger, and the prerendered document never ran, so it fetched no subresource of its own.
      const prefetchRows = ledger.cdp.filter((r) => r.url.endsWith('/next.html'));
      assert('the traffic the rule DID cause (a prefetch) is inside the ledger — nothing unaccounted',
        prefetchRows.length >= 1, `${prefetchRows.length} /next.html row(s) in the ledger, server logged ${preHits.filter((u) => u === '/next.html').length}`, '>= 1');
      assert('the prerendered document never ran, so it issued no subresource (server log)',
        !preHits.includes('/next-res.js'), `server log: ${preHits.join(', ')}`, 'no /next-res.js');
      assert('the population gate still ACCEPTS this page (no target existed to refuse)',
        pop.ok, pop.measured.slice(0, 200), 'inside the population');
    }
  } catch (e) { prereq('the prerender fixture ran', false, String(e).slice(0, 200), 'no throw'); }
  finally { await cx.close(); await new Promise((r) => srv.close(r)); }
}

await browser.close();

// ══ VERDICTS ═══════════════════════════════════════════════════════════════════════════════════
const rows = cases.map((c) => {
  const prereqs = c.checks.filter((k) => k.prereq);
  const claims = c.checks.filter((k) => !k.prereq);
  const ranAtAll = c.checks.length > 0 && prereqs.every((k) => k.pass);
  const claimsHold = claims.length > 0 && claims.every((k) => k.pass);
  const due = STAGE_RANK[c.owner] <= rank;
  //  !ranAtAll               -> BROKEN        the case did not exercise its defect; not evidence
  //  due & claimsHold        -> GREEN
  //  due & !claimsHold       -> FAIL          the build breaks
  // !due & !claimsHold       -> EXPECTED-RED  the repro reproduces; THIS is the recorded evidence
  // !due &  claimsHold       -> STALE-RED     a finding: the case no longer demonstrates anything
  const verdict = !ranAtAll ? 'BROKEN'
    : due ? (claimsHold ? 'GREEN' : 'FAIL')
    : (claimsHold ? 'STALE-RED' : 'EXPECTED-RED');
  return {
    ...c, passed: ranAtAll && claimsHold, due, verdict,
    failedPrereqs: prereqs.filter((k) => !k.pass).map((k) => `${k.name} :: ${k.measured}`),
    failed: claims.filter((k) => !k.pass).map((k) => `${k.name} :: ${k.measured}`),
  };
});

console.log(`\n${'═'.repeat(94)}\nL31 v2.1a REGRESSION CASES — stage ${stage.toUpperCase()}`
  + `${ONLY.length ? `  (FILTERED to ${ONLY.join(', ')} — this is NOT the full contract)` : ''}\n`);
for (const r of rows) {
  console.log(`${r.verdict.padEnd(13)} ${r.id.padEnd(24)} owner=${r.owner}  ${r.ref}`);
  console.log(`              ${r.title}`);
  for (const f of r.failedPrereqs) console.log(`              ! PREREQ ${f}`);
  if (r.failed.length) for (const f of r.failed) console.log(`              - ${f}`);
}

const broken = rows.filter((r) => r.verdict === 'FAIL');
const didNotRun = rows.filter((r) => r.verdict === 'BROKEN');
const stale = rows.filter((r) => r.verdict === 'STALE-RED');
const expectedRed = rows.filter((r) => r.verdict === 'EXPECTED-RED');
const green = rows.filter((r) => r.verdict === 'GREEN');

writeFileSync(join(outDir, `regress-${label}.json`), JSON.stringify({
  at: new Date().toISOString(), base, stage, label,
  scenes: {a: BLOB, b: BLOB_B},
  totals: {green: green.length, fail: broken.length, broken: didNotRun.length, expectedRed: expectedRed.length, stale: stale.length, cases: rows.length},
  cases: rows,
}, null, 1));

console.log(`\n${green.length} GREEN · ${broken.length} FAIL · ${expectedRed.length} EXPECTED-RED · ${stale.length} STALE-RED  of ${rows.length} cases`);
if (expectedRed.length) console.log(`  expected-red (owned by a later commit): ${expectedRed.map((r) => r.id).join(', ')}`);
if (stale.length) console.log(`  ⚠️ STALE-RED — these cases no longer reproduce their defect and prove nothing: ${stale.map((r) => r.id).join(', ')}`);
console.log(`  -> ${join(outDir, `regress-${label}.json`)}`);
// A stale red is a finding, not a pass: the case has to be strengthened or its owner corrected.
process.exit(broken.length === 0 && stale.length === 0 && didNotRun.length === 0 ? 0 : 1);
