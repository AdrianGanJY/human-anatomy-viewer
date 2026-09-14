/**
 * ══ THE INPUTS THE URL IS BUILT FROM — ONE FUNCTION, TWO CALLERS ══════════════════════════════
 * L31 v2.1b+c, S7 (planner ruling after codex round 29).
 *
 * `page.tsx` has exactly two places that turn the app's state into a URL: the debounced effect that
 * mirrors it into the address bar, and Copy link. Round 29's HIGH is what happens when those two
 * build their inputs SEPARATELY — the copy passed `flags: {}` and `snap: false` while the writer
 * passed the live ones, so any non-default render flag the copy hardcoded away was dropped from a
 * shared link and the recipient landed somewhere else.
 *
 * The answer is not to copy the writer's argument list into the control and keep them in step by
 * hand; that is the same defect waiting for the next field. Both callers ask THIS function, so
 * "does the copy carry field X?" stops being a question anybody can get wrong: there is one
 * argument list, and a field is either in it or in neither.
 *
 * ⚠️ PURE, AND IN ITS OWN MODULE, so `test/v2-copy-link.test.mjs` can call the PRODUCTION function
 * rather than a transcription of it. A test that re-types the mapping cannot catch the mapping
 * drifting — which is precisely the class of bug this exists to end.
 */
import type {UrlInputs} from '../url-state.ts';
import type {Lang} from '../i18n/ui.ts';
import type {Scene} from '../scene-model.ts';
import type {V2State} from './controller.ts';
import {encodeScene} from '../scene-codec.js';

/**
 * WHICH CAPTION A PAGE HAS, as a pure function of the scene. In scene mode the caption lives in the
 * scene (and only when it asks to be drawn `in` the view); otherwise it is the legacy
 * `?title=`/`?note=` pair. One rule, read by the render and by both URL paths.
 */
export const captionOf = (scene: Scene | null, legacy: {title?: string; note?: string}) => {
 if (!scene) return legacy;
 return scene.caption.place === 'in' ? {title: scene.caption.title, note: scene.caption.note} : {};
};

/** Everything about the page that is NOT the controller's: the two display flags, the UI language,
 *  the legacy caption, and whether the document is in snap mode. */
export interface PageUrlFacts {
 lang: Lang;
 legacyCaption: {title?: string; note?: string};
 stage: boolean;
 probe: boolean;
 snap: boolean;
}

/**
 * THE ARGUMENT LIST. Every field `buildQuery` reads comes from here and from nowhere else.
 *
 * ⚠️ THE BLOB IS ENCODED FROM THE SCENE, NEVER TAKEN FROM `state.blob` — round 29's MEDIUM. The
 * cached blob is written by the controller alongside the scene, so the two agree in every path this
 * app has today; "today" is not an invariant, and a copied link whose `scene=` is one transaction
 * behind the fields beside it is indistinguishable from a correct one. Encoding from the canonical
 * scene cannot skew by construction. (`atlas.plate()` still returns its own pre-increment spelling —
 * that surface is the MCP's and codex round 27 required it byte-identical.)
 */
export function urlInputsOf(c: V2State, p: PageUrlFacts): UrlInputs {
 return {
  state: c.render,
  selectIds: c.picks,
  caption: captionOf(c.scene, p.legacyCaption),
  lang: p.lang,
  // `clearHash` is a WRITER-only instruction and `buildQuery` does not read it, so carrying it here
  // keeps ONE object for both callers without changing what the copy produces.
  flags: {stage: p.stage, probe: p.probe, clearHash: true},
  blob: c.scene ? encodeScene(c.scene) : '',
  snap: p.snap,
 };
}
