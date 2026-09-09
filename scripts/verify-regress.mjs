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
import {join} from 'node:path';
import {decodeScene, encodeScene, normalizeScene} from '../app/scene-codec.js';

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
/** One assertion inside a case. The case's verdict is the AND of its assertions. */
const assert = (name, pass, measured, want) => {
  current.checks.push({name, pass: !!pass, measured: String(measured), want: want ?? ''});
  console.log(`    ${pass ? 'ok  ' : 'NOT ok'} ${name} :: ${measured}${want ? ` want=${want}` : ''}`);
};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

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
{
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
    const drawnOutside = t1.parts.filter((p) => p.concept !== 'FMA22359' && p.id !== 'FMA22359').length;
    assert('isolate=1 & system=none ⇒ nothing else is drawn', drawnOutside === 0,
      `${drawnOutside} parts drawn outside the selection (of ${t1.parts.length})`, '0');
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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 2 — STAGE / PROBE RETENTION, and the stage chrome fence ═══════════════════════════════
// codex-app-review.md §2 row 7 (R:31) + §8 line 10 (R:110). `writeUrlState` builds the query from
// a fixed key list (app/url-state.ts:135-149) that has no `stage` and no `probe`, so 200 ms after
// entry the flags are gone; the page keeps its React state, so nothing looks wrong until a reload
// brings the chrome back. `?stage=1` is the L32 display client's whole contract.
{
  openCase('stage-probe', 'C1', '?stage=1 and ?probe=1 survive entry, debounce, reload and exit', 'R:31, R:110');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?stage=1&probe=1&scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await page.waitForTimeout(1400);   // past the 200 ms debounce with room to spare

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
      head: !!document.querySelector('.v2-head') && getComputedStyle(document.querySelector('.v2-head')).display !== 'none',
    }));
    assert('stage still applies after a reload', afterReload.stage && !afterReload.head,
      `stage=${afterReload.stage} headShown=${afterReload.head} search=${afterReload.search.slice(0, 80)}`, 'staged, no chrome');

    // EXIT restores the chrome and must clear the flag from the URL, or the next reload re-stages
    // the page a human just left.
    const exit = await page.$('.v2-stage-exit');
    assert('the stage exit control exists', !!exit, exit ? 'present' : 'absent', 'present');
    if (exit) {
      await clickAt(page, exit);
      await page.waitForTimeout(1200);
      const afterExit = await page.evaluate(() => ({
        search: location.search, stage: document.body.classList.contains('v2-stage'),
        head: !!document.querySelector('.v2-head') && getComputedStyle(document.querySelector('.v2-head')).display !== 'none',
      }));
      assert('exit restores the chrome and drops stage from the URL',
        !afterExit.stage && afterExit.head && !/stage=1/.test(afterExit.search),
        `stage=${afterExit.stage} headShown=${afterExit.head} search=${afterExit.search.slice(0, 100)}`, 'unstaged, no stage=1');
      assert('exit keeps probe=1 (it is a separate flag)', /probe=1/.test(afterExit.search), afterExit.search.slice(0, 100), 'probe=1 retained');
    }
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 3 — EXPLICIT SCENE CLEARING ═══════════════════════════════════════════════════════════
// codex-app-review.md §2 row 6 (R:30) + §1 (R:7). `#scene=&select=…` is how the snapshot renderer
// gets a warm tab OUT of a scene, and `readUrlState` already models it — `clearScene:true`
// (app/url-state.ts:84). v2's hashchange handler throws that away: `if (!u.scene) return`
// (app/v2/page.tsx:345), so the previous scene keeps drawing while the URL says otherwise, and the
// legacy keys in the new hash are ignored.
{
  openCase('scene-clear', 'C1', '#scene= (empty) clears the previous scene and applies the legacy keys', 'R:7, R:30');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await waitAll(page);
    await page.waitForTimeout(SETTLE);
    const before = await atlasState(page);
    assert('the scene is on screen to begin with', !!before?.blob, `blob=${(before?.blob || '').slice(0, 12)}…`, 'a blob');

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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 4 — RE-DRIVE READINESS IS GENERATION-AWARE ════════════════════════════════════════════
// codex-app-review.md §2 row 5 (R:29), the subtlest of the six and the one with two opposite
// failure modes in one line of code:
//
//   markSceneReady(phase === 'atlas')            app/v2/page.tsx:352
//
// (a) BETWEEN THE BARRIER AND FULL LOAD, `phase` is 'scene', so the re-drive clears readiness and
//     publishes false — and nothing ever restores it, because `onProgress(100)` calls `markReady`
//     and never `markSceneReady`. The marker the renderer waits on is gone for the life of the tab.
// (b) BEFORE THE FIRST BARRIER, the pending barrier belongs to the PREVIOUS scene's priority set.
//     It fires, publishes readiness, and the page is showing a different scene whose meshes may
//     not have arrived — readiness true for the wrong generation.
//
// Both are asserted. (b) needs two scenes with DISJOINT chunk sets or the mistake is invisible
// (the second scene's meshes happen to be loaded already), so the disjointness is checked at
// runtime rather than assumed from the fixture.
{
  openCase('readiness-generations', 'C1', 're-drive readiness publishes only for the CURRENT scene, in all three timings', 'R:29');
  const {context, page, errors} = await fresh();
  try {
    // The fixtures' chunk sets, from the atlas the app itself loads.
    await page.goto(`${base}/v2/`, {waitUntil: 'domcontentloaded', timeout: 180000});
    const chunks = await page.evaluate(async (ids) => {
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
      return {a: of(ids.a), b: of(ids.b)};
    }, {a: SCENE.structures.map((s) => s.id), b: SCENE_B.structures.map((s) => s.id)});
    const overlap = chunks.a.filter((c) => chunks.b.includes(c));
    assert('the two fixtures need DIFFERENT chunks (or case (b) cannot fail)',
      chunks.b.some((c) => !chunks.a.includes(c)),
      `A=[${chunks.a}] B=[${chunks.b}] overlap=[${overlap}]`, 'B needs at least one chunk A does not');

    // ── (a) re-drive BETWEEN the barrier and full load ────────────────────────────────────────
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    const fullyLoaded = await page.evaluate(() => document.documentElement.dataset.atlasReady === '1');
    await page.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B);
    let restored = true;
    try { await waitScene(page, 90000); } catch { restored = false; }
    assert(`readiness returns after a re-drive between the barrier and full load${fullyLoaded ? ' (NOTE: the atlas had already finished on this host — see measured)' : ''}`,
      restored, restored ? 'the marker came back' : 'the marker NEVER came back within 90 s', 'the marker returns');
    await page.waitForTimeout(SETTLE);
    const sB = await atlasState(page);
    assert('and it is published for the CURRENT scene', sB?.blob === BLOB_B,
      `state.blob=${(sB?.blob || '').slice(0, 12)}… want=${BLOB_B.slice(0, 12)}…`, 'scene B');
    const tB = await targets(page, ['FMA7088']);
    assert('the current scene is actually drawn when readiness is published',
      !!tB.groups?.FMA7088 && tB.groups.FMA7088.n > 0, `${tB.groups?.FMA7088?.n ?? 0} meshes of the new primary projected`, '> 0');

    // ── (b) re-drive BEFORE the first barrier ─────────────────────────────────────────────────
    // `waitUntil:'commit'` returns as soon as the navigation is committed, so the hash is set
    // while the first priority set is still downloading. The invariant asserted is the one that
    // matters: WHEN readiness first appears, the scene it describes is the current one.
    const {context: c2, page: p2, errors: e2} = await fresh();
    try {
      await p2.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'commit', timeout: 180000});
      await p2.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B).catch(() => {});
      let early = true;
      try { await waitScene(p2, 120000); } catch { early = false; }
      const atMarker = await p2.evaluate(() => ({
        blob: window.atlas?.state?.().blob ?? null,
        marker: document.documentElement.dataset.atlasSceneReady ?? null,
        sceneAttr: document.documentElement.dataset.atlasScene ?? null,
      }));
      assert('readiness appears at all after a pre-barrier re-drive', early, early ? 'appeared' : 'never appeared in 120 s', 'appears');
      assert('readiness never describes the SUPERSEDED scene',
        atMarker.blob === BLOB_B && atMarker.sceneAttr === BLOB_B.slice(0, 16),
        `state.blob=${(atMarker.blob || '').slice(0, 12)}… data-atlas-scene=${atMarker.sceneAttr}`, `scene B (${BLOB_B.slice(0, 12)}…)`);
      await p2.waitForTimeout(SETTLE);
      const t2b = await targets(p2, ['FMA7088']);
      assert('the superseding scene is drawn by the time readiness is published',
        !!t2b.groups?.FMA7088 && t2b.groups.FMA7088.n > 0, `${t2b.groups?.FMA7088?.n ?? 0} meshes projected`, '> 0');
      assert('no page error (pre-barrier re-drive)', e2.length === 0, e2.slice(0, 2).join(' | ') || 'none', 'none');
    } finally { await c2.close(); }

    // ── (c) re-drive AFTER full load ─────────────────────────────────────────────────────────
    const {context: c3, page: p3} = await fresh();
    try {
      await p3.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
      await waitAll(p3);
      await p3.evaluate((b) => { location.hash = `scene=${b}`; }, BLOB_B);
      let post = true;
      try { await waitScene(p3, 60000); } catch { post = false; }
      const s3 = await atlasState(p3);
      assert('readiness is republished after a post-load re-drive', post && s3?.blob === BLOB_B,
        `${post ? 'marker present' : 'marker MISSING'}, blob=${(s3?.blob || '').slice(0, 12)}…`, 'present, scene B');
    } finally { await c3.close(); }
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
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
{
  openCase('warm-legacy-redrive', 'C1', 'a warm legacy re-drive resets language and system in both directions', 'R:34');
  const {context, page, errors} = await fresh();
  try {
    const {reDriveHash} = await import('../workers/snap/src/helpers.mjs');
    // Direction 1: zh-Hans + skeletal, then a plain request with neither.
    await page.goto(`${base}/?select=FMA22359&lang=zh-Hans&system=skeletal&snap=1`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitAll(page);
    await page.waitForTimeout(1500);
    const warm = await page.evaluate(() => ({lang: document.documentElement.lang, systems: document.documentElement.dataset.atlasSelected}));
    assert('the warm tab really is in zh-Hans first', warm.lang === 'zh-Hans', `lang=${warm.lang}`, 'zh-Hans');

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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 6 — "1 pieces" ════════════════════════════════════════════════════════════════════════
// v21-design.md:912, critic gap 7. It is on the screenshot Adrian sent. `'{n} pieces'`
// (app/v2/copy.ts:35) with one mesh selected prints "1 pieces", and the design's own wireframe
// draws "1 piece" — so the spec and the picture disagreed and the code matched neither.
// FMA7487 "body of sternum" has exactly one element, which is what makes n===1 reachable at all.
{
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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

// ══ CASE 7 — AN EDITED SCENE IS WHAT RELOAD AND plate() SEE ════════════════════════════════════
// codex-app-review.md §2 row 3 (R:27). OWNED BY C2: the repair is the canonical controller, and a
// C1 patch would build a throwaway one that C2 replaces (codex-plan-review.md §A.2). Today
// `writeUrlState` writes `lastBlob` VERBATIM (app/url-state.ts:149) — deliberately, so a copied
// plate URL reproduces the same picture — but nothing updates `lastBlob` when the human edits the
// scene, so the URL, `plate()` and a reload all describe the scene as it ARRIVED.
{
  openCase('edited-scene-persists', 'C2', 'removing a structure changes the blob, the URL, plate() and a reload', 'R:27');
  const {context, page, errors} = await fresh();
  try {
    await page.goto(`${base}/v2/?scene=${BLOB}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await waitScene(page);
    await waitAll(page);
    await page.waitForTimeout(SETTLE);
    await openMargin(page);

    const before = await atlasState(page);
    assert('the scene starts with all five structures', (before?.ids ?? []).length === 5,
      `${(before?.ids ?? []).length} ids`, '5');

    // Remove the femur (a CONTEXT member, so the primary and the focus are untouched and the
    // assertion is about membership rather than about focus fallback).
    const removed = 'FMA9611';
    const xs = await page.$$('.v2-row-x');
    let clicked = false;
    for (const x of xs) {
      const owns = await x.evaluate((el, id) => {
        const row = el.closest('.v2-row');
        const label = el.getAttribute('aria-label') || '';
        return !!row && (label.includes('femur') || label.includes('股骨') || row.textContent.includes(id));
      }, removed);
      if (owns) { clicked = await clickAt(page, x); break; }
    }
    if (!clicked && xs.length) clicked = await clickAt(page, xs[xs.length - 1]);
    assert('a remove control was found and pressed', clicked, `${xs.length} remove controls in the set list`, 'one pressed');
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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
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
{
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
    assert('the scene declares a focus to begin with', (s0?.framing?.focus ?? 0) > 0,
      `framing.focus=${s0?.framing?.focus}`, '> 0');

    // FMA16203 is the GHOST and the alphabetically-first member — the structure L31's hotfix
    // stopped the page opening on. Focusing it deliberately is a different operation from
    // defaulting to it, and it is far from the hamstrings, so a real retarget is unmistakable.
    const notches = await page.$$('.v2-rail .v2-notch');
    let moved = false;
    for (const n of notches) {
      const isGhost = await n.evaluate((el) => el.className.includes('role-ghost'));
      if (isGhost) { moved = await clickAt(page, n); break; }
    }
    assert('the ghost notch was found and pressed', moved, `${notches.length} notches in the rail`, 'one pressed');
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
    assert('no page error', errors.length === 0, errors.slice(0, 2).join(' | ') || 'none', 'none');
  } catch (e) { current.error = String(e).slice(0, 240); assert('case ran', false, current.error, 'no throw'); }
  finally { await context.close(); }
}

await browser.close();

// ══ VERDICTS ═══════════════════════════════════════════════════════════════════════════════════
const rows = cases.map((c) => {
  const passed = c.checks.length > 0 && c.checks.every((k) => k.pass);
  const due = STAGE_RANK[c.owner] <= rank;
  // due & passed            -> GREEN
  // due & !passed           -> FAIL           (the build breaks)
  // !due & !passed          -> EXPECTED-RED   (the repro reproduces; this is the evidence)
  // !due & passed           -> STALE-RED      (a finding: the case no longer demonstrates anything)
  const verdict = due ? (passed ? 'GREEN' : 'FAIL') : (passed ? 'STALE-RED' : 'EXPECTED-RED');
  return {...c, passed, due, verdict, failed: c.checks.filter((k) => !k.pass).map((k) => `${k.name} :: ${k.measured}`)};
});

console.log(`\n${'═'.repeat(94)}\nL31 v2.1a REGRESSION CASES — stage ${stage.toUpperCase()}\n`);
for (const r of rows) {
  console.log(`${r.verdict.padEnd(13)} ${r.id.padEnd(24)} owner=${r.owner}  ${r.ref}`);
  console.log(`              ${r.title}`);
  if (r.failed.length) for (const f of r.failed) console.log(`              - ${f}`);
}

const broken = rows.filter((r) => r.verdict === 'FAIL');
const stale = rows.filter((r) => r.verdict === 'STALE-RED');
const expectedRed = rows.filter((r) => r.verdict === 'EXPECTED-RED');
const green = rows.filter((r) => r.verdict === 'GREEN');

writeFileSync(join(outDir, `regress-${label}.json`), JSON.stringify({
  at: new Date().toISOString(), base, stage, label,
  scenes: {a: BLOB, b: BLOB_B},
  totals: {green: green.length, fail: broken.length, expectedRed: expectedRed.length, stale: stale.length, cases: rows.length},
  cases: rows,
}, null, 1));

console.log(`\n${green.length} GREEN · ${broken.length} FAIL · ${expectedRed.length} EXPECTED-RED · ${stale.length} STALE-RED  of ${rows.length} cases`);
if (expectedRed.length) console.log(`  expected-red (owned by a later commit): ${expectedRed.map((r) => r.id).join(', ')}`);
if (stale.length) console.log(`  ⚠️ STALE-RED — these cases no longer reproduce their defect and prove nothing: ${stale.map((r) => r.id).join(', ')}`);
console.log(`  -> ${join(outDir, `regress-${label}.json`)}`);
// A stale red is a finding, not a pass: the case has to be strengthened or its owner corrected.
process.exit(broken.length === 0 && stale.length === 0 ? 0 : 1);
