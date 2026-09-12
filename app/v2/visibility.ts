/**
 * EFFECTIVE ALPHA — ONE READING OF WHAT THE RENDERER ACTUALLY DRAWS.
 * L31 v2.1b+c, S3b. Born from codex round 4, whose four Highs are one defect wearing four hats:
 * **every visibility control in S3 reported its own declaration instead of the visibility the
 * renderer computes.** The renderer's alpha comes off a CHAIN, and each control read one link:
 *
 *   1. `roleOpacity[role]`            — what a structure with NO style entry is drawn at
 *                                       (`scene-codec.js:403 structureOpacity`). It is NOT 1.
 *   2. `styles[id].opacity`           — the scene's explicit per-structure alpha, render mode only
 *                                       (`sceneOpacities` returns 1 for every member in explore).
 *   3. a MAX across shared meshes     — two concepts can name the same part, and `page.tsx`'s plate
 *                                       takes `max(opacity[el], a)`, so a mesh a second selected
 *                                       structure keeps at 1 is drawn at 1.
 *   4. the session override           — `page.tsx renderState` sets `opacity[el] = 0` for the
 *                                       render-only hidden set, AFTER the max.
 *   5. the visibility lane            — `shown = (isolate ? selected : visible.has(system) ||
 *                                       selected) && alpha > 0` (`scene.tsx:759-762`). A structure
 *                                       whose system is off is not drawn whatever its alpha says.
 *
 * This file is the ONE implementation of steps 4→5 read back off the finished map, so a control
 * cannot disagree with the picture. It takes the EXACT object handed to the renderer, which is what
 * makes "the same chain" true by construction rather than by a comment: if `page.tsx` changes what
 * it hands over, this changes with it.
 *
 * ⚠️ IT IS A READING, NEVER A WRITER. Nothing here dispatches, and nothing here decides what a
 * control should DO — only what it must SAY. The write side stays in `controller.ts` (serialised
 * facts) and in `page.tsx`'s session set (render-only facts), exactly as the RC8 three-way split
 * requires.
 */
import type {SceneState, SystemId} from '../anatomy';
// The explicit extension is the repo's convention for a VALUE import out of a `.ts` module
// (`tree.tsx` imports `../find.ts` the same way): Vite resolves it, and `node --test`'s type
// stripping requires it. A bare specifier here resolves under Vite and throws in the suite.
import {sceneOpacities, type Scene} from '../scene-model.ts';

/** The slice of the renderer's state this depends on — named so a future field cannot be added to
 *  the render path and silently bypass the reading. */
export type AlphaState = Pick<SceneState, 'opacity' | 'restOpacity' | 'visible' | 'selected' | 'isolate'>;

/**
 * The per-PART effective alpha, transcribed from `app/scene.tsx`:
 *
 *   const alpha = s.opacity?.[p.id] ?? (selected ? 1 : (s.restOpacity ?? 1));
 *   const shown = (s.isolate ? selected : visible.has(p.system) || selected) && alpha > 0;
 *
 * and then `shown ? alpha : 0` — because the lane and the alpha are two reasons for the same
 * outcome and a control only ever needs the outcome. Kept as a transcription on purpose: if the
 * renderer's rule changes, this file is the second place to change, and the unit test that pins
 * both is `test/v2-visibility.test.mjs`.
 */
export function partAlphas(state: AlphaState, partSystem: ReadonlyMap<string, SystemId>): (partId: string) => number {
 const selected = new Set(state.selected);
 const visible = new Set(state.visible);
 const rest = state.restOpacity ?? 1;
 return (partId: string): number => {
  const sel = selected.has(partId);
  const alpha = state.opacity?.[partId] ?? (sel ? 1 : rest);
  const sys = partSystem.get(partId);
  const shown = (state.isolate ? sel : (sys !== undefined && visible.has(sys)) || sel) && alpha > 0;
  return shown ? alpha : 0;
 };
}

/**
 * A CONCEPT'S effective alpha is the MAX over its meshes, and the max is the honest answer.
 *
 * A concept is a set of parts; the reader sees "the sternum", not eight meshes. If ANY of its
 * meshes is on screen, the structure is on screen — so an eye that says "hidden" while one mesh is
 * drawn at 1 is lying, which is codex r4's third High exactly (hiding *Body of sternum* while
 * *Sternum* is also selected leaves the shared `FJ3178` at alpha 1). Taking the MIN, or the
 * structure's own declaration, would reproduce the lie in a different shape.
 *
 * A concept with no meshes at all resolves to 0 — there is nothing of it to draw.
 */
export function conceptAlpha(alphaOf: (partId: string) => number, elements: readonly string[]): number {
 let max = 0;
 for (const el of elements) { const a = alphaOf(el); if (a > max) max = a; }
 return max;
}

/**
 * WHY A STRUCTURE IS NOT DRAWN — **WORDING ONLY, SINCE S3c.**
 *
 * ⚠️ THIS NO LONGER GATES ANY CONTROL, and that demotion IS codex round 7, Medium 3. Through S3b
 * the tree computed a cause and then inferred "the eye is inert" from `cause === 'system'`. Two
 * things were wrong with that, and only the second is about the taxonomy:
 *
 *   1. the lane test compared a CONCEPT id against `state.selected`, which holds MESH ids, so it
 *      could never be true through the `|| sel` exemption — codex executed a selected *Sternum*
 *      with a session-hidden *Body of sternum* and got `laneBlocked:true, eyeInert:true` over a
 *      Show that would have moved the alpha 0 → 1;
 *   2. a taxonomy is a PREDICTION of what a click would do, and the prediction can be wrong in the
 *      other direction too — an unpicked structure under `rest.opacity:0` read `'declared'`, kept
 *      an active eye, and its Show cleared an empty session set and changed nothing.
 *
 * So the control's gate is now `eyeActionable` — one recomputation of the chain, which cannot
 * disagree with the renderer because it IS the renderer's expression. The cause survives to say
 * WHY in words next to an inert eye, where being approximately right is a legibility question
 * rather than a correctness one.
 *
 *   'session'  — a render-only override the eye owns.
 *   'declared' — the scene resolves this structure to alpha 0.
 *   'system'   — its system is switched off. A different control.
 *   'isolate'  — isolation is drawing only the selection, and this is not in it. A different
 *                control again, and saying "its system is switched off" there is a lie about an
 *                ENABLED system (codex round 7, Medium 3, third case).
 *   'drawn'    — it is on screen. Nothing to explain.
 */
export type AlphaCause = 'drawn' | 'session' | 'declared' | 'system' | 'isolate';

export function alphaCause(args: {
 alpha: number;
 inSession: boolean;
 /** The scene's RESOLVED alpha for this structure — `sceneOpacities`, so `roleOpacity` is already
  *  applied. NOT `styles[id].opacity ?? 1`: a missing style is not a declared 1. */
 resolvedZero: boolean;
 /** From `laneBlocks` — the renderer's own `shown` expression over MESHES, never a concept id. */
 laneBlocked: boolean;
 /** Which lane control is the one to name. */
 isolate: boolean;
}): AlphaCause {
 if (args.alpha > 0) return 'drawn';
 /**
  * ⚠️ ORDER IS "WHAT WOULD REMOVING THIS CAUSE CHANGE?", NOT A PRIORITY LIST — codex round 6,
  * Medium 4, second half. The lane comes FIRST because it is the one cause the eye cannot touch: a
  * structure hidden by BOTH a session override and its system reported `'session'`, so the eye
  * stayed active and clearing the override moved the alpha from 0 to 0 (codex executed exactly
  * that). Answering "which control would actually help?" puts the lane ahead of the rest.
  */
 if (args.laneBlocked) return args.isolate ? 'isolate' : 'system';
 if (args.inSession) return 'session';
 return args.resolvedZero ? 'declared' : 'declared';
}

/**
 * IS THE VISIBILITY LANE WHAT BLOCKS THIS CONCEPT — asked of the renderer's own `shown` expression,
 * **over MESHES**.
 *
 * codex round 7, Medium 3: the tree asked `picked.has(row.id)`, where `picked` holds CONCEPT ids
 * and the renderer's `selected` holds MESH ids. Those are two populations, and the renderer's
 * `|| sel` exemption lives in the second — a concept nobody picked can still have every mesh
 * selected, because a picked NEIGHBOUR names the same meshes. codex measured exactly that on
 * *Body of sternum* under a selected *Sternum*: `actualSelectedMeshes:["FJ3153","FJ3178","FJ3290"]`.
 *
 * One drawn mesh is enough to clear the lane, for the same reason `conceptAlpha` takes the MAX.
 * A concept with no meshes is not blocked by the lane — there is nothing of it to block.
 */
export function laneBlocks(
 state: AlphaState, partSystem: ReadonlyMap<string, SystemId>, elements: readonly string[],
): boolean {
 if (!elements.length) return false;
 const selected = new Set(state.selected);
 const visible = new Set(state.visible);
 for (const el of elements) {
  const sel = selected.has(el);
  const sys = partSystem.get(el);
  if (state.isolate ? sel : (sys !== undefined && visible.has(sys)) || sel) return false;
 }
 return true;
}

/**
 * THE SCENE'S RESOLVED ALPHA for one structure — `roleOpacity` applied, mode applied — or
 * `undefined` when there is no scene or the structure is not a member.
 *
 * It exists because two controls kept using `styles.find(...)?.opacity ?? 1` as "what the scene
 * declares", and that is wrong twice over: a missing style inherits `roleOpacity[role]`
 * (0.55 / 0.25 / whatever the link says), and in EXPLORE mode every member resolves to 1 whatever
 * its style says. codex round 6 found both, in two different controls, after round 5 had fixed the
 * same class of error in a third.
 */
export function resolvedStructureAlpha(scene: Scene | null, id: string): number | undefined {
 if (!scene?.structures.some((st) => st.id === id)) return undefined;
 const {structures} = sceneOpacities(scene) as unknown as {structures: Record<string, number>};
 return structures[id];
}

/**
 * STEP 2+3 OF THE CHAIN — the scene's own per-mesh alpha, before the session set touches it.
 *
 * Lifted out of `page.tsx`'s `plate` memo so that the two things that need it — the renderer and
 * the controls — read ONE implementation. `sceneOpacities` owns the mode rule (explore draws every
 * named structure solid); the MAX owns the shared-mesh rule. Both were already here; only the
 * ownership moved.
 *
 * ⚠️ `a === undefined` LEAVES THE MESH OUT, rather than writing a 1. A part of a picked concept
 * that the SCENE does not name has no declared alpha at all, and the renderer's own default for it
 * (`selected ? 1 : restOpacity`) is a different rule from "1". Writing 1 here would quietly promote
 * every ghosted rest mesh to full alpha.
 */
export function sceneAlphaMap(scene: Scene, basket: readonly {id: string; elements: readonly string[]}[]): Record<string, number> {
 const {structures: alpha} = sceneOpacities(scene) as unknown as {structures: Record<string, number>};
 const out: Record<string, number> = {};
 for (const p of basket) {
  const a = alpha[p.id];
  if (a === undefined) continue;
  for (const el of p.elements) out[el] = Math.max(out[el] ?? 0, a);
 }
 return out;
}

/**
 * STEP 4 — the session-only hidden set, applied AFTER the max.
 *
 * It OVERRIDES rather than joining the max, and that is the intended asymmetry: a render-only hide
 * is the reader saying "take this off my screen now", and losing to a shared mesh would make the
 * control do nothing at all in the commonest case (a parent and its part both selected). The cost
 * is that it also blanks a mesh a second structure shares — which the reader can see, and can undo
 * with one click, because nothing about it is saved.
 *
 * A fresh object identity every time, because `app/scene.tsx`'s change guard compares `s.opacity`
 * by REFERENCE (scene.tsx:738) and a map mutated in place never reaches the GPU.
 */
export function withSessionHidden(
 base: Record<string, number> | undefined,
 hidden: ReadonlySet<string>,
 elementsOf: (conceptId: string) => readonly string[],
): Record<string, number> | undefined {
 if (!hidden.size) return base;
 const out: Record<string, number> = {...(base ?? {})};
 for (const id of hidden) for (const el of elementsOf(id)) out[el] = 0;
 return out;
}

// ── what a control SAYS, and what a click DOES ────────────────────────────────────────────────

/** RC8's three-way split, decided by what the row IS and by whether the codec honours the fact in
 *  this scene's MODE. `tree.tsx eyeKind` is the only caller; it lives here so the tests can too. */
export type EyeKind = 'system' | 'member' | 'session';

/**
 * WHAT THE EYE SAYS — and it is the RENDERER'S answer for every row type, never the control's own
 * declaration. codex r4's four Highs are four ways of getting this one line wrong.
 *
 * A SYSTEM row reads `render.visible`, NOT `visibleIntent`. That is a reversal of S3 and it is
 * deliberate: a ghost scene's arrival rewrites `render.visible` to `['skeletal']`
 * (`controller.ts:361`), and `system=` in the URL serialises the RENDER value — so an eye reading
 * the intent reported "skeletal hidden" over a drawn skeleton, and the link it produced said
 * `system=skeletal`. The eye's job is to describe the picture. The human's own set is NOT lost: it
 * stays in `visibleIntent`, the row publishes it as `data-intent`, and the row says so in words
 * when the two disagree — two facts, two surfaces, one of which is the one the reader is looking at.
 */
export function eyeOn(args: {
 kind: EyeKind;
 system?: SystemId;
 /** `render.visible` — the EFFECTIVE system set, the one the renderer reads. */
 visible: readonly SystemId[];
 /** The concept's effective alpha, from `conceptAlpha` over the finished map. */
 alpha?: number;
}): boolean {
 if (args.kind === 'system') return args.system !== undefined && args.visible.includes(args.system);
 return (args.alpha ?? 0) > 0;
}

/** What the SESSION set must do after a click. `clear` is not merely "the opposite of hide": every
 *  control that RAISES visibility clears it, because an override the reader can no longer see the
 *  cause of is the stranding codex r4's first High describes. */
export type SessionOp = 'hide' | 'clear' | 'none';

export interface EyeAction {
 /** For a system row: the new EFFECTIVE set to dispatch through `set-visible`. */
 visible?: SystemId[];
 /**
  * The new INTENT set — the human's own choice, patched rather than replaced (codex round 5,
  * Medium 6). Computing the intent from the EFFECTIVE set discarded preferences for systems the
  * reader never clicked: codex executed intent `['muscular','nervous']` + a skeletal-ghost scene +
  * one click on Digestive and got intent `['skeletal','digestive']`, both originals gone.
  */
 intent?: SystemId[];
 /** For a structure row: the `set-opacity` argument, or `undefined` for "do not dispatch". */
 opacity?: number;
 session: SessionOp;
}

/**
 * WHAT A CLICK DOES.
 *
 * ⚠️ SHOW WRITES AN EXPLICIT `1`, NEVER `null` — codex r4's second High. `null` REMOVES the entry,
 * and an absent opacity is not 100%: `scene-codec.js:403` falls back to `roleOpacity[role]`, which
 * is 0.55 for context and 0.25 for a ghost (and whatever a teaching link declares — codex executed
 * `roleOpacity.ghost = 0`, where "show" left the structure completely invisible). The blob costs
 * ~14 characters more and says what the reader asked for.
 *
 * ⚠️ SHOW ALSO CLEARS THE SESSION OVERRIDE — codex r4's first High. A row that was hidden as a
 * non-member and then TICKED becomes a member row, whose eye writes `styles` and cannot reach the
 * session set; the override stayed, the renderer kept honouring it, and the eye promised a
 * visibility it no longer controlled.
 *
 * A system click is computed from `visible` (the effective set) for the same reason the eye reads
 * it: the reader is acting on the picture in front of them. `set-visible` writes both the intent
 * and the render value, so clicking an eye is also how a reader takes their intent back from a
 * scene that overrode it.
 */
export function eyeAction(args: {
 kind: EyeKind; on: boolean; system?: SystemId;
 /** `render.visible` — the EFFECTIVE set the click acts on. */
 visible: readonly SystemId[];
 /** `visibleIntent` — the human's own set, PATCHED by the same click. */
 intent?: readonly SystemId[];
}): EyeAction {
 if (args.kind === 'system') {
  const sys = args.system;
  const toggle = (set: readonly SystemId[]) => (args.on
   ? set.filter((x) => x !== sys)
   : [...set.filter((x) => x !== sys), ...(sys ? [sys] : [])]);
  // TWO SETS, THE SAME OPERATION. The effective set is what the reader is looking at, so the click
  // acts on it; the intent is their own list, so the click adds to or removes from THAT rather than
  // overwriting it with the scene's choice plus one.
  return {visible: toggle(args.visible), intent: toggle(args.intent ?? args.visible), session: 'none'};
 }
 if (args.kind === 'member') return args.on ? {opacity: 0, session: 'none'} : {opacity: 1, session: 'clear'};
 return args.on ? {session: 'hide'} : {session: 'clear'};
}

// ── WOULD THE CLICK CHANGE THE PICTURE? ───────────────────────────────────────────────────────

/**
 * Everything the counterfactual needs, and nothing else. It is deliberately the SAME material
 * `page.tsx` hands the renderer, so the recomputation below is the renderer's own arithmetic on a
 * hypothetical input rather than a second model of it.
 */
export interface EyeProbe {
 /** `renderState` — the exact object handed to `AnatomyScene`. Read for the lane and the rest. */
 base: AlphaState & {opacity?: Record<string, number>};
 /** The alpha map **before** the session set — `plate.opacity`. The session set is re-applied here
  *  under the hypothetical, so it must not already be baked in. */
 sceneOpacity: Record<string, number> | undefined;
 partSystem: ReadonlyMap<string, SystemId>;
 elementsOf(conceptId: string): readonly string[];
 /** The session-only hidden set, BEFORE the click. */
 hidden: ReadonlySet<string>;
 /** Needed for a MEMBER write, which lands in `styles` and has to re-resolve through the codec. */
 scene: Scene | null;
 basket: readonly {id: string; elements: readonly string[]}[];
}

/** The alpha the renderer would compute for one concept under a hypothetical session set + scene. */
function alphaUnder(
 probe: EyeProbe, conceptId: string, sceneOpacity: Record<string, number> | undefined, hidden: ReadonlySet<string>,
): number {
 const opacity = withSessionHidden(sceneOpacity, hidden, probe.elementsOf);
 return conceptAlpha(partAlphas({...probe.base, opacity}, probe.partSystem), probe.elementsOf(conceptId));
}

/**
 * ⚠️ THE EYE'S GATE, AND IT IS A MEASUREMENT RATHER THAN A CLASSIFICATION — codex round 7, Medium 3.
 *
 * The question a control has to answer before it offers itself is not "why is this hidden?" but
 * **"would my write change what is drawn?"**. Those are different questions, and S3b answered the
 * first and used the answer for the second. Both directions of error were executed by codex:
 *
 *   · *Body of sternum*, session-hidden, under a selected *Sternum*, `visible:[]` — reported cause
 *     `'system'` and **disabled a Show that works** (clearing the override reaches alpha 1 through
 *     the shared mesh);
 *   · an unpicked femur under `rest:{opacity:0}` with Skeleton enabled — reported `'declared'` and
 *     **offered a Show that changes nothing** (its session set is empty; clearing it is a no-op).
 *
 * So this applies the write to a COPY of the inputs and asks the chain again. It is one extra
 * `partAlphas` over one concept's meshes per drawn row — the same handful of map lookups the eye
 * already costs. A SYSTEM row is exempt: `set-visible` moves the lane itself, so it always acts.
 */
export function eyeActionable(probe: EyeProbe, conceptId: string, kind: EyeKind, on: boolean): boolean {
 if (kind === 'system') return true;
 const act = eyeAction({kind, on, visible: probe.base.visible});
 const before = alphaUnder(probe, conceptId, probe.sceneOpacity, probe.hidden);

 const hidden = new Set(probe.hidden);
 if (act.session === 'hide') hidden.add(conceptId);
 if (act.session === 'clear') hidden.delete(conceptId);

 let sceneOpacity = probe.sceneOpacity;
 if (act.opacity !== undefined && probe.scene) {
  // The member write, re-resolved through `sceneOpacities` — NOT written straight into the map,
  // because the mode rule and `roleOpacity` both live in the codec and explore mode ignores styles
  // entirely. Re-encoding is what makes this agree with what the click would actually produce.
  const prev = probe.scene.styles.find((s) => s.id === conceptId);
  const styles = [...probe.scene.styles.filter((s) => s.id !== conceptId), {...(prev ?? {id: conceptId}), opacity: act.opacity}];
  sceneOpacity = sceneAlphaMap({...probe.scene, styles}, probe.basket);
 }
 return alphaUnder(probe, conceptId, sceneOpacity, hidden) !== before;
}

/** What a concept row's eye must SAY and whether it may ACT — one call, one chain, so the two
 *  cannot drift apart the way they did in S3b. */
export interface EyeReading { actionable: boolean; cause: AlphaCause }

export function readEye(probe: EyeProbe, conceptId: string, kind: EyeKind, on: boolean): EyeReading {
 const elements = probe.elementsOf(conceptId);
 const opacity = withSessionHidden(probe.sceneOpacity, probe.hidden, probe.elementsOf);
 const state = {...probe.base, opacity};
 return {
  actionable: eyeActionable(probe, conceptId, kind, on),
  cause: alphaCause({
   alpha: conceptAlpha(partAlphas(state, probe.partSystem), elements),
   inSession: probe.hidden.has(conceptId),
   resolvedZero: resolvedStructureAlpha(probe.scene, conceptId) === 0,
   laneBlocked: laneBlocks(state, probe.partSystem, elements),
   isolate: state.isolate,
  }),
 };
}

