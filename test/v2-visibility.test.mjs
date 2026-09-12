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
import {alphaCause, conceptAlpha, eyeAction, eyeOn, partAlphas, sceneAlphaMap, withSessionHidden} from '../app/v2/visibility.ts';

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
  /**
   * ⚠️ REWRITTEN AT ROUND 5, AND THE SUITE IS WHAT CAUGHT IT. This row used to establish the intent
   * with a `set-visible` CLICK and then assert that the ghost overrode it — i.e. it asserted the
   * exact behaviour round 5's High calls a defect, and it went red the moment the High was fixed.
   * That is the correction-hides-the-next-defect shape, landing in my own test.
   *
   * The reading claim it makes is still real, so it is re-pointed at the case where the divergence
   * legitimately exists: a ghost scene arriving at a page where the human has NEVER SPOKEN. The
   * intent then falls back to the render seed, the ghost drives the render value (it may), and the
   * two diverge — which is what the eye has to describe honestly. The case where the human HAS
   * spoken is the row below.
   */
  let st = initialState({}, {explode: 0, visible: ['muscular', 'nervous'], selected: [],
    isolate: false, view: 'three-quarter', rotate: false, reset: 0}).state;
  assert.equal(st.intentExplicit ?? false, false, 'nobody has said anything about systems');
  assert.deepEqual(st.visibleIntent, ['muscular', 'nervous'], 'the intent falls back to the seed');
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
  const act = eyeAction({kind: 'system', on: true, system: 'skeletal',
    visible: st.render.visible, intent: st.visibleIntent});
  assert.deepEqual(act.visible, [], 'the click acts on the DRAWN set');
  assert.deepEqual(act.intent, ['muscular', 'nervous'], 'and leaves an intent that never named it alone');
  const off = reduce(st, {type: 'set-visible', visible: act.visible, intent: act.intent}).state;
  assert.deepEqual(off.render.visible, []);
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

// ══ S3b ROUND 5 — the High, and the Mediums that were product defects ═════════════════════════
// Round 5's High is the half of round 4's H4 that S3b MISSED: the READING was corrected and the
// PERSISTENCE was not, and an honest eye made the persistence defect visible instead of hiding it.
// The round-4 unit row never executed a reload, so it could not have caught this — that row asserts
// what the eye SAYS; these assert what SURVIVES.

const SEED = () => ({explode: 0, visible: ['skeletal'], selected: [], isolate: false,
  view: 'three-quarter', rotate: false, reset: 0});

/** A reload, reconstructed through the real chain: serialise -> parse -> seed -> apply the scene.
 *  Not a browser reload; the browser half is verify-ux.mjs's new reload rows. */
function reload({scene, visible, intentExplicit}) {
  const seeded = initialState(
    {scene, sceneBlob: encodeScene(scene), visible, select: scene.structures.map((s) => s.id)},
    {...SEED(), visible: visible ?? ['skeletal']},
  ).state;
  assert.equal(seeded.intentExplicit ?? false, intentExplicit,
    'the premise: a URL `system=` key is what marks the intent explicit');
  return reduce(seeded, {type: 'apply-scene', scene}).state;
}

const GHOST = () => normalizeScene({mode: 'render', structures: [{id: 'FMA22359', role: 'primary'}],
  rest: {include: 'skeletal', opacity: 0.18}});

test('round 5, the High — a system the reader hid SURVIVES a reload of their own link', () => {
  const ghost = GHOST();

  // THE DEFECT, with codex's own numbers: no explicit `system=`, so the ghost branch fires and the
  // reader's empty set comes back as ['skeletal'] — FJ3259 at 0.18 under an eye reading "shown".
  const noStatement = reload({scene: ghost, visible: undefined, intentExplicit: false});
  assert.deepEqual(noStatement.render.visible, ['skeletal'],
    'a PLAIN ghost link still ghosts the skeleton — the branch keeps working');

  // THE FIX: the same reload of a URL that also carries `system=` (an EMPTY set is what "I hid
  // everything" serialises to) leaves the reader's statement alone.
  const withStatement = reload({scene: ghost, visible: [], intentExplicit: true});
  assert.deepEqual(withStatement.render.visible, [], 'codex measured ["skeletal"] here');
  assert.deepEqual(withStatement.visibleIntent, []);
  assert.equal(eyeOn({kind: 'system', system: 'skeletal', visible: withStatement.render.visible}), false,
    'and the eye still reports hidden, because it still IS');

  // An explicit NON-empty set survives too — the flag is about "has the human spoken", not emptiness.
  const kept = reload({scene: ghost, visible: ['muscular'], intentExplicit: true});
  assert.deepEqual(kept.render.visible, ['muscular']);
});

test('round 5, the High — a CLICK is a statement, so the next scene arrival cannot undo it', () => {
  const ghost = GHOST();
  // ⚠️ NO `system=` IN THE SEED. After the High, the ghost may only drive the render value while
  // nobody has spoken — which is exactly the premise this row needs, and getting it wrong was how
  // the first draft of this test failed against its own fix.
  let st = initialState({}, {...SEED(), visible: ['skeletal', 'muscular']}).state;
  assert.equal(st.intentExplicit ?? false, false, 'the premise');
  st = reduce(st, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(st.render.visible, ['skeletal'], 'the ghost drove the render value (it may)');
  // The reader hides it. That click is the human speaking.
  const act = eyeAction({kind: 'system', on: true, system: 'skeletal', visible: st.render.visible, intent: st.visibleIntent});
  st = reduce(st, {type: 'set-visible', visible: act.visible, intent: act.intent}).state;
  assert.equal(st.intentExplicit, true);
  // The SAME scene re-driven (a hashchange, window.atlas.applyScene, a tab) must not restore it.
  st = reduce(st, {type: 'apply-scene', scene: ghost, redrive: true}).state;
  /**
   * THE CLAIM IS ABOUT THE SKELETON, not about the whole set, and the difference is worth stating.
   * codex measured `['skeletal']` coming back. It does not any more. What the re-drive DOES restore
   * is the rest of the reader's own intent (`['muscular']` here, which was in their set all along
   * and which they never touched) — because after a statement the arrival falls back to the intent
   * instead of the ghost. So the assertion is the one the reader would make: the thing I hid is
   * still hidden.
   */
  assert.ok(!st.render.visible.includes('skeletal'), 'codex: ["skeletal"] came back');
  assert.deepEqual(st.visibleIntent, ['muscular'], 'and the click removed it from the intent too');
});

test('round 5, Medium 6 — one system click PATCHES the intent, it does not replace it', () => {
  const ghost = GHOST();
  // The intent comes from the SEED, not a click: a click is now a STATEMENT, and after the High a
  // statement stops the ghost overriding — so a clicked intent cannot produce the divergence this
  // row is about. The reachable divergence is the DEFAULT set against a ghost.
  let st = initialState({}, {...SEED(), visible: ['muscular', 'nervous']}).state;
  st = reduce(st, {type: 'apply-scene', scene: ghost}).state;
  assert.deepEqual(st.render.visible, ['skeletal'], 'the premise: render and intent diverge');
  assert.deepEqual(st.visibleIntent, ['muscular', 'nervous']);
  // Before the fix the intent was recomputed from the EFFECTIVE set, so this click produced
  // ['skeletal','digestive'] and BOTH earlier preferences disappeared. codex's exact case.
  const act = eyeAction({kind: 'system', on: false, system: 'digestive',
    visible: st.render.visible, intent: st.visibleIntent});
  assert.deepEqual(act.visible, ['skeletal', 'digestive'], 'the click acts on what is DRAWN');
  assert.deepEqual(act.intent, ['muscular', 'nervous', 'digestive'], 'and PATCHES what the human chose');
  const after = reduce(st, {type: 'set-visible', visible: act.visible, intent: act.intent}).state;
  assert.deepEqual(after.visibleIntent, ['muscular', 'nervous', 'digestive']);
  // Turning it back off removes only that one, from the intent.
  const off = eyeAction({kind: 'system', on: true, system: 'digestive',
    visible: after.render.visible, intent: after.visibleIntent});
  assert.deepEqual(off.intent, ['muscular', 'nervous']);
});

test('round 5, Medium 4 — an off-system row names its cause instead of offering a dead click', () => {
  // No scene, no picks, femur's system switched off. Effective 0, and the eye cannot fix it.
  assert.equal(alphaCause({alpha: 0, inSession: false, declaredZero: false, systemOn: false}), 'system');
  // The three the eye CAN fix stay actionable.
  assert.equal(alphaCause({alpha: 0, inSession: true, declaredZero: false, systemOn: false}), 'session',
    'a session override is the eye own business, whatever the system says');
  assert.equal(alphaCause({alpha: 0, inSession: false, declaredZero: true, systemOn: true}), 'declared');
  assert.equal(alphaCause({alpha: 0.55, inSession: false, declaredZero: false, systemOn: true}), 'drawn');
  // And the reading itself is unchanged — this is about the CONTROL, not the number.
  const scene = normalizeScene({mode: 'render', structures: [{id: 'FMA9611', role: 'primary'}]});
  assert.equal(drawn({scene, picks: [], visible: ['muscular']}).concept('FMA9611'), 0,
    'codex: both femur meshes are outside the visible system set');
});

test('round 5, Medium 1 — the controller refusal really is atomic, which is what "dispatch first" relies on', () => {
  // The ORDERING is in tree.tsx/shell.tsx (JSX, not unit-testable). This pins the half it rests on.
  const big = normalizeScene({mode: 'render', structures: [{id: 'FMA22359', role: 'primary'}],
    caption: {title: 'x'.repeat(80), note: '界'.repeat(284)}});
  const before = encodeScene(big);
  const st = initialState({scene: big, sceneBlob: before}, SEED()).state;
  const out = reduce(st, {type: 'set-opacity', id: 'FMA22359', opacity: 1});
  if (out.rejected) {
    assert.equal(out.state, st, 'a refusal returns the SAME state object — nothing moved');
    assert.equal(out.state.blob, before);
  } else {
    assert.ok(out.state.blob.length <= 1400, 'or it was accepted and stayed inside the bound');
  }
});

test('round 5, the Low — sceneDeclaresLang agrees with decodeScene on every gate', () => {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  // codex's three: all returned true while decodeScene returned null.
  for (const o of [{lang: 'zh-Hans'}, {v: 2, s: ['FMA7485'], lang: 'zh-Hans'}, {v: 1, s: [], lang: 'zh-Hans'}]) {
    const blob = b64(o);
    assert.equal(decodeScene(blob), null, `decodeScene rejects ${JSON.stringify(o)}`);
    assert.equal(sceneDeclaresLang(blob), false, 'so the helper must too');
  }
  // And a real declaring blob still reads true, or the fix would be a silent disable.
  assert.equal(sceneDeclaresLang(encodeScene(normalizeScene({structures: [{id: 'FMA7485'}], lang: 'zh-Hant'}))), true);
});
