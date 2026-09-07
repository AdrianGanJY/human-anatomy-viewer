/**
 * The scene codec and the URL plumbing it rides on (L30 P4a). `node --test test/`.
 *
 * The most valuable test in this file is the LAST one. The fork's highest-rated hazard is
 * a URL key that reaches the page but not the renderer's cache key or its warm-tab
 * re-drive: both failures return HTTP 200 with a plausible picture, never an error, so
 * nothing else in the project can catch them. That test enumerates the keys out of the
 * REAL modules and goes red the moment a new one appears without a decision about it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => `file://${join(ROOT, ...p).replace(/\\/g, '/')}`;

const codec = await import(url('app', 'scene-codec.js'));
const {
  SCENE_V, LIMITS, DEFAULTS, normalizeScene, validateScene, canonicalScene,
  encodeScene, decodeScene, structureOpacity, sceneOpacities, sceneSelectIds,
} = codec;
const helpers = await import(url('workers', 'snap', 'src', 'helpers.mjs'));
const { canonical, reDriveHash, parseSize, LEGACY_KEYS, SCENE_KEYS } = helpers;

const HAMSTRINGS = ['FMA22357', 'FMA22438', 'FMA45887'];
const forwardBend = () => ({
  mode: 'render',
  structures: [
    ...HAMSTRINGS.map((id) => ({ id, role: 'primary' })),
    { id: 'FMA16580', role: 'context' }, { id: 'FMA9611', role: 'context' },
    { id: 'FMA16203', role: 'ghost' },
  ],
  camera: { view: 'side', focus: ['FMA16580', 'FMA22357'], padding: 1.35 },
  roleOpacity: { primary: 1, context: 0.4, ghost: 0.08 },
  caption: { title: 'Forward bend', note: 'The pelvis should rotate over the femur first.' },
});

// ── round trip ──────────────────────────────────────────────────────────────

test('a scene survives encode -> decode with every field intact', () => {
  const s = normalizeScene(forwardBend());
  const back = decodeScene(encodeScene(s));
  assert.deepEqual(back, s);
});

test('20 fixtures round-trip, and canonical form is a FIXED POINT', () => {
  const fixtures = [];
  for (let i = 0; i < 20; i++) {
    fixtures.push(normalizeScene({
      ...forwardBend(),
      lang: ['en', 'zh-Hans', 'zh-Hant'][i % 3],
      background: i % 2 ? 'dark' : 'light',
      mode: i % 5 === 0 ? 'explore' : 'render',
      rest: { include: i % 4 === 0 ? 'skeletal' : 'none', opacity: 0.02 * i },
      camera: { view: ['side', 'front', 'back', 'three-quarter'][i % 4], focus: HAMSTRINGS.slice(0, (i % 3) + 1), padding: 1 + i * 0.1 },
      styles: [{ id: 'FMA22357', emphasis: 'highlight', opacity: i / 20 }],
      caption: { title: `t${i}`, note: `n${i}`, place: i % 2 ? 'out' : 'in' },
      size: { w: 960, h: 720 },
      ss: i % 2,
    }));
  }
  for (const f of fixtures) {
    const blob = encodeScene(f);
    const back = decodeScene(blob);
    // The blob is a CACHE KEY, so it carries exactly what the PICTURE depends on. Caption
    // text at place:'out' is shown by the chat client and never drawn on the plate, so it
    // is deliberately absent from the blob — two calls that differ only in their sentence
    // must share one cached picture, which is what burn_caption:false promises.
    const expected = f.caption.place === 'out' ? { ...f, caption: { ...f.caption, title: '', note: '' } } : f;
    assert.deepEqual(back, expected, 'decode(encode(scene)) must be the scene, minus what the picture does not depend on');
    // The fixed point is what makes the blob a correct cache key: re-encoding what came
    // out of the cache key must produce the SAME cache key.
    assert.equal(encodeScene(back), blob, 'encode(decode(blob)) must be the blob');
  }
  assert.equal(new Set(fixtures.map(encodeScene)).size, 20, 'no two distinct scenes may share a blob');
});

test('burn_caption:false really does share one cached picture across different sentences', () => {
  // The promise in the tool description. Same pixels -> same blob -> one metered render.
  const withText = (title) => normalizeScene({ ...forwardBend(), caption: { title, note: `note ${title}`, place: 'out' } });
  assert.equal(encodeScene(withText('A')), encodeScene(withText('B')));
  // ...and burning it in must split the key, because then the pixels really do differ.
  const burned = (title) => normalizeScene({ ...forwardBend(), caption: { title, note: '', place: 'in' } });
  assert.notEqual(encodeScene(burned('A')), encodeScene(burned('B')));
});

test('focus is a SET: naming the same ids in another order is the same picture', () => {
  const a = normalizeScene({ ...forwardBend(), camera: { view: 'side', focus: ['FMA16580', 'FMA22357'] } });
  const b = normalizeScene({ ...forwardBend(), camera: { view: 'side', focus: ['FMA22357', 'FMA16580'] } });
  assert.equal(encodeScene(a), encodeScene(b));
});

test('encodeScene normalizes ANYTHING, including a versioned but raw object', () => {
  assert.equal(typeof encodeScene({ v: 1, structures: ['FMA22357'] }), 'string');
  assert.equal(typeof encodeScene({ structures: [{ id: 'FMA22357' }] }), 'string');
  assert.equal(decodeScene(encodeScene({ v: 1, structures: ['FMA22357'] })).structures[0].id, 'FMA22357');
});

test('semantically identical scenes produce the SAME blob, so they share one cached picture', () => {
  const a = normalizeScene({ structures: [{ id: 'B' }, { id: 'A' }], camera: { view: 'side' } });
  const b = normalizeScene({ structures: [{ id: 'A', role: 'primary' }, { id: 'B', role: 'primary' }], camera: { view: 'side', padding: 1.35 } });
  assert.equal(encodeScene(a), encodeScene(b));
});

test('defaults are DROPPED, so a plain scene stays small enough for a URL', () => {
  const blob = encodeScene(normalizeScene({ structures: [{ id: 'FMA22357' }] }));
  const json = canonicalScene(normalizeScene({ structures: [{ id: 'FMA22357' }] }));
  assert.equal(json, JSON.stringify({ v: SCENE_V, s: ['FMA22357'] }));
  assert.equal(DEFAULTS.ss, 1, 'supersampling is the plate default — a plain scene must not carry ss at all');
  assert.ok(blob.length < 40, `${blob.length} chars`);
  assert.ok(encodeScene(normalizeScene(forwardBend())).length < LIMITS.SCENE_MAX_B64,
    'the PRD section 9 scene must fit the URL budget');
});

test('a corrupt, hostile or future blob decodes to null and NEVER throws', () => {
  for (const bad of ['', 'not base64!!', 'YWJj', '////', 'a'.repeat(LIMITS.SCENE_MAX_B64 + 1), null, 42, undefined]) {
    assert.equal(decodeScene(bad), null, JSON.stringify(bad));
  }
  const future = codec.b64urlEncode(JSON.stringify({ v: 99, s: ['FMA1'] }));
  assert.equal(decodeScene(future), null, 'an unknown version is ignored, not guessed at');
  // A scene with no structures is not a scene.
  assert.equal(decodeScene(codec.b64urlEncode(JSON.stringify({ v: SCENE_V, s: [] }))), null);
});

test('a Chinese caption survives the base64url round trip', () => {
  const s = normalizeScene({ structures: [{ id: 'FMA16580' }], caption: { title: '骨盆前倾', note: '髋关节先动。' } });
  assert.equal(decodeScene(encodeScene(s)).caption.title, '骨盆前倾');
});

// ── resolution ──────────────────────────────────────────────────────────────

test('roles resolve to opacity, and an explicit style beats the role', () => {
  const s = normalizeScene({
    structures: [{ id: 'A', role: 'primary' }, { id: 'B', role: 'context' }, { id: 'C', role: 'ghost' }],
    styles: [{ id: 'C', opacity: 0.5 }],
  });
  // The role defaults are CALIBRATED FOR COVERAGE, not blending — see DEFAULTS.roleOpacity.
  assert.deepEqual(structureOpacity(s), { A: 1, B: DEFAULTS.roleOpacity.context, C: 0.5 });
  assert.equal(DEFAULTS.roleOpacity.context, 0.55);
  assert.equal(DEFAULTS.roleOpacity.ghost, 0.25);
});

test('contextOpacity 0 reproduces isolate exactly — nothing is drawn but the primaries', () => {
  const s = normalizeScene({
    structures: [{ id: 'A', role: 'primary' }, { id: 'B', role: 'context' }],
    roleOpacity: { primary: 1, context: 0, ghost: 0 },
  });
  assert.equal(structureOpacity(s).B, 0);
});

// ── L30 P4a.1: the MODE GATE ────────────────────────────────────────────────
// Adrian opened a render_anatomy link in the explorer and asked "为什么蒙蒙?" — the plate's
// coverage dither had followed the scene into a view you orbit. These are the tests for
// "the same scene, two modes", and the last one is the one that matters: the blob must be
// UNCHANGED, or `mode=render` on the same link would stop ghosting too.

test('explore draws every named structure SOLID; render applies the roles', () => {
  const s = normalizeScene(forwardBend());
  const render = sceneOpacities(s);
  assert.equal(render.render, true);
  assert.deepEqual(render.structures, structureOpacity(s));
  assert.equal(render.structures.FMA16580, 0.4, 'context keeps the scene\'s own number in render mode');
  assert.equal(render.structures.FMA16203, 0.08, 'and so does the ghost');

  const explore = sceneOpacities(normalizeScene({ ...forwardBend(), mode: 'explore' }));
  assert.equal(explore.render, false);
  assert.deepEqual(
    explore.structures,
    Object.fromEntries(sceneSelectIds(s).map((id) => [id, 1])),
    'every structure the scene names — context and ghost included — is drawn at alpha 1',
  );
  assert.equal(Object.keys(explore.structures).length, 6, 'and none of them is dropped');
});

test('an explicit per-structure style does NOT ghost the explorer either', () => {
  // styles[].opacity beats the role in render mode, so it is the other way this could leak.
  const raw = { ...forwardBend(), styles: [{ id: 'FMA16203', opacity: 0.05 }] };
  assert.equal(sceneOpacities(normalizeScene(raw)).structures.FMA16203, 0.05);
  assert.equal(sceneOpacities(normalizeScene({ ...raw, mode: 'explore' })).structures.FMA16203, 1);
});

test('rest:skeletal is a GHOST on a plate and a VISIBILITY switch in the explorer', () => {
  const raw = { ...forwardBend(), rest: { include: 'skeletal', opacity: 0.08 } };
  assert.equal(sceneOpacities(normalizeScene(raw)).rest, 0.08);
  assert.equal(sceneOpacities(normalizeScene({ ...raw, mode: 'explore' })).rest, 1);
  // rest:none is isolate, and its opacity is meaningless in both modes.
  assert.equal(sceneOpacities(normalizeScene(forwardBend())).rest, 1);
});

test('the mode gate does NOT touch the blob — the same link with mode=render still ghosts', () => {
  const raw = forwardBend();
  const explore = normalizeScene({ ...raw, mode: 'explore' });
  // Roles and opacities survive the explore round trip verbatim...
  const back = decodeScene(encodeScene(explore));
  assert.deepEqual(back.structures, normalizeScene(raw).structures);
  assert.deepEqual(back.roleOpacity, normalizeScene(raw).roleOpacity);
  // ...so flipping the one field reproduces the plate's opacities exactly.
  assert.deepEqual(sceneOpacities({ ...back, mode: 'render' }).structures, structureOpacity(normalizeScene(raw)));
});

test('sceneSelectIds is canonical order — the exact string the page will report back', () => {
  const s = normalizeScene(forwardBend());
  assert.deepEqual(sceneSelectIds(s), s.structures.map((x) => x.id));
  assert.deepEqual(sceneSelectIds(s), [...sceneSelectIds(s)].sort(), 'canonical order is sorted by id');
  // Every named structure travels, ghosts included: the page sets ALL of them as picks,
  // and the renderer waits on that exact string.
  assert.equal(sceneSelectIds(s).length, 6);
});

test('MAX_STRUCTURES is pinned to the page SELECT_MAX that silently truncates', () => {
  const src = readFileSync(join(ROOT, 'app', 'url-state.ts'), 'utf8');
  const m = /SELECT_MAX\s*=\s*(\d+)/.exec(src);
  assert.ok(m, 'SELECT_MAX must still be declared in app/url-state.ts');
  assert.equal(LIMITS.MAX_STRUCTURES, Number(m[1]),
    'a scene bigger than SELECT_MAX loses its tail on the page with NO error and renders a confidently wrong picture');
});

// ── validation ──────────────────────────────────────────────────────────────

const errFor = (input) => validateScene(normalizeScene(input));

test('validation refuses what the viewer cannot honour, and names the fix', () => {
  assert.match(errFor({ structures: [] }), /no structures/);
  assert.match(errFor({ structures: Array.from({ length: 25 }, (_, i) => ({ id: `FMA${i}` })) }), /maximum is 24/);
  assert.match(errFor({ structures: [{ id: 'FMA1' }], camera: { focus: ['FMA9'] } }), /focus can only frame structures the scene already carries/);
  assert.match(errFor({ structures: [{ id: 'FMA1' }], camera: { padding: 5 } }), /DISTANCE multiplier, not a percentage/);
  assert.match(errFor({ structures: [{ id: 'FMA1' }], styles: [{ id: 'FMA1', emphasis: 'sparkly' }] }), /unknown emphasis/);
  assert.match(errFor({ structures: [{ id: 'FMA1' }], annotations: [{ type: 'label', target: 'FMA9', text: 'x' }] }), /not in the scene/);
  assert.match(errFor({ structures: [{ id: 'FMA1' }], size: { w: 720, h: 540 } }), /phone layout/);
  assert.equal(errFor(forwardBend()), null);
});

test('normal is an alias for neutral, and curved-arrow for rotation-arrow (the PRD writes both)', () => {
  const s = normalizeScene({
    structures: [{ id: 'A' }],
    styles: [{ id: 'A', emphasis: 'normal' }],
    annotations: [{ type: 'curved-arrow', target: 'A', direction: 'anterior', text: 'Hip hinge' }],
  });
  assert.equal(s.styles[0].emphasis, 'neutral');
  assert.equal(s.annotations[0].type, 'rotation-arrow');
  assert.equal(validateScene(s), null);
});

test('normalize is TOTAL — junk in, a complete scene out, never a throw', () => {
  for (const junk of [null, undefined, 42, 'nope', [], { structures: 'no' }, { camera: 7, styles: [null] }]) {
    const s = normalizeScene(junk);
    assert.equal(s.v, SCENE_V);
    assert.equal(s.camera.padding, DEFAULTS.camera.padding);
    assert.ok(Array.isArray(s.structures));
  }
});

// ── the renderer's two lists ────────────────────────────────────────────────

test('parseSize keeps the plate above the page breakpoints and inside the render bounds', () => {
  assert.deepEqual(parseSize(null), { width: 960, height: 720 });
  assert.deepEqual(parseSize('960x720'), { width: 960, height: 720 });
  assert.deepEqual(parseSize('9999x9999'), { width: 1600, height: 1200 });
});

test('canonical() hashes the blob in the scene branch, so two scenes cannot collide', () => {
  const a = encodeScene(normalizeScene(forwardBend()));
  const b = encodeScene(normalizeScene({ ...forwardBend(), camera: { view: 'front', focus: [] } }));
  assert.notEqual(a, b);
  const ca = canonical(new URLSearchParams({ scene: a, select: 'X', size: '960x720' }));
  const cb = canonical(new URLSearchParams({ scene: b, select: 'X', size: '960x720' }));
  assert.notEqual(ca, cb, 'two different scenes must never share one R2 entry');
  // Order in the query string must not change the key.
  assert.equal(ca, canonical(new URLSearchParams({ size: '960x720', select: 'X', scene: a })));
});

test('canonical() in the scene branch IGNORES the legacy keys — they live inside the blob', () => {
  const a = encodeScene(normalizeScene(forwardBend()));
  const withNoise = canonical(new URLSearchParams({ scene: a, select: 'X', title: 'ignored', view: 'front', lang: 'zh-Hans' }));
  const clean = canonical(new URLSearchParams({ scene: a, select: 'X' }));
  assert.equal(withNoise, clean);
});

test('reDriveHash carries the scene into a warm tab', () => {
  const blob = encodeScene(normalizeScene(forwardBend()));
  const hash = reDriveHash(new URLSearchParams({ scene: blob, select: 'A,B' }));
  const p = new URLSearchParams(hash.slice(1));
  assert.equal(p.get('scene'), blob);
  assert.equal(p.get('select'), 'A,B');
  assert.equal(p.get('snap'), '1');
});

test('reDriveHash writes the P4 aliases EXPLICITLY so a warm tab can be reset', () => {
  const p = new URLSearchParams(reDriveHash(new URLSearchParams({ select: 'A' })).slice(1));
  for (const k of ['mode', 'focus', 'contextOpacity']) {
    assert.equal(p.get(k), '', `${k} must be written empty, not omitted`);
  }
});

test('a LEGACY re-drive can get a warm tab OUT of a scene', () => {
  // The other direction of the top hazard: without an explicit clear, the blob survives in
  // the tab's own query string, the page takes its authoritative scene branch, ignores every
  // legacy key in this hash, and the PREVIOUS picture is cached under the new key.
  const p = new URLSearchParams(reDriveHash(new URLSearchParams({ select: 'A', view: 'back' })).slice(1));
  assert.equal(p.get('scene'), '', 'the legacy branch must clear the scene explicitly');
  // ...and the page must READ that as a clear, not merely fail to find a blob.
  const src = readFileSync(join(ROOT, 'app', 'url-state.ts'), 'utf8');
  assert.match(src, /clearScene\s*=\s*true/, 'app/url-state.ts must treat an empty scene= as a clear');
});

/**
 * THE FOUR-PLACES SUPERSET TEST.
 *
 * Every key the PAGE reads must either be part of the renderer's cache key or be an
 * explicitly justified exclusion. A key that reaches the page but not `canonical()` makes
 * two different pictures share one R2 entry; one that reaches the page but not
 * `reDriveHash()` makes a reused tab render the previous request's value. Both are HTTP
 * 200 with a plausible picture. This is the only check in the project that can go RED for
 * either, and it reads the key list out of the real source rather than a copy of it.
 */
test('every URL key the page reads is in the renderer cache key, or excluded on purpose', () => {
  const src = readFileSync(join(ROOT, 'app', 'url-state.ts'), 'utf8');
  const merge = src.slice(src.indexOf('function merge('), src.indexOf('function synthesize('));
  const keys = [...new Set([...merge.matchAll(/p\.get\('([A-Za-z]+)'\)/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 9, `expected the merge() key list, found ${keys.join(',')}`);

  // Deliberate exclusions, each with the reason it is safe. Adding a key here is a
  // DECISION; forgetting to add one anywhere is what this test exists to catch.
  const EXCLUDED = {
    // Always set by the renderer itself on every snapshot URL, never varied.
    snap: 'the renderer always sets snap=1; it can never differ between two requests',
    // P2 economics: snap mode hides all chrome, so the PNG is identical in all three
    // languages and keeping lang would split the cache three ways for one picture.
    // (In the SCENE branch lang lives inside the blob, so it IS hashed there.)
    lang: 'dropped from every legacy snapshot URL on purpose; inside the blob in the scene branch',
    // A scene is carried by `scene=`; this is only ever read back off the live page.
    scene: 'IS the scene branch key',
  };
  const legacy = new Set(LEGACY_KEYS);
  for (const k of keys) {
    if (EXCLUDED[k]) continue;
    assert.ok(legacy.has(k), `URL key "${k}" is parsed by the page but missing from the renderer's cache key (workers/snap/src/helpers.mjs LEGACY_KEYS) — two different pictures would share one R2 entry`);
  }
  // ...and the re-drive must be able to say something about each of them, or a warm tab
  // keeps the previous request's value.
  const redriven = new URLSearchParams(reDriveHash(new URLSearchParams({ select: 'A' })).slice(1));
  for (const k of keys) {
    if (EXCLUDED[k] || k === 'system') continue; // `system` is written only when present
    assert.ok(redriven.has(k), `URL key "${k}" is parsed by the page but never written by reDriveHash() — a reused tab would keep the PREVIOUS request's value`);
  }
  assert.deepEqual(SCENE_KEYS, ['scene', 'select', 'size']);
});
