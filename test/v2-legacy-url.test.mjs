/**
 * THE COLD LEGACY LINK AND THE ENGLISH SINGULAR. L31 v2.1a — the pure halves of two C1 repairs.
 *
 * The end-to-end halves live in scripts/verify-regress.mjs (cases `cold-legacy` and `plural`), which
 * drives a real browser; these are the assertions that can be made without one, and they are the
 * ones that pin the SEMANTICS the browser case can only observe indirectly — in particular that an
 * ABSENT URL key and an EMPTY one are different things.
 *
 * Imported as `.ts`: Node strips types, which is enough for these two modules (neither contains
 * JSX). `app/v2/page.tsx` cannot be imported the same way, which is why `legacySceneState` lives in
 * its own file rather than in the page.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {legacySceneState} from '../app/v2/legacy-url.ts';
import {v2t, V2, V2_ONE} from '../app/v2/copy.ts';

const previous = {
  explode: 0, visible: ['skeletal', 'muscular'], selected: [], isolate: false,
  view: 'three-quarter', rotate: false, reset: 7,
};

test('a legacy link applies view, isolate, explode and system', () => {
  const next = legacySceneState({view: 'side', isolate: true, explode: 0.5, visible: ['skeletal']}, previous);
  assert.equal(next.view, 'side');
  assert.equal(next.isolate, true);
  assert.equal(next.explode, 0.5);
  assert.deepEqual(next.visible, ['skeletal']);
});

test('reset is bumped, or the state changes and the camera does not', () => {
  // app/scene.tsx:378 refits on `s.view !== lastView || s.reset !== lastReset`. A mapping that set
  // `view` without bumping `reset` would still refit (view changed) — but one that set only
  // `isolate` or `explode` would not, and that is the silent half.
  assert.equal(legacySceneState({}, previous).reset, 8);
  assert.equal(legacySceneState({isolate: true}, previous).reset, 8);
});

test('ABSENT keys leave the previous value alone', () => {
  const next = legacySceneState({}, previous);
  assert.equal(next.view, 'three-quarter');
  assert.equal(next.isolate, false);
  assert.equal(next.explode, 0);
  assert.deepEqual(next.visible, ['skeletal', 'muscular']);
});

test('system=none means EMPTY, which is not the same as absent', () => {
  // This is the case `??`/`||` get wrong, and it is a real request: `system=none` is how every
  // isolate-style deep link hides the rest of the body (app/url-state.ts:61).
  const none = legacySceneState({visible: []}, previous);
  assert.deepEqual(none.visible, [], 'system=none must produce an EMPTY visible set');
  const absent = legacySceneState({}, previous);
  assert.deepEqual(absent.visible, ['skeletal', 'muscular']);
});

test('isolate=0 and explode=0 are requests, not absences', () => {
  const on = {...previous, isolate: true, explode: 0.8};
  assert.equal(legacySceneState({isolate: false}, on).isolate, false, 'isolate=0 must switch it off');
  assert.equal(legacySceneState({explode: 0}, on).explode, 0, 'explode=0 must reassemble the body');
});

test('the previous state is not mutated', () => {
  const snapshot = JSON.stringify(previous);
  legacySceneState({view: 'back', visible: []}, previous);
  assert.equal(JSON.stringify(previous), snapshot);
});

// ── the English singular (v21-design.md:912, critic gap 7) ───────────────────────────────────────

test('one piece is singular, everything else is plural', () => {
  assert.equal(v2t('en', 'margin.pieces', {n: '1'}), '1 piece');
  assert.equal(v2t('en', 'margin.pieces', {n: 1}), '1 piece');
  assert.equal(v2t('en', 'margin.pieces', {n: '0'}), '0 pieces');
  assert.equal(v2t('en', 'margin.pieces', {n: '2'}), '2 pieces');
  assert.equal(v2t('en', 'margin.pieces', {n: '2,234'}), '2,234 pieces');
  // A localised thousands separator must not read as 1. `Number('1,024')` is NaN, which is not 1 —
  // the right answer by the right route, and this asserts it stays that way.
  assert.equal(v2t('en', 'margin.pieces', {n: '1,024'}), '1,024 pieces');
});

test('Chinese is untouched — 个部件 is correct for one and for a thousand', () => {
  assert.equal(v2t('zh-Hans', 'margin.pieces', {n: '1'}), '1 个部件');
  assert.equal(v2t('zh-Hant', 'margin.pieces', {n: '1'}), '1 個部件');
  assert.equal(v2t('zh-Hans', 'margin.pieces', {n: '3'}), '3 个部件');
});

test('rail.more is deliberately NOT in the singular table', () => {
  // "1 more" is already correct English. The audit gap asked for every `{n}` string to be checked,
  // and the outcome of checking this one is that it needs nothing — asserted so a later reader does
  // not "complete" the table and change a correct string.
  assert.equal(V2_ONE['rail.more'], undefined);
  assert.equal(v2t('en', 'rail.more', {n: 1}), '1 more');
  assert.equal(v2t('en', 'rail.more', {n: 4}), '4 more');
});

test('every V2_ONE key exists in V2, and keys without a singular are unaffected', () => {
  for (const key of Object.keys(V2_ONE)) {
    assert.ok(V2[key], `V2_ONE has "${key}" but V2 does not — the singular could never be reached`);
  }
  assert.equal(v2t('en', 'search.add', {name: 'femur'}), 'Add femur');
  assert.equal(v2t('en', 'entry.bytes', {done: '1.0', total: '9.1'}), '1.0 of 9.1 MB');
});

test('an unknown key still returns the key, and a missing var still returns its placeholder', () => {
  assert.equal(v2t('en', 'nope.nope'), 'nope.nope');
  assert.equal(v2t('en', 'rail.focus', {}), 'Focus {name}');
});
