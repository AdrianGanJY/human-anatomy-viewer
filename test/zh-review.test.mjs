/**
 * Unit tests for the P3r review harness — scripts/zh-apply-grades.mjs guards and
 * scripts/zh-grade.mjs reply parsing. `node --test test/`.
 *
 * These guards are the only thing standing between one bad grader reply and a corrupted
 * dictionary, so they are tested for what they REFUSE, not only for what they accept. A guard
 * that has never been shown to fire is not a guard.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (f) => `file://${join(ROOT, 'scripts', f).replace(/\\/g, '/')}`;

// zh-apply-grades runs its pipeline at import time, so it is imported only for its exports
// AFTER the grades file exists; the pure helpers are re-implemented nowhere else.
const { refuse, lateralityEn, lateralityZh, numbersEn, numbersZh, sameNums } = await import(url('zh-apply-grades.mjs'));
const { parseArray } = await import(url('zh-grade.mjs'));

test('laterality is read off the English, which is the authority', () => {
  assert.equal(lateralityEn('left gluteus medius'), 'left');
  assert.equal(lateralityEn('right first rib'), 'right');
  assert.equal(lateralityEn('gluteus medius'), null);
  assert.equal(lateralityZh('左臀中肌'), 'left');
  assert.equal(lateralityZh('右第1肋'), 'right');
  assert.equal(lateralityZh('臀中肌'), null);
});

test('numbering is extracted from ordinals, digits and vertebral levels alike', () => {
  assert.deepEqual(numbersEn('first rib'), [1]);
  assert.deepEqual(numbersEn('twelfth thoracic vertebra'), [12]);
  assert.deepEqual(numbersEn('C7 vertebra'), [7]);
  assert.deepEqual(numbersEn('2nd posterior intercostal artery'), [2]);
  assert.deepEqual(numbersEn('gluteus medius'), []);
  // Chinese counts both conventions — 第1肋 (shipped) and 第一肋 (textbook).
  assert.deepEqual(numbersZh('第1肋'), [1]);
  assert.deepEqual(numbersZh('第一肋'), [1]);
  assert.deepEqual(numbersZh('第十二胸椎'), [12]);
  assert.deepEqual(numbersZh('第十一肋'), [11]);
  assert.ok(sameNums(numbersEn('twelfth rib'), numbersZh('第12肋')));
});

// ── the refusals: each one must actually fire ───────────────────────────────

test('refuse() lets a genuine correction through', () => {
  assert.equal(refuse('supraspinatus', '棘上肌', '冈上肌'), null);
  assert.equal(refuse('left first rib', '左第一肋', '左第1肋'), null);
});

test('refuse() blocks an empty or unchanged standard', () => {
  assert.match(refuse('supraspinatus', '冈上肌', ''), /no standard/);
  assert.match(refuse('supraspinatus', '冈上肌', '冈上肌'), /identical/);
});

test('refuse() blocks a standard that is not Chinese', () => {
  assert.match(refuse('supraspinatus', '冈上肌', 'supraspinatus muscle'), /no CJK/);
  assert.match(refuse('supraspinatus', '冈上肌', '冈上肌 (supraspinatus)'), /Latin letters/);
});

test('refuse() blocks a rewrite that DROPS laterality — the error a learner cannot catch', () => {
  assert.match(refuse('left gluteus medius', '左臀中肌', '臀中肌'), /laterality none != English left/);
});

test('refuse() blocks a rewrite that FLIPS laterality', () => {
  assert.match(refuse('left gluteus medius', '左臀中肌', '右臀中肌'), /laterality right != English left/);
});

test('refuse() blocks a rewrite that INVENTS laterality the English never had', () => {
  assert.match(refuse('gluteus medius', '臀中肌', '左臀中肌'), /laterality left != English none/);
});

test('refuse() blocks a rewrite whose number drifted', () => {
  assert.match(refuse('first rib', '第1肋', '第2肋'), /numbering \[2\] != English \[1\]/);
  assert.match(refuse('twelfth rib', '第12肋', '第肋'), /numbering \[\] != English \[12\]/);
});

test('refuse() accepts a number written in the other numeral convention', () => {
  assert.equal(refuse('twelfth thoracic vertebra', '第12胸椎', '第十二胸椎'), null);
});

// ── the grader reply parser ─────────────────────────────────────────────────

test('parseArray survives a markdown fence and surrounding prose', () => {
  assert.deepEqual(parseArray('Here you go:\n```json\n[{"i":0,"verdict":"correct"}]\n```\nDone.'), [{ i: 0, verdict: 'correct' }]);
  assert.deepEqual(parseArray('[{"i":1,"verdict":"wrong","standard":"冈上肌"}]'), [{ i: 1, verdict: 'wrong', standard: '冈上肌' }]);
});

test('parseArray throws rather than returning a partial batch', () => {
  assert.throws(() => parseArray('I could not grade these.'), /no JSON array/);
  assert.throws(() => parseArray('{"i":0}'), /no JSON array/);
});
