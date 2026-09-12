/**
 * THE v2 SCENE CONTROLLER — one owner for scene / picks / focus / visibility intent / camera intent.
 * L31 v2.1a, commit C2. Specified by codex-app-review.md §1 (the first structural High) and
 * codex-plan-review.md §A.3–4, and the contract below is theirs almost verbatim.
 *
 * ══ THE DEFECT THIS EXISTS TO END ══════════════════════════════════════════════════════════════
 * `scene`/`sceneBlob`, `picks`, `focusId` and `state` used to evolve SEPARATELY. Selection actions
 * changed picks without touching the scene; `writeUrlState` wrote the arrival blob back verbatim
 * (app/url-state.ts:149 — deliberately, so a copied plate URL reproduces the same picture); and
 * `plate` derived the renderer's focus set from `scene.camera.focus`. So three things disagreed the
 * moment a human edited anything:
 *   · remove a structure  → it left the rail and stayed in the blob, the URL, plate() and a reload
 *   · focus another member → the label changed and the camera did not move
 * (codex-app-review.md §2 rows 3 and 4; R:27, R:28.) A writable Scene JSON panel — v2.1c — would
 * have shown the disagreement immediately.
 *
 * ══ THE CONTRACT ═══════════════════════════════════════════════════════════════════════════════
 * 1. A transaction PATCHES THE COMPLETE AUTHORITATIVE SCENE. It never reconstructs one from
 *    renderer or React state. That is what keeps the design's data-loss concern honoured
 *    (v21-design.md:318, "never re-encode React state") while still letting the URL be updated:
 *    every field the page does not model — styles, annotations, background, size, ss, padding,
 *    caption placement — travels through untouched because the patch starts from the scene itself.
 * 2. IT PROMISES NOTHING ABOUT UNSUPPORTED FIELDS. `normalizeScene` drops what it does not know
 *    (app/scene-codec.js:209-244), so "preserve arbitrary unknown keys" would be a promise the
 *    codec breaks. Supported-and-untouched survive; unknown do not. Stated rather than implied.
 * 3. LIMITS ARE CHECKED ATOMICALLY, BEFORE COMMITTING. Both bounds: 24 structures AND 1,400
 *    encoded characters. A rejected edit returns the state UNCHANGED plus a message for the human.
 *    Never a silent truncation — `select=` already slices at 24 in the URL layer, and a scene that
 *    lost its tail renders a confidently wrong picture.
 * 4. REMOVING A STRUCTURE RECONCILES EVERYTHING THAT REFERENCED IT: the declared camera focus, the
 *    styles and the annotations. `validateScene` rejects a scene whose focus/styles/annotations
 *    name a non-member, so an unreconciled removal would not merely be untidy — it would produce a
 *    scene that cannot be encoded at all.
 * 5. CAMERA INTENT IS EXPLICIT. `reset` — the counter the renderer refits on (app/scene.tsx:378) —
 *    is bumped ONLY by commands that ARE a camera intent: applying a scene, applying a legacy URL,
 *    clearing, focusing, choosing a view, resetting. Adding or removing a structure, toggling a
 *    system and toggling isolate are NOT camera intents and no longer refit. Resize and navigation
 *    ownership belong to v2.1b (codex-plan-review.md §B: "C2 may define camera intent; C3
 *    implements resize/navigation ownership").
 * 6. FOCUS RETARGETS THROUGH THE SCENE, not around it. Focusing a DECLARED MEMBER rewrites
 *    `camera.focus`, which is the only representation the renderer reads, so the camera moves and
 *    the change survives serialisation. Focusing something that is not a scene member sets the UI
 *    focus and leaves the declared focus alone — the alternative would be to silently add it to the
 *    scene, i.e. change membership as a side effect of looking at something.
 *
 * ══ VISIBILITY: WHAT IS EXPRESSIBLE AND WHAT IS DEFERRED ═══════════════════════════════════════
 * codex-plan-review.md §A.4 requires each command's representation in the EXISTING contract to be
 * documented before any visibility control ships. The audit, against app/scene-codec.js:
 *
 *   SYSTEM VISIBILITY   `visible: SystemId[]` — page/renderer state, serialised as the legacy
 *                       `system=` key (app/url-state.ts:138). Round-trips. EXPRESSIBLE.
 *   ISOLATE             `rest.include === 'none'` in a scene; `isolate=1` in a legacy URL.
 *                       Round-trips. EXPRESSIBLE.
 *   REST AS A GHOST     `rest.include === 'skeletal'` + `rest.opacity`. Round-trips. EXPRESSIBLE.
 *   PER-STRUCTURE ALPHA `styles[id].opacity`, resolved per MODE (explore draws every named
 *                       structure solid). Round-trips for SCENE MEMBERS only. EXPRESSIBLE.
 *   PER-PART VISIBILITY ⛔ NOT EXPRESSIBLE. There is no general per-part visibility map and no
 *                       arbitrary system-set field in the codec. A Layers "eye" on one part of a
 *                       concept therefore has NO round-trip: the live page would hide it and the
 *                       link would not. So NO visibility UI ships in this commit, and when v2.1b
 *                       adds the tree the eye must mean one of the four expressible things above —
 *                       or the codec gets a versioned additive field FIRST, in its own commit,
 *                       with its own goldens. Deferred deliberately, not forgotten.
 *   ORDERING            ⛔ NEVER. Canonical order is a cache-key property (structures are sorted by
 *                       id so two identical scenes share one R2 entry). Presentation order is a
 *                       different concern and must never be stored as one. No drag ordering, ever.
 *
 * ══ AMENDED BY S3 (2026-09-12) — WHAT THE EYE ACTUALLY MEANS, PER ROW TYPE ═════════════════════
 * The deferral above was honoured: the tree ships with NO new codec field, and the eye is not one
 * control with one meaning. It is THREE, chosen by what the row IS, and each one states its own
 * serialisation in its own tooltip (opus-plan-review-2.md RC8 — an eye whose serialisation is not
 * in its tooltip is refused).
 *
 *   A SYSTEM ROW        → `set-visible`. Page state, serialised as the legacy `system=` key. Round
 *                         trips. ⚠️ IT ALSO FORCES `isolate:false` (see the command below), so the
 *                         control SAYS so: the tooltip names both effects, and while isolate is on
 *                         the eye's label carries the consequence rather than performing it
 *                         silently. That is the RC8 requirement, discharged by disclosure.
 *   A SCENE-MEMBER ROW  → `set-opacity`, i.e. `styles[id].opacity = 0`. Round-trips inside the
 *                         blob. It is THE SAME FACT as the Selection panel's opacity slider — one
 *                         fact, two controls, one command — so the two can never disagree.
 *                         ⚠️ **ONLY IN `mode:'render'`** (codex round 3, H1). The PER-STRUCTURE
 *                         ALPHA row above says it in passing — "resolved per MODE (explore draws
 *                         every named structure solid)" — and S3 built a control on top of it
 *                         anyway: `sceneOpacities` returns `{id: 1}` for every member of an EXPLORE
 *                         scene, so the eye wrote 0 into the blob while the renderer kept drawing
 *                         the structure at full alpha, and TWO controls said "hidden" over a
 *                         visible mesh. In explore mode a member is therefore treated as a
 *                         NON-MEMBER row: the override is render-only, nothing unhonoured is
 *                         written, and the tooltip says session-only — which is the truth there.
 *                         Enforced in `tree.tsx eyeKind` and in the Selection slider's `disabled`.
 *   A NON-MEMBER ROW    → a RENDER-ONLY override. It is not a command at all: the controller never
 *                         sees it, nothing is serialised, and `app/v2/page.tsx` merges it into the
 *                         renderer's `opacity` map after the plate. It is drawn visibly differently
 *                         (a dashed eye), its tooltip says "this session only, not in the link",
 *                         and it is DISCARDED whenever a scene is applied — because a saved view
 *                         that opened with a structure mysteriously missing is the worse failure
 *                         (`spec.md`: "Opening a saved scene/tab resets these session overrides").
 *
 * The fourth possibility — a real per-part visibility field in the codec — is still not built and
 * still not needed: none of the three above invents one.
 *
 * ══ WHY A PURE REDUCER ═════════════════════════════════════════════════════════════════════════
 * Every rule above is a statement about a STATE TRANSITION, so it is testable without a browser,
 * a renderer or React — and `app/v2/page.tsx` cannot be unit-tested at all (Node strips types, not
 * JSX). The page is the adapter: it turns events into commands and commits the result. The renderer
 * and the URL are DERIVED VIEWS of what this file returns, which is the whole point of one owner.
 */
import type {SceneState, SystemId, View} from '../anatomy';
// The codec is imported at its REAL path with its REAL extension: `app/scene-codec.js` is plain ESM
// with zero imports (it is shared with a Pages Function), so Node can load it as-is. The TYPES come
// from `scene-model`, and a type import is erased before Node ever sees it.
import {encodeScene, LIMITS, normalizeScene, sceneFocusId, sceneSelectIds, validateScene} from '../scene-codec.js';
import type {Role, Scene} from '../scene-model';
/**
 * `uniq` is deliberately NOT an import of `selection.ts`'s `dedupe`, and the reason is mechanical
 * rather than aesthetic: `selection.ts` imports SYSTEMS from `../anatomy` as a VALUE, so pulling it
 * in here would drag the whole extensionless chain into `node --test` and cost this contract its
 * unit coverage. The behaviour is pinned to `dedupe(app/selection.ts:52)` — trim, drop empties,
 * keep first occurrence — and `test/v2-controller.test.mjs` asserts the two agree, so the copy
 * cannot drift silently.
 *
 * `addPick`/`removePick` are not needed at all: every call site here has already established
 * membership with an `includes` guard, so they reduce to an append and a filter.
 */
const uniq = (ids: readonly string[]): string[] => [...new Set(ids.map((s) => s.trim()).filter(Boolean))];

/**
 * THE MEMBERSHIP BOUND, applied to EVERY path that can set `picks` — not only to the scene-mode
 * edits that route through `commitScene`.
 *
 * codex's second review (High 3) executed the counterexamples: a bare `replace` and an
 * `apply-legacy` both accepted 25 selections, and `clear-scene` had no bound at all. The URL layer
 * slices `select=` at 24 (app/url-state.ts `idList`), so those lists arrive bounded from a link —
 * but `window.atlas` and the search panel do not go through the URL layer, and "the caller happens
 * to bound it" is not an invariant this file can rely on.
 *
 * REFUSED, NEVER TRUNCATED. Silently dropping the tail is how a scene renders a confidently wrong
 * picture, which is the failure this whole contract exists to prevent.
 */
const overBound = (ids: readonly string[]): string | null =>
 ids.length > LIMITS.MAX_STRUCTURES
  ? `that is ${ids.length} structures and the maximum is ${LIMITS.MAX_STRUCTURES} — remove some first`
  : null;
import {legacySceneState} from './legacy-url.ts';
import type {LegacyUrlFields} from './legacy-url';

/** The authoritative state. `scene`+`blob` are one fact in two encodings and are only ever written
 *  together, by `commitScene` below — which is the invariant the old code could not state. */
export interface V2State {
 scene: Scene | null;
 /** The canonical encoding of `scene`, or '' when there is no scene. Never a stale arrival blob. */
 blob: string;
 /** EXACT REQUESTED IDS, concepts or parts. The GPU selection is derived from these through
  *  `resolvePicks`/`unionElements` — never a parallel set of checkbox booleans (R:57). */
 picks: string[];
 focusId: string | null;
 render: SceneState;
 /**
  * THE SYSTEM SET THE HUMAN CHOSE — kept apart from `render.visible`, which a scene can overwrite.
  *
  * codex r9 Medium 1, second half (controller.ts:282): `apply-scene` wrote
  * `visible: scene.rest.include === 'skeletal' ? ['skeletal'] : state.render.visible`. The first
  * branch is correct as a RENDER decision — a scene declaring a skeletal ghost is asking for the
  * skeleton — but it wrote that decision into the field that also holds the human's own choice, and
  * `render.visible` is the ONLY copy. So a ghost scene consumed it: after one such link, the user's
  * set was `['skeletal']` for the rest of the session, and the very next non-ghost scene inherited
  * `['skeletal']` through the `else` branch as if the human had asked for it. It is a one-way door,
  * and it is serialised (`system=`, app/url-state.ts:138), so the clobbered value also went into
  * the address bar.
  *
  * Two facts needed two fields. This one is INTENT, written only by the commands that ARE the human
  * speaking — `set-visible`, and the legacy URL's `system=` key. `render.visible` stays the RENDER
  * value and a scene may still drive it. Optional so every existing `V2State` literal (the unit
  * suite builds several) keeps type-checking and behaves as before: readers fall back to
  * `render.visible`, which is exactly today's value.
  */
 visibleIntent?: SystemId[];
}

export type Command =
 | {type: 'apply-scene'; scene: Scene; blob?: string; redrive?: boolean}
 | {type: 'apply-legacy'; url: LegacyUrlFields & {select?: string[]}}
 | {type: 'clear-scene'; url: LegacyUrlFields & {select?: string[]}}
 | {type: 'replace'; ids: readonly string[]; focus?: string | null}
 | {type: 'add'; id: string}
 | {type: 'remove'; id: string}
 | {type: 'clear-all'}
 | {type: 'focus'; id: string}
 | {type: 'set-view'; view: View}
 | {type: 'reset-view'}
 | {type: 'set-visible'; visible: SystemId[]}
 | {type: 'set-isolate'; on: boolean}
 /**
  * ── S3. THE TREE'S TICK — ONE ATOMIC TRANSACTION FOR ONE ROW AND FOR A WHOLE SYSTEM ───────────
  *
  * A child tick is `{ids: [oneId], on}`; a system's bulk tick is the same command with every
  * descendant in it. ONE path, deliberately: `spec.md` requires the bulk form to "add/remove exact
  * descendant requests atomically" and to refuse the WHOLE operation over either bound, and a
  * separate single-tick path is how the two would drift into disagreeing about that.
  *
  * NOT A CAMERA INTENT (rule 5). Ticking a structure in a list must not throw away the reader's
  * pose — that is the same reason `add` and `remove` do not refit.
  */
 | {type: 'tick'; ids: readonly string[]; on: boolean}
 /**
  * ── S3. PER-STRUCTURE ALPHA — the Selection slider and the member row's eye, one command ───────
  * `styles[id].opacity`. Scene members only; a non-member is refused rather than silently added to
  * the scene (`validateScene` rejects a style naming a non-member, so this is the codec's rule
  * surfaced rather than a policy invented here). `null` REMOVES the style entry, which is how
  * "back to normal" differs from "explicitly 100%".
  */
 | {type: 'set-opacity'; id: string; opacity: number | null};

export interface Outcome {
 state: V2State;
 /** A message for the HUMAN when an edit was refused. Present ⇒ `state` is the input, unchanged. */
 rejected?: string;
 /** True when the scene identity changed, so the caller withdraws readiness and opens a new
  *  renderer generation (see `sceneEpoch` in app/scene.tsx). */
 epoch?: boolean;
}

/** A camera intent, and the ONLY way `reset` is ever bumped. See contract rule 5. */
const intent = (render: SceneState, patch: Partial<SceneState> = {}): SceneState =>
 ({...render, ...patch, reset: render.reset + 1});

/**
 * COMMIT A PATCHED SCENE — the one place a scene and its blob are written together.
 *
 * Validation happens on the NORMALIZED candidate and the length check on its ACTUAL encoding, in
 * that order, because both bounds have to hold and only the encoding knows the second one. If
 * either fails the caller's state comes back untouched with a sentence a human can act on.
 */
function commitScene(state: V2State, candidate: unknown, render: SceneState): Outcome {
 const next = normalizeScene(candidate) as Scene;
 const invalid = validateScene(next);
 if (invalid) return {state, rejected: invalid};
 const blob = encodeScene(next);
 if (blob.length > LIMITS.SCENE_MAX_B64) {
  // NOT A TRUNCATION. The encoded budget exists so the whole plate URL stays under the 2,000
  // characters the server enforces; silently dropping the tail would render a wrong picture under
  // a valid key, which is the failure class this whole file is guarding.
  return {state, rejected: `this scene encodes to ${blob.length} characters and the limit is ${LIMITS.SCENE_MAX_B64} — remove a structure, or shorten the title or note`};
 }
 return {
  state: {...state, scene: next, blob, picks: sceneSelectIds(next), focusId: sceneFocusId(next), render},
  epoch: blob !== state.blob,
 };
}

/**
 * REMOVE A STRUCTURE FROM A SCENE, reconciling every reference to it (contract rule 4).
 * `validateScene` rejects a focus/style/annotation naming a non-member, so this is not tidiness:
 * an unreconciled removal produces a scene that cannot be encoded.
 */
function withoutStructure(scene: Scene, id: string) {
 const structures = scene.structures.filter((s) => s.id !== id);
 return {
  ...scene,
  structures,
  camera: {...scene.camera, focus: scene.camera.focus.filter((f) => f !== id)},
  styles: scene.styles.filter((s) => s.id !== id),
  annotations: scene.annotations.filter((a) => {
   const targets = a.type === 'arrow' ? [a.from, a.to] : [a.target];
   return !targets.includes(id);
  }),
 };
}

/**
 * THE COLD SEED — the initial controller state, validated.
 *
 * `app/v2/page.tsx` used to build its first `V2State` inline from `readUrlState()`, copying the
 * decoded scene, its blob and all of its picks straight in. That is a committing path like any
 * other, and it was the one path that never went through a gate: `decodeScene` checks the version
 * and that at least one structure survives, but it does NOT call `validateScene`.
 *
 * codex executed the consequence (review 3, High 1) with 25 real atlas concepts in a 448-character
 * blob: the initializer published all 25 structures, then `apply-scene` correctly REFUSED them
 * after the atlas arrived and preserved its input state — which already contained the invalid
 * scene. The refusal stopped the camera being applied and left the scene live, so the page held a
 * scene declaring `side` while the camera sat at `three-quarter`, and the marker and serializer
 * both received the retained blob. Worse than either outcome alone: a partial application.
 *
 * Validating HERE means an unusable link degrades to what it can still honour — its legacy fields,
 * which is exactly what a link with no blob would have given — instead of to a half-applied scene.
 */
export function initialState(
 url: {scene?: Scene | null; sceneBlob?: string; select?: string[]} & LegacyUrlFields,
 render: SceneState,
): {state: V2State; rejected?: string} {
 // The seed's intent is whatever the URL asked for, or the render seed's own set. `legacySceneState`
 // is not consulted here because it needs a `previous` and this IS the previous.
 const blank: V2State = {scene: null, blob: '', picks: [], focusId: null, render, visibleIntent: url.visible ?? render.visible};
 if (url.scene) {
  const scene = normalizeScene(url.scene) as Scene;
  const invalid = validateScene(scene);
  const encoded = invalid ? '' : encodeScene(scene);
  if (!invalid && encoded.length <= LIMITS.SCENE_MAX_B64) {
   return {
    state: {
     scene, picks: sceneSelectIds(scene), focusId: sceneFocusId(scene),
     blob: url.sceneBlob && url.sceneBlob === encoded ? url.sceneBlob : encoded,
     render, visibleIntent: url.visible ?? render.visible,
    },
   };
  }
  // FALL THROUGH to the legacy fields rather than to nothing: the link still names structures, and
  // showing them beats showing an empty page for a scene the codec cannot honour.
  //
  // WHAT THIS DOES NOT DO, stated because the earlier wording here overclaimed it. This is NOT
  // "the same as the link without a blob": a URL carrying the PRD's alias form
  // (`mode=render&focus=…&contextOpacity=…`) has a scene SYNTHESIZED for it by `readUrlState`
  // (app/url-state.ts `synthesize`), so a no-blob visit would arrive with a declared focus and
  // isolation that this fallback does not reproduce — codex executed the comparison (review 4,
  // Medium 2). The fallback preserves the LEGACY FIELDS the URL still names: selection, view,
  // isolate, explode, systems. The refusal above tells the reader the view itself was not applied.
  const picks = uniq(url.select ?? []).slice(0, LIMITS.MAX_STRUCTURES);
  return {
   state: {...blank, picks, render: legacySceneState(url, render)},
   rejected: `this link's view could not be applied — ${invalid ?? `it encodes to ${encoded.length} characters, over the ${LIMITS.SCENE_MAX_B64} limit`}`,
  };
 }
 const picks = uniq(url.select ?? []);
 const tooMany = overBound(picks);
 return tooMany
  ? {state: {...blank, picks: picks.slice(0, LIMITS.MAX_STRUCTURES), render: legacySceneState(url, render)}, rejected: tooMany}
  : {state: {...blank, picks, render: legacySceneState(url, render)}};
}

export function reduce(state: V2State, cmd: Command): Outcome {
 switch (cmd.type) {
  // ── arrival paths ─────────────────────────────────────────────────────────────────────────
  case 'apply-scene': {
   const scene = normalizeScene(cmd.scene) as Scene;
   // ⚠️ AN ARRIVAL IS NOT PRE-VALIDATED. `decodeScene` normalizes and checks the VERSION and that
   // at least one structure survives — it does NOT call `validateScene` (app/scene-codec.js), so a
   // blob naming 25 real concepts in 351 characters decodes happily and used to be committed
   // straight into state. codex executed exactly that, plus a normalized scene encoding to 2,462
   // characters whose resulting blob could not decode at all (review 2, High 3).
   //
   // So the arrival goes through the same gate every edit does. A rejected link degrades to the
   // state the page already had, with a message — never to a page rendering a scene it cannot
   // serialise, and never to a truncation.
   const invalidArrival = validateScene(scene);
   if (invalidArrival) return {state, rejected: `this link's view could not be applied — ${invalidArrival}`};
   const arrivalBlob = encodeScene(scene);
   if (arrivalBlob.length > LIMITS.SCENE_MAX_B64) {
    return {state, rejected: `this link's view encodes to ${arrivalBlob.length} characters and the limit is ${LIMITS.SCENE_MAX_B64}`};
   }
   const render = intent(state.render, {
    view: scene.camera.view,
    explode: scene.camera.explode,
    rotate: scene.camera.rotate,
    // `rest:'none'` IS today's isolate, exactly — the same mapping v1 makes at page.tsx:149 — so
    // every P1–P3 deep link keeps meaning what it meant.
    isolate: scene.rest.include === 'none',
    // The ghost drives the RENDER value; the human's own set (`visibleIntent`) is never touched, so
    // it survives a ghost scene and is what the NEXT scene falls back to. See `visibleIntent`.
    visible: scene.rest.include === 'skeletal' ? ['skeletal'] : (state.visibleIntent ?? state.render.visible),
   });
   // THE ARRIVAL BLOB IS KEPT ONLY WHEN IT IS ALREADY CANONICAL, and the earlier wording here
   // overstated that. codex passed a valid blob using the supported `structures` spelling instead of
   // the canonical `s`, and it was rewritten on arrival (review 2, Medium 5) — semantically the same
   // scene, a different string. That is CANONICALISATION, not preservation, and it is the desired
   // behaviour (two spellings of one picture must share one R2 entry, which is the whole reason the
   // codec canonicalises at all) — but the claim has to match the code. A canonical blob, which is
   // what every link this app and `/mcp` emit carries, survives byte-identically; a hand-written or
   // legacy spelling is normalised.
   const blob = cmd.blob && cmd.blob === arrivalBlob ? cmd.blob : arrivalBlob;
   return {
    state: {...state, scene, blob, picks: sceneSelectIds(scene), focusId: sceneFocusId(scene), render},
    epoch: true,
   };
  }
  case 'apply-legacy': {
   // No scene: the P1–P3 contract. Camera and visibility come off the URL (R:26); see
   // `legacySceneState` for the measurement of what used to happen instead.
   const picks = cmd.url.select ? uniq(cmd.url.select) : state.picks;
   const tooMany = overBound(picks);
   if (tooMany) return {state, rejected: tooMany};
   // A LEGACY APPLY LEAVES SCENE MODE, and it reconciles the focus. codex executed both halves
   // (review 2, Medium 2): applying `[FMA7088]` over a scene whose focus was `FMA22359` left
   // `atlas.state().focus` reporting the old id while the visible detail had already fallen back to
   // the new basket — the exact controller/view disagreement this file exists to end. And applying
   // it to a scene-bearing controller kept the old scene and blob while replacing the picks, so the
   // URL described structures that were no longer selected.
   //
   // The legacy contract has no scene by definition (`synthesize()` returns early unless
   // mode=render), so arriving through it means the page is no longer showing the link's scene.
   return {
    state: {
     ...state, scene: null, blob: '', picks,
     focusId: state.focusId && picks.includes(state.focusId) ? state.focusId : null,
     // `system=` in a legacy URL IS the human speaking (it is what `set-visible` serialises to), so
     // it updates the intent; absent, the previous intent stands. See `visibleIntent`.
     visibleIntent: cmd.url.visible ?? state.visibleIntent ?? state.render.visible,
     render: legacySceneState(cmd.url, state.render),
    },
    epoch: true,
   };
  }
  case 'clear-scene': {
   // `#scene=` — LEAVING scene mode on purpose (R:7, R:30). The blob is cleared, which is what
   // stops `writeUrlState` writing the abandoned scene straight back into the address bar.
   const cleared = cmd.url.select ? uniq(cmd.url.select) : [];
   const clearTooMany = overBound(cleared);
   if (clearTooMany) return {state, rejected: clearTooMany};
   return {
    state: {
     ...state, scene: null, blob: '', focusId: null,
     picks: cleared,
     visibleIntent: cmd.url.visible ?? state.visibleIntent ?? state.render.visible,
     render: legacySceneState(cmd.url, state.render),
    },
    epoch: true,
   };
  }

  // ── membership ────────────────────────────────────────────────────────────────────────────
  case 'replace': {
   const ids = uniq(cmd.ids);
   if (!ids.length) return {state, rejected: 'nothing to select'};
   const replaceTooMany = overBound(ids);
   if (replaceTooMany) return {state, rejected: replaceTooMany};
   // "Show me this instead" — a search result, or a tap on the model. It IS a camera intent.
   const render = intent(state.render, {isolate: false, rotate: false});
   if (!state.scene) return {state: {...state, picks: ids, focusId: cmd.focus ?? null, render}};
   // IN SCENE MODE THIS PATCHES THE SCENE; IT DOES NOT EXIT IT. Exiting was the tempting reading —
   // the structures are no longer the ones the link declared — but tapping a structure on a chat
   // link would then silently discard the assistant's title and note, and that tap is the single
   // most common interaction on the phone flow this whole entry exists for. The previous code kept
   // the scene too (it simply let picks and the scene disagree, which is R:27); this keeps the
   // scene AND makes the two agree. `Clear` is the explicit way out, and clear-all is the command
   // codex names for exiting (codex-plan-review.md §A.3).
   const out = commitScene(state, {
    ...state.scene,
    structures: ids.map((id) => ({id, role: 'primary' as Role})),
    // The declared focus can only name a member; keep it when the new set still contains it.
    // `rotate:false` IS WRITTEN THROUGH, for the same reason `set-view` writes it (codex r9 Medium
    // 1, controller.ts:345): this command stops the live turntable via `intent(…{rotate:false})`,
    // and leaving `camera.rotate:true` in the blob makes the link and the screen disagree about a
    // field the codec expresses perfectly well. Every camera field a command touches is serialised,
    // or the exception list in this file's header is a fiction.
    camera: {...state.scene.camera, rotate: false, focus: state.scene.camera.focus.filter((f) => ids.includes(f))},
    styles: state.scene.styles.filter((s) => ids.includes(s.id)),
    // An annotation survives only if EVERY id it points at survives — `validateScene` rejects one
    // that targets a non-member, so a half-reconciled annotation makes the scene unencodable.
    annotations: state.scene.annotations.filter((a) => {
     const targets = (a.type === 'arrow' ? [a.from, a.to] : [a.target]).filter((t): t is string => !!t);
     return targets.length > 0 && targets.every((t) => ids.includes(t));
    }),
   }, render);
   return out.rejected ? out : {...out, state: {...out.state, focusId: cmd.focus ?? out.state.focusId}};
  }
  case 'add': {
   if (state.picks.includes(cmd.id)) return {state};
   const picks = [...state.picks, cmd.id];
   // NOT a camera intent (rule 5): adding a supporting structure must not throw away the pose.
   if (!state.scene) {
    if (picks.length > LIMITS.MAX_STRUCTURES) {
     return {state, rejected: `a view holds at most ${LIMITS.MAX_STRUCTURES} structures — remove one first`};
    }
    return {state: {...state, picks, focusId: cmd.id}};
   }
   // In scene mode the structure joins the SCENE, as context: a primary is a claim about what the
   // link is teaching, and a structure the human added afterwards is not that.
   const out = commitScene(state, {
    ...state.scene,
    structures: [...state.scene.structures, {id: cmd.id, role: 'context' as Role}],
   }, state.render);
   return out.rejected ? out : {...out, state: {...out.state, focusId: cmd.id}};
  }
  case 'remove': {
   if (!state.picks.includes(cmd.id)) return {state};
   if (!state.scene) {
    const picks = state.picks.filter((x) => x !== cmd.id);
    return {state: {...state, picks, focusId: state.focusId === cmd.id ? (picks[0] ?? null) : state.focusId}};
   }
   if (state.scene.structures.length <= 1) {
    // `validateScene` refuses a scene with no structures, and it is right to: an empty scene is not
    // a scene, it is a cleared page. Say so instead of failing to encode.
    return {state, rejected: 'a view needs at least one structure — use Clear to leave this view'};
   }
   return commitScene(state, withoutStructure(state.scene, cmd.id), state.render);
  }
  case 'clear-all': {
   // EXITS SCENE MODE AND CLEARS THE CACHED BLOB (codex-plan-review.md §A.3). Isolate goes with it:
   // an isolate with an empty selection draws nothing at all.
   return {
    state: {...state, scene: null, blob: '', picks: [], focusId: null, render: intent(state.render, {isolate: false})},
    epoch: !!state.scene,
   };
  }

  // ── S3: the tree's membership transaction ─────────────────────────────────────────────────
  case 'tick': {
   const asked = uniq(cmd.ids);
   if (!asked.length) return {state};
   const have = new Set(state.picks);
   // THE OPERATION IS COMPUTED FIRST AND COMMITTED ONCE. Not a fold over single adds: a fold that
   // hits the bound halfway leaves HALF the system ticked, which is the silent truncation this
   // whole file exists to refuse. Either every requested id moves or none does.
   const picks = cmd.on
    ? [...state.picks, ...asked.filter((id) => !have.has(id))]
    : state.picks.filter((id) => !asked.includes(id));
   if (picks.length === state.picks.length && cmd.on) return {state};   // nothing to add
   if (picks.length === state.picks.length && !cmd.on) return {state};  // nothing to remove
   const tooMany = overBound(picks);
   if (tooMany) return {state, rejected: tooMany};
   if (!state.scene) {
    // Untick-to-empty is a legitimate end state OUTSIDE scene mode: it is what `Clear` does, and
    // the page renders the empty state for it. `focusId` follows what is left.
    return {state: {...state, picks, focusId: picks.includes(state.focusId ?? '') ? state.focusId : (picks[0] ?? null)}};
   }
   if (!picks.length) {
    // IN SCENE MODE IT IS REFUSED, not silently turned into a clear. `validateScene` rejects a
    // scene with no structures, and emptying a teaching link by unticking the last row would
    // discard its title and note as a side effect of a checkbox.
    return {state, rejected: 'a view needs at least one structure — use Clear to leave this view'};
   }
   const inScene = new Set(state.scene.structures.map((s) => s.id));
   const structures = cmd.on
    // Joining structures are CONTEXT, exactly as `add` rules: a primary is a claim about what the
    // link teaches, and a row the reader ticked afterwards is not that.
    ? [...state.scene.structures, ...asked.filter((id) => !inScene.has(id)).map((id) => ({id, role: 'context' as Role}))]
    : state.scene.structures.filter((s) => !asked.includes(s.id));
   // Every reference to a departing structure is reconciled, or the scene cannot encode (rule 4).
   const gone = new Set(structures.map((s) => s.id));
   const out = commitScene(state, {
    ...state.scene,
    structures,
    camera: {...state.scene.camera, focus: state.scene.camera.focus.filter((f) => gone.has(f))},
    styles: state.scene.styles.filter((s) => gone.has(s.id)),
    annotations: state.scene.annotations.filter((a) => {
     const targets = (a.type === 'arrow' ? [a.from, a.to] : [a.target]).filter((x): x is string => !!x);
     return targets.length > 0 && targets.every((x) => gone.has(x));
    }),
   }, state.render);
   return out;
  }
  case 'set-opacity': {
   if (!state.scene) {
    // NO SCENE, NO STYLE. `styles` is a scene field; outside scene mode there is nowhere to put it
    // and the render-only override in the page is the honest surface. Said, not silently ignored.
    return {state, rejected: 'opacity is part of a saved view — this page is not showing one'};
   }
   if (!state.scene.structures.some((s) => s.id === cmd.id)) {
    return {state, rejected: 'opacity applies to a structure in this view — add it first'};
   }
   /**
    * ⚠️ `null` REMOVES THE OPACITY, NOT THE WHOLE STYLE ENTRY — codex round 3, Medium 2.
    *
    * The first version dropped the entry and re-pushed it only when a number was given, so
    * restoring a structure to full alpha DELETED its `emphasis` — a saved scene field this command
    * has no business touching. codex executed it on a fixture carrying `emphasis:'highlight'`:
    * `before=[{id,emphasis:'highlight'}]` → `hidden=[{id,emphasis:'highlight',opacity:0}]` →
    * `restored=[]`. Contract rule 1 is that a transaction patches the scene and leaves every field
    * it does not own alone; this owned one field and took two.
    *
    * An entry with nothing left in it but its id IS dropped: an explicit 1 and an absent style
    * render identically, so the blob should carry the smaller one.
    */
   const prior = state.scene.styles.find((s) => s.id === cmd.id);
   const styles = state.scene.styles.filter((s) => s.id !== cmd.id);
   if (cmd.opacity !== null) {
    styles.push({...(prior ?? {}), id: cmd.id, opacity: Math.min(1, Math.max(0, cmd.opacity))});
   } else if (prior) {
    const {opacity: _dropped, ...rest} = prior;
    if (Object.keys(rest).length > 1) styles.push(rest);
   }
   return commitScene(state, {...state.scene, styles}, state.render);
  }

  // ── camera intent ─────────────────────────────────────────────────────────────────────────
  case 'focus': {
   if (!state.picks.includes(cmd.id)) return {state};
   const render = intent(state.render, {rotate: false});
   // A DECLARED MEMBER RETARGETS THROUGH THE SCENE (R:28, contract rule 6). `camera.focus` is the
   // only focus representation the renderer reads (app/v2/page.tsx `plate`), so writing it here is
   // what makes the camera move AND what makes the change survive into the URL and plate().
   if (state.scene?.structures.some((s) => s.id === cmd.id)) {
    // `rotate:false` travels with the focus — codex r9 Medium 1 (controller.ts:412). The live
    // turntable is stopped by `intent` above; the blob has to say so too.
    const out = commitScene(state, {...state.scene, camera: {...state.scene.camera, rotate: false, focus: [cmd.id]}}, render);
    // `commitScene` re-derives focusId from the scene, which is now this id — but be explicit, so
    // a future change to `sceneFocusId` cannot silently move the UI focus somewhere else.
    return out.rejected ? out : {...out, state: {...out.state, focusId: cmd.id}};
   }
   // Not a member: the UI focus moves, the DECLARED focus does not. Adding it to the scene would
   // change membership as a side effect of looking at something.
   //
   // BUT THE STOPPED ROTATION IS STILL A CAMERA FACT. Focusing a non-member is still a camera
   // intent that stops the turntable, so in scene mode the scene is patched to agree — and ONLY
   // when it currently disagrees, so a focus on a non-member never re-encodes a scene for nothing.
   if (state.scene?.camera.rotate) {
    const out = commitScene(state, {...state.scene, camera: {...state.scene.camera, rotate: false}}, render);
    return out.rejected ? out : {...out, state: {...out.state, focusId: cmd.id}};
   }
   return {state: {...state, focusId: cmd.id, render}};
  }
  case 'set-view': {
   // `rotate:false` GOES INTO THE BLOB TOO. codex executed the divergence (review 2, Medium 4):
   // choosing a view stopped the live turntable while the decoded blob still said
   // `camera.rotate:true`, so the link and the screen disagreed about a field the codec can express
   // perfectly well. Every camera field this command touches has to be written, or the exception
   // list in this file's header is a fiction.
   const render = intent(state.render, {view: cmd.view, rotate: false});
   if (!state.scene) return {state: {...state, render}};
   return commitScene(state, {...state.scene, camera: {...state.scene.camera, view: cmd.view, rotate: false}}, render);
  }
  case 'reset-view': {
   const render = intent(state.render, {view: 'three-quarter', explode: 0, rotate: false});
   if (!state.scene) return {state: {...state, render}};
   return commitScene(state, {...state.scene, camera: {...state.scene.camera, view: 'three-quarter', explode: 0, rotate: false}}, render);
  }

  // ── visibility intent (only the expressible commands — see the audit above) ────────────────
  case 'set-visible': {
   // Systems are page state serialised as `system=`; they are not a scene field, so no re-encode.
   // Not a camera intent: turning a system off must not refit.
   //
   // THE HUMAN IS SPEAKING, so this writes BOTH the render value and the intent it came from.
   //
   // ⚠️ S3, RC8 DISCHARGED BY DISCLOSURE, NOT BY A BEHAVIOUR CHANGE. This command clears `isolate`
   // unconditionally, and that is CORRECT: isolate means "draw only the selection", so a system
   // the reader just switched on would be invisible and the control would read as broken. What was
   // wrong was that nothing SAID so. The tree's system eye now carries both effects in its tooltip
   // (`tree.eyeSystem` / `tree.eyeSystemIsolate` in copy.ts), so the reader is told before the
   // click rather than surprised after it. The alternative RC8 allows — refusing the toggle while
   // isolate is on — was weighed and rejected: it makes a working control unusable in the exact
   // mode where a reader most wants to add context back.
   return {state: {...state, visibleIntent: cmd.visible, render: {...state.render, isolate: false, visible: cmd.visible}}};
  }
  case 'set-isolate': {
   // RENDER-ONLY, IN BOTH MODES, AND THAT IS THE DEFERRAL DISCIPLINE RATHER THAN AN OVERSIGHT.
   // `rest.include` is a closed enum of exactly `none | skeletal` (app/scene-codec.js:37) — there
   // is no value meaning "show everything". So isolate ON maps cleanly (`none`) and isolate OFF has
   // NO representation: writing `skeletal` would turn "stop hiding the others" into "ghost the
   // skeleton", a different picture than the human asked for, and writing nothing leaves the scene
   // declaring an isolate the view no longer has.
   //
   // Given a choice between inventing a semantic and leaving one field of the arriving link
   // undisturbed, this leaves it undisturbed: "Hide others" is a VIEW control on a link a human is
   // exploring, not an edit to what the link teaches. Making it a scene edit needs a `rest` mode
   // for it — a versioned additive codec change, in its own commit, with its own goldens
   // (codex-plan-review.md §A.4: "Defer controls whose live behavior cannot round-trip").
   //
   // BUT `explode` IS EXPRESSIBLE, and this command zeroes it. codex executed that divergence
   // (review 2, Medium 4): toggling isolate reset the live explosion while the decoded blob still
   // said `camera.explode:0.5`. So the isolate FLAG is the only field left undisturbed, and the
   // explosion it resets is written through like any other camera edit.
   if (!state.scene) return {state: {...state, render: {...state.render, isolate: cmd.on, explode: 0}}};
   if (state.scene.camera.explode === 0) {
    return {state: {...state, render: {...state.render, isolate: cmd.on, explode: 0}}};
   }
   return commitScene(state, {...state.scene, camera: {...state.scene.camera, explode: 0}},
    {...state.render, isolate: cmd.on, explode: 0});
  }
  default:
   return {state};
 }
}
