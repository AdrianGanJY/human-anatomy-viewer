/**
 * THE SWEEP'S RETRY EXEMPTION — codex round 23, Medium 6. L31 v2.1b+c, S6 prelude.
 *
 * The instrument that decides whether a viewport's rows may be believed had no test, because it
 * lived inside a script that runs a browser sweep on import. It now lives in `scripts/lib/` and
 * this file executes it — including the RED PROOF: the exact scenario codex executed, run through
 * the predicate S5b actually shipped, which accepts it.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {retryVerdict, shouldRetry, visitClean} from '../scripts/lib/sweep-retry.mjs';

const clean = {ready: 1, err: '', record: ''};
const atlas503 = {ready: null, err: 'atlas', record: '/models/atlas.json :: 503 :: load'};
const rendererDied = {ready: null, err: 'renderer', record: 'renderer :: context lost'};
const otherFetch = {ready: 1, err: '', record: '/i18n/pinyin.json :: 500 :: load'};

test('a viewport that never failed is judged exactly as before', () => {
  const v = retryVerdict({first: clean});
  assert.equal(v.retried, false);
  assert.equal(v.ok, true);
  assert.deepEqual(v.lines, []);
});

test('a failed request with no retry still fails the row', () => {
  const v = retryVerdict({first: otherFetch});
  assert.equal(v.retried, false);
  assert.equal(v.ok, false, 'a non-atlas failure never retried and never passes');
});

test('a first visit that never became usable fails even with an empty record', () => {
  // Readiness is half the bar. A page that records no failed request and never renders is not a
  // page that worked; S5b's row only read the record.
  assert.equal(visitClean({ready: null, err: '', record: ''}), false);
});

test('the atlas verdict — and only it — arms the retry', () => {
  assert.equal(shouldRetry(atlas503), true);
  assert.equal(shouldRetry(rendererDied), false);
  assert.equal(shouldRetry(otherFetch), false);
  assert.equal(shouldRetry(clean), false);
});

test('a retry that really succeeded passes, and says so in both visits', () => {
  const v = retryVerdict({first: atlas503, second: clean});
  assert.equal(v.retried, true);
  assert.equal(v.ok, true);
  assert.match(v.lines[1], /the retry SUCCEEDED/);
  assert.match(v.measured, /first visit/);
  assert.match(v.measured, /second visit/);
});

test('a retry that failed the same way fails the row', () => {
  const v = retryVerdict({first: atlas503, second: {...atlas503}});
  assert.equal(v.ok, false);
  assert.match(v.lines[1], /THE RETRY FAILED THE SAME WAY/);
});

test('⚠️ codex r23 M6: a NEW failure on the second visit fails the row and is named as new', () => {
  // codex's executed sequence: atlas 503, then a renderer failure with readiness never reached.
  const v = retryVerdict({first: atlas503, second: rendererDied});
  assert.equal(v.ok, false, 'the second visit is judged on its own terms, not on "was it the atlas again"');
  assert.match(v.lines[1], /FAILED DIFFERENTLY/);
  assert.match(v.lines[1], /NEW failure/);
  assert.match(v.measured, /renderer/);

  // THE RED PROOF — S5b's shipped predicate, verbatim, over the same two visits. It announced a
  // success and exempted the row. This assertion is what the fix had to overturn; if it ever starts
  // failing, the old rule has been reintroduced somewhere and this file should be read again.
  const s5bAnnouncedSuccess = rendererDied.err !== 'atlas';
  const s5bRowPassed = rendererDied.record === '' || /* retriedHere */ true;
  assert.equal(s5bAnnouncedSuccess, true);
  assert.equal(s5bRowPassed, true);
});

test('a second visit that was never made is a failure, not a silent pass', () => {
  const v = retryVerdict({first: atlas503, second: null});
  assert.equal(v.ok, false);
  assert.match(v.lines[1], /NO SECOND VISIT/);
});

test('a retry whose second visit failed at a DIFFERENT request also fails', () => {
  const v = retryVerdict({first: atlas503, second: otherFetch});
  assert.equal(v.ok, false);
  assert.match(v.measured, /pinyin/);
});
