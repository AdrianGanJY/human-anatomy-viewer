/**
 * L31 v2 — scene-first chunk ORDER.
 *
 * The loading claim is entirely "which chunk is fetched first", so it is asserted here in
 * milliseconds rather than only inside a headless render that costs 33 MB and four minutes.
 * The last test runs against the REAL deployed atlas, because the interesting property — that
 * every benchmark scene needs 3 or 4 of 15 chunks and that the shared 0..14 cursor fetches them
 * LAST — is a property of the data, not of the function.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {orderChunks} from '../app/scene-chunks.ts';

const atlasPath = fileURLToPath(new URL('../public/models/atlas.json', import.meta.url));

const toy = {
  chunks: [{}, {}, {}, {}],
  parts: [
    {id: 'p0', chunk: 0}, {id: 'p1', chunk: 1}, {id: 'p2', chunk: 2},
    {id: 'p3', chunk: 3}, {id: 'p3b', chunk: 3},
  ],
  concepts: [{id: 'C1', elements: ['p1', 'p3']}, {id: 'CEMPTY', elements: []}],
};

test('no priority ⇒ today\'s 0..N cursor, byte-for-byte, and an EMPTY rest', () => {
  // This is the v1 path and it must be indistinguishable from the code it replaced. An empty
  // `rest` is also what stops the barrier firing early on `/`, where nothing listens for it.
  assert.deepEqual(orderChunks(toy, undefined), {first: [0, 1, 2, 3], rest: []});
  assert.deepEqual(orderChunks(toy, []), {first: [0, 1, 2, 3], rest: []});
});

test('a CONCEPT id expands to its meshes\' chunks', () => {
  assert.deepEqual(orderChunks(toy, ['C1']), {first: [1, 3], rest: [0, 2]});
});

test('a bare PART id is honoured, not dropped', () => {
  // A scene may name a single mesh; `sceneSelectIds` carries either vocabulary.
  assert.deepEqual(orderChunks(toy, ['p2']), {first: [2], rest: [0, 1, 3]});
});

test('the two phases PARTITION the chunk list — nothing fetched twice, nothing dropped', () => {
  const {first, rest} = orderChunks(toy, ['C1', 'p2']);
  assert.deepEqual([...first, ...rest].sort((a, b) => a - b), [0, 1, 2, 3]);
  assert.equal(new Set([...first, ...rest]).size, 4);
});

test('order is ASCENDING and independent of the caller\'s argument order', () => {
  // The canonical scene blob is the render cache key; an ordering that moved with the caller
  // would make two identical scenes fetch differently and reason about differently.
  assert.deepEqual(orderChunks(toy, ['C1', 'p2']), orderChunks(toy, ['p2', 'C1']));
  assert.deepEqual(orderChunks(toy, ['p3', 'p0']).first, [0, 3]);
});

test('ids this atlas has never heard of DEGRADE to today\'s order, not to an empty first phase', () => {
  // A stale link must still load the body. An empty `first` would fire the barrier against a
  // blank canvas — a worse failure than no barrier at all.
  assert.deepEqual(orderChunks(toy, ['FMA-nope', 'CEMPTY']), {first: [0, 1, 2, 3], rest: []});
});

test('the §9 forward-bend scene needs 4 of 15 chunks, and the OLD cursor fetched them last', () => {
  const atlas = JSON.parse(readFileSync(atlasPath, 'utf8'));
  const ids = ['FMA22359', 'FMA22449', 'FMA16580', 'FMA9611', 'FMA16203'];
  const {first, rest} = orderChunks(atlas, ids);
  assert.equal(atlas.chunks.length, 15);
  assert.deepEqual(first, [1, 11, 12, 13], 'the measured chunk set for this scene (audit-current.md:26)');
  assert.equal(first.length + rest.length, 15);

  const bytes = (list) => list.reduce((n, i) => n + (atlas.chunks[i].gzipBytes ?? atlas.chunks[i].bytes), 0);
  const total = bytes([...first, ...rest]);
  assert.equal(total, 32956129, 'the "33 MB"');
  assert.equal(bytes(first), 9053527);
  // THE CLAIM, as a ratio rather than a millisecond: 27.5% of the download.
  assert.ok(bytes(first) / total < 0.28, `${(bytes(first) / total * 100).toFixed(1)}%`);

  // AND THE REASON IT IS WORTH DOING: under the old shared 0..14 cursor the scene is not
  // complete until chunk 13, i.e. after 14 of 15 chunks — so scene-complete cost ~100% of the
  // download for a scene that needs 27.5%. That is the whole finding, and it lives in the data.
  assert.equal(Math.max(...first), 13);
  const underOldOrder = bytes(Array.from({length: Math.max(...first) + 1}, (_, i) => i));
  assert.ok(underOldOrder / total > 0.95, `${(underOldOrder / total * 100).toFixed(1)}% under the old order`);
});

test('every benchmark scene needs 3 or 4 chunks — the 20.4%–27.5% band, re-derived here', () => {
  const atlas = JSON.parse(readFileSync(atlasPath, 'utf8'));
  const scenes = {
    'forward-bend': ['FMA22357', 'FMA22438', 'FMA45887', 'FMA16580', 'FMA9611', 'FMA16203'],
    'rotator-cuff': ['FMA9629', 'FMA32546', 'FMA32550', 'FMA13413', 'FMA13394', 'FMA13303'],
    spine: ['FMA13478', 'FMA10446', 'FMA16202'],
    // The FULL sets the audit resolved, not abbreviations of them: a shortened knee set spans 2
    // chunks and the band assertion failed on my own fixture, not on the code (caught first run).
    knee: ['FMA9611', 'FMA24476', 'FMA24479', 'FMA24485', 'FMA22429', 'FMA45950', 'FMA22590', 'FMA51048'],
    'hip-flexors': ['FMA18060', 'FMA22310', 'FMA22430', 'FMA22423', 'FMA22353', 'FMA16580', 'FMA9611', 'FMA16203'],
  };
  const total = atlas.chunks.reduce((n, c) => n + (c.gzipBytes ?? c.bytes), 0);
  for (const [name, ids] of Object.entries(scenes)) {
    const {first} = orderChunks(atlas, ids);
    assert.ok(first.length >= 3 && first.length <= 4, `${name}: ${first.length} chunks`);
    const share = first.reduce((n, i) => n + (atlas.chunks[i].gzipBytes ?? atlas.chunks[i].bytes), 0) / total;
    assert.ok(share >= 0.2 && share <= 0.28, `${name}: ${(share * 100).toFixed(1)}%`);
  }
});

test('rest:"skeletal" would ERASE the win — the conflict the plan flags, asserted', () => {
  // Ghost context spans 9 of 15 chunks (61.5%). This test exists so that adding a skeletal ghost
  // to the default scene shape fails HERE rather than silently making the loading story false.
  const atlas = JSON.parse(readFileSync(atlasPath, 'utf8'));
  const skeletal = atlas.parts.filter((p) => p.system === 'skeletal').map((p) => p.id);
  const {first} = orderChunks(atlas, skeletal);
  assert.ok(first.length >= 9, `skeletal spans ${first.length} chunks`);
});
