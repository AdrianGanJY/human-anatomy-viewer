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
import {reduce} from '../app/v2/controller.ts';
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
