/**
 * EFFECTIVE ALPHA — codex round 4's four Highs, as executable assertions. L31 v2.1b+c, S3b.
 *
 * Each case below is codex's OWN counterexample, re-run against the real codec, the real controller
 * and the real atlas. Every one asserts TWO things on purpose:
 *
 *   1. what the renderer actually draws (`partAlphas` / `conceptAlpha` — the fix), and
 *   2. what the OLD control read (the structure's own declaration — the defect),
 *
 * and asserts that (2) DISAGREES with (1). The disagreement assertion is the red-proof, pinned here
 * permanently: if anyone re-points a control at its own declaration, these rows say why that was
 * wrong with the exact numbers codex measured, instead of the fix quietly rotting into a comment.
 *
 * THE OLD READINGS, transcribed verbatim from the round-4 tree:
 *   the member eye   `(scene.styles.find((s) => s.id === row.id)?.opacity ?? 1) > 0`   (tree.tsx:247)
 *   the system eye   `visibleIntent.includes(row.system)`                              (tree.tsx:246)
 *   the slider       `scene.styles.find((s) => s.id === id)?.opacity ?? 1`              (shell.tsx:328)
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {decodeScene, encodeScene, normalizeScene} from '../app/scene-codec.js';
import {sceneDeclaresLang} from '../app/v2/scene-lang.ts';
import {initialState, reduce} from '../app/v2/controller.ts';
import {conceptAlpha, eyeAction, eyeOn, partAlphas, sceneAlphaMap, withSessionHidden} from '../app/v2/visibility.ts';

const FILE = ['dist/models/atlas.json', 'public/models/atlas.json'].find((f) => existsSync(f));
const atlas = FILE ? JSON.parse(readFileSync(FILE, 'utf8')) : null;
const byId = new Map((atlas?.concepts ?? []).map((c) => [c.id, c]));
const partSystem = new Map((atlas?.parts ?? []).map((p) => [p.id, p.system]));
const elementsOf = (id) => byId.get(id)?.elements ?? [id];
const basketOf = (ids) => ids.map((id) => ({id, elements: elementsOf(id)}));

/** The page's whole chain, in one call, so no test re-implements a step of it.
 *  Mirrors `page.tsx`: plate -> renderState -> the renderer's per-part rule. */
function drawn({scene, picks, hidden = new Set(), visible = ['skeletal', 'muscular'], isolate = false}) {
  const basket = basketOf(picks);
  const selected = [...new Set(basket.flatMap((b) => b.elements))];
  const opacity = withSessionHidden(scene ? sceneAlphaMap(scene, basket) : undefined, hidden, elementsOf);
  const alphaOf = partAlphas({opacity, restOpacity: 1, visible, selected, isolate}, partSystem);
  return {
    part: alphaOf,
    concept: (id) => conceptAlpha(alphaOf, elementsOf(id)),
  };
}

/** The round-4 reading, kept so the disagreement is measured rather than asserted from memory. */
const declaredAlpha = (scene, id) => scene?.styles.find((s) => s.id === id)?.opacity ?? 1;

test('the atlas is built — these cases are about REAL shared meshes, not a fixture', () => {
  assert.ok(atlas, 'public/models/atlas.json must exist; run the build before the suite');
  assert.deepEqual(elementsOf('FMA7487'), ['FJ3178'], 'body of sternum is one mesh');
  assert.ok(elementsOf('FMA7485').includes('FJ3178'), 'and the sternum SHARES it — the whole of H3');
  assert.deepEqual(elementsOf('FMA9611'), ['FJ3259', 'FJ3365'], 'femur, codex H1/H2');
});

test('H1 — ticking a session-hidden structure no longer strands its override', () => {
  const scene = normalizeScene({mode: 'render', structures: [{id: 'FMA22359', role: 'primary'}]});
  // Hidden as a NON-MEMBER row, then ticked in. It is now a member row.
  const hidden = new Set(['FMA9611']);
  const after = drawn({scene: normalizeScene({...scene, structures: [...scene.structures, {id: 'FMA9611', role: 'context'}]}),
    picks: ['FMA22359', 'FMA9611'], hidden});
  const truth = after.concept('FMA9611');

  assert.equal(truth, 0, 'the renderer still draws nothing: codex measured FJ3259/FJ3365 at 0');
  assert.equal(after.part('FJ3259'), 0);
  assert.equal(after.part('FJ3365'), 0);
  // THE DEFECT, measured: the old eye read the declaration and said "shown" over two blank meshes.
  const old = declaredAlpha(scene, 'FMA9611') > 0;
  assert.equal(old, true, 'the round-4 reading said shown');
  assert.equal(eyeOn({kind: 'member', visible: [], alpha: truth}), false, 'the fix says what the renderer does');
  assert.notEqual(eyeOn({kind: 'member', visible: [], alpha: truth}), old, 'and the two disagree — that IS the High');

  // And "show" can now reach the override that was stranding it.
  const act = eyeAction({kind: 'member', on: false, visible: []});
  assert.deepEqual(act, {opacity: 1, session: 'clear'});
  const cleared = drawn({scene: normalizeScene({...scene, structures: [...scene.structures, {id: 'FMA9611', role: 'context'}],
    styles: [{id: 'FMA9611', opacity: act.opacity}]}), picks: ['FMA22359', 'FMA9611'], hidden: new Set()});
  assert.equal(cleared.concept('FMA9611'), 1, 'after show: drawn at full alpha');
});

test('H2 — an absent opacity is NOT 100%: roleOpacity.ghost = 0 leaves "show" invisible', () => {
  const scene = normalizeScene({mode: 'render', structures: [{id: 'FMA9611', role: 'ghost'}], roleOpacity: {ghost: 0}});
  const d = drawn({scene, picks: ['FMA9611']});
  assert.equal(d.concept('FMA9611'), 0, 'codex: resolved=0, meshes [["FJ3259",0],["FJ3365",0]]');
  assert.equal(declaredAlpha(scene, 'FMA9611') > 0, true, 'the round-4 eye said shown');
  assert.equal(eyeOn({kind: 'member', visible: [], alpha: d.concept('FMA9611')}), false);

  // The slider half: 0.5 then "100%". Round 4 sent `null`, which REMOVES the entry and inherits
  // roleOpacity.context = 0.55 while the control printed 100%.
  const ctx = normalizeScene({mode: 'render', structures: [{id: 'FMA9611', role: 'context'}], styles: [{id: 'FMA9611', opacity: 0.5}]});
  const removed = normalizeScene({...ctx, styles: []});
  assert.equal(drawn({scene: removed, picks: ['FMA9611']}).concept('FMA9611'), 0.55, 'codex: resolved mesh alpha 0.55');
  assert.equal(declaredAlpha(removed, 'FMA9611'), 1, 'while the round-4 slider reported 100%');
  // The fix: an explicit 1.
  const explicit = normalizeScene({...ctx, styles: [{id: 'FMA9611', opacity: 1}]});
  assert.equal(drawn({scene: explicit, picks: ['FMA9611']}).concept('FMA9611'), 1);
  assert.equal(eyeAction({kind: 'member', on: false, visible: []}).opacity, 1, 'show writes 1, never null');
});

test('H3 — a member eye may not report hidden while a shared mesh is drawn at 1', () => {
  const scene = normalizeScene({
    mode: 'render',
    structures: [{id: 'FMA7485', role: 'primary'}, {id: 'FMA7487', role: 'primary'}],
    styles: [{id: 'FMA7487', opacity: 0}],
  });
  const d = drawn({scene, picks: ['FMA7485', 'FMA7487']});
  assert.equal(d.part('FJ3178'), 1, 'codex: mesh FJ3178 has alpha 1 — the parent keeps its contribution');
  assert.equal(d.concept('FMA7487'), 1, 'so the structure IS on screen');
  assert.equal(declaredAlpha(scene, 'FMA7487'), 0, 'the round-4 eye read 0 and printed "hidden"');
  assert.equal(eyeOn({kind: 'member', visible: [], alpha: d.concept('FMA7487')}), true, 'the fix says shown, because it is');

  // The sternum's OTHER meshes are untouched — the max is per mesh, not per structure.
  assert.equal(d.part('FJ3153'), 1);
  // And with the parent unticked, the same declaration really does hide it.
  const alone = drawn({scene: normalizeScene({mode: 'render', structures: [{id: 'FMA7487', role: 'primary'}], styles: [{id: 'FMA7487', opacity: 0}]}), picks: ['FMA7487']});
  assert.equal(alone.concept('FMA7487'), 0, 'control arm: without the sharer the hide bites');
});

test('H4 — the system eye reads render.visible, and survives a ghost scene reload', () => {
  const ghost = normalizeScene({mode: 'render', structures: [{id: 'FMA22359', role: 'primary'}],
    rest: {include: 'skeletal', opacity: 0.18}});
  const seed = {explode: 0, visible: ['skeletal', 'muscular'], selected: [], isolate: false,
    view: 'three-quarter', rotate: false, reset: 0};
  let st = initialState({visible: ['skeletal', 'muscular']}, {...seed}).state;
  st = reduce(st, {type: 'set-visible', visible: ['muscular', 'nervous']}).state;
  assert.deepEqual(st.visibleIntent, ['muscular', 'nervous']);
  st = reduce(st, {type: 'apply-scene', scene: ghost}).state;

  // The scene's arrival is what makes the two diverge — the control arm for everything below.
  assert.deepEqual(st.render.visible, ['skeletal'], 'the ghost drives the RENDER value');
  assert.deepEqual(st.visibleIntent, ['muscular', 'nervous'], 'and never touches the human set');

  // The round-4 eye read the intent: it said "skeletal hidden" while the skeleton was on screen.
  assert.equal(st.visibleIntent.includes('skeletal'), false, 'the round-4 reading');
  assert.equal(eyeOn({kind: 'system', system: 'skeletal', visible: st.render.visible}), true, 'the fix: it is drawn, so the eye is on');
  assert.equal(eyeOn({kind: 'system', system: 'muscular', visible: st.render.visible}), false);

  // Clicking it acts on the picture, and `set-visible` re-declares the intent — so the next
  // serialisation and the eye agree, which is the half of the High about `system=`.
  const act = eyeAction({kind: 'system', on: true, system: 'skeletal', visible: st.render.visible});
  assert.deepEqual(act.visible, []);
  const off = reduce(st, {type: 'set-visible', visible: act.visible}).state;
  assert.deepEqual(off.render.visible, []);
  assert.deepEqual(off.visibleIntent, []);
  assert.equal(eyeOn({kind: 'system', system: 'skeletal', visible: off.render.visible}), false, 'and it stays off');
});

test('the visibility lane: a structure whose system is off is not drawn, whatever its alpha says', () => {
  const scene = normalizeScene({mode: 'render', structures: [{id: 'FMA9611', role: 'primary'}]});
  // Selected parts are drawn even when their system is off — that is the renderer's own `|| sel`.
  assert.equal(drawn({scene, picks: ['FMA9611'], visible: []}).concept('FMA9611'), 1);
  // But isolate + not selected is not drawn at all.
  const other = drawn({scene, picks: ['FMA9611'], visible: ['skeletal'], isolate: true});
  assert.equal(other.part('FJ3153'), 0, 'a mesh outside the selection under isolate');
});

test('the session override wins over a shared mesh, and clearing it is one call', () => {
  const scene = normalizeScene({mode: 'render', structures: [{id: 'FMA7485', role: 'primary'}, {id: 'FMA7487', role: 'primary'}]});
  const hidden = new Set(['FMA7487']);
  assert.equal(drawn({scene, picks: ['FMA7485', 'FMA7487'], hidden}).part('FJ3178'), 0, 'the override is applied AFTER the max');
  assert.equal(drawn({scene, picks: ['FMA7485', 'FMA7487']}).part('FJ3178'), 1);
  assert.deepEqual(eyeAction({kind: 'session', on: true, visible: []}), {session: 'hide'});
  assert.deepEqual(eyeAction({kind: 'session', on: false, visible: []}), {session: 'clear'});
});

test('withSessionHidden returns a FRESH object, or the GPU never sees the change', () => {
  const base = {FJ3178: 1};
  const out = withSessionHidden(base, new Set(['FMA7487']), elementsOf);
  assert.notEqual(out, base, 'reference equality is scene.tsx:738 change guard');
  assert.equal(base.FJ3178, 1, 'and the input is not mutated');
  assert.equal(withSessionHidden(base, new Set(), elementsOf), base, 'no override: the same object, no re-render');
});

// ══ S3b — `sceneDeclaresLang`: DECLARED vs DEFAULTED ═══════════════════════════════════════════
// The page needs this distinction and the NORMALISED scene cannot carry it: `normalizeScene`
// defaults `lang` to 'en' and `canonicalScene` omits it at the default, so every scene "has" a
// lang. Reading the raw wire object is the only place the truth survives. Additive and read-only:
// these rows also assert that nothing about the serialised form changed.
test('sceneDeclaresLang separates a declared language from the codec default', () => {
  const mute = encodeScene(normalizeScene({structures: [{id: 'FMA7485', role: 'primary'}]}));
  const zh = encodeScene(normalizeScene({structures: [{id: 'FMA7485', role: 'primary'}], lang: 'zh-Hans'}));
  assert.equal(sceneDeclaresLang(mute), false, 'no lang key on the wire');
  assert.equal(sceneDeclaresLang(zh), true);
  // A scene that DECLARED 'en' is indistinguishable, because canonicalScene omits the default.
  // That is a property of the format; the page resolves the tie in the reader's favour.
  const en = encodeScene(normalizeScene({structures: [{id: 'FMA7485', role: 'primary'}], lang: 'en'}));
  assert.equal(en, mute, 'canonicalScene omits lang at the default — the two blobs are identical');
  assert.equal(sceneDeclaresLang(en), false);
  // And the serialised default itself is untouched by this addition.
  assert.equal(decodeScene(mute).lang, 'en', 'normalizeScene still defaults lang to en');
});

test('sceneDeclaresLang never throws, and agrees with decodeScene about what a blob is', () => {
  for (const bad of ['', 'not-a-blob', '!!!', 'a'.repeat(2000), null, undefined, 42, {}, []]) {
    assert.equal(sceneDeclaresLang(bad), false, `declares(${String(bad).slice(0, 20)}) must be false`);
  }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  assert.equal(sceneDeclaresLang(b64([])), false, 'an array is not a scene object');
  assert.equal(sceneDeclaresLang(Buffer.from('not json').toString('base64url')), false);
  // A blob with a language the codec does not accept is NOT a declaration — `pick` discards it
  // anyway, so honouring it would let a junk value beat an explicit `?lang=`.
  const junk = b64({v: 1, s: ['FMA7485'], lang: 'klingon'});
  assert.equal(sceneDeclaresLang(junk), false);
  assert.equal(decodeScene(junk)?.lang, 'en', 'and the codec normalises it to the default');
});
