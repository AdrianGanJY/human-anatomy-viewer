/**
 * THE v2 SCENE CONTROLLER'S CONTRACT, as assertions. L31 v2.1a, commit C2.
 *
 * Every rule in app/v2/controller.ts's header is a statement about a state TRANSITION, so it can be
 * asserted without a browser, a renderer or React — and the end-to-end halves live in
 * scripts/verify-regress.mjs (cases `edited-scene-persists` and `focus-retargets-camera`), which
 * drive a real page. These are the ones that pin the semantics those cases can only observe
 * indirectly: what survives a patch, what a refusal leaves behind, and which commands are camera
 * intents.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, reduce} from '../app/v2/controller.ts';
import {decodeScene, encodeScene, normalizeScene, LIMITS} from '../app/scene-codec.js';

/** The §9 forward-bend scene — the same fixture the oracles and the regression cases use, and it
 *  carries a style, an annotation and a declared focus precisely so "reconcile every reference"
 *  is a testable claim rather than an intention. */
const SCENE = normalizeScene({
  mode: 'explore', lang: 'zh-Hans',
  structures: [
    {id: 'FMA22359', role: 'primary'},
    {id: 'FMA22449', role: 'primary'},
    {id: 'FMA16580', role: 'context'},
    {id: 'FMA9611', role: 'context'},
    {id: 'FMA16203', role: 'ghost'},
  ],
  camera: {view: 'side', focus: ['FMA22359'], padding: 1.5, explode: 0},
  styles: [{id: 'FMA9611', emphasis: 'secondary'}, {id: 'FMA22359', emphasis: 'highlight'}],
  annotations: [{type: 'label', target: 'FMA9611', text: 'femur'}, {type: 'label', target: 'FMA22359', text: 'hamstring'}],
  caption: {title: '腘绳肌与骨盆', note: '前屈时腘绳肌被拉长。', place: 'in'},
  background: 'dark',
});

const render = {
  explode: 0, visible: ['skeletal', 'muscular'], selected: [], isolate: false,
  view: 'three-quarter', rotate: false, reset: 0,
};
const withScene = () => ({
  scene: SCENE, blob: encodeScene(SCENE),
  picks: SCENE.structures.map((s) => s.id).sort(),
  focusId: 'FMA22359', render: {...render},
});
const bare = () => ({scene: null, blob: '', picks: ['FMA9611'], focusId: 'FMA9611', render: {...render}});

// ── rule 1 + 2: a transaction PATCHES the authoritative scene ────────────────────────────────────

test('removing a structure re-encodes the blob and drops it from picks', () => {
  const {state, rejected} = reduce(withScene(), {type: 'remove', id: 'FMA9611'});
  assert.equal(rejected, undefined);
  assert.equal(state.picks.includes('FMA9611'), false);
  assert.equal(state.scene.structures.some((s) => s.id === 'FMA9611'), false);
  // THE BLOB IS THE EDIT, not the arrival string. This is R:27 in one line.
  assert.notEqual(state.blob, encodeScene(SCENE));
  assert.equal(state.blob, encodeScene(state.scene));
  assert.equal(decodeScene(state.blob).structures.some((s) => s.id === 'FMA9611'), false);
});

test('an edit preserves every supported field the page does not model', () => {
  const {state} = reduce(withScene(), {type: 'remove', id: 'FMA9611'});
  const back = decodeScene(state.blob);
  assert.equal(back.caption.title, SCENE.caption.title, 'the caption must survive an edit');
  assert.equal(back.caption.note, SCENE.caption.note);
  assert.equal(back.camera.padding, 1.5, 'a non-default padding must survive');
  assert.equal(back.background, 'dark', 'the declared background must survive');
  assert.equal(back.mode, 'explore');
  assert.equal(back.lang, 'zh-Hans');
  assert.deepEqual(back.camera.focus, ['FMA22359'], 'the declared focus must survive');
});

test('removing a structure reconciles the focus, styles and annotations that named it', () => {
  // Not tidiness: `validateScene` REJECTS a scene whose focus/styles/annotations name a non-member,
  // so an unreconciled removal produces a scene that cannot be encoded at all.
  const {state, rejected} = reduce(withScene(), {type: 'remove', id: 'FMA22359'});
  assert.equal(rejected, undefined);
  const back = decodeScene(state.blob);
  assert.deepEqual(back.camera.focus, [], 'the declared focus named the removed structure');
  assert.equal(back.styles.some((s) => s.id === 'FMA22359'), false);
  assert.equal(back.annotations.some((a) => a.target === 'FMA22359'), false);
  // and the OTHER structure's style and annotation are untouched
  assert.equal(back.styles.some((s) => s.id === 'FMA9611'), true);
  assert.equal(back.annotations.some((a) => a.target === 'FMA9611'), true);
});

test('adding a structure joins the scene as CONTEXT, not as a primary', () => {
  const {state} = reduce(withScene(), {type: 'add', id: 'FMA7088'});
  const added = decodeScene(state.blob).structures.find((s) => s.id === 'FMA7088');
  assert.equal(added.role, 'context', 'a primary is a claim about what the link teaches');
  assert.equal(state.picks.includes('FMA7088'), true);
  assert.equal(state.focusId, 'FMA7088');
});

// ── rule 3: limits are atomic, and a refusal changes nothing ─────────────────────────────────────

test('the 24-structure bound is enforced atomically and the state comes back UNCHANGED', () => {
  let s = {scene: null, blob: '', picks: [], focusId: null, render: {...render}};
  const ids = Array.from({length: LIMITS.MAX_STRUCTURES}, (_, i) => `FMA${1000 + i}`);
  s = reduce(s, {type: 'replace', ids}).state;
  assert.equal(s.picks.length, LIMITS.MAX_STRUCTURES);
  const before = JSON.stringify(s);
  const out = reduce(s, {type: 'add', id: 'FMA9999'});
  assert.ok(out.rejected, 'the 25th structure must be refused');
  assert.match(out.rejected, /24/);
  assert.equal(JSON.stringify(out.state), before, 'a refused edit must leave the state untouched');
  assert.equal(out.state.picks.includes('FMA9999'), false, 'and must NOT silently truncate');
});

test('the 1,400-character encoded bound is enforced on the ACTUAL encoding', () => {
  // Both bounds have to hold and only the encoding knows the second one. A scene well under 24
  // structures can still exceed the URL budget through its caption.
  const fat = normalizeScene({
    ...SCENE,
    caption: {title: 'x'.repeat(LIMITS.TITLE_MAX), note: 'y'.repeat(LIMITS.NOTE_MAX), place: 'in'},
  });
  const state = {scene: fat, blob: encodeScene(fat), picks: fat.structures.map((s) => s.id).sort(), focusId: null, render: {...render}};
  assert.ok(encodeScene(fat).length > LIMITS.SCENE_MAX_B64 - 200, 'fixture must be near the bound to be a test');
  const out = reduce(state, {type: 'add', id: 'FMA7088'});
  if (out.rejected) {
    assert.match(out.rejected, /1400|characters/);
    assert.equal(out.state.blob, state.blob, 'a refused edit must leave the blob untouched');
  } else {
    assert.ok(out.state.blob.length <= LIMITS.SCENE_MAX_B64, 'an accepted edit must be within the bound');
  }
});

test('a scene cannot be emptied by removing its last structure', () => {
  const one = normalizeScene({...SCENE, structures: [{id: 'FMA22359', role: 'primary'}], camera: {view: 'side', focus: []}, styles: [], annotations: []});
  const state = {scene: one, blob: encodeScene(one), picks: ['FMA22359'], focusId: 'FMA22359', render: {...render}};
  const out = reduce(state, {type: 'remove', id: 'FMA22359'});
  assert.ok(out.rejected, 'an empty scene is not a scene');
  assert.match(out.rejected, /Clear/);
  assert.equal(out.state.scene.structures.length, 1);
});

// ── rule 5: camera intent ────────────────────────────────────────────────────────────────────────

test('ONLY camera intents bump reset', () => {
  const s = withScene();
  const bump = (cmd) => reduce(s, cmd).state.render.reset - s.render.reset;
  // intents
  assert.equal(bump({type: 'focus', id: 'FMA9611'}), 1);
  assert.equal(bump({type: 'set-view', view: 'front'}), 1);
  assert.equal(bump({type: 'reset-view'}), 1);
  assert.equal(bump({type: 'replace', ids: ['FMA9611']}), 1);
  assert.equal(bump({type: 'clear-all'}), 1);
  // NOT intents — these must not throw away a pose the human orbited to
  assert.equal(bump({type: 'add', id: 'FMA7088'}), 0, 'adding a structure must not refit');
  assert.equal(bump({type: 'remove', id: 'FMA9611'}), 0, 'removing a structure must not refit');
  assert.equal(bump({type: 'set-visible', visible: ['skeletal']}), 0, 'a system toggle must not refit');
  assert.equal(bump({type: 'set-isolate', on: true}), 0, 'an isolate toggle must not refit');
});

// ── rule 6: focus retargets THROUGH the scene ────────────────────────────────────────────────────

test('focusing a declared member rewrites camera.focus, which is what moves the camera', () => {
  const {state, rejected} = reduce(withScene(), {type: 'focus', id: 'FMA16203'});
  assert.equal(rejected, undefined);
  assert.deepEqual(state.scene.camera.focus, ['FMA16203'], 'the renderer reads camera.focus and nothing else');
  assert.equal(state.focusId, 'FMA16203');
  // MEMBERSHIP IS UNCHANGED. Retargeting is a camera operation; a fix that also dropped the other
  // structures would have traded one defect for a worse one.
  assert.deepEqual(state.picks, withScene().picks);
  // and it survives serialisation, so plate() and a reload agree
  assert.deepEqual(decodeScene(state.blob).camera.focus, ['FMA16203']);
});

test('focusing something that is not a scene member moves the UI focus only', () => {
  const s = withScene();
  s.picks = [...s.picks, 'FMA7088'];            // added outside the scene
  const {state} = reduce(s, {type: 'focus', id: 'FMA7088'});
  assert.equal(state.focusId, 'FMA7088');
  assert.deepEqual(state.scene.camera.focus, ['FMA22359'],
    'the declared focus must not change — adding it to the scene would change membership as a side effect');
});

test('focusing an id that is not selected at all is a no-op', () => {
  const s = withScene();
  const out = reduce(s, {type: 'focus', id: 'FMA0000'});
  assert.equal(out.state, s);
});

// ── clear-all, and the epoch ─────────────────────────────────────────────────────────────────────

test('clear-all exits scene mode and clears the cached blob', () => {
  const {state, epoch} = reduce(withScene(), {type: 'clear-all'});
  assert.equal(state.scene, null);
  assert.equal(state.blob, '', 'the cached blob must go, or writeUrlState puts the scene back');
  assert.deepEqual(state.picks, []);
  assert.equal(state.focusId, null);
  assert.equal(state.render.isolate, false, 'an isolate with an empty selection draws nothing');
  assert.equal(epoch, true);
});

test('the epoch is raised exactly when the scene identity changed', () => {
  assert.equal(reduce(withScene(), {type: 'remove', id: 'FMA9611'}).epoch, true);
  assert.equal(reduce(withScene(), {type: 'set-visible', visible: ['skeletal']}).epoch, undefined);
  assert.equal(reduce(bare(), {type: 'clear-all'}).epoch, false, 'nothing to withdraw on a bare page');
});

// ── arrival paths ────────────────────────────────────────────────────────────────────────────────

test('applying a scene preserves an equivalent arrival blob byte-for-byte', () => {
  const blob = encodeScene(SCENE);
  const {state} = reduce(bare(), {type: 'apply-scene', scene: SCENE, blob});
  assert.equal(state.blob, blob, 'a link a human copied must reproduce byte-identically (the R2 key)');
  assert.equal(state.render.view, 'side');
  assert.equal(state.render.isolate, true, "rest:'none' IS today's isolate");
  assert.equal(state.focusId, 'FMA22359');
});

test('a legacy re-drive applies camera and visibility together with its picks', () => {
  const {state} = reduce(bare(), {type: 'apply-legacy', url: {select: ['FMA22359'], view: 'side', isolate: true, explode: 0.5, visible: []}});
  assert.deepEqual(state.picks, ['FMA22359']);
  assert.equal(state.render.view, 'side');
  assert.equal(state.render.isolate, true);
  assert.equal(state.render.explode, 0.5);
  assert.deepEqual(state.render.visible, [], 'system=none means an EMPTY visible set');
});

test('clear-scene leaves scene mode and applies the clearing hash’s legacy keys', () => {
  const {state} = reduce(withScene(), {type: 'clear-scene', url: {select: ['FMA9611'], view: 'front'}});
  assert.equal(state.scene, null);
  assert.equal(state.blob, '');
  assert.deepEqual(state.picks, ['FMA9611']);
  assert.equal(state.render.view, 'front');
  assert.equal(state.focusId, null);
});

test('replace patches the scene rather than exiting it, and reconciles what no longer fits', () => {
  const {state, rejected} = reduce(withScene(), {type: 'replace', ids: ['FMA9611'], focus: 'FMA9611'});
  assert.equal(rejected, undefined);
  assert.ok(state.scene, 'tapping a structure must not discard the assistant’s title and note');
  const back = decodeScene(state.blob);
  assert.equal(back.caption.title, SCENE.caption.title);
  assert.deepEqual(back.structures.map((s) => s.id), ['FMA9611']);
  assert.deepEqual(back.camera.focus, [], 'the declared focus named a structure that is gone');
  assert.equal(back.annotations.some((a) => a.target === 'FMA22359'), false);
  assert.equal(state.render.isolate, false);
});

// ── the deliberate exception, asserted so it cannot drift into an accident ───────────────────────

test('set-isolate is RENDER-ONLY and never rewrites the scene', () => {
  // `rest.include` is a closed enum of `none | skeletal` with no value meaning "show everything",
  // so isolate OFF has no representation. Leaving the arriving link's `rest` undisturbed is the
  // deferral discipline, and this asserts it stays deliberate.
  const s = withScene();
  const off = reduce(s, {type: 'set-isolate', on: false});
  assert.equal(off.state.render.isolate, false);
  assert.equal(off.state.blob, s.blob, 'the blob must not change');
  assert.equal(off.state.scene.rest.include, s.scene.rest.include, 'and the declared rest must not be invented');
  const on = reduce(s, {type: 'set-isolate', on: true});
  assert.equal(on.state.render.isolate, true);
  assert.equal(on.state.blob, s.blob);
});

test('set-visible never re-encodes — systems are page state, serialised as the legacy system= key', () => {
  const s = withScene();
  const {state} = reduce(s, {type: 'set-visible', visible: ['skeletal']});
  assert.deepEqual(state.render.visible, ['skeletal']);
  assert.equal(state.blob, s.blob);
  assert.equal(state.render.isolate, false, 'choosing systems turns isolate off, as it always has');
});

test('the input state is never mutated', () => {
  const s = withScene();
  const snapshot = JSON.stringify(s);
  for (const cmd of [
    {type: 'remove', id: 'FMA9611'}, {type: 'add', id: 'FMA7088'}, {type: 'focus', id: 'FMA16203'},
    {type: 'set-view', view: 'front'}, {type: 'clear-all'}, {type: 'replace', ids: ['FMA9611']},
    {type: 'set-isolate', on: true}, {type: 'set-visible', visible: ['skeletal']},
  ]) reduce(s, cmd);
  assert.equal(JSON.stringify(s), snapshot);
});

test('the controller’s uniq agrees with selection.ts dedupe (the copy cannot drift silently)', async () => {
  // `selection.ts` cannot be imported here (it pulls SYSTEMS from `../anatomy` as a value, which
  // drags the extensionless chain into node --test), so the guard reads its SOURCE and runs the
  // same cases through both. If either implementation changes, this fails.
  const {readFileSync} = await import('node:fs');
  const src = readFileSync(new URL('../app/selection.ts', import.meta.url), 'utf8');
  const m = /export function dedupe\(ids:readonly string\[\]\):string\[\]\{return ([^;]+);\}/.exec(src);
  assert.ok(m, 'could not find dedupe in app/selection.ts — this guard needs updating');
  const dedupe = new Function('ids', `return ${m[1]};`);
  const uniq = (ids) => [...new Set(ids.map((s) => s.trim()).filter(Boolean))];
  for (const sample of [[], ['a'], ['a', 'a'], [' a ', 'a'], ['', ' ', 'b'], ['b', 'a', 'b']]) {
    assert.deepEqual(uniq(sample), dedupe(sample), `uniq drifted from dedupe on ${JSON.stringify(sample)}`);
  }
});

// ══ codex REVIEW 2 — the four executed counterexamples, as standing assertions ══════════════════
// Each of these reproduced a real defect in the shipped controller. They are here so the same hole
// cannot reopen quietly.

test('an ARRIVING scene is validated: 25 real structures in a short blob is refused, not committed', () => {
  // codex's counterexample: 25 genuine atlas concepts encode to only 351 characters, so the length
  // bound never fires — and `decodeScene` does NOT call `validateScene`, so nothing else caught it.
  const ids = Array.from({length: 25}, (_, i) => `FMA${2000 + i}`);
  const fat = normalizeScene({structures: ids.map((id) => ({id, role: 'primary'})), camera: {view: 'front', focus: []}});
  const before = bare();
  const out = reduce(before, {type: 'apply-scene', scene: fat, blob: encodeScene(fat)});
  assert.ok(out.rejected, 'a 25-structure arrival must be refused');
  assert.match(out.rejected, /25 structures|maximum is 24/);
  assert.equal(out.state, before, 'and the page keeps the state it already had');
});

test('an ARRIVING scene that exceeds the encoded budget is refused', () => {
  const ids = Array.from({length: 20}, (_, i) => `FMA${3000 + i}`);
  const huge = normalizeScene({
    structures: ids.map((id) => ({id, role: 'primary'})),
    camera: {view: 'front', focus: []},
    annotations: ids.slice(0, 8).map((id) => ({type: 'label', target: id, text: 'x'.repeat(60)})),
    styles: ids.map((id) => ({id, emphasis: 'highlight', opacity: 0.5})),
    caption: {title: 'y'.repeat(80), note: 'z'.repeat(600), place: 'in'},
  });
  const blob = encodeScene(huge);
  const before = bare();
  const out = reduce(before, {type: 'apply-scene', scene: huge, blob});
  if (blob.length > LIMITS.SCENE_MAX_B64) {
    assert.ok(out.rejected, `a ${blob.length}-character arrival must be refused`);
    assert.equal(out.state, before);
  } else {
    // If the fixture did not exceed the bound, the committed blob must still be decodable — the
    // property the bound exists to protect.
    assert.ok(decodeScene(out.state.blob), 'a committed blob must decode');
  }
});

test('every membership path is bounded, not just the scene edits', () => {
  const ids = Array.from({length: 25}, (_, i) => `FMA${4000 + i}`);
  const before = bare();
  for (const cmd of [
    {type: 'replace', ids},
    {type: 'apply-legacy', url: {select: ids}},
    {type: 'clear-scene', url: {select: ids}},
  ]) {
    const out = reduce(before, cmd);
    assert.ok(out.rejected, `${cmd.type} must refuse 25 selections`);
    assert.equal(out.state, before, `${cmd.type} must leave the state untouched`);
    assert.equal(out.state.picks.length, before.picks.length, `${cmd.type} must NOT truncate`);
  }
  // and 24 is still accepted on each of them
  const ok = ids.slice(0, 24);
  assert.equal(reduce(before, {type: 'replace', ids: ok}).rejected, undefined);
  assert.equal(reduce(before, {type: 'apply-legacy', url: {select: ok}}).rejected, undefined);
  assert.equal(reduce(before, {type: 'clear-scene', url: {select: ok}}).rejected, undefined);
});

test('clear-all leaves NOTHING for the serializer to put back', () => {
  // The page's marker effect is what actually writes `lastBlob`, and it used to skip the call when
  // the scene became null — so Clear cleared the controller and the URL restored the scene on
  // reload (codex review 2, High 1). The controller half of that contract is asserted here: after
  // clear-all there is no scene and no blob, so an unconditional marker write publishes ''.
  const {state} = reduce(withScene(), {type: 'clear-all'});
  assert.equal(state.scene, null);
  assert.equal(state.blob, '');
  assert.deepEqual(state.picks, []);
});

// ══ codex REVIEW 2 — the Mediums that were product defects ══════════════════════════════════════

test('apply-legacy reconciles the focus and leaves scene mode', () => {
  // Executed by codex: applying `[FMA7088]` over a scene focused on FMA22359 left `state.focus`
  // reporting the old id while the visible detail had already fallen back to the new basket — and
  // kept the old scene and blob while replacing the picks, so the URL described structures that
  // were no longer selected.
  const {state} = reduce(withScene(), {type: 'apply-legacy', url: {select: ['FMA7088'], view: 'front'}});
  assert.equal(state.scene, null, 'the legacy contract has no scene by definition');
  assert.equal(state.blob, '');
  assert.deepEqual(state.picks, ['FMA7088']);
  assert.equal(state.focusId, null, 'a focus outside membership must not survive');
  // a focus that IS still a member survives
  const keep = reduce({...bare(), focusId: 'FMA9611'}, {type: 'apply-legacy', url: {select: ['FMA9611', 'FMA7088']}});
  assert.equal(keep.state.focusId, 'FMA9611');
});

test('set-view writes camera.rotate into the blob, not only into the live view', () => {
  const spinning = normalizeScene({...SCENE, camera: {...SCENE.camera, rotate: true}});
  const s = {scene: spinning, blob: encodeScene(spinning), picks: spinning.structures.map((x) => x.id).sort(), focusId: null, render: {...render, rotate: true}};
  const {state} = reduce(s, {type: 'set-view', view: 'front'});
  assert.equal(state.render.rotate, false, 'the live turntable stops');
  assert.equal(decodeScene(state.blob).camera.rotate, false, 'and the blob says so too');
  assert.equal(decodeScene(state.blob).camera.view, 'front');
});

test('set-isolate writes the explosion reset it performs', () => {
  const exploded = normalizeScene({...SCENE, camera: {...SCENE.camera, explode: 0.5}});
  const s = {scene: exploded, blob: encodeScene(exploded), picks: exploded.structures.map((x) => x.id).sort(), focusId: null, render: {...render, explode: 0.5}};
  const {state} = reduce(s, {type: 'set-isolate', on: true});
  assert.equal(state.render.explode, 0, 'the live explosion collapses');
  assert.equal(decodeScene(state.blob).camera.explode, 0, 'and the blob agrees');
  // the isolate FLAG itself is still the documented exception: rest.include is untouched
  assert.equal(decodeScene(state.blob).rest.include, exploded.rest.include);
});

test('an already-canonical arrival blob survives byte-identically', () => {
  // The weaker, TRUE claim: canonical in, canonical out. A non-canonical spelling is normalised,
  // which is what the codec is for — two spellings of one picture must share one R2 entry.
  const canonical = encodeScene(SCENE);
  const {state} = reduce(bare(), {type: 'apply-scene', scene: SCENE, blob: canonical});
  assert.equal(state.blob, canonical);
});

// ══ codex REVIEW 3 — the cold seed ══════════════════════════════════════════════════════════════

test('the COLD SEED validates before publishing, so a bad link never half-applies', () => {
  // codex executed this with 25 real atlas concepts in a 448-character blob: the old inline
  // initializer published all 25, and `apply-scene` then correctly refused them while preserving the
  // state that already contained them — a scene declaring `side` live on a `three-quarter` camera.
  const ids = Array.from({length: 25}, (_, i) => `FMA${5000 + i}`);
  const over = normalizeScene({structures: ids.map((id) => ({id, role: 'primary'})), camera: {view: 'side', focus: []}});
  const {state, rejected} = initialState(
    {scene: over, sceneBlob: encodeScene(over), select: ids, view: 'side'}, {...render});
  assert.ok(rejected, 'an unusable arrival must say so');
  assert.equal(state.scene, null, 'and must NOT be published');
  assert.equal(state.blob, '', 'so the marker and serializer never see it');
  assert.ok(state.picks.length <= LIMITS.MAX_STRUCTURES, 'the fallback is bounded too');
  assert.equal(state.render.view, 'side', 'the legacy fields it CAN honour are still honoured');
});

test('the cold seed publishes a VALID scene untouched', () => {
  const blob = encodeScene(SCENE);
  const {state, rejected} = initialState({scene: SCENE, sceneBlob: blob}, {...render});
  assert.equal(rejected, undefined);
  assert.equal(state.blob, blob, 'a canonical arrival survives byte-identically');
  assert.equal(state.picks.length, 5);
  assert.equal(state.focusId, 'FMA22359');
  // The CAMERA is not applied here on purpose: the page's mount effect dispatches `apply-scene`
  // once the atlas exists, which is the single place that bumps `reset` and moves the view. Doing
  // it in the seed as well would bump it twice for one arrival.
  assert.equal(state.render.view, render.view, 'the seed carries the render state through untouched');
});

test('the cold seed bounds a bare legacy selection too', () => {
  const ids = Array.from({length: 25}, (_, i) => `FMA${6000 + i}`);
  const {state, rejected} = initialState({select: ids}, {...render});
  assert.ok(rejected, '25 legacy selections must be reported');
  assert.equal(state.picks.length, LIMITS.MAX_STRUCTURES, 'and bounded rather than published whole');
  const fine = initialState({select: ids.slice(0, 3), view: 'back'}, {...render});
  assert.equal(fine.rejected, undefined);
  assert.deepEqual(fine.state.picks, ids.slice(0, 3));
  assert.equal(fine.state.render.view, 'back');
});

// ── codex r9 MEDIUM 1: the camera/system round-trip (the S0 prelude) ─────────────────────────────
// Two halves of one defect: a command that changes a camera fact live must write that fact into the
// blob, and a SCENE must not consume a fact the HUMAN owns.

const rotating = () => {
  const scene = normalizeScene({...SCENE, camera: {...SCENE.camera, rotate: true}});
  return {scene, blob: encodeScene(scene), picks: scene.structures.map((s) => s.id).sort(),
    focusId: 'FMA22359', render: {...render, rotate: true}};
};

test('replace stops the turntable IN THE BLOB, not only on screen', () => {
  const before = rotating();
  assert.equal(decodeScene(before.blob).camera.rotate, true, 'the fixture must actually be rotating');
  const {state, rejected} = reduce(before, {type: 'replace', ids: ['FMA22359', 'FMA9611']});
  assert.equal(rejected, undefined);
  assert.equal(state.render.rotate, false, 'the live turntable stops');
  assert.equal(state.scene.camera.rotate, false, 'and the scene agrees');
  assert.equal(decodeScene(state.blob).camera.rotate, false, 'so a copied link opens still, not spinning');
});

test('focusing a MEMBER stops the turntable in the blob too', () => {
  const {state, rejected} = reduce(rotating(), {type: 'focus', id: 'FMA9611'});
  assert.equal(rejected, undefined);
  assert.equal(state.focusId, 'FMA9611');
  assert.deepEqual(state.scene.camera.focus, ['FMA9611']);
  assert.equal(decodeScene(state.blob).camera.rotate, false);
});

test('focusing a NON-MEMBER stops it as well — and re-encodes only when it has to', () => {
  // A pick that is not a scene structure: membership is unchanged, the camera fact is not.
  const spinning = rotating();
  const withPick = {...spinning, picks: [...spinning.picks, 'FMA7487']};
  const {state, rejected} = reduce(withPick, {type: 'focus', id: 'FMA7487'});
  assert.equal(rejected, undefined);
  assert.equal(state.focusId, 'FMA7487', 'the UI focus moves');
  assert.deepEqual(state.scene.camera.focus, ['FMA22359'], 'the DECLARED focus does not');
  assert.equal(decodeScene(state.blob).camera.rotate, false, 'but the stopped turntable is serialised');
  // And when there was nothing to correct, the scene is left exactly as it was — no churn, no epoch.
  const still = {...withScene(), picks: [...withScene().picks, 'FMA7487']};
  const out2 = reduce(still, {type: 'focus', id: 'FMA7487'});
  assert.equal(out2.state.blob, still.blob, 'an already-stopped scene is not re-encoded');
  assert.equal(out2.epoch, undefined);
});

/**
 * ⚠️ RE-POINTED AT S3b ROUND 5, AND THE POLARITY OF ONE ASSERTION IS INVERTED ON PURPOSE.
 *
 * This row asserted `afterGhost.render.visible === ['skeletal']` — "the ghost still drives what is
 * drawn" — AFTER an explicit `set-visible`. codex round 5's High is that exactly that sequence is a
 * defect: the reader hid a system, reloaded their own link, and the ghost branch undid it while the
 * eye's tooltip claimed the choice was saved in the link. So a CLICK is now a statement
 * (`intentExplicit`), and a statement beats a scene's `rest` declaration.
 *
 * The row's REAL claim — a ghost must not CONSUME the human's set, so the next scene does not
 * inherit it — is untouched and still asserted below. What changed is the one line about what the
 * ghost drives when the human has already spoken. Named here rather than quietly edited, and the
 * ghost's own behaviour where nobody has spoken is asserted by the new row after this one.
 */
test('a GHOST scene does not consume the system set the human chose', () => {
  // The human picks two systems, then opens a link whose rest is a skeletal ghost.
  const seeded = initialState({}, {...render, visible: ['muscular', 'nervous']});
  const chosen = reduce(seeded.state, {type: 'set-visible', visible: ['muscular', 'nervous']}).state;
  assert.deepEqual(chosen.visibleIntent, ['muscular', 'nervous']);
  assert.equal(chosen.intentExplicit, true, 'the click is a STATEMENT (S3b round 5)');

  const ghost = normalizeScene({...SCENE, rest: {include: 'skeletal', opacity: 0.08}});
  const afterGhost = reduce(chosen, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(afterGhost.render.visible, ['muscular', 'nervous'],
    'INVERTED at round 5: a statement beats the ghost, so the reader keeps what they chose');
  assert.deepEqual(afterGhost.visibleIntent, ['muscular', 'nervous'], 'and the human choice survives it');

  // THE DEFECT, in one assertion: the NEXT scene used to inherit ['skeletal'] as if it were asked for.
  const plain = reduce(afterGhost, {type: 'apply-scene', scene: SCENE}).state;
  assert.deepEqual(plain.render.visible, ['muscular', 'nervous'],
    'a non-ghost scene restores the human set — it does not inherit the ghost');
});

/** THE CONTROL ARM FOR THE ROW ABOVE, added at round 5. Inverting an assertion is only safe if the
 *  behaviour it used to cover is asserted somewhere — otherwise the ghost feature could break
 *  silently. Where NOBODY has spoken, the ghost still drives the render value, exactly as before. */
test('a GHOST scene still drives what is drawn when the human has NOT spoken', () => {
  const seeded = initialState({}, {...render, visible: ['muscular', 'nervous']}).state;
  assert.equal(seeded.intentExplicit ?? false, false, 'no click, no system= — no statement');
  const ghost = normalizeScene({...SCENE, rest: {include: 'skeletal', opacity: 0.08}});
  const afterGhost = reduce(seeded, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(afterGhost.render.visible, ['skeletal'], 'the ghost feature is intact');
  assert.deepEqual(afterGhost.visibleIntent, ['muscular', 'nervous'], 'and still does not consume the set');
});

/**
 * ⚠️ RE-POINTED AT ROUND 5 AND *RESTORED* AT ROUND 6, and the round trip is the point.
 *
 * Round 5 made a URL `system=` key mark the intent EXPLICIT, so it beat a ghost in the same link.
 * Round 6 measured two reasons that is wrong, and the second is a REGRESSION of a previously fixed
 * defect: the app's own serialiser writes `system=` from the RENDER value, so an untouched ghost's
 * automatic URL write manufactures a statement nobody made (codex: zero clicks, intent became
 * `['skeletal']`). The flag is now set only by a real `set-visible`, and this row is back to its
 * pre-round-5 assertion. The `system=` key still carries the SET; it simply does not carry
 * "a human said so", which the URL vocabulary cannot express today. See the row below.
 */
test('system= in a legacy URL IS the human speaking, and survives a later ghost', () => {
  const seeded = initialState({select: ['FMA9611'], visible: ['arterial']}, {...render}).state;
  assert.deepEqual(seeded.visibleIntent, ['arterial']);
  assert.equal(seeded.intentExplicit ?? false, false,
    'a URL key is NOT a statement (round 6): the serialiser writes it from the render value');
  const ghost = normalizeScene({...SCENE, rest: {include: 'skeletal', opacity: 0.08}});
  const afterGhost = reduce(seeded, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(afterGhost.render.visible, ['skeletal'],
    'so the ghost drives the render value, as it did before round 5');
  const back = reduce(afterGhost, {type: 'apply-legacy', url: {select: ['FMA9611']}}).state;
  assert.deepEqual(back.visibleIntent, ['arterial'], 'a legacy apply with no system= leaves the intent alone');
});

// ── the S0 stand-in review, H3: the UI path, not just the reducer ────────────────────────────────
// The controller-side fix alone did NOT close the one-way door. The systems checkbox displayed
// `render.visible` and recomputed the next set from it, so after a ghost scene the human's own
// choice read as OFF, and one click wrote the ghost straight into the intent. This is that exact
// five-step sequence, with the UI handler reproduced as the page performs it.

test('the human\u2019s system set survives a ghost scene THROUGH THE UI, not only in the reducer', () => {
  /**
   * ⚠️ S3c — NO PRELIMINARY CLICK, AND THAT IS THE WHOLE ROW (codex round 7, the Low).
   *
   * This test used to open with `reduce(..., {type:'set-visible', visible:['muscular','nervous']})`
   * — a CLICK, which since round 5 marks the intent explicit, so the ghost no longer overrode
   * `render.visible` and the two sources this row exists to tell apart held the SAME value. codex
   * executed it: swapping `st.visibleIntent ?? st.render.visible` for `st.render.visible` left the
   * row PASSING. It could not go red for the defect it names.
   *
   * The set is now SEEDED from the render seed, which is the state a page actually reaches when
   * nobody has clicked. The ghost then does drive the render value, the two sources DIVERGE, and a
   * control reading the wrong one is measurably wrong. The divergence is asserted FIRST, so a
   * future change that removes it makes this row go red rather than go hollow again.
   */
  const seeded = initialState({}, {...render, visible: ['muscular', 'nervous']});
  assert.equal(seeded.state.intentExplicit ?? false, false, 'the premise: nobody has clicked yet');

  const ghost = normalizeScene({...SCENE, rest: {include: 'skeletal', opacity: 0.08}});
  const afterGhost = reduce(seeded.state, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(afterGhost.render.visible, ['skeletal'],
    'with no statement the ghost drives the render value — the divergence this row needs');

  // WHAT THE CHECKBOX SHOWS. `app/v2/page.tsx` reads `visibleIntent`, never `render.visible` — so
  // the human sees the boxes they ticked, not the scene's ghost. Reading the wrong source now
  // returns ['skeletal'] and this assertion fails, which is the protection that was missing.
  const shown = (st) => st.visibleIntent ?? st.render.visible;
  assert.notDeepEqual(shown(afterGhost), afterGhost.render.visible,
    'the two sources must actually differ, or this row is measuring nothing');
  assert.deepEqual(shown(afterGhost), ['muscular', 'nervous'],
    'the control shows the human their own choice, still ticked');

  // WHAT ONE CLICK WRITES. Reproducing page.tsx's onChange verbatim: toggle 'arterial' on.
  const cur = shown(afterGhost);
  const next = cur.includes('arterial') ? cur.filter((x) => x !== 'arterial') : [...cur, 'arterial'];
  const afterClick = reduce(afterGhost, {type: 'set-visible', visible: next}).state;
  assert.deepEqual(afterClick.visibleIntent, ['muscular', 'nervous', 'arterial'],
    'the ghost never enters the intent — this is the assertion the old UI path failed');

  // AND THE NEXT SCENE INHERITS THE HUMAN, NOT THE GHOST.
  const plain = reduce(afterClick, {type: 'apply-scene', scene: SCENE}).state;
  assert.deepEqual(plain.render.visible, ['muscular', 'nervous', 'arterial']);
});

// ══ L31 v2.1b+c, S3 — THE TREE'S TWO NEW TRANSACTIONS ═══════════════════════════════════════════
// `tick` is the ONE path a single child tick and a whole-system bulk tick both take, and
// `set-opacity` is the ONE command behind both the Selection slider and the tree's member eye. Both
// claims are about state transitions, so they belong here rather than in a browser.

test('tick adds EXACTLY the requested id and nothing else', () => {
  const before = bare();
  const {state, rejected} = reduce(before, {type: 'tick', ids: ['FMA22359'], on: true});
  assert.equal(rejected, undefined);
  assert.deepEqual(state.picks, ['FMA9611', 'FMA22359']);
  // The existing member is untouched, and the new one is exactly one id — not its elements, not its
  // system. `picks` is the EXACT REQUESTED IDS (R:57).
  assert.equal(state.picks.length, before.picks.length + 1);
});

test('tick is idempotent: ticking an already-ticked id changes nothing', () => {
  const before = bare();
  const {state} = reduce(before, {type: 'tick', ids: ['FMA9611'], on: true});
  assert.equal(state, before, 'the same object is returned, so no render is published');
});

test('an over-bound BULK tick refuses ATOMICALLY — not one id is committed', () => {
  const before = bare();
  const many = Array.from({length: LIMITS.MAX_STRUCTURES + 4}, (_, i) => `FMA9000${i}`);
  const {state, rejected} = reduce(before, {type: 'tick', ids: many, on: true});
  assert.ok(rejected, 'it refuses');
  assert.ok(/maximum is 24|24 structures/.test(rejected), `the message names the bound: ${rejected}`);
  // THE POINT OF THE ROW: the state is the INPUT, unchanged. A fold over single adds would have
  // committed the first 24 and then refused, which is the silent truncation the contract forbids.
  assert.deepEqual(state.picks, before.picks);
  assert.equal(state.blob, before.blob);
  assert.equal(state.render.reset, before.render.reset, 'and it is not a camera intent');
});

test('a bulk untick removes every requested id in one transaction', () => {
  const s = withScene();
  const two = ['FMA9611', 'FMA16580'];
  const {state, rejected} = reduce(s, {type: 'tick', ids: two, on: false});
  assert.equal(rejected, undefined);
  for (const id of two) assert.ok(!state.picks.includes(id), `${id} is gone`);
  assert.equal(state.picks.length, s.picks.length - 2);
  // Rule 4: every reference to a departing structure is reconciled, or the scene cannot encode.
  const decoded = decodeScene(state.blob);
  assert.ok(decoded, 'the scene still encodes');
  for (const id of two) {
    assert.ok(!decoded.styles.some((x) => x.id === id), `no style names ${id}`);
    assert.ok(!decoded.annotations.some((a) => a.target === id), `no annotation names ${id}`);
    assert.ok(!decoded.camera.focus.includes(id), `the declared focus does not name ${id}`);
  }
});

test('unticking the LAST structure in scene mode is refused, not silently a clear', () => {
  const s = withScene();
  const all = s.picks.slice();
  const {state, rejected} = reduce(s, {type: 'tick', ids: all, on: false});
  assert.ok(rejected, 'it refuses');
  assert.ok(/at least one structure/.test(rejected), rejected);
  assert.equal(state.blob, s.blob, 'the teaching link keeps its title, note and structures');
});

test('tick is NOT a camera intent — the pose survives it', () => {
  const before = bare();
  const {state} = reduce(before, {type: 'tick', ids: ['FMA22359'], on: true});
  assert.equal(state.render.reset, before.render.reset);
});

test('set-opacity writes styles[id].opacity and re-encodes', () => {
  const {state, rejected} = reduce(withScene(), {type: 'set-opacity', id: 'FMA9611', opacity: 0});
  assert.equal(rejected, undefined);
  const decoded = decodeScene(state.blob);
  assert.equal(decoded.styles.find((s) => s.id === 'FMA9611')?.opacity, 0);
});

test('set-opacity(null) REMOVES the entry rather than writing 1', () => {
  const withZero = reduce(withScene(), {type: 'set-opacity', id: 'FMA9611', opacity: 0}).state;
  const {state} = reduce(withZero, {type: 'set-opacity', id: 'FMA9611', opacity: null});
  const decoded = decodeScene(state.blob);
  const entry = decoded.styles.find((s) => s.id === 'FMA9611');
  // The structure keeps its other style fields; only the alpha is gone.
  assert.equal(entry?.opacity, undefined, 'no opacity is carried');
});

test('set-opacity on a NON-MEMBER is refused with a reason, and on a scene-less page too', () => {
  const notMember = reduce(withScene(), {type: 'set-opacity', id: 'FMA99999', opacity: 0.5});
  assert.ok(notMember.rejected, 'a non-member is refused');
  assert.equal(notMember.state.blob, withScene().blob);
  const noScene = reduce(bare(), {type: 'set-opacity', id: 'FMA9611', opacity: 0.5});
  assert.ok(noScene.rejected, 'a page with no scene is refused');
  assert.ok(/saved view|not showing one/.test(noScene.rejected), noScene.rejected);
});

test('set-opacity clamps out-of-range values rather than storing them', () => {
  const hi = reduce(withScene(), {type: 'set-opacity', id: 'FMA9611', opacity: 4});
  assert.equal(decodeScene(hi.state.blob).styles.find((s) => s.id === 'FMA9611')?.opacity ?? 1, 1);
  const lo = reduce(withScene(), {type: 'set-opacity', id: 'FMA9611', opacity: -3});
  assert.equal(decodeScene(lo.state.blob).styles.find((s) => s.id === 'FMA9611')?.opacity, 0);
});

// ══ codex round 3 — the corrective assertions ═══════════════════════════════════════════════════
// Each is written against the DEFECT codex executed, not against the fix.

test('codex r3 M2: restoring opacity keeps every OTHER style field', () => {
  // The fixture's FMA9611 carries `emphasis:'secondary'`; FMA22359 carries `emphasis:'highlight'`.
  const hidden = reduce(withScene(), {type: 'set-opacity', id: 'FMA9611', opacity: 0}).state;
  const mid = decodeScene(hidden.blob).styles.find((s) => s.id === 'FMA9611');
  assert.equal(mid?.opacity, 0);
  assert.equal(mid?.emphasis, 'secondary', 'the sibling field survives the hide');
  const {state} = reduce(hidden, {type: 'set-opacity', id: 'FMA9611', opacity: null});
  const after = decodeScene(state.blob).styles.find((s) => s.id === 'FMA9611');
  // THE DEFECT: the whole entry was dropped, so `emphasis` disappeared when the reader pressed show.
  assert.ok(after, 'the style entry still exists');
  assert.equal(after.opacity, undefined, 'only the opacity is gone');
  assert.equal(after.emphasis, 'secondary', 'and the emphasis is NOT collateral damage');
});

test('codex r3 M2: an entry with nothing left but its id IS dropped', () => {
  // FMA22449 has no style in the fixture, so setting and clearing must leave `styles` as it was.
  const before = withScene();
  const hidden = reduce(before, {type: 'set-opacity', id: 'FMA22449', opacity: 0.5}).state;
  assert.ok(decodeScene(hidden.blob).styles.some((s) => s.id === 'FMA22449'));
  const {state} = reduce(hidden, {type: 'set-opacity', id: 'FMA22449', opacity: null});
  assert.ok(!decodeScene(state.blob).styles.some((s) => s.id === 'FMA22449'),
    'an id-only entry is not carried in the blob');
  assert.equal(state.blob, before.blob, 'and the scene is byte-identical to where it started');
});
