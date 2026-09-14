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
 *  · the COPY LINK's URL — it has to be the scene the reader is looking at, and it must not carry
 *    the presentation flags, which are about THIS session's screen and not about the view.
 *  · the PLATE's URL — `/api/snap` defaults `lang` to `en` (workers/snap/src/helpers.mjs:145), so a
 *    简体 reader who shares a plate today ships an ENGLISH picture of their Chinese view.
 *
 * The DOM halves (a real download, a real clipboard, a real new tab) are the sweep's, not this
 * file's: they need a browser, and `scripts/verify-ux.mjs` has one.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pngBlobFrom, plateLink, shareLink, snapshotName} from '../app/v2/shell/share.ts';

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

// ── the copy link ────────────────────────────────────────────────────────────────────────────

test('the copied link is the address the page has written for its scene', () => {
  assert.equal(shareLink('https://anatomy.adrian.my/v2/?select=FMA1,FMA2&lang=zh-Hans&scene=abc'),
    'https://anatomy.adrian.my/v2/?select=FMA1,FMA2&lang=zh-Hans&scene=abc');
});

test('the copied link drops the presentation flags, which are about this screen and not the view', () => {
  assert.equal(shareLink('https://h/v2/?select=FMA1&scene=abc&stage=1&probe=1'),
    'https://h/v2/?select=FMA1&scene=abc');
});

test('the copied link drops a spent scene hash that would outrank its own query', () => {
  assert.equal(shareLink('https://h/v2/?select=FMA1&scene=new#scene=old'),
    'https://h/v2/?select=FMA1&scene=new');
});

test('a spent hash is recognised through the parser, not through the raw text', () => {
  assert.equal(shareLink('https://h/v2/?scene=new#%73cene=old'), 'https://h/v2/?scene=new');
});

test('a fragment that is not ours is left alone', () => {
  assert.equal(shareLink('https://h/v2/?scene=new#section-2'), 'https://h/v2/?scene=new#section-2');
});

test('a bare visit copies as a bare visit', () => {
  assert.equal(shareLink('https://h/v2/'), 'https://h/v2/');
});

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

// ── the plate ────────────────────────────────────────────────────────────────────────────────

test('the plate link is the one the renderer answers, and it is unchanged in English', () => {
  assert.equal(plateLink({origin: 'https://h', ids: ['FMA1', 'FMA2'], blob: 'abc', lang: 'en'}),
    'https://h/api/snap?select=FMA1,FMA2&scene=abc&snap=1');
});

test('the plate link carries the reader language, because /api/snap defaults to English', () => {
  assert.equal(plateLink({origin: 'https://h', ids: ['FMA1'], blob: 'abc', lang: 'zh-Hant'}),
    'https://h/api/snap?select=FMA1&scene=abc&snap=1&lang=zh-Hant');
});

test('a plate of a bare selection carries no scene', () => {
  assert.equal(plateLink({origin: 'https://h', ids: ['FMA1'], blob: '', lang: 'en'}),
    'https://h/api/snap?select=FMA1&snap=1');
});

test('the plate link carries a size when one is asked for', () => {
  assert.equal(plateLink({origin: 'https://h', ids: ['FMA1'], blob: '', lang: 'en', size: '1200x900'}),
    'https://h/api/snap?select=FMA1&snap=1&size=1200x900');
});

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

test('no control in v2 is still a placeholder — the inert convention is spent', () => {
  const found = [];
  for (const file of sources(SRC)) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // COMMENTS ARE SKIPPED, and that is not a loophole: the retirement has to be EXPLAINED
      // somewhere, and the explanation names the class it retired. Code is what this scans.
      if (/^\s*(\/\/|\/?\*)/.test(line)) return;
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
