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
export function eyeAction(args: {kind: EyeKind; on: boolean; system?: SystemId; visible: readonly SystemId[]}): EyeAction {
 if (args.kind === 'system') {
  const sys = args.system;
  return {
   visible: args.on ? args.visible.filter((x) => x !== sys) : [...args.visible.filter((x) => x !== sys), ...(sys ? [sys] : [])],
   session: 'none',
  };
 }
 if (args.kind === 'member') return args.on ? {opacity: 0, session: 'none'} : {opacity: 1, session: 'clear'};
 return args.on ? {session: 'hide'} : {session: 'clear'};
}

