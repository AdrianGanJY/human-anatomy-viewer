/**
 * THE WHOLE localStorage SCHEMA, DECLARED AT S0 — including keys whose features arrive later.
 * L31 v2.1b+c, S0. Specified by opus-plan-review-2.md RC12.
 *
 * WHY ALL FOUR NOW, when only one has a feature behind it. A later group cannot change a shape S0
 * shipped: the key is already on Adrian's machine, so S4 either reads what S0 wrote or writes a
 * migration. Declaring the shape while nothing depends on it costs one file; discovering the shape
 * was wrong after it shipped costs a migration and a session of confusion about why a toggle
 * remembers the wrong thing.
 *
 * FOUR PROPERTIES, and every one of them is a defect somebody has actually shipped:
 *  1. A `v` FIELD. Without it there is no way to tell "written by an older build" from "corrupt",
 *     and the only safe reading of an unknown shape is to throw it away — which silently forgets a
 *     setting the human chose.
 *  2. VALIDATION, not a cast. `JSON.parse` returns `any`; a value that used to be a string and is
 *     now an object reaches the render as the wrong type and the page goes white. Every reader here
 *     proves the shape before returning it.
 *  3. CLAMPING. `spec.md` (§420 px field floor): "With a single 780 invalid persisted dock, clamp to
 *     its allowed width before this ladder." A persisted width outside its range is not an error to
 *     report, it is a number to bring back into range.
 *  4. EVERY ACCESS IS WRAPPED. `localStorage` THROWS in Safari private browsing — not returns null,
 *     throws — and the existing `atlas.lang` reads already wrap for exactly that reason
 *     (app/v2/page.tsx:89). An unwrapped read here would take the whole shell down on a browser
 *     where the app otherwise works fine.
 *
 * The oracle for this file is "a corrupt value in each of the four keys still renders the shell".
 */

/** The right-hand docks, in the order they may be opened. `json` and `ask` are S5's; they are named
 *  here because `atlas.dock` must be able to hold them the day S5 lands, not because S0 opens them. */
export type DockKey = 'selection' | 'info' | 'json' | 'ask';
export const DOCK_KEYS: DockKey[] = ['selection', 'info', 'json', 'ask'];

/** Default widths, from `spec.md` §Geometry: Selection/Ask 320, Info 300, JSON 360, combined max 780. */
export const DOCK_W: Record<DockKey, number> = {selection: 320, info: 300, json: 360, ask: 320};
export const DOCK_MAX_TOTAL = 780;
/** The left sidebar: default 264, admissible 220–420 (a persisted or future width), stub 44. */
export const SIDE_DEFAULT = 264, SIDE_MIN = 220, SIDE_MAX = 420, SIDE_STUB = 44;
/** The field may not go below this. `spec.md` §420 px field floor. */
export const FIELD_MIN = 420;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Read + parse, never throwing. Returns `undefined` for absent, unreadable OR unparseable — the
 *  three cases are indistinguishable to a caller that can only fall back to a default anyway. */
function raw(key: string): unknown {
 try {
  const s = localStorage.getItem(key);
  if (s === null) return undefined;
  return JSON.parse(s) as unknown;
 } catch { return undefined; }
}
function put(key: string, value: unknown): void {
 try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private browsing, or full */ }
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

// ── atlas.dock — S0 ──────────────────────────────────────────────────────────────────────────────
/**
 * `{v:1, open:DockKey[]|null, side:number, sideCollapsed:boolean}`.
 *
 * `open` is in LEAST- to MOST-recently-opened order, which is what makes both the third-dock
 * eviction rule and the collapse ladder deterministic: both read from the same end.
 *
 * ⚠️ `open: null` MEANS "THE HUMAN HAS NEVER CHOSEN", and it is a different fact from "the human
 * chose one dock". Conflating them is a one-way door: the first build seeded the DEFAULT into this
 * key on the first visit at ANY tier — including the phone, where the shell never renders — so a
 * human who opened the app once on a phone or at 1440 had `['selection']` on disk, and every later
 * visit at >=1600 read it back as a CHOICE and served one dock forever. G2's two-panel default
 * became unreachable, and no later group could repair it, because by then the key is on the machine.
 * (Found by the S0 stand-in review, H1, with an executed counterexample: fresh @1920 → 620 px of
 * dock; phone-seeded @1920 → 320.)
 *
 * So nothing is ever written here until the human OPENS OR CLOSES something. Until then the open set
 * is derived from the tier, live, and follows the window.
 */
export interface DockPrefs {v: 1; open: DockKey[] | null; side: number; sideCollapsed: boolean}
export const DOCK_KEY = 'atlas.dock';

/** The default open set is TIER-DEPENDENT (G2): one dock below 1600, Selection + Info at and above
 *  it. Passed in rather than read here so this module stays free of `matchMedia`. */
export const defaultDocks = (wide: boolean): DockKey[] => (wide ? ['selection', 'info'] : ['selection']);
/** The open set to USE: the human's choice if there is one, otherwise the tier's default. */
export const effectiveDocks = (p: DockPrefs, wide: boolean): DockKey[] => p.open ?? defaultDocks(wide);

export function readDocks(): DockPrefs {
 const fallback: DockPrefs = {v: 1, open: null, side: SIDE_DEFAULT, sideCollapsed: false};
 const v = raw(DOCK_KEY);
 if (!isObj(v) || v.v !== 1) return fallback;
 // Unknown dock names are DROPPED rather than rejecting the whole value: a build that removes a
 // dock should not wipe the human's other choices. Duplicates are collapsed, and the set is capped
 // at two because "max two, never three" is a layout invariant and not a preference.
 // A non-array `open` (absent, or corrupt) stays NULL — "never chosen" — rather than collapsing to
 // a tier default that would then look like a choice on the next read.
 const open = Array.isArray(v.open)
  ? [...new Set(v.open.filter((k): k is DockKey => typeof k === 'string' && (DOCK_KEYS as string[]).includes(k)))].slice(0, 2)
  : null;
 const side = typeof v.side === 'number' && Number.isFinite(v.side) ? clamp(v.side, SIDE_MIN, SIDE_MAX) : SIDE_DEFAULT;
 return {v: 1, open, side, sideCollapsed: v.sideCollapsed === true};
}
export const writeDocks = (p: DockPrefs): void => put(DOCK_KEY, p);

// ── atlas.pinyin — S4 ────────────────────────────────────────────────────────────────────────────
/** Declared at S0, written by nobody until S4. A bare boolean would have been the obvious shape and
 *  the wrong one: it cannot carry a version, so S4 could not tell "the human chose off" from
 *  "written by a build that meant something else by `false`". */
export interface PinyinPrefs {v: 1; on: boolean}
export const PINYIN_KEY = 'atlas.pinyin';
export function readPinyin(): PinyinPrefs {
 const v = raw(PINYIN_KEY);
 return isObj(v) && v.v === 1 && typeof v.on === 'boolean' ? {v: 1, on: v.on} : {v: 1, on: false};
}
export const writePinyin = (p: PinyinPrefs): void => put(PINYIN_KEY, p);

// ── atlas.scenes — S5a ───────────────────────────────────────────────────────────────────────────
/** A tab is the CONTROLLER's full scene blob plus the live camera pose (G6 as codex amended it:
 *  "a tab snapshot = the controller's full scene + camera, not the raw incoming blob"). The pose is
 *  six numbers, kept as a tuple so a partially-written one is detectable rather than half-applied. */
export interface SceneTab {blob: string; title: string; cam: [number, number, number, number, number, number] | null}
export interface ScenePrefs {v: 1; tabs: SceneTab[]}
export const SCENES_KEY = 'atlas.scenes', SCENES_CAP = 8;
const isCam = (v: unknown): v is SceneTab['cam'] =>
 Array.isArray(v) && v.length === 6 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
export function readScenes(): ScenePrefs {
 const v = raw(SCENES_KEY);
 if (!isObj(v) || v.v !== 1 || !Array.isArray(v.tabs)) return {v: 1, tabs: []};
 const tabs = v.tabs
  .filter(isObj)
  .filter((t) => typeof t.blob === 'string' && t.blob.length > 0)
  .map((t) => ({blob: t.blob as string, title: typeof t.title === 'string' ? t.title : '', cam: isCam(t.cam) ? t.cam : null}))
  .slice(0, SCENES_CAP);
 return {v: 1, tabs};
}
export const writeScenes = (p: ScenePrefs): void => put(SCENES_KEY, {v: 1, tabs: p.tabs.slice(0, SCENES_CAP)});

// ── atlas.openai — S5b ───────────────────────────────────────────────────────────────────────────
/**
 * ⚠️ DECLARED, DELIBERATELY NOT READ BY ANY RENDER PATH. The key is a SECRET, and the rule S5b will
 * be held to (opus-plan-review-2.md §G.3) is that it is read at CALL TIME and never held in React
 * state, a prop or a ref. So this module exposes a reader that returns the key and a remover that
 * deletes it — and deliberately no "load it into state on mount" helper, because that helper is
 * exactly the shape of the defect.
 *
 * `last4` is what the UI shows (`sk-***…last4`); it is derived on demand from the stored value and
 * is not persisted separately, so there is no second copy to leak or to fall out of step.
 */
export interface OpenAiPrefs {v: 1; key: string; model: string}
export const OPENAI_KEY = 'atlas.openai';
export function readOpenAi(): OpenAiPrefs | null {
 const v = raw(OPENAI_KEY);
 if (!isObj(v) || v.v !== 1 || typeof v.key !== 'string' || !v.key) return null;
 return {v: 1, key: v.key, model: typeof v.model === 'string' && v.model ? v.model : ''};
}
export const clearOpenAi = (): void => { try { localStorage.removeItem(OPENAI_KEY); } catch { /* ignore */ } };
/** `sk-***…abcd`. Takes the key as an argument rather than reading it, so a caller cannot
 *  accidentally obtain the whole secret by asking for the mask. */
export const maskKey = (key: string): string => (key.length > 4 ? `sk-***…${key.slice(-4)}` : 'sk-***');
