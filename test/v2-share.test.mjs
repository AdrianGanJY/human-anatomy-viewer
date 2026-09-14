/**
 * ══ THE THREE SHARE CONTROLS' CONTRACT — L31 v2.1b+c, S7 ══════════════════════════════════════
 *
 * Adrian found 截图 / 复制链接 / 分享图版 on the live site still carrying their S1 tooltip and doing
 * nothing. Wiring them is three different acts with three different failure modes, and only the
 * pure parts can be asserted here:
 *
 *  · the SNAPSHOT's filename — a name is the only thing a downloaded PNG carries into the folder it
 *    lands in, and a title with a slash in it writes to a DIRECTORY that does not exist (or, on the
 *    browsers that tolerate it, silently truncates to the segment after the last separator).
 *  · the COPY LINK moved to `test/v2-copy-link.test.mjs` when it stopped reading the address bar.
 *  · the PLATE was REMOVED after codex round 27 — see the note where its assertions were.
 *
 * The DOM halves (a real download, a real clipboard, a real new tab) are the sweep's, not this
 * file's: they need a browser, and `scripts/verify-ux.mjs` has one.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pngBlobFrom, snapshotName} from '../app/v2/shell/share.ts';

const AT = new Date(Date.UTC(2026, 8, 14, 3, 7, 9));
/** The local stamp is what a reader compares against their own clock, so the expectation has to be
 *  derived the same way rather than hardcoded to the runner's timezone. */
const STAMP = `${AT.getFullYear()}${String(AT.getMonth() + 1).padStart(2, '0')}${String(AT.getDate()).padStart(2, '0')}-${String(AT.getHours()).padStart(2, '0')}${String(AT.getMinutes()).padStart(2, '0')}`;

// ── the snapshot's filename ──────────────────────────────────────────────────────────────────

test('the snapshot is named after the scene title and the minute it was taken', () => {
  assert.equal(snapshotName({title: 'The hamstring group', ids: ['FMA22356'], at: AT}),
    `the-hamstring-group-${STAMP}.png`);
});

test('a title in Chinese keeps its characters', () => {
  assert.equal(snapshotName({title: '腘绳肌群', ids: [], at: AT}), `腘绳肌群-${STAMP}.png`);
});

test('without a title the snapshot is named after the structures it shows', () => {
  assert.equal(snapshotName({title: '', ids: ['FMA22356', 'FMA22357'], at: AT}),
    `FMA22356-FMA22357-${STAMP}.png`);
});

test('a long selection is named by its first three ids and a count', () => {
  assert.equal(snapshotName({title: '', ids: ['a', 'b', 'c', 'd', 'e'], at: AT}), `a-b-c+2-${STAMP}.png`);
});

test('with neither a title nor a selection the snapshot is still named', () => {
  assert.equal(snapshotName({title: '', ids: [], at: AT}), `anatomy-${STAMP}.png`);
});

test('a path separator in the title cannot become a path in the filename', () => {
  const name = snapshotName({title: 'C7/T1 \\ "the joint": *why*?', ids: [], at: AT});
  for (const ch of ['/', '\\', ':', '*', '?', '"', '<', '>', '|']) {
    assert.ok(!name.includes(ch), `${JSON.stringify(name)} still contains ${ch}`);
  }
  assert.ok(name.endsWith(`-${STAMP}.png`), name);
});

test('a title longer than the cap is truncated, and still carries its stamp', () => {
  const name = snapshotName({title: 'x'.repeat(200), ids: [], at: AT});
  assert.ok(name.length < 80, `${name.length} characters`);
  assert.ok(name.endsWith(`-${STAMP}.png`), name);
});

// ── the copy link: MOVED, and the move is the record ────────────────────────────────────────
//
// Nine assertions about `shareLink` lived here — session flags stripped, a spent fragment dropped,
// an unspent one kept, a percent-encoded key recognised. All of them were about adjudicating the
// ADDRESS BAR, and the planner ruled that out after codex rounds 27 and 28: Copy link serializes
// the controller through `buildQuery` now. The sequences those rows were groping at are in
// `test/v2-copy-link.test.mjs`, stated against the real reducer.

// ── the captured bitmap, as a file ───────────────────────────────────────────────────────────

test('a captured data URL becomes a PNG blob, decoded here rather than fetched', () => {
  // ⚠️ NOT `fetch(dataUrl)`, which is the obvious spelling: S5b shipped `connect-src 'self'
  // https://api.openai.com`, and a `data:` fetch is governed by connect-src — it would be BLOCKED
  // on the live site and work in every local test. Decoding is also simply the truth: there is no
  // request to make.
  const blob = pngBlobFrom(`data:image/png;base64,${Buffer.from('hello').toString('base64')}`);
  assert.equal(blob?.type, 'image/png');
  assert.equal(blob?.size, 5);
});

test('a data URL that is not a PNG is refused rather than mislabelled', () => {
  assert.equal(pngBlobFrom('data:text/html;base64,PHNjcmlwdD4='), null);
  assert.equal(pngBlobFrom(''), null);
  assert.equal(pngBlobFrom('https://h/x.png'), null);
});

// ── the plate: REMOVED, and the removal is the record ────────────────────────────────────────
//
// S7's plate builder and its four assertions are gone. codex round 27 executed the production
// endpoint and the Worker's canonicaliser and showed the control could not work for the person
// pressing it (401 for a browser cookie) and that its `lang` key never reached rendering. The
// remaining plate URL is `atlas.plate()`'s, unchanged since before this increment, and
// `verify-regress` case 7 is still its test.

// ── the inert convention, at its expiry date ─────────────────────────────────────────────────

/**
 * ⚠️ A SOURCE SCAN, NOT ONLY A DOM SCAN, and the difference is the whole reason this test exists.
 *
 * `scripts/verify-ux.mjs` looks for `.v2-inert` and `S<n>` tooltips at all six viewports — but it
 * can only see what is MOUNTED, and the last inert control in this app (the key-pad preference)
 * lives inside the Settings modal, which is closed. A DOM-only guard would have gone green with
 * the defect still on the screen the moment a reader opened Settings: "a guard that cannot fire is
 * not tested".
 */
const SRC = fileURLToPath(new URL('../app/v2/', import.meta.url));
const sources = (dir) => readdirSync(dir, {withFileTypes: true}).flatMap((e) =>
  e.isDirectory() ? sources(`${dir}${e.name}/`) : /\.tsx?$/.test(e.name) ? [`${dir}${e.name}`] : []);

/**
 * Blank out comment CONTENTS, keeping every newline so line numbers survive.
 *
 * ⚠️ A SCANNER, NOT A REGEX — codex round 28, MEDIUM 2, with an executed counterexample. The regex
 * version guarded `//` with `[^:]` so `https://…` inside a string would not eat its line; codex
 * handed it a PROTOCOL-RELATIVE url instead —
 *   `const u = "//h/x"; const P = () => <button className="v2-inert" title="S1"/>;`
 * — and the whole line vanished, hiding a placeholder from the only guard that can see an unmounted
 * one. A `"/*"` inside a string did the same in the other direction. Knowing where a STRING is is
 * the only way to know where a COMMENT is not, so this walks the text once and tracks both.
 */
const stripComments = (text) => {
  const out = [...text];
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  let i = 0;
  while (i < text.length) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      blank(i, stop); i = stop; continue;
    }
    if (c === '/' && d === '/') {
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      blank(i, end); i = end; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      i++;
      while (i < text.length && text[i] !== c) i += text[i] === '\\' ? 2 : 1;
      i++; continue;
    }
    i++;
  }
  return out.join('');
};

test('no control in v2 is still a placeholder — the inert convention is spent', () => {
  const found = [];
  for (const file of sources(SRC)) {
    // ⚠️ COMMENT CONTENTS ARE BLANKED, LINES ARE NOT SKIPPED — codex round 27, MEDIUM 1, with an
    // executed counterexample: `/* pending */ const X = () => <button className="v2-inert"…` on ONE
    // line defeated a line-skipping scan entirely, and with that component unmounted the DOM scan
    // saw nothing either. A placeholder could have survived BOTH guards. Blanking preserves line
    // numbers (a hit still points at its line) while leaving the code beside a comment visible.
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, i) => {
      // The convention is the CLASS plus a group-name tooltip. A true disabled state (the tree's
      // undecidable eye, Ask's empty query) uses `aria-disabled` with a reason and must survive.
      if (/\bv2-inert\b/.test(line) || /title=["']S\d[a-z]?["']/.test(line)) {
        found.push(`${file.slice(SRC.length)}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(found, [], `still inert:\n${found.join('\n')}`);
});

// ── atlas.keypad — the last inert control's RC12 storage contract ────────────────────────────

/**
 * The key-pad preference is the ELEVENTH and last of S0's placeholders. Its segmented control drew
 * `off` as the selected value while the pad was on the screen — a placeholder that was not merely
 * dead but WRONG about the state of the app.
 */
function withKeypadStorage(value, fn) {
  const prev = globalThis.localStorage;
  const store = new Map(value === undefined ? [] : [['atlas.keypad', value]]);
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  };
  try { return fn(store); } finally { globalThis.localStorage = prev; }
}

test('atlas.keypad: a corrupt or unknown mode still renders, as the pad the app has always drawn', async () => {
  const {readKeypad} = await import('../app/v2/shell/store.ts');
  for (const bad of ['"full"', '{', '{"v":2,"mode":"off"}', '{"v":1,"mode":"nope"}', '[]', 'null', '3']) {
    assert.deepEqual(withKeypadStorage(bad, () => readKeypad()), {v: 1, mode: 'full'}, `fallback for ${bad}`);
  }
  assert.deepEqual(withKeypadStorage(undefined, () => readKeypad()), {v: 1, mode: 'full'});
  // …and every valid mode is respected, or the fallback above proves nothing.
  for (const mode of ['off', 'arrows', 'full']) {
    assert.deepEqual(withKeypadStorage(`{"v":1,"mode":"${mode}"}`, () => readKeypad()), {v: 1, mode});
  }
});

test('atlas.keypad: the write is the shape the read accepts, and a throwing store is survivable', async () => {
  const {readKeypad, writeKeypad, KEYPAD_KEY} = await import('../app/v2/shell/store.ts');
  withKeypadStorage(undefined, (store) => {
    writeKeypad({v: 1, mode: 'arrows'});
    assert.equal(store.get(KEYPAD_KEY), '{"v":1,"mode":"arrows"}');
    assert.deepEqual(readKeypad(), {v: 1, mode: 'arrows'}, 'round trip');
  });
  const prev = globalThis.localStorage;
  globalThis.localStorage = {getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }};
  try {
    assert.deepEqual(readKeypad(), {v: 1, mode: 'full'});
    writeKeypad({v: 1, mode: 'off'});
  } finally { globalThis.localStorage = prev; }
});

test('the key-pad rows a mode shows: off draws nothing, arrows drops the letters, full is both', async () => {
  const {padRows} = await import('../app/v2/shell/share.ts');
  assert.deepEqual(padRows('off'), []);
  assert.deepEqual(padRows('arrows').flat().filter(Boolean).map((k) => k.code),
    ['ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  assert.deepEqual(padRows('full').flat().filter(Boolean).map((k) => k.code),
    ['KeyW', 'ArrowUp', 'KeyA', 'KeyS', 'KeyD', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
});

test('the source scan cannot be defeated by a comment on the same line (round 27, M1)', () => {
  // codex's own counterexample, run against the production predicate rather than described.
  const hit = (text) => stripComments(text).split('\n')
    .some((l) => /\bv2-inert\b/.test(l) || /title=["']S\d[a-z]?["']/.test(l));
  assert.equal(hit('/* pending control */ const P = () => <button className="v2-inert" title="S1"/>;'),
    true, 'a leading block comment must not hide the code beside it');
  assert.equal(hit('// a note about v2-inert and title="S1"'), false, 'a real comment is still not code');
  // A jsdoc CONTINUATION line, given with its opener — which is how it always occurs in a real
  // file. (Handed the bare `* …` line alone it would read as code, correctly: a stripper that
  // blanked every line starting with `*` would blank a multiplication.)
  assert.equal(hit('/**\n * `.v2-inert` is retired\n */\nconst x = 1;'), false, 'a jsdoc block is not code');
  // A URL inside a string must not be eaten as a line comment.
  assert.equal(hit('const u = "https://h/x"; const b = <button className="v2-inert"/>;'), true);
  // codex round 28's counterexample: a PROTOCOL-RELATIVE url, which the old `[^:]` guard missed.
  assert.equal(hit('const u = "//h/x"; const P = () => <button className="v2-inert" title="S1"/>;'), true);
  // …and a comment opener inside a string, which must not start a comment either.
  assert.equal(hit('const a = "/*"; const P = () => <button className="v2-inert"/>; const b = "*/";'), true);
  // A real trailing comment after real code still hides only itself.
  assert.equal(hit('const x = 1; // v2-inert'), false);
});

test('no plate control survives anywhere in the source (round 28, MEDIUM 1)', () => {
  // The DOM count can only see what is MOUNTED, and the tablet's plate items lived in an unopened
  // More menu. The same two-instrument shape the inert convention needed: this reads the source.
  const found = [];
  for (const file of sources(SRC)) {
    const text = stripComments(readFileSync(file, 'utf8'));
    text.split('\n').forEach((line, i) => {
      if (/data-act="(plate|copy-plate)"/.test(line) || /onOpenPlate|onCopyPlate|plateLink\(/.test(line)) {
        found.push(`${file.slice(SRC.length)}:${i + 1}  ${line.trim().slice(0, 90)}`);
      }
    });
  }
  assert.deepEqual(found, [], `a plate control survives:\n${found.join('\n')}`);
});
