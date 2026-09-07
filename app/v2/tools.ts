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
 stage: boolean;
 /** `scene` = every structure the link named is drawn; `atlas` = all 15 chunks. */
 phase: 'boot' | 'scene' | 'atlas';
 bytes: {done: number; total: number};
 /** What the camera fit was actually handed: mesh counts for focus and frame, and isolate. */
 framing: {focus: number; frame: number; isolate: boolean};
}

export interface AtlasTools {
 /** Apply a scene: a base64url blob, or a full URL/query carrying `scene=`. */
 applyScene(sceneOrUrl: string): boolean;
 /** Move the camera and the margin onto one structure already in the view. */
 focus(ids: string | readonly string[]): boolean;
 /** The plate for what is on screen — the URL, NOT a render call. Rendering is metered and
  *  gated (`/api/snap` needs an owner identity), so a local tool never spends it silently. */
 plate(): {url: string; blob: string; ids: string[]};
 state(): AtlasState;
 /** Subscribe to the event stream. Returns the unsubscriber. */
 on(listener: (e: AtlasEvent) => void): () => void;
 readonly version: 2;
}

type Handlers = {
 applyScene: (s: string) => boolean;
 focus: (ids: string[]) => boolean;
 plate: () => {url: string; blob: string; ids: string[]};
 state: () => AtlasState;
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
  on: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  version: 2,
 };
 (window as unknown as {atlas?: AtlasTools}).atlas = api;
 return () => {
  listeners.clear();
  if ((window as unknown as {atlas?: AtlasTools}).atlas === api) delete (window as unknown as {atlas?: AtlasTools}).atlas;
 };
}
