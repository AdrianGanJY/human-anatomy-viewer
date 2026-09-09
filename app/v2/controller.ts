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
 | {type: 'set-isolate'; on: boolean};

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

export function reduce(state: V2State, cmd: Command): Outcome {
 switch (cmd.type) {
  // ── arrival paths ─────────────────────────────────────────────────────────────────────────
  case 'apply-scene': {
   const scene = normalizeScene(cmd.scene) as Scene;
   const render = intent(state.render, {
    view: scene.camera.view,
    explode: scene.camera.explode,
    rotate: scene.camera.rotate,
    // `rest:'none'` IS today's isolate, exactly — the same mapping v1 makes at page.tsx:149 — so
    // every P1–P3 deep link keeps meaning what it meant.
    isolate: scene.rest.include === 'none',
    visible: scene.rest.include === 'skeletal' ? ['skeletal'] : state.render.visible,
   });
   // THE ARRIVAL BLOB IS PRESERVED WHEN IT IS EQUIVALENT. A link a human copied must reproduce
   // byte-identically, and re-encoding a scene that decoded from `cmd.blob` would silently change
   // the R2 cache key for anyone who pasted it — even though the picture is the same. So the
   // incoming string wins whenever it canonicalises to this scene, and only an EDIT re-encodes.
   const canonical = encodeScene(scene);
   const blob = cmd.blob && cmd.blob === canonical ? cmd.blob : canonical;
   return {
    state: {...state, scene, blob, picks: sceneSelectIds(scene), focusId: sceneFocusId(scene), render},
    epoch: true,
   };
  }
  case 'apply-legacy': {
   // No scene: the P1–P3 contract. Camera and visibility come off the URL (R:26); see
   // `legacySceneState` for the measurement of what used to happen instead.
   const picks = cmd.url.select ? uniq(cmd.url.select) : state.picks;
   return {state: {...state, picks, render: legacySceneState(cmd.url, state.render)}, epoch: true};
  }
  case 'clear-scene': {
   // `#scene=` — LEAVING scene mode on purpose (R:7, R:30). The blob is cleared, which is what
   // stops `writeUrlState` writing the abandoned scene straight back into the address bar.
   return {
    state: {
     ...state, scene: null, blob: '', focusId: null,
     picks: cmd.url.select ? uniq(cmd.url.select) : [],
     render: legacySceneState(cmd.url, state.render),
    },
    epoch: true,
   };
  }

  // ── membership ────────────────────────────────────────────────────────────────────────────
  case 'replace': {
   const ids = uniq(cmd.ids);
   if (!ids.length) return {state, rejected: 'nothing to select'};
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
    camera: {...state.scene.camera, focus: state.scene.camera.focus.filter((f) => ids.includes(f))},
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

  // ── camera intent ─────────────────────────────────────────────────────────────────────────
  case 'focus': {
   if (!state.picks.includes(cmd.id)) return {state};
   const render = intent(state.render, {rotate: false});
   // A DECLARED MEMBER RETARGETS THROUGH THE SCENE (R:28, contract rule 6). `camera.focus` is the
   // only focus representation the renderer reads (app/v2/page.tsx `plate`), so writing it here is
   // what makes the camera move AND what makes the change survive into the URL and plate().
   if (state.scene?.structures.some((s) => s.id === cmd.id)) {
    const out = commitScene(state, {...state.scene, camera: {...state.scene.camera, focus: [cmd.id]}}, render);
    // `commitScene` re-derives focusId from the scene, which is now this id — but be explicit, so
    // a future change to `sceneFocusId` cannot silently move the UI focus somewhere else.
    return out.rejected ? out : {...out, state: {...out.state, focusId: cmd.id}};
   }
   // Not a member: the UI focus moves, the DECLARED focus does not. Adding it to the scene would
   // change membership as a side effect of looking at something.
   return {state: {...state, focusId: cmd.id, render}};
  }
  case 'set-view': {
   const render = intent(state.render, {view: cmd.view, rotate: false});
   if (!state.scene) return {state: {...state, render}};
   return commitScene(state, {...state.scene, camera: {...state.scene.camera, view: cmd.view}}, render);
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
   return {state: {...state, render: {...state.render, isolate: false, visible: cmd.visible}}};
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
   // (codex-plan-review.md §A.4: "Defer controls whose live behavior cannot round-trip"). Recorded
   // here because it is the one place in this file where the live view and the blob may disagree,
   // and that disagreement is deliberate and bounded to this single field.
   return {state: {...state, render: {...state.render, isolate: cmd.on, explode: 0}}};
  }
  default:
   return {state};
 }
}
