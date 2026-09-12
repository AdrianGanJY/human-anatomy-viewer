/**
 * `window.atlas` — the LOCAL tool surface, reserved for a future OpenAI Realtime session
 * (Adrian's ruling 2, README.md:42). A WebRTC voice session runs IN THE PAGE, so it can call
 * these directly and drive the viewer with no MCP round-trip and no server hop; MCP stays the
 * path for ChatGPT/claude.ai TEXT chat, which is a different process on a different machine.
 *
 * SCOPE DISCIPLINE — this file contains NO microphone, NO camera, NO WebRTC and no pose code.
 * It is the SURFACE only: the four verbs plus a typed event stream. Building the voice client
 * against a surface that already exists is the cheap half; the surface is what has to be
 * designed now, because every later client freezes it.
 *
 * It is also the app's own introspection point, which is why the headless oracles read
 * `window.atlas.state()` rather than scraping the DOM for things the DOM does not say.
 */
import type {Lang} from '../i18n/ui';

export type AtlasEvent =
 | {type: 'scene'; blob: string; ids: string[]; focus: string | null}
 | {type: 'focus'; id: string | null}
 | {type: 'select'; ids: string[]}
 | {type: 'scene-ready'; ms: number}
 | {type: 'ready'; ms: number}
 | {type: 'lang'; lang: Lang}
 | {type: 'stage'; on: boolean}
 | {type: 'error'; code: string};

export interface AtlasState {
 /** The scene blob currently on screen, verbatim — the same string the URL carries. */
 blob: string;
 ids: string[];
 focus: string | null;
 /** Names of the focused structure in the interface language and in English. */
 name: string | null;
 nameEn: string | null;
 lang: Lang;
 view: string;
 /**
  * THE SYSTEM SET THE RENDERER IS DRAWING (`render.visible`). Added at S3b round 6 because an
  * oracle asserted `state().visible.includes('skeletal')` against a field that did not exist — so
  * `[].includes(...)` made the assertion UNCONDITIONALLY FALSE and the row passed while proving
  * nothing (codex round 6, Medium 2). A tautology in a deploy-gating suite is worse than a red.
  * This is the tool surface's whole purpose: read the app's own state instead of scraping the DOM.
  */
 visible: string[];
 stage: boolean;
 /** `scene` = every structure the link named is drawn; `atlas` = all 15 chunks. */
 phase: 'boot' | 'scene' | 'atlas';
 bytes: {done: number; total: number};
 /** What the camera fit was actually handed: mesh counts for focus and frame, and isolate. */
 framing: {focus: number; frame: number; isolate: boolean};
}

/**
 * L31 v2.1a — THE EDIT VERBS (version 3).
 *
 * `add`, `remove`, `clear` and `setView` are not new capability: they are the SAME commands the
 * on-screen controls already send, exposed on the same door. That is the point — codex's review
 * asks that the tool surface and the shell call one owner (codex-app-review.md §1), so a voice
 * session, v2.1b's toolbar and the margin's buttons cannot drift into three behaviours. Every one
 * of them goes through `reduce` in app/v2/controller.ts and is subject to the same atomic limits.
 *
 * They return FALSE when the controller refused (an unknown id, or a bound exceeded) — never a
 * partial application, and never a silent truncation.
 */
export interface AtlasTools {
 /** Apply a scene: a base64url blob, or a full URL/query carrying `scene=`. */
 applyScene(sceneOrUrl: string): boolean;
 /** Move the camera and the margin onto one structure already in the view. */
 focus(ids: string | readonly string[]): boolean;
 /** The plate for what is on screen — the URL, NOT a render call. Rendering is metered and
  *  gated (`/api/snap` needs an owner identity), so a local tool never spends it silently. */
 plate(): {url: string; blob: string; ids: string[]};
 state(): AtlasState;
 /**
  * ── L31 v2.1b+c, S4 — THE RESOLVED PER-MESH ALPHA, FOR INSTRUMENTS ────────────────────────────
  *
  * codex round 9's open Low: "neither browser row proves member-Show wiring". Both existing rows
  * read the eye's own `aria-pressed` and `is-inert`, which is the CONTROL reporting on itself —
  * and S3b's whole lesson was that a control's declaration is not the five-link chain the renderer
  * walks. An oracle that wants to prove a Show CHANGED THE PICTURE has to read the picture.
  *
  * So this returns the exact `meshAlpha` map `app/v2/page.tsx` hands to the visibility controls,
  * which is computed from the `renderState` object handed to `AnatomyScene` in the same render.
  *
  * ⚠️ WHAT IT IS NOT: a GPU readback. It is one step before the draw call, not zero. It cannot
  * catch a renderer that ignores its own `opacity` input — `scripts/verify-render.mjs`'s pixel
  * comparison is the lane for that. Stated here so no oracle overclaims it.
  *
  * Keyed by MESH (part) id, not by concept: the concept maximum is exactly the abstraction that
  * could not see a Hide blanking two of three meshes while a sharer kept the third (round 8).
  */
 alphas(): Record<string, number>;
 /** Add one structure to the view. In scene mode it joins the scene as CONTEXT. */
 add(id: string): boolean;
 /** Remove one structure, reconciling the declared focus, styles and annotations that named it. */
 remove(id: string): boolean;
 /** Leave scene mode and empty the selection. */
 clear(): boolean;
 setView(view: string): boolean;
 /** Subscribe to the event stream. Returns the unsubscriber. */
 on(listener: (e: AtlasEvent) => void): () => void;
 /**
  * STILL 3 AFTER S4 ADDED `alphas()`, and deliberately. The number exists so a future client can
  * tell whether the verbs it needs are present; an ADDITIVE method breaks no caller written against
  * 3, and bumping it would tell every existing client it is out of date to describe a change that
  * cannot affect it. It bumps when a verb's signature or semantics change, not when the surface
  * grows. (`alphas()` is also an INSTRUMENT rather than a verb — no client drives the viewer with
  * it — which is the other reason it does not belong in the contract's version.)
  */
 readonly version: 3;
}

type Handlers = {
 applyScene: (s: string) => boolean;
 focus: (ids: string[]) => boolean;
 plate: () => {url: string; blob: string; ids: string[]};
 state: () => AtlasState;
 alphas: () => Record<string, number>;
 add: (id: string) => boolean;
 remove: (id: string) => boolean;
 clear: () => boolean;
 setView: (view: string) => boolean;
};

const listeners = new Set<(e: AtlasEvent) => void>();

/** Emit to every subscriber. A throwing listener must not take the app down with it. */
export function emitAtlas(e: AtlasEvent) {
 for (const l of [...listeners]) { try { l(e); } catch { /* a subscriber's bug is its own */ } }
}

export function installAtlasTools(h: Handlers): () => void {
 const api: AtlasTools = {
  applyScene: (s) => (typeof s === 'string' && !!s.trim() ? h.applyScene(s.trim()) : false),
  focus: (ids) => h.focus(typeof ids === 'string' ? [ids] : [...(ids ?? [])].filter((x) => typeof x === 'string')),
  plate: () => h.plate(),
  state: () => h.state(),
  alphas: () => h.alphas(),
  // Guarded the same way `applyScene` is: a caller that hands this surface a non-string gets false
  // rather than a thrown error inside a voice session's tool loop.
  add: (id) => (typeof id === 'string' && !!id.trim() ? h.add(id.trim()) : false),
  remove: (id) => (typeof id === 'string' && !!id.trim() ? h.remove(id.trim()) : false),
  clear: () => h.clear(),
  setView: (view) => (typeof view === 'string' ? h.setView(view) : false),
  on: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  version: 3,
 };
 (window as unknown as {atlas?: AtlasTools}).atlas = api;
 return () => {
  listeners.clear();
  if ((window as unknown as {atlas?: AtlasTools}).atlas === api) delete (window as unknown as {atlas?: AtlasTools}).atlas;
 };
}
