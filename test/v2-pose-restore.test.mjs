/**
 * ══ THE PENDING POSE RESTORE — S5a-2, and this file is the proof codex's rounds 13/14/15 asked for ═
 *
 * THE DEFECT, three times over: a scene tab's pending camera restore could outlive a newer human
 * intent and overwrite it. Three patches ENUMERATED the callers that must cancel it, and each time
 * codex executed the next caller nobody had listed — tab-to-tab, then `home`/`fit` (answered inside
 * `useShell`, so a hook on declined commands never saw them), then `applySceneState`, then
 * `clearSceneState` via the legacy hash branch, then HELD CAMERA KEYS (`installDispatcher` routes
 * those through `onHold`, never `cmdRef`). Round 15 also measured the mirror defect: opening the
 * keyboard help cancelled a restore, which is not a camera request.
 *
 * So the mechanism changed (see the pending-pose block in app/v2/page.tsx), and this file asserts the
 * new one over EVERY entry point codex named plus both of its Lows:
 *
 *   tab-to-tab · home · fit · applySceneState · clearSceneState via the legacy hash · a held W key ·
 *   a pointer gesture · the keyboard help must NOT abort · completion requires a real setter call
 *
 * ⚠️ IT RUNS THE SHIPPED SOURCE, NOT A MODEL OF IT. Every slice below is cut out of `page.tsx`,
 * `use-shell.ts` and `url-state.ts` and executed in a VM against the REAL reducer and codec. The
 * round-13 lesson that made this non-negotiable: a hand-written stand-in that calls the abort
 * "because I know it should" passes on the tree where codex measured the defect.
 *
 * ⚠️ AND EVERY CLAIM HAS A SENSITIVITY ARM. `mutate` deletes one guard from the source and the test
 * asserts the matching case then FAILS — red-first, executable, in the same run. A green assertion
 * whose guard can be deleted without it noticing is not evidence.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
import vm from 'node:vm';
import {reduce} from '../app/v2/controller.ts';
import {decodeScene, encodeScene, normalizeScene, sceneFocusId, sceneSelectIds} from '../app/scene-codec.js';
import {SYSTEMS} from '../app/anatomy.ts';
import {isLang} from '../app/i18n/ui.ts';
import {POSE_CMDS, NEUTRAL_CMDS} from '../app/v2/shell/keys.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (f) => readFileSync(ROOT + f, 'utf8').replace(/\r\n/g, '\n');
const PAGE = read('app/v2/page.tsx');
const SHELL = read('app/v2/shell/use-shell.ts');
const URLSTATE = read('app/url-state.ts');
const KEYS = read('app/v2/shell/keys.ts');
const SELECTION = read('app/selection.ts');

/** Cut a slice out of source, or throw — a probe that cannot reach its subject must not pass. */
const cut = (s, a, b) => {
  const i = s.indexOf(a);
  assert.ok(i >= 0, `the test cannot reach its subject: ${a}`);
  const j = s.indexOf(b, i);
  assert.ok(j >= 0, `the test cannot reach its subject: ${b} after ${a}`);
  return s.slice(i, j + b.length);
};

/**
 * THE EXTRACTED PROGRAM. Seven slices of the page, the dispatcher body, the `onHold` wiring and the
 * real URL parser — assembled once, then instantiated per case with fresh adapters.
 */
const program = () => [
  // The URL parser, with `export` stripped so it runs in the VM against the fake `location`.
  URLSTATE.slice(URLSTATE.indexOf('export const TITLE_MAX='), URLSTATE.indexOf('/** Chrome-less'))
    .replace(/^export /gm, ''),
  /**
   * THE REAL GENERATION WIRING — codex round 17, Low 1. The harness used to supply its own bump, so
   * deleting the production `setEpoch(sceneGen.current)` left all 23 cases green: the ref advanced
   * and the renderer's prop never did. `bumpEpoch` is extracted now, the harness's `setEpoch` records
   * what the RENDERER would have been given, and `ready()` publishes THAT rather than the ref.
   */
  // `app/selection.ts` cannot be imported here (it resolves './anatomy' extensionless), so the one
  // function the handler needs from it is extracted like everything else rather than re-typed.
  cut(SELECTION, 'export function sameIds(', '}').replace(/^export /, ''),
  cut(PAGE, ' const bumpEpoch = useCallback(', ', []);'),
  cut(PAGE, ' const abortPoseRestore = useCallback(', ', []);'),
  cut(PAGE, ' const poseSig = () => {', '\n };'),
  cut(PAGE, ' const applySceneState = useCallback(', ' }, [dispatch]);'),
  cut(PAGE, ' const clearSceneState = useCallback(', ' }, [known, dispatch]);'),
  cut(PAGE, '  const reapply = () => {', '\n  };'),
  cut(PAGE, ' const applyTab = useCallback(', ' }, [dispatch]);'),
  cut(PAGE, ' poseRestoreRef.current = (drawnGen: number) => {', '\n };'),
  /**
   * THE REAL READINESS CALLBACK — codex round 16, Low 1. Without this the suite supplied its own
   * call to `poseRestoreRef.current()`, so DELETING the production invocation left all 19 cases
   * green (codex executed that mutation). The barrier is now driven the way the renderer drives it,
   * and `mutations` below includes deleting that line.
   */
  cut(PAGE, ' const onSceneReady = useCallback(', ' }, [sampleBytes]);'),
  // The keyboard dispatcher body — the real `POSE_CMDS` filter, not a re-typed `if`.
  cut(SHELL, ' cmdRef.current = (cmd: KeyCommand) => {', '\n };'),
  // The `onHold` wiring, turned from an object property into a callable.
  'const onHold = ' + cut(SHELL, '   onHold: (n: number) =>', '},').replace(/^\s*onHold:\s*/, '').replace(/,$/, '') + ';',
  'globalThis.api = {applyTab, applySceneState, clearSceneState, reapply, onSceneReady, runCmd: cmdRef.current, onHold, abortPoseRestore};',
  'globalThis.bumpEpoch = bumpEpoch;',
].join('\n');

/**
 * One scenario. `hash`/`search` feed the real URL parser; `mutate` optionally removes a guard from
 * the source first (the sensitivity arms).
 */
function scenario({hash = '', search = '', held = 0, mutate = (s) => s} = {}) {
  const log = [];
  let ctl = {scene: null, blob: '', picks: [], focusId: null, visibleIntent: null,
    render: {view: 'three-quarter', reset: 0, visible: ['skeletal'], selected: [], focus: [], isolate: false}};
  let pose = {x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, manual: false};
  const marks = {};
  const nav = {
    pose: () => pose,
    setPose: (p) => {
      if (![p?.x, p?.y, p?.z, p?.tx, p?.ty, p?.tz].every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
      pose = {...p, manual: true};
      log.push(`setPose x=${p.x} scene=${ctl.scene?.caption?.title ?? null}`);
      return true;
    },
    // Home and Fit move the camera WITHOUT the controller — the whole reason `POSE_CMDS` exists.
    home: () => { pose = {x: 99, y: 99, z: 99, tx: 0, ty: 0, tz: 0, manual: true}; log.push('home'); },
    fit: () => { pose = {x: 88, y: 88, z: 88, tx: 0, ty: 0, tz: 0, manual: false}; log.push('fit'); return 'fit'; },
    pan: () => { pose = {...pose, x: pose.x + 1, manual: true}; log.push('pan'); },
    orbit: () => {}, dolly: () => {}, mode: () => 'orbit',
  };
  const listeners = new Map();
  const ctx = {
    useCallback: (f) => f, useRef: (v) => ({current: v}),
    reduce, decodeScene, encodeScene, normalizeScene, sceneSelectIds, sceneFocusId,
    SYSTEMS, isLang, POSE_CMDS, URLSearchParams, console,
    location: {search, hash},
    pendingPose: {current: null},
    poseRestoreRef: {current: null},
    // The page's synchronous generation counter, and the collaborators `onSceneReady` needs. The
    // barrier is now driven through the REAL callback, so the production `poseRestoreRef.current(...)`
    // line is load-bearing for this suite (codex round 16, Low 1).
    sceneGen: {current: 0},
    // What the RENDERER would receive as `sceneEpoch` — written only by the production `bumpEpoch`.
    setEpoch: (n) => { ctx.renderEpoch = n; },
    renderEpoch: 0,
    mark: () => {},
    performance: {now: () => 0},
    modelBytes: () => ({done: 0, requests: 0}),
    markSceneReady: () => {},
    setPhase: () => {},
    sampleBytes: () => {},
    // The dispatcher's OWN held set, as `applyTab` reads it through the shell ref.
    shellRef: {current: {held: new Set(Array.from({length: held}, (_, i) => `Key${i}`))}},
    ctlRef: {get current() { return ctl; }, set current(v) { ctl = v; }},
    navOf: () => nav,
    nav: () => nav,
    document: {documentElement: {dataset: marks}, querySelector: () => null},
    window: {
      addEventListener: (k, f) => listeners.set(k, f),
      removeEventListener: (k) => listeners.delete(k),
      dispatchEvent: (e) => listeners.get(e.type)?.(e),
    },
    dispatch: (cmd) => {
      const out = reduce(ctl, cmd);
      if (out.rejected) { log.push(`refused ${out.rejected.key}`); return false; }
      ctl = out.state;
      // The page bumps its generation synchronously whenever the controller opens a new one — through
      // the PRODUCTION `bumpEpoch`, so both halves of it (the ref and the renderer's prop) are live.
      if (out.epoch) ctx.bumpEpoch();
      log.push(`dispatch ${cmd.type} -> scene=${ctl.scene?.caption?.title ?? null} reset=${ctl.render.reset} gen=${ctx.sceneGen.current}`);
      return true;
    },
    // Collaborators this test does not assert about. Named no-ops rather than second implementations:
    // if one ever becomes load-bearing for the restore, this list is where it shows up as a throw.
    known: () => true, applyLang: () => {}, emitAtlas: (e) => { if (e.type === 'pose-restore') log.push(`emit ${e.state}`); },
    // NOTE: no `setEpoch` here — it is defined above and records what the RENDERER would receive.
    // A second no-op entry silently shadowed it once, which is how the generation stopped moving.
    setRefused: () => {}, setHidden: () => {}, setDetent: () => {},
    markScene: () => {}, markSceneReady: () => {}, markSettled: () => {}, setLegacyCaption: () => {},
    sceneDeclaresLang: () => null, readUrlState: null,
    keysOpen: false, settingsOpen: false, findOpen: false,
    setKeysOpen: () => {}, setSettingsOpen: () => {}, setFindOpen: () => {}, setNavMode: () => {},
    onCommandRef: {current: () => false}, anyRef: {current: null}, cmdRef: {},
    setHoldN: () => {},
  };
  vm.runInNewContext(stripTypeScriptTypes(mutate(program())), ctx);
  // `readUrlState` comes out of the extracted url-state slice; the page's callbacks close over it.
  ctx.readUrlState = ctx.readUrlState ?? null;
  // The page wires the abort to the engine's gesture event and to `useShell`'s camera-intent hook.
  ctx.window.addEventListener('atlas-nav-gesture', () => ctx.api.abortPoseRestore());
  ctx.anyRef.current = () => ctx.api.abortPoseRestore();

  const tab = (title, cam) => ({
    blob: encodeScene(normalizeScene({structures: [{id: 'FMA22359'}], caption: {title}})),
    cam,
  });
  return {
    log, marks, api: () => ctx.api, nav,
    pose: () => pose, ctl: () => ctl, pending: () => ctx.pendingPose.current,
    tab,
    /** The page's own dispatch, for a command with no dedicated entry point in this harness. */
    dispatchRaw: (cmd) => ctx.dispatch(cmd),
    /** Move the address bar between navigations. `readUrlState` reads BOTH halves (url-state.ts:123),
     *  which is the whole subject of codex round 18. */
    setUrl: ({search = '', hash = ''} = {}) => { ctx.location.search = search; ctx.location.hash = hash; },
    gesture: () => ctx.window.dispatchEvent({type: 'atlas-nav-gesture'}),
    /**
     * THE RENDERER'S READINESS BARRIER, driven through the REAL `onSceneReady`. `gen` defaults to
     * the page's current generation, which is what the renderer publishes when nothing has moved
     * since the barrier armed; a case that needs an OLDER barrier passes one explicitly.
     */
    ready: (gen = ctx.renderEpoch) => ctx.api.onSceneReady(0, gen),
    gen: () => ctx.sceneGen.current,
    /** Subscribe to the public event stream, as `tools.ts` delivers it: synchronously. */
    onEvent: (f) => { ctx.emitAtlas = (e) => { if (e.type === 'pose-restore') log.push(`emit ${e.state}`); f(e); }; },
    newCamera: () => { pose = {x: 99, y: 99, z: 99, tx: 0, ty: 0, tz: 0, manual: false}; log.push('new camera x=99'); },
  };
}

/** Arm a restore from tab A, exactly as a click does. */
const armA = (s) => { s.api().applyTab(s.tab('A', [1, 2, 3, 4, 5, 6])); };

// ════ 1. THE CONTROL ARM — without it every "no stale write" below passes on a dead feature ═══════

test('CONTROL: an uninterrupted restore really does apply the pose, once, on the barrier', () => {
  const s = scenario();
  armA(s);
  assert.ok(s.pending(), 'the tab armed a pending restore');
  assert.equal(s.marks.atlasPose, 'pending');
  s.ready();
  assert.deepEqual(
    {x: s.pose().x, z: s.pose().z, tz: s.pose().tz, manual: s.pose().manual},
    {x: 1, z: 3, tz: 6, manual: true},
    `the six saved coordinates, with manual true; log: ${s.log.join(' -> ')}`);
  assert.equal(s.marks.atlasPose, 'applied');
  assert.ok(s.log.includes('emit applied'));
  assert.equal(s.pending(), null, 'the pending state is consumed, so a later barrier cannot re-apply it');
  // ONCE. A second barrier with nothing pending must write nothing.
  const writes = s.log.filter((l) => l.startsWith('setPose')).length;
  s.ready();
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, writes, 'exactly one application');
});

// ════ 2. EVERY ENTRY POINT codex NAMED ════════════════════════════════════════════════════════════

test('M1 tab-to-tab (round 13): a newer tab supersedes A, pose-less or not', () => {
  const s = scenario();
  armA(s);
  // B carries NO pose — the case that made round 13's defect reachable, because `applyTab`'s early
  // `return` for a pose-less tab skipped every cleanup below it.
  s.api().applyTab(s.tab('B', null));
  assert.equal(s.pending(), null, `B cleared A's pending restore; log: ${s.log.join(' -> ')}`);
  s.newCamera();
  s.ready();
  assert.equal(s.pose().x, 99, 'B\'s own camera survives');
  assert.equal(s.pose().manual, false, 'and A\'s write would have forced manual true, suppressing B\'s fit');
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
});

test('M1 tab-to-tab: a REFUSED or UNDECODABLE tab still supersedes a pending restore', () => {
  for (const bad of ['not-a-blob', '']) {
    const s = scenario();
    armA(s);
    s.api().applyTab({blob: bad, cam: [7, 7, 7, 7, 7, 7]});
    assert.equal(s.pending(), null, `an unusable tab (${JSON.stringify(bad)}) still clears the pending restore`);
    s.ready();
    assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  }
});

for (const cmd of ['home', 'fit']) {
  test(`M1 ${cmd} (round 14): the command the hook answers ITSELF aborts the restore`, () => {
    const s = scenario();
    armA(s);
    s.api().runCmd(cmd);
    assert.equal(s.pending(), null, `${cmd} aborted it; log: ${s.log.join(' -> ')}`);
    const at = {...s.pose()};
    s.ready();
    assert.deepEqual(s.pose(), at, `the camera ${cmd} produced is left exactly where ${cmd} put it`);
    assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  });
}

test('M1 applySceneState (round 14): an incoming scene aborts it through the SIGNATURE, not a cancel', () => {
  const s = scenario();
  armA(s);
  const b = s.tab('B', null);
  s.api().applySceneState(decodeScene(b.blob), b.blob);
  // ⚠️ THE PENDING STATE IS STILL SET — and that is the design. Nothing on this path knows the tab
  // lane exists. It is the SIGNATURE that no longer matches, which is what makes the next barrier
  // drop the restore instead of writing it.
  assert.ok(s.pending(), 'no caller-side cancel on this path');
  s.newCamera();
  s.ready();
  assert.equal(s.marks.atlasPose, 'stale', `dropped as stale; log: ${s.log.join(' -> ')}`);
  assert.equal(s.pose().x, 99);
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
});

for (const hash of ['#scene=&select=FMA22359&view=back', '#select=FMA22359&view=back']) {
  test(`M1 clearSceneState via the legacy hash (round 15): ${hash}`, () => {
    const s = scenario({hash});
    armA(s);
    s.api().reapply();
    s.newCamera();
    s.ready();
    assert.equal(s.marks.atlasPose, 'stale',
      `the hash navigation moved the view, so A's pose is dropped; log: ${s.log.join(' -> ')}`);
    assert.equal(s.pose().x, 99, 'the newer camera survives');
    assert.equal(s.pose().manual, false);
    assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  });
}

test('M1 a HELD camera key (round 15): W down aborts the restore through onHold', () => {
  const s = scenario();
  armA(s);
  // `installDispatcher` announces held keys through `onHold` and never through `run`, which is why
  // the command filter cannot see this and why the wiring is asserted here.
  s.api().onHold(1);
  assert.equal(s.pending(), null, 'a held camera key is camera intent');
  s.ready();
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  // AND RELEASING IS NOT an intent: `onHold(0)` must not abort anything (it cannot here — there is
  // nothing left — so the claim is asserted on a fresh restore).
  const t = scenario();
  armA(t);
  t.api().onHold(0);
  assert.ok(t.pending(), 'the set going EMPTY is not a camera request');
});

test('a tab clicked WHILE a camera key is HELD never arms a restore at all', () => {
  // The other ordering, and the browser is where it showed up: `onHold` already fired when the key
  // went down, so nothing would abort a restore armed underneath a reader who is still holding it.
  const s = scenario({held: 1});
  armA(s);
  assert.equal(s.pending(), null, 'nothing armed');
  assert.equal(s.marks.atlasPose, 'aborted');
  s.ready();
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0,
    'and the barrier writes nothing, so the reader keeps the camera they are driving');
});

test('M1 a POINTER GESTURE: OrbitControls\' own `start` aborts the restore', () => {
  const s = scenario();
  armA(s);
  s.gesture();
  assert.equal(s.pending(), null, 'the engine\'s gesture event is the reader taking the camera');
  // AN ABORT IS VISIBLE. Three rounds of review were argued partly from invisible state; the marker
  // lets an oracle tell an abort from a restore that never armed.
  assert.equal(s.marks.atlasPose, 'aborted');
  assert.ok(s.log.includes('emit aborted'));
  s.ready();
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  // AND IT NEVER MANUFACTURES AN EVENT: a gesture with nothing pending reports nothing.
  const t = scenario();
  t.gesture();
  assert.equal(t.marks.atlasPose, undefined, 'no pending restore, no abort event');
});

// ════ 3. ROUND 15's TWO LOWS — the design was wrong in BOTH directions at once ═════════════════════

test('LOW (too broad): the keyboard help, Settings and a dock toggle do NOT abort a restore', () => {
  for (const cmd of ['keymap', 'escape', 'find', 'snapshot', 'stage', 'side-toggle', 'dock-toggle']) {
    const s = scenario();
    armA(s);
    s.api().runCmd(cmd);
    assert.ok(s.pending(), `${cmd} makes no camera request, so it must leave the restore armed`);
    s.ready();
    assert.equal(s.marks.atlasPose, 'applied', `${cmd}: the pose still arrives`);
  }
});

test('LOW (zero-setter completion): a restore is complete ONLY if the setter ran', () => {
  // Start with the camera ALREADY at the saved pose — the exact case where the old predicate
  // (two frames of coordinate equality) reported success with zero setter calls.
  const s = scenario();
  armA(s);
  s.nav.setPose({x: 1, y: 2, z: 3, tx: 4, ty: 5, tz: 6});
  const before = s.log.filter((l) => l.startsWith('setPose')).length;
  s.ready();
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, before + 1,
    'the barrier still CALLS the setter rather than concluding from equality');
  assert.equal(s.marks.atlasPose, 'applied');
});

test('a refused pose reports `refused`, not `applied`', () => {
  const s = scenario();
  // Six numbers or nothing: a half-written `localStorage` value is a real case, and `setPose`
  // rejecting it must not be recorded as a restore.
  s.api().applyTab({blob: s.tab('A', null).blob, cam: [1, 2, 3, 4, 5, Number.NaN]});
  s.ready();
  assert.equal(s.marks.atlasPose, 'refused');
  assert.ok(s.log.includes('emit refused'));
});

// ════ 3b. codex ROUND 16 — THE BARRIER MUST CONSUME ITS OWN GENERATION ════════════════════════════

test("M1 (round 16): a `scene-ready` SUBSCRIBER that opens tab B does not lose B's pose to A's barrier", () => {
  /**
   * codex's executed sequence. `scene-ready` is emitted SYNCHRONOUSLY (tools.ts), so a subscriber
   * can open tab B inside scene A's readiness callback: B dispatches and arms its pose, A's callback
   * then resumes and consumed it — and the SIGNATURE could not see the mistake, because it compares
   * B against the controller, which is now B. B's pose was applied at A's barrier, before B's own
   * fit had run, and B's next frame cleared it. Measured by codex as
   * `setPose x=7 controller=B rendererReset=1 controllerReset=2 ... B frame: manual=false needsFit=true`.
   */
  const s = scenario();
  // A arrives through the URL path and is the generation that will draw.
  const a = s.tab('A', null);
  s.api().applySceneState(decodeScene(a.blob), a.blob);
  const genA = s.gen();
  let opened = false;
  s.onEvent((e) => {
    if (e.type !== 'scene-ready' || opened) return;
    opened = true;
    s.api().applyTab(s.tab('B', [7, 7, 7, 7, 7, 7]));
  });
  s.ready(genA);
  assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0,
    `A's barrier must not write B's pose; log: ${s.log.join(' -> ')}`);
  assert.ok(s.pending(), "B's pending restore SURVIVES the older callback rather than being dropped");
  // ...and B's OWN barrier applies it.
  s.ready();
  assert.equal(s.pose().x, 7, `B's pose arrives at B's barrier; log: ${s.log.join(' -> ')}`);
  assert.equal(s.marks.atlasPose, 'applied');
});

test('a barrier from a SUPERSEDED generation discards the pending restore rather than keeping it', () => {
  // The other direction of the same rule: a restore whose generation was replaced before it ever
  // drew has no barrier coming, and leaving it armed would be a restore with no owner.
  const s = scenario();
  armA(s);
  const stale = s.gen();
  s.api().applyTab(s.tab('B', null));   // supersedes; B carries no pose
  armA(s);                               // arm again, at the newer generation
  s.ready(stale + 5);                    // a barrier from a generation NEWER than the pending one
  assert.equal(s.pending(), null);
  assert.equal(s.marks.atlasPose, 'stale');
});

test('M1 (round 17): a hash that names NO view does not supersede a pending restore', () => {
  /**
   * The reachable case is our own SKIP LINK (`#v2-field`, shell.tsx): a keyboard user jumping to the
   * field while a tab restore is pending. Nothing about the view changes — the controller, and so the
   * signature, is untouched — but the handler used to open a new generation anyway, and the newer
   * barrier then discarded a restore that was about to be correct. codex executed it:
   * `armedGen 1, drawnGen 2, marker stale, setters 0`, against `applied / 1 setter` without the bump.
   */
  const s = scenario({hash: '#v2-field'});
  armA(s);
  const gen = s.gen();
  s.api().reapply();
  assert.equal(s.gen(), gen, 'no generation was opened, because no view was applied');
  s.ready();
  assert.equal(s.marks.atlasPose, 'applied', `the restore still arrives; log: ${s.log.join(' -> ')}`);
  assert.equal(s.pose().x, 1);
});

// ════ 3c. codex ROUND 18 — A BRANCH IN MERGED URL STATE IS NOT AN ACCEPTED TRANSITION ═════════════

/**
 * `readUrlState()` reads the QUERY AND THE HASH MERGED (url-state.ts:123), and a warm tab carries its
 * scene in the query. So `?scene=<current>` + `#v2-field` still SELECTED the scene branch: the
 * handler opened a generation, `apply-scene` opened another, and the pending restore went stale.
 * codex measured `1 → 3, stale, 0 setters` for three navigations that change nothing at all.
 *
 * These are codex's six rows, executed against the shipped handler. The two that genuinely change
 * the view are asserted separately below, and they MUST still open a generation.
 */
const armWithScene = (s) => {
  // A tab whose scene becomes the controller's current scene — the warm-tab precondition.
  const t = s.tab('A', [1, 2, 3, 4, 5, 6]);
  s.api().applyTab(t);
  return t;
};

for (const [name, url] of [
  ['empty query -> #v2-field', {hash: '#v2-field'}],
  ['empty query -> #stage=1&probe=1', {hash: '#stage=1&probe=1'}],
  ['CURRENT SCENE in the query -> #v2-field', {query: true, hash: '#v2-field'}],
  ['CURRENT SCENE in the query -> #stage=1&probe=1', {query: true, hash: '#stage=1&probe=1'}],
  ['the hash re-sets the UNCHANGED current scene', {sceneHash: true}],
]) {
  test(`M1 (round 18): ${name} changes nothing, so it opens no generation and the pose still lands`, () => {
    const s = scenario();
    const t = armWithScene(s);
    const gen = s.gen();
    s.setUrl({
      search: url.query ? `?scene=${t.blob}` : '',
      hash: url.sceneHash ? `#scene=${t.blob}` : (url.hash ?? ''),
    });
    s.api().reapply();
    assert.equal(s.gen(), gen, `no generation was opened; log: ${s.log.join(' -> ')}`);
    s.ready();
    assert.equal(s.marks.atlasPose, 'applied', `the restore still lands; log: ${s.log.join(' -> ')}`);
    assert.equal(s.pose().x, 1);
  });
}

test('M1 (round 18): a decoded but REFUSED arrival changes nothing, bumps nothing, and keeps the pose', () => {
  // codex's sixth row: 25 structures, over the atomic bound. The controller refuses, so the
  // generation must not move — the bump lives inside `dispatch`, AFTER acceptance.
  const s = scenario();
  armWithScene(s);
  const gen = s.gen();
  const tooMany = encodeScene(normalizeScene({
    structures: Array.from({length: 25}, (_, i) => ({id: `FMA${20000 + i}`})),
    caption: {title: 'too many'},
  }));
  s.setUrl({hash: `#scene=${tooMany}`});
  s.api().reapply();
  assert.ok(s.log.some((l) => l.startsWith('refused')), `the controller refused it; log: ${s.log.join(' -> ')}`);
  assert.equal(s.gen(), gen, 'a refusal changes nothing, so it opens no generation');
  s.ready();
  assert.equal(s.marks.atlasPose, 'applied', 'and the valid pending pose survives it');
  assert.equal(s.pose().x, 1);
});

for (const [name, build] of [
  ['a CHANGED scene', (s, t) => ({hash: `#scene=${s.tab('B', null).blob}`})],
  ['an explicit CLEAR', () => ({hash: '#scene=&select=FMA22359'})],
  ['a LEGACY select', () => ({hash: '#select=FMA22449&view=back'})],
]) {
  test(`${name} DOES open a generation, and the superseded pose is rejected`, () => {
    // The other side of the rule: this test file must not be satisfiable by a handler that has
    // simply stopped applying anything.
    const s = scenario();
    const t = armWithScene(s);
    const gen = s.gen();
    s.setUrl(build(s, t));
    s.api().reapply();
    assert.ok(s.gen() > gen, `the view changed, so a generation was opened; log: ${s.log.join(' -> ')}`);
    s.ready();
    assert.equal(s.marks.atlasPose, 'stale', 'and the pose armed for the previous view is discarded');
    assert.equal(s.log.filter((l) => l.startsWith('setPose')).length, 0);
  });
}

test('a LEGACY hash restating the CURRENT selection opens no generation either', () => {
  /**
   * The same rule on the branch a pending restore cannot reach (a restore implies a scene, and a
   * legacy arrival over a scene IS a transition). Asserted on the generation directly rather than
   * through the pose, so the claim is about what it actually says.
   */
  const s = scenario();
  s.dispatchRaw({type: 'apply-legacy', url: {select: ['FMA22359'], view: 'back'}});
  const gen = s.gen();
  s.setUrl({hash: '#select=FMA22359&view=back'});
  s.api().reapply();
  assert.equal(s.gen(), gen, `restating the same selection is not a transition; log: ${s.log.join(' -> ')}`);
  // ...and changing it IS one.
  s.setUrl({hash: '#select=FMA22449&view=back'});
  s.api().reapply();
  assert.ok(s.gen() > gen, 'a different selection opens a generation');
});

// ════ 4. SENSITIVITY — delete each guard, assert the matching claim FAILS ══════════════════════════

/**
 * RED-FIRST, EXECUTED. Each mutation removes exactly one guard from the extracted source; the arm
 * asserts the case it protects then breaks. Without this, every claim above is satisfiable by a
 * build in which the restore simply never runs.
 */
const mutations = [
  {
    name: 'the signature check',
    mutate: (s) => s.replace("if (p.sig !== poseSig()) return 'stale';", ''),
    /**
     * RESET, INSIDE THE SAME GENERATION — the case that isolates the signature from the generation
     * guard beside it. `reset-view` returns `epoch:false` (measured) but bumps `render.reset`, so the
     * barrier that fires is the tab's OWN and only the signature can tell that the reader has since
     * asked for something else. The legacy-hash case no longer isolates it: after round 16 the
     * generation guard catches that one too, and a sensitivity arm that two guards satisfy proves
     * neither.
     */
    defect: (mk) => {
      const s = mk();
      armA(s);
      s.dispatchRaw({type: 'reset-view'});
      s.newCamera();
      s.ready();
      return {ok: s.pose().x === 1, saw: `pose.x=${s.pose().x} · ${s.log.join(' -> ')}`};
    },
  },
  {
    name: 'the generation guard',
    mutate: (s) => s.replace('  if (drawnGen < p.gen) return;', ''),
    // codex round 16's sequence: B's pose eaten at A's barrier.
    defect: (mk) => {
      const s = mk();
      const a = s.tab('A', null);
      s.api().applySceneState(decodeScene(a.blob), a.blob);
      const genA = s.gen();
      let opened = false;
      s.onEvent((e) => {
        if (e.type !== 'scene-ready' || opened) return;
        opened = true;
        s.api().applyTab(s.tab('B', [7, 7, 7, 7, 7, 7]));
      });
      s.ready(genA);
      return {ok: s.pose().x === 7, saw: `pose.x=${s.pose().x} · ${s.log.join(' -> ')}`};
    },
  },
  {
    name: "the barrier's own call into the restore",
    mutate: (s) => s.replace('  poseRestoreRef.current?.(drawnEpoch);', ''),
    /**
     * codex round 16, Low 1: it deleted this exact line and all 19 cases stayed green, because the
     * suite called the restore itself. Every case now goes through the real `onSceneReady`, so the
     * production wiring is load-bearing — this arm is the proof of that.
     */
    defect: (mk) => {
      const s = mk();
      armA(s);
      s.ready();
      return {ok: s.pose().x !== 1, saw: `pose.x=${s.pose().x} · marker=${s.marks.atlasPose}`};
    },
  },
  {
    name: "the hash handler's no-op early return",
    mutate: (s) => s.replace(
      "    if (incoming === c.blob && sameVisible(u.visible)) { if (u.lang) applyLang(u.lang); return; }",
      ''),
    // codex round 17: a skip-link jump discarding a valid restore.
    /**
     * THE WARM-TAB FORM, which is what round 18 corrected: the scene lives in the QUERY, so the skip
     * link's hash still reaches the scene branch. (Round 17's empty-query version of this arm no
     * longer isolates anything — that path returns before the guard this mutation deletes.)
     */
    defect: (mk) => {
      const s = mk();
      const t = s.tab('A', [1, 2, 3, 4, 5, 6]);
      s.api().applyTab(t);
      s.setUrl({search: `?scene=${t.blob}`, hash: '#v2-field'});
      s.api().reapply();
      s.ready();
      return {ok: s.marks.atlasPose === 'stale' && s.pose().x !== 1,
        saw: `marker=${s.marks.atlasPose} pose.x=${s.pose().x} · ${s.log.join(' -> ')}`};
    },
  },
  {
    name: "bumpEpoch's write to the renderer's prop",
    mutate: (s) => s.replace('setEpoch(sceneGen.current);', ''),
    /**
     * codex round 17, Low 1: with the harness supplying its own counter, deleting this left all 23
     * cases green — the ref advanced and the renderer's prop never did. The suite now publishes the
     * value the RENDERER would have been given, so the connection is load-bearing.
     */
    defect: (mk) => {
      const s = mk();
      const a = s.tab('A', null);
      s.api().applySceneState(decodeScene(a.blob), a.blob);
      armA(s);
      s.ready();
      return {ok: s.pose().x !== 1, saw: `pose.x=${s.pose().x} marker=${s.marks.atlasPose}`};
    },
  },
  {
    name: 'the generation belonging to dispatch (after acceptance) rather than to the handler',
    // The round-18 shape put back: bump before knowing whether anything will be accepted.
    mutate: (s) => s.replace('   const c = ctlRef.current;', '   bumpEpoch();\n   const c = ctlRef.current;'),
    defect: (mk) => {
      const s = mk();
      s.api().applyTab(s.tab('A', [1, 2, 3, 4, 5, 6]));
      s.setUrl({hash: '#v2-field'});
      s.api().reapply();
      s.ready();
      return {ok: s.marks.atlasPose === 'stale', saw: `marker=${s.marks.atlasPose} · ${s.log.join(' -> ')}`};
    },
  },
  {
    name: 'the POSE_CMDS filter in the dispatcher',
    mutate: (s) => s.replace('if (POSE_CMDS.has(cmd)) anyRef.current?.(cmd);', ''),
    // Home asked for, Home given, then A's pose written back over it — round 14's measurement.
    defect: (mk) => {
      const s = mk();
      armA(s);
      s.api().runCmd('home');
      s.ready();
      return {ok: s.pose().x === 1, saw: `pose.x=${s.pose().x} · ${s.log.join(' -> ')}`};
    },
  },
  {
    name: 'the held-key abort',
    mutate: (s) => s.replace("if (n > 0) anyRef.current?.('held');", ''),
    defect: (mk) => {
      const s = mk();
      armA(s);
      s.api().onHold(1);
      s.ready();
      return {ok: s.pose().x === 1, saw: `pose.x=${s.pose().x} · pending=${s.pending() ? 'armed' : 'clear'}`};
    },
  },
  {
    name: 'the setter verdict',
    mutate: (s) => s.replace("return nav.setPose(p.want) ? 'applied' : 'refused';", "return 'applied';"),
    // A refusal reported as a restore — round 15's third Low, one level out.
    defect: (mk) => {
      const s = mk();
      s.api().applyTab({blob: s.tab('A', null).blob, cam: [1, 2, 3, 4, 5, Number.NaN]});
      s.ready();
      return {ok: s.marks.atlasPose === 'applied', saw: `data-atlas-pose=${s.marks.atlasPose}`};
    },
  },
];

for (const m of mutations) {
  test(`SENSITIVITY: removing ${m.name} reintroduces the defect`, () => {
    // The mutation must actually match — a `replace` that changed nothing would make this arm a
    // green asserting the opposite of what it claims.
    const src = program();
    assert.notEqual(m.mutate(src), src, `the mutation for "${m.name}" matched no source`);
    const mk = (opts = {}) => scenario({...opts, mutate: m.mutate});
    const {ok, saw} = m.defect(mk);
    assert.ok(ok, `removing ${m.name} should have reintroduced the defect, and did not: ${saw}`);
    // And the UNMUTATED build must not show it — otherwise the arm proves nothing about the guard.
    const clean = m.defect((opts = {}) => scenario(opts));
    assert.equal(clean.ok, false, `the shipped build shows the same defect: ${clean.saw}`);
  });
}

// ════ 5. THE COMMAND CLASSIFICATION IS CLOSED — a new command cannot be added without a verdict ════

test('every `Command` is classified as camera-moving or neutral, exactly once', () => {
  const block = cut(KEYS, 'export type Command =', ';\n');
  const all = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  assert.ok(all.length >= 20, `parsed ${all.length} commands out of keys.ts — the anchor moved`);
  for (const cmd of all) {
    const inPose = POSE_CMDS.has(cmd), inNeutral = NEUTRAL_CMDS.has(cmd);
    assert.ok(inPose !== inNeutral,
      `${cmd} must be in exactly one of POSE_CMDS / NEUTRAL_CMDS (pose=${inPose}, neutral=${inNeutral}) — ` +
      'a command added without a verdict about the camera is how round 14 and round 15 both happened');
  }
  // And neither set may name a command that no longer exists.
  for (const cmd of [...POSE_CMDS, ...NEUTRAL_CMDS]) {
    assert.ok(all.includes(cmd), `${cmd} is classified but is not a Command any more`);
  }
  assert.deepEqual([...POSE_CMDS].sort(), ['fit', 'home'],
    'only `home` and `fit` move the camera without passing through the controller');
});
