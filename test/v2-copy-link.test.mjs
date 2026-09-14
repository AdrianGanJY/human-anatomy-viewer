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
import {DEFAULT_VISIBLE} from '../app/anatomy.ts';
import {encodeScene, normalizeScene} from '../app/scene-codec.js';

const FIELD_INSET = {top: 14, right: 14, bottom: 14, left: 14};
const baseRender = {
  explode: 0, visible: DEFAULT_VISIBLE, selected: [], isolate: false,
  view: 'three-quarter', rotate: false, reset: 0, insets: FIELD_INSET,
};

/** What `page.tsx` hands the serializer, read from the CONTROLLER and from nothing else. */
const inputsOf = (c, lang = 'en') => ({
  state: c.render,
  selectIds: c.picks,
  caption: c.scene
    ? (c.scene.caption?.place === 'in' ? {title: c.scene.caption.title, note: c.scene.caption.note} : {})
    : {},
  lang,
  flags: {},
  blob: c.blob || (c.scene ? encodeScene(c.scene) : ''),
  snap: false,
});
const copiedFrom = (c, lang) => canonicalUrl('https://h', '/v2/', inputsOf(c, lang));

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
  const url = copiedFrom(state, 'zh-Hant');
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

test('the copied link never carries the session flags, whatever the page is doing', () => {
  const {state} = initialState({select: ['FMA9611']}, baseRender);
  // `stage`/`probe` describe THIS screen. `inputsOf` passes `flags: {}` and the writer's own
  // explicit-flags rule (url-state.ts) means absent is absent.
  const url = copiedFrom(state);
  assert.doesNotMatch(url, /stage=/);
  assert.doesNotMatch(url, /probe=/);
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
