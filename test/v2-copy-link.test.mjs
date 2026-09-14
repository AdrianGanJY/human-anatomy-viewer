/**
 * ══ COPY LINK SERIALIZES THE CONTROLLER — L31 v2.1b+c, S7 (planner ruling, after codex 27 + 28) ══
 *
 * THE RULING: Copy link must not depend on the address bar at all.
 *
 * `writeUrlState` is called from a DEBOUNCED effect, so `location.search` is up to 200 ms behind the
 * controller and is briefly wrong after every edit. Three attempts to make reading it safe by
 * WAITING each looked right and each left a hole codex executed:
 *
 *   · a FLUSH — a callback assigned during render closes over that render's state, so it rewrote the
 *     URL with the stale values it was meant to repair;
 *   · a FIELD COMPARISON on `scene`+`select` — `set-view: back` on a bare selection changes NEITHER,
 *     so the wait returned instantly (`Polling timers created: 0`) and copied a link that reopened
 *     `three-quarter`;
 *   · a COMPLETION TOKEN — it can only speak for work that has been SCHEDULED, and the edit and the
 *     click are one synchronous task, so it read equal before the effect had run.
 *
 * A wait cannot fix a derivation that starts from the wrong place. This file asserts the derivation:
 * the controller's state through `buildQuery` — the SAME function `writeUrlState` uses — with no
 * timers anywhere in the test, because there are none in the product.
 *
 * Every sequence below is transcribed from `codex-review-bc-r28.md`.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, reduce} from '../app/v2/controller.ts';
import {buildQuery, canonicalUrl} from '../app/url-state.ts';
import {urlInputsOf} from '../app/v2/url-inputs.ts';
import {DEFAULT_VISIBLE} from '../app/anatomy.ts';
import {encodeScene, normalizeScene} from '../app/scene-codec.js';

const FIELD_INSET = {top: 14, right: 14, bottom: 14, left: 14};
const baseRender = {
  explode: 0, visible: DEFAULT_VISIBLE, selected: [], isolate: false,
  view: 'three-quarter', rotate: false, reset: 0, insets: FIELD_INSET,
};

/**
 * ⚠️ THE PRODUCTION FUNCTION, NOT A TRANSCRIPTION OF IT — codex round 29, HIGH.
 *
 * This used to be a hand-written copy of what `page.tsx` passes, and that is exactly the shape of
 * the defect round 29 found: the copy control and the URL writer each built their own argument list
 * and drifted (`flags: {}` and `snap: false` against the writer's live values). A test that re-types
 * the mapping cannot catch the mapping drifting. `urlInputsOf` is what the page calls, for BOTH
 * paths, and it is what this file calls.
 */
const inputsOf = (c, facts = {}) => urlInputsOf(c, {
  lang: 'en', legacyCaption: {}, stage: false, probe: false, snap: false, ...facts,
});
const copiedFrom = (c, facts) => canonicalUrl('https://h', '/v2/', inputsOf(c, facts));

// ── codex round 28, HIGH 1: a named view changes neither `scene` nor `select` ────────────────

test('HIGH 1 — set-view: back on a bare selection is in the copied link, with no timers anywhere', () => {
  // codex's exact sequence: `/v2/?select=FMA9611` → `set-view: back` → copy pressed 116 ms later.
  // Its measurement against the wait-based version: `Polling timers created: 0 · Copied
  // /v2/?select=FMA9611 · Reopened view: three-quarter`.
  const {state: seeded} = initialState({select: ['FMA9611']}, baseRender);
  assert.equal(seeded.picks.join(','), 'FMA9611', 'the premise: one bare structure');

  const after = reduce(seeded, {type: 'set-view', view: 'back'}).state;
  assert.equal(after.render.view, 'back', 'the premise: the controller took the view');

  const url = copiedFrom(after);
  assert.match(url, /view=back/, 'the copied link must carry the view the controller holds');
  assert.match(url, /select=FMA9611/);
  // ⚠️ AND THE DEFAULT IS STILL OMITTED — the serializer is the writer's, so a link is not
  // suddenly fatter than the address bar it replaces.
  assert.doesNotMatch(copiedFrom(seeded), /view=/, 'three-quarter is the default and stays absent');
});

test('the language and the caption travel too — the other two fields the comparison could not see', () => {
  const scene = normalizeScene({
    mode: 'explore', lang: 'zh-Hans',
    structures: [{id: 'FMA9611', role: 'primary'}],
    camera: {view: 'three-quarter', focus: [], explode: 0},
    caption: {title: '腘绳肌', note: '一行说明', place: 'in'},
  });
  const {state} = initialState({scene, sceneBlob: encodeScene(scene), select: ['FMA9611']}, baseRender);
  const url = copiedFrom(state, {lang: 'zh-Hant'});
  assert.match(url, /lang=zh-Hant/, 'the UI language the reader is in');
  assert.match(url, /title=/, 'and the scene caption');
});

// ── codex round 28, HIGH 2: the fragment, and what "current" means ───────────────────────────

test('HIGH 2 — a cold arrival whose FRAGMENT is authoritative copies the accepted scene, not the query', () => {
  /**
   * codex's sequence: the query carries `scene=<two structures>` from an earlier write while
   * `#%73cene=` carries the authoritative one-structure arrival; the controller ACCEPTED the
   * fragment. Reading the address bar copied the query and reopened `[FMA7485, FMA9611]` against a
   * controller holding `[FMA7485]`.
   *
   * Serializing the controller makes the whole question disappear: there is no fragment to
   * adjudicate, because what the controller holds after acceptance IS the authoritative arrival.
   */
  const stale = normalizeScene({
    mode: 'explore', lang: 'en',
    structures: [{id: 'FMA7485', role: 'primary'}, {id: 'FMA9611', role: 'primary'}],
    camera: {view: 'three-quarter', focus: [], explode: 0}, caption: {title: '', note: ''},
  });
  const authoritative = normalizeScene({
    mode: 'explore', lang: 'en',
    structures: [{id: 'FMA7485', role: 'primary'}],
    camera: {view: 'three-quarter', focus: [], explode: 0}, caption: {title: '', note: ''},
  });
  // The page was re-driven by the fragment: the controller holds the one-structure scene.
  const {state} = initialState(
    {scene: authoritative, sceneBlob: encodeScene(authoritative), select: ['FMA7485']}, baseRender);

  const url = copiedFrom(state);
  const q = new URL(url).searchParams;
  assert.equal(q.get('scene'), encodeScene(authoritative), 'the scene the controller accepted');
  assert.notEqual(q.get('scene'), encodeScene(stale), 'never the one still sitting in the query');
  assert.equal(q.get('select'), 'FMA7485');
  assert.equal(new URL(url).hash, '', 'and no fragment to outrank it on reload');
});

test('the copied link carries the display flags EXACTLY as the writer does — including not at all', () => {
  /**
   * ⚠️ THIS ROW REVERSED AT ROUND 29, deliberately, and the reversal is the fix.
   *
   * It used to assert that a copied link never carries `stage`/`probe`, on the reading that they
   * describe THIS screen rather than the view. That reading is defensible and it is also how the
   * defect got in: the control hardcoded `flags: {}` while the writer passed the live values, and a
   * field the two treat differently is a field that can be wrong. Equivalence is the invariant that
   * can be proved; a per-field judgement call is the one that cannot.
   *
   * So: absent when they are off (the ordinary case, unchanged for every reader), present when the
   * page really is in that mode — and identical to the address bar either way.
   */
  const {state} = initialState({select: ['FMA9611']}, baseRender);
  assert.doesNotMatch(copiedFrom(state), /stage=|probe=/, 'off is off');
  const staged = copiedFrom(state, {stage: true, probe: true});
  assert.match(staged, /stage=1/);
  assert.match(staged, /probe=1/);
});

// ── the refactor is behaviour-preserving ─────────────────────────────────────────────────────

test('buildQuery is the writer\'s own body — the key order and every omission are unchanged', () => {
  // The order is `select, lang, system, isolate, view, explode, snap, title, note, scene, stage,
  // probe`, and it is asserted because a cache key and six plate goldens depend on the spelling.
  const scene = normalizeScene({
    mode: 'explore', lang: 'zh-Hans',
    structures: [{id: 'FMA9611', role: 'primary'}],
    camera: {view: 'back', focus: [], explode: 0.25}, caption: {title: 'T', note: 'N', place: 'in'},
  });
  const q = buildQuery({
    state: {...baseRender, view: 'back', explode: 0.25, isolate: true, visible: ['skeletal']},
    selectIds: ['FMA1', 'FMA2'],
    caption: {title: 'T', note: 'N'},
    lang: 'zh-Hans', flags: {stage: true, probe: true},
    blob: encodeScene(scene), snap: true,
  });
  assert.equal(
    q.split('&').map((kv) => kv.split('=')[0]).join(','),
    'select,lang,system,isolate,view,explode,snap,title,note,scene,stage,probe');
});

test('a plain visit serializes to nothing at all', () => {
  assert.equal(buildQuery({state: baseRender, selectIds: [], caption: {}, lang: 'en', blob: '', snap: false}), '');
  assert.equal(canonicalUrl('https://h', '/v2/', {state: baseRender, selectIds: [], caption: {}, lang: 'en', blob: '', snap: false}),
    'https://h/v2/');
});

// ── the red-proof, pinned permanently ────────────────────────────────────────────────────────

/**
 * ⚠️ EVERY ROW ABOVE EXERCISES THE NEW DERIVATION, so on its own this file would only prove that
 * new code does what it was just written to do. This row asserts the DISAGREEMENT: on the exact
 * state codex used, the ADDRESS BAR and the CONTROLLER say different things, and the serializer
 * follows the controller.
 *
 * It is the same shape `test/v2-visibility.test.mjs` uses for codex round 4's findings — assert
 * what the old reading returned, assert what the new one returns, and assert they differ — so that
 * re-pointing this control at `location.href` goes red with the reason rather than rotting into a
 * comment.
 */
test('RED-PROOF: the address bar and the controller disagree, and the copy follows the controller', () => {
  const {state: seeded} = initialState({select: ['FMA9611']}, baseRender);
  const after = reduce(seeded, {type: 'set-view', view: 'back'}).state;

  // What `location.href` still says inside the 200 ms debounce — codex's own measurement,
  // transcribed: `Copied: /v2/?select=FMA9611`, with no `view`.
  const addressBarDuringDebounce = 'https://h/v2/?select=FMA9611';
  const copied = copiedFrom(after);

  assert.notEqual(copied, addressBarDuringDebounce,
    'if these are ever equal, the control is reading the address bar again');
  assert.doesNotMatch(addressBarDuringDebounce, /view=back/, 'the old source did not carry the edit');
  assert.match(copied, /view=back/, 'the new one does');

  // And the reverse direction: once the writer HAS run, the two agree — so the serializer is not
  // merely different, it is what the writer produces.
  const settledAddressBar = `https://h/v2/?${buildQuery(inputsOf(after))}`;
  assert.equal(copied, settledAddressBar, 'the copy equals what the writer will write');
});

// ── round 29's HIGH: the copy and the writer are ONE argument list ───────────────────────────

/**
 * ⚠️ THE EQUIVALENCE, ASSERTED ACROSS A SET OF STATES — the planner's own test for round 29's HIGH.
 *
 * The defect was two argument lists kept in step by hand: the copy passed `flags: {}` and
 * `snap: false` while the writer passed the live ones, so a non-default render flag was dropped
 * from a shared link and the recipient landed somewhere else. Both paths call `urlInputsOf` now,
 * so the equivalence is structural — and this row is what says so, over every field codex named.
 *
 * `writerQuery` is what the debounced effect will put in the address bar; `copyQuery` is what the
 * control puts on the clipboard. They are the same call, and the RED-PROOF below mutates ONE input
 * to show this row can fail.
 */
const STATES = [
  ['the default view', {}, {}],
  ['view=back', {view: 'back'}, {}],
  ['isolate on', {isolate: true}, {}],
  ['explode 0.6', {explode: 0.6}, {}],
  ['system=muscular', {visible: ['muscular']}, {}],
  ['snap on', {}, {snap: true}],
  ['presentation mode', {}, {stage: true}],
  ['the probe panel', {}, {probe: true}],
  ['a caption', {}, {legacyCaption: {title: 'T', note: 'N'}}],
  ['zh-Hant', {}, {lang: 'zh-Hant'}],
  ['view=back AND snap', {view: 'back'}, {snap: true}],
];

test('round 29 HIGH — the copy and the writer build the SAME query, for every render flag', () => {
  for (const [name, render, facts] of STATES) {
    const {state} = initialState({select: ['FMA9611']}, {...baseRender, ...render});
    // The controller keeps its own `render`, so reach past it for the flags a URL carries but a
    // seed does not set — this is the state the page would be in, not a synthetic one.
    const c = {...state, render: {...state.render, ...render}};
    const inputs = inputsOf(c, facts);
    // ONE object, two destinations: `writeUrlFrom` puts `buildQuery(inputs)` in the address bar,
    // `canonicalUrl` puts it on the clipboard.
    const writerQuery = buildQuery(inputs);
    const copyQuery = new URL(canonicalUrl('https://h', '/v2/', inputs)).search.replace(/^\?/, '');
    assert.equal(copyQuery, writerQuery, `${name}: the copy and the address bar must agree`);
  }
});

test('…and each of those flags really does reach the query (the row is not vacuous)', () => {
  // Without this, the equivalence above would pass just as happily if `buildQuery` ignored
  // everything — two identical empty strings agree perfectly.
  const q = (render, facts) => {
    const {state} = initialState({select: ['FMA9611']}, {...baseRender, ...render});
    return buildQuery(inputsOf({...state, render: {...state.render, ...render}}, facts));
  };
  assert.match(q({view: 'back'}, {}), /view=back/);
  assert.match(q({isolate: true}, {}), /isolate=1/);
  assert.match(q({explode: 0.6}, {}), /explode=0\.60/);
  assert.match(q({visible: ['muscular']}, {}), /system=muscular/);
  assert.match(q({}, {snap: true}), /snap=1/);
  assert.match(q({}, {stage: true}), /stage=1/);
  assert.match(q({}, {probe: true}), /probe=1/);
  assert.match(q({}, {lang: 'zh-Hant'}), /lang=zh-Hant/);
  assert.match(q({}, {legacyCaption: {title: 'T'}}), /title=T/);
});

test('RED-PROOF: mutating ONE input breaks the equivalence, so the row can fail', () => {
  // codex round 29's HIGH, reconstructed: the copy hardcodes `snap: false` while the writer passes
  // the live flag. If anyone reintroduces a second argument list, this is the shape it takes.
  const {state} = initialState({select: ['FMA9611']}, baseRender);
  const writerInputs = inputsOf(state, {snap: true, stage: true});
  const copyInputsAsRound29BuiltThem = {...writerInputs, snap: false, flags: {}};
  assert.notEqual(buildQuery(copyInputsAsRound29BuiltThem), buildQuery(writerInputs),
    'if these are ever equal the assertion above proves nothing');
  assert.doesNotMatch(buildQuery(copyInputsAsRound29BuiltThem), /snap=1|stage=1/, 'what the reader lost');
  assert.match(buildQuery(writerInputs), /snap=1/);
});

test('round 29 MEDIUM — the blob is encoded from the scene, never taken from a cached field', () => {
  // A `state.blob` that is one transaction behind the fields beside it produces a copied link that
  // is indistinguishable from a correct one. `urlInputsOf` encodes from `c.scene`, so a skewed
  // cache cannot reach the URL — asserted by handing it a DELIBERATELY WRONG cached blob.
  const scene = normalizeScene({
    mode: 'explore', lang: 'en',
    structures: [{id: 'FMA9611', role: 'primary'}],
    camera: {view: 'three-quarter', focus: [], explode: 0}, caption: {title: '', note: ''},
  });
  const {state} = initialState({scene, sceneBlob: encodeScene(scene), select: ['FMA9611']}, baseRender);
  const skewed = {...state, blob: 'STALE-CACHED-BLOB'};
  const q = new URLSearchParams(buildQuery(inputsOf(skewed)));
  assert.equal(q.get('scene'), encodeScene(scene), 'the canonical scene, not the cached string');
  assert.notEqual(q.get('scene'), 'STALE-CACHED-BLOB');
});
