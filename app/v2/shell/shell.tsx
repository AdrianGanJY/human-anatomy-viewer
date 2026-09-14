/**
 * THE STUDIO SHELL — every region present, every control that is not wired says so.
 * L31 v2.1b+c, S0. Visual contract: `mock/spec.md` + artboards X5 / D1 / D2 / D7 / D9 / D10.
 *
 * ══ WHAT "PLACEHOLDER-FIRST" MEANS HERE ════════════════════════════════════════════════════════
 * ⚠️ S1 HAS LANDED, so the paragraphs below are S0's account with S1's corrections in place: the
 * floating pill and the on-screen key pad are now LIVE (they drive `window.__atlasNav` and the
 * dispatcher's held set), and the inert set is down from eleven controls to the tree's ticks, eyes
 * and filter (S3), Find (S2), pinyin (S4) and JSON edit / scene `+` (S5). Everything the section
 * on INERT ≠ DISABLED says still holds for those.
 *
 * The WIRING is placeholder. The SPACE is not, and neither is the copy. Adrian's complaint was
 * 感觉没有好好plan整个空间 — that the space was not planned — and you cannot react to a plan of a
 * space that is drawn in lorem and grey boxes. So every region is laid out at its final geometry,
 * in real EN / 简体 / 繁體, with real numbers off the real atlas; what is missing is the behaviour
 * behind eleven specific controls, and each of those carries `aria-disabled` and a tooltip naming
 * the group that brings it.
 *
 * ⚠️ S7 — THE INERT CONVENTION IS SPENT. All eleven are wired; nothing in `app/v2/` carries
 * `.v2-inert` or an `S<n>` tooltip any more, and two guards keep it that way: a source scan in
 * `test/v2-share.test.mjs` (which can see an unmounted modal) and a DOM scan at all six viewports
 * in `verify-ux.mjs` (which can see what a source scan cannot, a class applied at runtime). The
 * distinction it drew still governs the app and is kept here because the SECOND half is live:
 *   INERT    — "this is where that will be". Focusable, dashed neutral border, tooltip `S1`…`S5`.
 *              RETIRED at S7: no control is a placeholder any more.
 *   DISABLED — "not now, and here is why": Fit with nothing selected, Ask with an empty box, `+`
 *              at cap 8, the tree's undecidable eye. Real `disabled`, with the reason adjacent.
 *
 * ══ WHAT IS ALREADY LIVE, because the controller exists ════════════════════════════════════════
 * Selection (the set, roles, piece counts, remove, clear, focus, hide-others), Info (the
 * description card, the atlas reference, the included structures), Scene JSON (read-only, the
 * canonical blob pretty-printed), the language selector, Settings → General and About, the status
 * chip, the scene caption, the panel toggles, the sidebar collapse and the whole collapse ladder.
 * Those are real work, not placeholder, and S1–S5 do not rebuild them.
 *
 * ══ WHAT S3 WILL TEAR OUT, and it is rendered accordingly ══════════════════════════════════════
 * The fifteen tree rows are throwaway: S3 replaces them with a virtualised tree with roving
 * tabindex and tri-state checkboxes. (The pill and the pad were on this list at S0 and came off it
 * in S1, which is what "placeholder-first" is for.)
 */
import {useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {SYSTEMS, type Atlas, type Part, type SceneState, type SystemId, type View} from '../../anatomy';
import type {Dicts, T} from '../../i18n/dict';
import {atlasIndex} from '../find.ts';
import Tree, {type TreeProps} from './tree.tsx';
import {LANGS, LANG_LABELS, type Lang} from '../../i18n/ui';
import type {Scene} from '../../scene-model';
import type {Command, Reason} from '../controller';
import RefusalText from '../refusal.tsx';
import {KEY_MAP} from './keys.ts';
/** Injected by `vite.config.ts`'s `define`. Declared rather than imported because that is what a
 *  compile-time constant is; the fallbacks keep a bare `tsc`/test run honest. */
declare const __ATLAS_BUILD__: string | undefined;
declare const __ATLAS_COMMIT__: string | undefined;
const ATLAS_BUILD = typeof __ATLAS_BUILD__ === 'string' ? __ATLAS_BUILD__ : 'dev';
const ATLAS_COMMIT = typeof __ATLAS_COMMIT__ === 'string' ? __ATLAS_COMMIT__ : 'dev';
declare const __ATLAS_PINYIN__: string | undefined;
declare const __ATLAS_PINYIN_N__: number | undefined;
/** `pinyin-pro@3.29.4` and the number of readings — both read at build time from the shipped map's
 *  own stamp (vite.config.ts `readPinyinLib`), never typed into copy. */
const ATLAS_PINYIN = typeof __ATLAS_PINYIN__ === 'string' ? __ATLAS_PINYIN__ : 'pinyin-pro';
const ATLAS_PINYIN_N = typeof __ATLAS_PINYIN_N__ === 'number' ? __ATLAS_PINYIN_N__ : 0;
declare const __ATLAS_DEPS__: string | undefined;
/** `react 19.2.6 (MIT) · three 0.159.0 (MIT) · …` — the RESOLVED tree, read from each package's own
 *  manifest at build time. See `about.notices` for what this does and does not include. */
const ATLAS_DEPS = typeof __ATLAS_DEPS__ === 'string' ? __ATLAS_DEPS__ : '';
import type {NavMode, TabletTab} from './use-shell.ts';
import Overlay from './overlay.tsx';
import {DOCK_KEYS, KEYPAD_MODES, clearOpenAi, openAiMask, readOpenAiModel, saveOpenAiKey, setOpenAiModel, tabOrdinals, type DockKey, type KeypadMode, type SceneTab} from './store.ts';
// S7: the pure half of the three share controls and of the key-pad preference.
import {padRows} from './share.ts';
import AskPanel, {OPENAI_CHANGED, type AskState} from './ask.tsx';
import {MODELS, modelOf} from './ai.ts';
import {LIMITS} from '../../scene-codec.js';

const ICON = {stroke: 'currentColor', fill: 'none', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const};
const Ico = ({d, size = 15}: {d: string; size?: number}) =>
 <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" {...ICON}><path d={d}/></svg>;
const P = {
 layers: 'M10 2.5 2.5 6.5 10 10.5 17.5 6.5 10 2.5M2.5 10.5 10 14.5 17.5 10.5M2.5 14 10 18 17.5 14',
 find: 'M8.8 14.6a5.8 5.8 0 1 0 0-11.6 5.8 5.8 0 0 0 0 11.6M13.2 13.2 17 17',
 gear: 'M10 12.6a2.6 2.6 0 1 0 0-5.2 2.6 2.6 0 0 0 0 5.2M10 2.2v1.8M10 16v1.8M17.8 10H16M4 10H2.2M15.5 4.5l-1.3 1.3M5.8 14.2l-1.3 1.3M15.5 15.5l-1.3-1.3M5.8 5.8 4.5 4.5',
 help: 'M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15M8 7.6a2 2 0 1 1 2.6 2c-.5.2-.6.6-.6 1v.6M10 14.2h.01',
 camera: 'M3 6.6h2.6L7 4.6h6l1.4 2H17v8.8H3zM10 13.4a2.8 2.8 0 1 0 0-5.6 2.8 2.8 0 0 0 0 5.6',
 link: 'M8.4 11.6a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 0 0-4.2-4.2l-1 1M11.6 8.4a3 3 0 0 0-4.2 0L5 10.8a3 3 0 0 0 4.2 4.2l1-1',
 plate: 'M3 4.5h14v11H3zM3 12l4-3.5 3.5 3L14 8l3 3',
 more: 'M5 10h.01M10 10h.01M15 10h.01',
 eye: 'M1.8 10S4.8 4.8 10 4.8 18.2 10 18.2 10 15.2 15.2 10 15.2 1.8 10 1.8 10M10 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8',
 eyeOff: 'M3 3l14 14M8.2 8.3A2.4 2.4 0 0 0 10 12.4c.6 0 1.2-.2 1.7-.6M6.3 6.4C3.6 7.8 1.8 10 1.8 10s3 5.2 8.2 5.2c1.4 0 2.6-.4 3.7-.9M15.6 13C17.3 11.8 18.2 10 18.2 10S15.2 4.8 10 4.8c-.6 0-1.2.1-1.7.2',
 fit: 'M3 7V3.6h3.4M17 7V3.6h-3.4M3 13v3.4h3.4M17 13v3.4h-3.4',
 home: 'M3.4 8.6 10 3.2l6.6 5.4v7.6a1 1 0 0 1-1 1h-3.2v-4.6H7.6v4.6H4.4a1 1 0 0 1-1-1z',
 info: 'M10 17.4a7.4 7.4 0 1 0 0-14.8 7.4 7.4 0 0 0 0 14.8M10 9.2v4.4M10 6.6h.01',
 orbit: 'M10 15.6a5.6 5.6 0 1 0 0-11.2 5.6 5.6 0 0 0 0 11.2M3.2 12.6c-1.4.9-2.1 1.9-1.8 2.7.5 1.4 4.3 1.5 8.6.3M16.8 12.6c1.4.9 2.1 1.9 1.8 2.7-.5 1.4-4.3 1.5-8.6.3',
 pan: 'M10 3.2v13.6M3.2 10h13.6M10 3.2 8 5.4M10 3.2l2 2.2M10 16.8l-2-2.2M10 16.8l2-2.2M3.2 10l2.2-2M3.2 10l2.2 2M16.8 10l-2.2-2M16.8 10l-2.2 2',
 rotate: 'M16.4 8.4A6.6 6.6 0 1 0 16.8 12M16.4 4v4.4H12',
 keys: 'M2.6 5.6h14.8v8.8H2.6zM5.4 8.4h.01M8.2 8.4h.01M11 8.4h.01M13.8 8.4h.01M6 11.6h8',
 stage: 'M3 4.4h14v8.4H3zM10 12.8v3M7 15.8h6',
 chev: 'M7.6 4.6 13 10l-5.4 5.4',
 chevD: 'M4.6 7.6 10 13l5.4-5.4',
 x: 'M5 5l10 10M15 5 5 15',
 tick: 'M4.5 10.4l3.6 3.6L15.5 6.6',
};

export interface ShellProps {
 t: T; tr(k: string, v?: Record<string, string | number>): string;
 lang: Lang; applyLang(l: Lang): void;
 atlas: Atlas | null;
 /** `Pick` from app/selection.ts, structurally: a concept or part resolved against the atlas. The
  *  shape is restated rather than imported so this file does not drag `selection.ts`'s value import
  *  of SYSTEMS into anything that only wants the type. `system` is nullable there — a part whose
  *  system the manifest does not name — so it is nullable here. */
 basket: {id: string; name: string; system?: SystemId | null; conceptId: string; elements: string[]}[];
 focused: {id: string; name: string; conceptId: string; elements: string[]} | null;
 focusPick(id: string): void;
 clearPicks(): void;
 systemId: SystemId | undefined;
 describe(name: string | undefined, sys: SystemId | undefined): string;
 state: SceneState;
 dispatch(cmd: Command): boolean;
 scene: Scene | null;
 sceneBlob: string;
 picks: string[];
 caption: {title?: string; note?: string};
 phase: 'boot' | 'scene' | 'atlas';
 bytes: {done: number; total: number};
 background: 'light' | 'dark';
 /** S4: a keyed `Reason`, resolved at DRAW time by `RefusalText` so it follows the language. */
 refused: Reason | null;
 /** S4: the reading for one row, or null. Off, not-yet-loaded and not-Chinese all give null —
  *  see `use-shell.ts` `py`. Threaded as a FUNCTION so no surface holds the 214 KB map. */
 py(id: string, shown: string): string | null;
 pinyin: boolean; onPinyin(on: boolean): void;
 /** From the collapse ladder. The shell RENDERS them; page.tsx OWNS them. */
 docks: DockKey[];
 sideStub: boolean;
 autoCollapsed: boolean;
 onToggleDock(k: DockKey): void;
 onToggleSide(): void;
 /** `true` while the `?` overlay is open — owned above so the dispatcher can see it. */
 /** A coarse pointer. Drives the controls that must not exist at all on touch, as distinct from
  *  the ones that merely grow — the split `spec.md` makes for the 32 px scene tabs. */
 coarse: boolean;
 /** ── S6 ─────────────────────────────────────────────────────────────────────────────────── */
 /** 768-1179: the studio chrome with ONE shared right sheet instead of a sidebar and two docks. */
 tablet: boolean;
 tSheet: TabletTab | null; onTSheet(v: TabletTab | null): void;
 /** Opens the Scenes list — the coarse tiers' replacement for the 32 px status-strip tabs. */
 onScenes(v: boolean): void;
 /** The sheet is a 300 px inline column (landscape >= 1024) rather than a 360 px scrim overlay. */
 tabletInline: boolean;
 keysOpen: boolean; onKeys(open: boolean): void;
 settingsOpen: boolean; onSettings(open: boolean): void;
 /** S2. The palette itself is rendered by `page.tsx`, not here: it must exist at the PHONE tier too
  *  (the A4 sheet) and this component renders only at >=1180. The shell owns the button, the page
  *  owns the surface, and `useShell` owns the single piece of state both read. */
 findOpen: boolean; onFind(open: boolean): void;
 /** ── S3 ─────────────────────────────────────────────────────────────────────────────────── */
 dicts: Dicts;
 visibleIntent: SystemId[];
 /** The session-only hidden set — the NON-MEMBER eye. Owned by `page.tsx` (it merges it into the
  *  renderer's opacity map), never serialised, cleared when a scene is applied. */
 hidden: ReadonlySet<string>;
 onHide(id: string, on: boolean): void;
 /** What the RENDERER draws a concept at, through the whole chain. `app/v2/visibility.ts`. */
 effectiveAlpha(conceptId: string): number;
 /** Passed straight through to the tree — see TreeProps.eyeState (codex round 7, Medium 3). */
 eyeState: TreeProps['eyeState'];
 /** The sidebar's filter box. Lifted here so the head can render it and the tree can read it. */
 treeQuery: string; onTreeQuery(q: string): void;
 /** Sheet presentation below 768 — the phone path for the `?` map. */
 sheet: boolean;
 /** ── S5a ────────────────────────────────────────────────────────────────────────────────────
  *  The snapshot list (from `useShell`, shared with the phone's A9 sheet) and the two operations
  *  the PAGE owns, because both need the controller: applying a tab is a transaction plus a camera
  *  restore, and snapshotting reads the live pose off the renderer. */
 tabs: SceneTab[];
 tabsFull: boolean;
 onSnapshot(): void;
 onApplyTab(t: SceneTab): void;
 /** ── S7 ─────────────────────────────────────────────────────────────────────────────────────
  *  The three controls that shipped inert at S0 and stayed inert through S6 — Adrian found them on
  *  the live site. All four callbacks live in `page.tsx`: the capture needs `__atlasCapture`, the
  *  link needs the address the URL writer has written, and both plate acts need the controller's
  *  scene through `atlas.plate()`. */
 onCapture(): void;
 onCopyLink(): void;
 /** Enter presentation mode. S1 bound `Shift+S` and S6 gave the stage a persistent way out, but
  *  ENTERING it had no pointer at all — which on a coarse 1366x1024 desktop means it did not
  *  exist. It lives in the studio's More menu. */
 onStage(): void;
 /** S5b: owned by `useShell` so closing the dock cannot discard a draft (round 22, Medium 5). */
 askState: AskState;
}

const MB = (n: number) => (n / 1048576).toFixed(1);

/**
 * ── A TAB'S LABEL AND ITS TOOLTIP — S5b prelude, codex r21 LOW 1 ───────────────────────────────
 *
 * Carried unfixed across rounds 18–21: the label is the scene's CAPTION, so pressing `+` twice on
 * one scene produces two identical tabs restoring two different cameras. Rename is out of this
 * increment (`spec.md` §Rejected), so the label takes a POSITIONAL ordinal and the tooltip takes
 * the SNAPSHOT TIME — positional because eviction renumbers, and the time because it does not.
 *
 * ⚠️ ONE IMPLEMENTATION FOR BOTH SURFACES. The desktop strip and the phone's A9 sheet render the
 * same list, and the way this goes wrong is one of them getting the ordinal and the other not —
 * so there is one function and neither surface computes anything of its own.
 *
 * ⚠️ THE DATE IS FORMATTED BY THE PLATFORM, in the UI language, never by a string in `copy.ts`.
 * A table of date words is a table that disagrees with the reader's own clock format.
 */
const tabLabel = (t: SceneTab, ord: number | null, untitled: string): string =>
 `${t.title || untitled}${ord === null ? '' : ` · ${ord}`}`;
const tabTip = (
 tr: ShellProps['tr'], lang: Lang, t: SceneTab, ord: number | null, untitled: string,
): string => {
 const parts = [t.title || untitled];
 if (ord !== null) parts.push(tr('tabs.nth', {n: ord}));
 if (t.cam) parts.push(tr('tabs.pose'));
 // `at` is absent on every tab written before S5b. The tooltip then simply says less, rather than
 // showing "Invalid Date" or inventing a time from when the page happened to load.
 if (typeof t.at === 'number' && Number.isFinite(t.at)) {
  let when: string;
  // A locale the runtime does not know throws a RangeError out of `toLocaleString`, which would
  // take the whole strip down for a tooltip.
  try { when = new Date(t.at).toLocaleString(lang); } catch { when = new Date(t.at).toISOString(); }
  parts.push(tr('tabs.taken', {t: when}));
 }
 return parts.join(' — ');
};

/**
 * THE FIELD OVERLAYS — a SEPARATE component, and the split is structural rather than tidy.
 *
 * `.v2-field` is rendered by `app/v2/page.tsx` (it holds the renderer, which must never be
 * remounted), so the caption / pill / key pad / legend cannot be children of the chrome fragment
 * below — they have to be children of the field. Two components, each with its own hook list, is
 * also what keeps `{studio && <StudioChrome/>}` legal: a single function returning an object of
 * regions would have had to be CALLED from page.tsx's render, putting its hooks into page.tsx's
 * hook list conditionally, which is the rules-of-hooks violation that crashes on the first resize
 * across 1180.
 *
 * This one holds no state at all — see the pill note below.
 */
/** The pad's twelve cells, in reading order: W / A S D on the left, the arrow cluster on the
 *  right. `null` is a SPACER, not an empty key — drawn with the key border they read as broken
 *  buttons, which is what S0's first screenshot showed. The `code` is the PHYSICAL code the cell
 *  presses, which is the whole reason a finger and a keyboard are the same event downstream. */
/** The tablet sheet's three panels, in the order `spec.md` draws them. */
const TABLET_TABS: TabletTab[] = ['layers', 'selection', 'info'];


export function StudioField(p: {
 tr: ShellProps['tr']; caption: ShellProps['caption']; state: SceneState;
 dispatch: ShellProps['dispatch']; structures: number; pieces: number; onKeys(open: boolean): void;
 navMode: NavMode; onNavMode(m: NavMode): void;
 held: ReadonlySet<string>; press(code: string): void; release(code: string): void;
 onFit(): void; onHome(): void; onSnapshot(): void;
 /** S7: `off` / `arrows` / `full` from `atlas.keypad`. */
 keypad: KeypadMode;
}) {
 const {tr} = p;
 const pad = padRows(p.keypad);
 /**
  * ⚠️ AND EVEN IF THE PAD ITSELF GOES AWAY UNDER THE FINGER.
  *
  * `StudioField` unmounts when the studio tier is lost AND when `?stage=1` is entered
  * (`page.tsx`: `shell.studio && !stage`). Either way a finger holding a pad key never delivers its
  * `pointerup` to a node that still exists, and none of the dispatcher's window-level clearing
  * paths fire — so the code sits in `held` for ever: the camera pans indefinitely and the discrete
  * twin of that code becomes unreachable. `use-shell` clears on a tier change, which covers the
  * resize; this covers EVERY reason this component can disappear, which is the honest scope
  * (round 3, Medium: the `[studio]` dependency missed `stage`).
  */
 const release = p.release;
 // S7: `padRows('full')` is the COMPLETE set of pad codes, not the currently drawn one —
 // a reader who switches the pad to `off` while holding W unmounts the key under their finger,
 // which is the same missing-keyup this cleanup exists for.
 useEffect(() => () => { for (const k of padRows('full').flat()) if (k) release(k.code); }, [release]);
 /**
  * ⚠️ A PAD KEY MUST BE RELEASED EVEN IF THE FINGER LEAVES IT. `pointerup` fires on the element
  * the pointer is OVER, so dragging off a key delivers the up somewhere else and the camera pans
  * for ever — the touch twin of the held-key defect guard 6 exists for. `setPointerCapture` binds
  * the whole gesture to the key that started it, so `pointerup`/`pointercancel` always come home.
  */
 const hold = (code: string) => ({
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => {
   e.preventDefault();
   e.currentTarget.setPointerCapture?.(e.pointerId);
   p.press(code);
  },
  onPointerUp: () => p.release(code),
  onPointerCancel: () => p.release(code),
  onPointerLeave: () => p.release(code),
  /**
   * KEYBOARD-REACHABLE TOO. A pad key is a real button, so Space/Enter must do something; a click
   * is a discrete nudge rather than a hold, which is the honest translation.
   *
   * ⚠️ `detail === 0` IS WHAT MAKES IT KEYBOARD-ONLY. A mouse gesture fires `pointerup` AND then
   * `click`, so without this every finger press ran press → release → press → release(+140 ms):
   * the key flickered, and a reader who let go still saw it lit for a beat. It also made the pad
   * oracle timing-dependent — it read `aria-pressed` after the gesture and sometimes caught the
   * click's phantom second press, which reads as "a key left stuck down". A click synthesised by
   * the keyboard reports `detail === 0`; one that came from a pointer does not.
   */
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => {
   if (e.detail !== 0) return;
   p.press(code);
   setTimeout(() => p.release(code), 140);
  },
 });
 return <>
  {p.caption.title && <div className="v2-cap">
   <span className="v2-sub">{tr('view.this')}</span>
   <b>{p.caption.title}</b>
   {p.caption.note && <p>{p.caption.note}</p>}
  </div>}
  {/* S1: EVERY CONTROL IN THIS GROUP IS LIVE. The pill, the pad and the physical keyboard are
      three inputs to the same commands — the pill's Fit/Home call the renderer's `__atlasNav`,
      the pad presses physical codes into the dispatcher's held set, and the named views and Reset
      go through the controller exactly as the phone's do. */}
  <div className="v2-pill" role="group" aria-label={tr('nav.controls')}>
   {(['orbit', 'pan'] as NavMode[]).map((m) => <button
    type="button" key={m} className={`v2-pbtn ${p.navMode === m ? 'is-on' : ''}`} aria-pressed={p.navMode === m}
    onClick={() => p.onNavMode(m)}><Ico d={m === 'pan' ? P.pan : P.orbit}/>{tr(`nav.${m}`)}</button>)}
   <span className="v2-sep"/>
   {(['three-quarter', 'front', 'side', 'back'] as View[]).map((v) => <button
    type="button" key={v} className={`v2-pbtn ${p.state.view === v ? 'is-on' : ''}`} aria-pressed={p.state.view === v}
    onClick={() => p.dispatch({type: 'set-view', view: v})}>{tr(`view.${v}`)}</button>)}
   <span className="v2-sep"/>
   <button type="button" className="v2-pbtn" aria-label={tr('nav.fit')} title={tr('nav.fit')} onClick={p.onFit}><Ico d={P.fit}/></button>
   <button type="button" className="v2-pbtn" aria-label={tr('nav.home')} title={tr('nav.home')} onClick={p.onHome}><Ico d={P.home}/></button>
   {/* `reset-view` is a controller command the phone already exposes, so leaving it out of the
       studio would have silently dropped a working control in the move. */}
   <button type="button" className="v2-pbtn" aria-label={tr('view.reset')} title={tr('view.reset')}
    onClick={() => p.dispatch({type: 'reset-view'})}><Ico d={P.rotate}/></button>
   <button type="button" className="v2-pbtn" aria-label={tr('nav.snapshot')} title={tr('nav.snapshot')} onClick={p.onSnapshot}><Ico d={P.camera}/></button>
   <button type="button" className="v2-pbtn" aria-label={tr('nav.keypad')} title={tr('nav.keypad')} onClick={() => p.onKeys(true)}><Ico d={P.keys}/></button>
   <button type="button" className="v2-pbtn" aria-label={tr('nav.info')} onClick={() => p.onKeys(true)}><Ico d={P.info}/></button>
  </div>
  {/* S7: THE PAD IS A PREFERENCE NOW (`atlas.keypad`). `off` draws nothing, `arrows` drops the
      letter block, `full` is what the app has always drawn and remains the default for a reader who
      has never chosen. `data-cols` carries the row width so the grid and `padRows` cannot disagree
      about how many columns a mode needs. */}
  {pad.length > 0 && <div className="v2-pad" aria-label={tr('nav.keypad')} role="group" data-cols={pad[0].length}>
   {pad.flat().map((k, i) => (k
    ? <button
       type="button" key={i}
       className={`v2-cap-key ${p.held.has(k.code) ? 'is-down' : ''}`}
       // THE PHYSICAL KEY LIGHTS THE ON-SCREEN ONE. `held` is the dispatcher's set, so pressing W
       // on the keyboard highlights the pad's W — the cheapest proof to a reader that the two
       // controls are one thing rather than two that happen to look alike.
       aria-pressed={p.held.has(k.code)}
       aria-label={k.code}
       {...hold(k.code)}
      >{k.label}</button>
    : <span key={i} className="v2-cap-key is-gap" aria-hidden="true"/>))}
  </div>}
  <div className="v2-legend">
   <div><span>{tr('legend.inView')}</span><b>{p.structures}</b></div>
   <div><span>{tr('legend.pieces')}</span><b>{p.pieces.toLocaleString()}</b></div>
  </div>
 </>;
}


/**
 * ══ THE OVERFLOW MENU — S6 ═════════════════════════════════════════════════════════════════════
 *
 * `spec.md`: "Chrome never wraps. Toolbar overflow priority: camera extras → selection actions →
 * named views → textual share labels. More remains reachable." On a coarse pointer every control in
 * the tools row is 44 px rather than 32, so a 768 px portrait toolbar cannot hold what a 1440 px
 * desktop one holds — and the answer `spec.md` refuses is a second toolbar row.
 *
 * It is a MENU, not a dialog: no scrim, no focus trap, no `aria-modal`. It closes on Escape, on a
 * pointer outside it, and on choosing anything — and Escape and the outside click both return focus
 * to the button, because a menu that leaves focus on a removed node drops the keyboard reader at
 * the top of the document.
 */
function More(p: {label: string; children: React.ReactNode; className?: string}) {
 const [open, setOpen] = useState(false);
 const [at, setAt] = useState<{top: number; right: number} | null>(null);
 const wrap = useRef<HTMLDivElement | null>(null);
 const pop = useRef<HTMLDivElement | null>(null);
 const btn = useRef<HTMLButtonElement | null>(null);

 /**
  * ⚠️ `position:fixed`, MEASURED FROM THE BUTTON — codex round 24, HIGH 1, and it is the defect I
  * would least have found by looking.
  *
  * `.v2-tools` carries `overflow:hidden` (it is what keeps the chrome from wrapping). The first
  * build positioned the menu `absolute` inside it, so EVERY ITEM had zero visible height — the
  * whole menu was clipped by the toolbar it hangs from, and on the tablet JSON and Ask live
  * NOWHERE ELSE. A z-index cannot climb out of an ancestor's clip; only leaving that ancestor's
  * containing block can, and `fixed` does exactly that (no transformed ancestor here to catch it).
  *
  * The oracle certified the broken state, which is the worse half: it measured the items'
  * HEIGHTS and their horizontal bounds and never asked whether an ancestor was clipping them —
  * the exact check codex had just made me add for the Ask panel's Apply button.
  */
 const place = useCallback(() => {
  const r = btn.current?.getBoundingClientRect();
  if (r) setAt({top: Math.round(r.bottom + 4), right: Math.round(window.innerWidth - r.right)});
 }, []);
 useEffect(() => {
  if (!open) return;
  place();
  const onDown = (e: PointerEvent) => {
   if (!wrap.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) {
    setOpen(false); btn.current?.focus();
   }
  };
  // `pointerdown` rather than `click`: a click that lands on another control must close this first,
  // and a `click` listener fires after that control has already acted with the menu still open.
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
  return () => {
   window.removeEventListener('pointerdown', onDown, true);
   window.removeEventListener('resize', place);
   window.removeEventListener('scroll', place, true);
  };
 }, [open, place]);

 /** The menu's own items, in DOM order, for roving focus. */
 const items = () => [...(pop.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
  .filter((b) => !b.disabled);
 // OPENING FOCUSES THE FIRST ITEM (codex round 24, Medium 2). Without it the menu opened behind the
 // keyboard: Tab walked into the toolbar behind it and ArrowDown reached the CAMERA.
 useEffect(() => { if (open) requestAnimationFrame(() => items()[0]?.focus()); }, [open]);

 /**
  * ⚠️ THE MENU EATS ITS OWN KEYS. It is a menu, not a modal, so the global dispatcher is still
  * live — and codex executed ArrowDown inside it reaching the camera's held set. Every key this
  * handler consumes is stopped here (`stopPropagation`) rather than declined downstream, which is
  * the only version of "the camera does not move while a menu is open" that does not require the
  * dispatcher to know what a menu is.
  */
 const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
  const list = items();
  const i = list.indexOf(document.activeElement as HTMLButtonElement);
  const go = (n: number) => { ev.preventDefault(); ev.stopPropagation(); list[(n + list.length) % list.length]?.focus(); };
  if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); setOpen(false); btn.current?.focus(); return; }
  if (!list.length) return;
  if (ev.key === 'ArrowDown') return go(i + 1);
  if (ev.key === 'ArrowUp') return go(i - 1);
  if (ev.key === 'Home') return go(0);
  if (ev.key === 'End') return go(list.length - 1);
  // Anything else that the camera would consume: swallow it while the menu has focus.
  if (/^(Arrow|Key|Digit)/.test(ev.code) || ev.key === 'Tab') ev.stopPropagation();
 }, []);

 // DISMISS ON FOCUS DEPARTURE (Medium 2). A menu left open behind the focus is a menu whose items
 // are still in the tab order of a surface the reader has left.
 const onBlur = useCallback((ev: React.FocusEvent) => {
  const next = ev.relatedTarget as Node | null;
  if (next && (wrap.current?.contains(next) || pop.current?.contains(next))) return;
  setOpen(false);
 }, []);

 return <div className={`v2-more ${p.className ?? ''}`} ref={wrap} onKeyDown={onKeyDown} onBlur={onBlur}>
  <button type="button" ref={btn} className={`v2-tbtn ${open ? 'is-on' : ''}`}
   aria-haspopup="menu" aria-expanded={open} aria-label={p.label} title={p.label}
   onClick={() => setOpen((v) => !v)}><Ico d={P.more}/></button>
  {open && <div className="v2-pop" role="menu" aria-label={p.label} ref={pop}
   style={at ? {top: at.top, right: at.right} : {visibility: 'hidden'}}
   onKeyDown={onKeyDown} onBlur={onBlur}
   // Choosing anything closes the menu. One handler on the container rather than a wrapper around
   // every item: an item that forgets to close is the defect this shape cannot have.
   onClick={() => { setOpen(false); btn.current?.focus(); }}>{p.children}</div>}
 </div>;
}

export default function Shell(p: ShellProps) {
 const {t, tr, lang} = p;
 const [tab, setTab] = useState<'general' | 'language' | 'about'>('general');

 /**
  * ⚠️ S3 REMOVED THE FOURTH COPY OF THE GROUPING RULE. This component used to derive its own
  * `systemConcepts` inline — a concept's system is the MODAL system of its elements — which made
  * FOUR implementations of one rule: here, `find.ts indexOf()`, `selection.ts dominantSystem` and
  * (wrongly) the palette's first `parts[].conceptId` version, whose disagreement with the other
  * three was S2's High 2. The rule now lives once, in `find.ts`, memoised per atlas in a `WeakMap`,
  * and both the tree and this header read it.
  *
  * MEASURED BEFORE REPLACING, because a count that moves silently is the defect: on the live atlas
  * all fifteen counts are identical between the two implementations, both total 3,432, and neither
  * leaves a concept unassigned (`.artifacts/L31/v21bc/s3/count-compare.txt`). The de-duplication
  * moves no number.
  *
  * DETERMINISTIC ORDER = `anatomy.ts`'s declaration order, and that is a MEASURED decision rather
  * than the obvious one. The mock's column is sorted by concept count descending, and so was S0's
  * first build — but the counts are derived from the ATLAS, which arrives ~1 s after the first
  * paint, so every row was in one place before it landed and somewhere else after. The CLS oracle
  * measured it immediately: 0.0124 at 1440×900 and 0.0062 at 1920×860, attributed by the browser's
  * own observer to `li.v2-tree-row`, against a budget of 0.001. The declaration order is static and
  * available in frame one. `spec.md` asks for "deterministic order", which this is; it is simply
  * not the mock's order, and the trade is a visual nicety for the CLS property the design rests on.
  */
 const liveSystems = useMemo(() => {
  if (!p.atlas) return SYSTEMS.length;
  const idx = atlasIndex(p.atlas);
  return SYSTEMS.filter((s) => (idx.bySystem.get(s.id)?.length ?? 0) > 0).length;
 }, [p.atlas]);

 /**
  * THE CHIP'S TWO NUMBERS ARE THE BARRIER'S OWN FROZEN STAMPS — the same pair `verify-ux.mjs`
  * asserts (`data-atlas-scene-bytes` / `data-atlas-scene-requests`), not a live reading.
  *
  * ⚠️ CAUGHT BY LOOKING: the first build printed `bytes.done`, which keeps CLIMBING as the rest of
  * the body arrives in the background — so "Scene ready · 9.1 MB · 4 chunks" drifted to 21.3, then
  * 28.0 MB while still claiming to describe the scene. The whole point of the barrier stamp is that
  * it is the measurement of THIS view, taken once, at the moment the view became usable.
  */
 const [stamp, setStamp] = useState({bytes: 0, chunks: 0});
 useEffect(() => {
  const d = document.documentElement.dataset;
  const bytes = Number(d.atlasSceneBytes), chunks = Number(d.atlasSceneRequests);
  if (Number.isFinite(bytes) && bytes > 0) setStamp({bytes, chunks: chunks || 0});
 }, [p.phase, p.bytes.done]);

 const allReady = p.phase === 'atlas';
 const pieces = p.state.selected.length;
 /** ROLE ORDER, the same order the phone's rail already uses: what the link is TEACHING first, then
  *  its context, then the ghost. `Array.prototype.sort` is stable in every engine this ships to, so
  *  structures of one role keep the atlas's own order and nothing reshuffles between renders. */
 const ROLE_N = {primary: 0, context: 1, ghost: 2} as const;
 const cards = useMemo(() => {
  if (!p.scene) return p.basket;
  const role = new Map(p.scene.structures.map((s) => [s.id, s.role]));
  return [...p.basket].sort((a, b) => (ROLE_N[role.get(a.id) ?? 'context'] - ROLE_N[role.get(b.id) ?? 'context']));
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [p.basket, p.scene]);
 const title = p.caption.title || (p.focused ? t.name(p.focused.id, p.focused.name) : tr('app.title'));
 /**
  * ⚠️ S3b — THE SLIDER READS WHAT THE RENDERER DRAWS, not the scene's declaration.
  *
  * It used to be `styles.find(...)?.opacity ?? 1`, and codex r4's second High is that an absent
  * opacity is NOT 1: `scene-codec.js:403` inherits `roleOpacity[role]`. codex executed the slider's
  * own "100%" command (`set-opacity(null)`) on a context structure and measured the control printing
  * 100% while the renderer drew 0.55. `p.effectiveAlpha` is the same reading the tree's eye uses —
  * one fact, two controls, and now genuinely one number.
  */
 const alphaOf = (id: string): number => p.effectiveAlpha(id);

 const dockTitle: Record<DockKey, string> = {
  selection: tr('panel.selection'), info: tr('panel.info'), json: tr('panel.json'), ask: tr('panel.ask'),
 };

 // ── the app bar ─────────────────────────────────────────────────────────────────────────────
 const bar = <header className="v2-bar">
  <a className="v2-skip" href="#v2-field">{tr('studio.skip')}</a>
  <span className="v2-brand">
   <svg width="17" height="17" viewBox="0 0 20 20" aria-hidden="true" {...ICON}>
    <path d="M10 2v16M6 5h8M6.8 9.4h6.4M7.6 14h4.8"/>
   </svg>
   {tr('app.title')}
  </span>
  <span className="v2-bar-sep"/>
  <span className="v2-bar-text">
   <b title={title}>{title}</b>
   {p.caption.note && <i title={p.caption.note}>{p.caption.note}</i>}
  </span>
  {/* THE STATUS CHIP. Two states, both real: the scene barrier's own figures while the rest is
      still arriving, and the whole-body count once it is. Never a fabricated percentage. */}
  {/* ⚠️ "LOADING" HERE MEANS THE BOOT PHASE ONLY. The first build used the page's `loading` flag
      (`boot || (scene && total>0)`), so the chip said "Loading this view" while the field's own
      progress line beside it said "This view is ready" — two instruments, one page, opposite
      claims. Once the barrier fires, the view IS ready; what is still arriving is the rest of the
      body, and that is what `status.ready` says. */}
  <span className={`v2-chip ${p.phase === 'boot' ? 'is-loading' : ''}`} role="status">
   <s/>
   {p.phase === 'boot'
    ? tr('entry.loading')
    : allReady
     // ⚠️ THE WHOLE BODY IS THE ATLAS'S CHUNK COUNT, not the scene's. The first build reused the
     // barrier stamp here and announced "Whole body loaded · 4 chunks" — the scene's four — for a
     // fifteen-chunk model. Two different populations; they needed two different numbers.
     ? tr('status.all', {n: p.atlas?.chunks.length ?? 0})
     : tr('status.ready', {mb: MB(stamp.bytes || p.bytes.total), n: stamp.chunks})}
  </span>
  <span className="v2-lang" role="group" aria-label={tr('lang.aria')}>
   {LANGS.map((l) => <button type="button" key={l} lang={l} className={lang === l ? 'is-on' : ''}
    aria-pressed={lang === l} onClick={() => p.applyLang(l)}>{LANG_LABELS[l]}</button>)}
  </span>
  <button type="button" className="v2-tbtn" aria-label={tr('settings.open')} title={tr('settings.open')}
   onClick={() => { setTab('general'); p.onSettings(true); }}><Ico d={P.gear}/></button>
  <button type="button" className="v2-tbtn" aria-label={tr('keys.title')} title={tr('keys.title')}
   onClick={() => p.onKeys(true)}><Ico d={P.help}/></button>
 </header>;

 // ── the tools row ───────────────────────────────────────────────────────────────────────────
 // All four docks are LIVE at S0 — Selection, Info and Scene JSON read the controller, and Ask is
 // the ChatGPT hand-off the kickoff permits. (An earlier version branched on a `live` flag into two
 // identical elements; the branch was dead code claiming a distinction that does not exist.)
 const panelBtn = (k: DockKey | 'layers') => {
  if (k === 'layers') {
   return <button type="button" key="layers" className={`v2-tbtn ${!p.sideStub ? 'is-on' : ''}`}
    aria-pressed={!p.sideStub} onClick={p.onToggleSide}>
    <Ico d={P.layers}/>{tr('panel.layers')}
   </button>;
  }
  const on = p.docks.includes(k);
  return <button type="button" key={k} className={`v2-tbtn ${on ? 'is-on' : ''}`} aria-pressed={on}
   onClick={() => p.onToggleDock(k)}>{dockTitle[k]}</button>;
 };
 const tools = <div className="v2-tools" role="toolbar" aria-label={tr('panel.panels')}>
  {panelBtn('layers')}
  {DOCK_KEYS.map(panelBtn)}
  <span className="v2-sep"/>
  {/* FIND IS LIVE AS OF S2. The `aria-label` stays alongside the visible label: the button's
      textContent is "Find" + its shortcut chip, so a reachability oracle matching on an exact name
      needs the accessible name to BE the name. A screen reader needed it anyway. */}
  <button type="button" className="v2-tbtn v2-findbtn" aria-label={tr('search.open')}
   aria-haspopup="dialog" aria-expanded={p.findOpen} onClick={() => p.onFind(true)}>
   <Ico d={P.find}/><span className="v2-grow">{tr('search.open')}</span><span className="v2-kbd">Ctrl K</span>
  </button>
  <span className="v2-sep"/>
  <button type="button" className="v2-tbtn" disabled={!p.focused}
   onClick={() => p.focused && p.focusPick(p.focused.id)}>{tr('panel.focus')}</button>
  <button type="button" className={`v2-tbtn ${p.state.isolate ? 'is-on' : ''}`} disabled={!p.basket.length}
   aria-pressed={p.state.isolate}
   onClick={() => p.dispatch({type: 'set-isolate', on: !p.state.isolate})}>{tr('margin.hideOthers')}</button>
  <button type="button" className="v2-tbtn" disabled={!p.basket.length} onClick={p.clearPicks}>{tr('margin.clear')}</button>
  <span className="v2-grow"/>
  {/* ── S7: THE THREE THAT WERE INERT ───────────────────────────────────────────────────────────
      Adrian, on the live site: "the toolbar's 截图 / 复制链接 / 分享图版 still carry the S1 tooltip
      and do nothing". They are three different acts and they are deliberately three plain buttons:
      the SECOND way to share a plate ("copy the link" rather than "open it") is in More below,
      because a menu that opens under a pointer is a worse default than the act itself. */}
  {/* ⚠️ `data-act` IS FOR THE ORACLES, and it is here because its absence produced a FALSE RED.
      The sweep's first S7 pass reported `button=MISSING` for all three: its driver matched the
      English labels while the §9 scene declares 简体, so it was looking for "Snapshot" on a button
      that says 截图. A driver that selects a control by its TRANSLATED TEXT measures the language,
      not the control — and this app has three of them. */}
  <button type="button" className="v2-tbtn" data-act="snapshot" title={tr('keys.snapStage')}
   onClick={p.onCapture}><Ico d={P.camera}/>{tr('nav.snapshot')}</button>
  <button type="button" className="v2-tbtn" data-act="copy-link" onClick={p.onCopyLink}><Ico d={P.link}/>{tr('nav.link')}</button>
  {/* ⚠️ 分享图版 IS NOT HERE, AND ITS ABSENCE IS THE FINDING — codex round 27, HIGH 1 and 3.
      `/api/snap` authenticates the SHARED SECRET or an Access JWT for the `anatomy.adrian.my/mcp`
      application (functions/api/snap.js:53-64); it does not read the browser's own
      `CF_Authorization` cookie, which is a different audience. codex executed the production
      endpoint with locally signed tokens: a valid browser cookie returns 401 and renders nothing.
      So the control would have opened a tab on an error page for the one person who pressed it —
      and my sweep could not see it, because it INTERCEPTS `/api/snap` and always answers a PNG.
      The plate is an AGENT surface (the MCP holds the right credential). Giving a browser reader
      one needs a decision Adrian owns (may a site-authenticated browser spend Browser Rendering
      minutes?) plus a `canonical()` change in `workers/snap/src/helpers.mjs`, which is in
      `renderPaths` and would move every cache key. That is not an S7 line item; it is escalated,
      named, with an owner. `atlas.plate()` is untouched and the MCP path is unaffected. */}
  {/* THE COARSE DESKTOP'S SCENES TRIGGER (codex round 24, Medium 3). At >=1180 with a fine pointer
      the snapshots are the status strip's tabs; on a coarse pointer those tabs are refused as
      28 px targets and this 44 px button is what replaces them. */}
  {p.coarse && <button type="button" className="v2-tbtn" onClick={() => p.onScenes(true)}>{tr('tabs.short')}</button>}
  {/* ── S7: THE STUDIO'S More IS REAL NOW, and it holds the three things that had no pointer at all.
      PRESENTATION MODE is the one that matters: S1 made `Shift+S` enter the stage and S6 gave it a
      persistent way out, but entering it was reachable ONLY from the keyboard — on a 1366x1024
      coarse desktop that is not reachable at all. Copy-plate-link is share-plate's second half, and
      Scenes is here for the same reason it is in the tablet's More. */}
  <More label={tr('nav.more')}>
   <button type="button" role="menuitem" className="v2-popitem" data-act="stage" onClick={p.onStage}>{tr('nav.stage')}</button>
   <span className="v2-popsep"/>
   <button type="button" role="menuitem" className="v2-popitem" onClick={() => p.onScenes(true)}>{tr('tabs.short')}</button>
  </More>
 </div>;

 /**
  * ── THE TABLET'S TOOLS ROW — S6 ───────────────────────────────────────────────────────────────
  *
  * The same 44 px row, with the same controls, arranged for a viewport that is 768 px wide and a
  * pointer that is a finger. Three differences, each from `spec.md`:
  *
  *  · the panel buttons are the SHEET'S TABS. There is one sheet, so "open Selection" and "switch
  *    to Selection" are the same act — `aria-pressed` says which one is showing, and pressing the
  *    showing one closes the sheet, exactly as a dock toggle does upstairs.
  *  · Find keeps its full-width button (it is the single most used control) but drops the `Ctrl K`
  *    chip, which names a key a tablet does not have.
  *  · everything else moves into More, in the spec's own priority order — selection actions first,
  *    then the share/snapshot group. Nothing is dropped and nothing wraps.
  */
 const tabletTab = (k: TabletTab) => {
  const on = p.tSheet === k;
  const label = k === 'layers' ? tr('panel.layers') : k === 'selection' ? tr('panel.selection') : tr('panel.info');
  // ⚠️ THE ACCESSIBLE NAME IS THE LABEL ALONE, WITHOUT THE COUNT. The reachability oracle matches a
  // control by `textContent === 'Selection'` OR its aria-label, and this button's text is
  // "Selection" + the basket count — so on a bare `?select=` visit it read as absent. A screen
  // reader had the same problem in words: "Selection 3" is a name that changes as you work.
  return <button type="button" key={k} className={`v2-tbtn ${on ? 'is-on' : ''}`} aria-pressed={on}
   aria-controls="v2-tsheet" aria-label={label}
   onClick={() => p.onTSheet(on ? null : k)}>
   {k === 'layers' ? <Ico d={P.layers}/> : null}{label}
   {k === 'selection' && p.basket.length > 0 ? <em className="v2-count">{p.basket.length}</em> : null}
  </button>;
 };
 const tabletTools = <div className="v2-tools is-compact" role="toolbar" aria-label={tr('panel.panels')}>
  {TABLET_TABS.map(tabletTab)}
  <span className="v2-sep"/>
  <button type="button" className="v2-tbtn v2-findbtn" aria-label={tr('search.open')}
   aria-haspopup="dialog" aria-expanded={p.findOpen} onClick={() => p.onFind(true)}>
   <Ico d={P.find}/><span className="v2-grow">{tr('search.open')}</span>
  </button>
  <span className="v2-grow"/>
  <More label={tr('nav.more')}>
   <button type="button" role="menuitem" className="v2-popitem" disabled={!p.focused}
    onClick={() => p.focused && p.focusPick(p.focused.id)}>{tr('panel.focus')}</button>
   <button type="button" role="menuitem" className={`v2-popitem ${p.state.isolate ? 'is-on' : ''}`}
    disabled={!p.basket.length} aria-pressed={p.state.isolate}
    onClick={() => p.dispatch({type: 'set-isolate', on: !p.state.isolate})}>{tr('margin.hideOthers')}</button>
   <button type="button" role="menuitem" className="v2-popitem" disabled={!p.basket.length}
    onClick={p.clearPicks}>{tr('margin.clear')}</button>
   <span className="v2-popsep"/>
   {/* ⚠️ JSON AND ASK ARE NOT DROPPED ON THE TABLET, THEY ARE BEHIND THE OVERFLOW — `spec.md`
       T2/T3: "Tablet tabs are Layers / Selection / Info, with JSON and Ask in Panels/More." They
       open the SAME sheet at a different panel, so "exactly one sheet" still holds and the reader
       has one mental model for five panels. The first build of this row shipped without them and
       the Ask reachability oracle at 768 said so immediately: the whole chat had no surface. */}
   {(['json', 'ask'] as TabletTab[]).map((k) => <button type="button" role="menuitem" key={k}
    className={`v2-popitem ${p.tSheet === k ? 'is-on' : ''}`} aria-pressed={p.tSheet === k}
    onClick={() => p.onTSheet(p.tSheet === k ? null : k)}>{k === 'json' ? tr('panel.json') : tr('panel.ask')}</button>)}
   <span className="v2-popsep"/>
   {/* ⚠️ THE SCENES TRIGGER LIVES HERE, AND ONLY HERE, ON A COARSE SCREEN. `spec.md`: "On coarse
       screens use a 44 px Scenes trigger in Panels/More opening a sheet, never 32 px touch tabs."
       The status strip's tabs are already gated on `!p.coarse`; this is their replacement. */}
   <button type="button" role="menuitem" className="v2-popitem" disabled={!p.scene}
    title={p.tabsFull ? tr('tabs.full') : tr('tabs.snapshot')}
    onClick={p.onSnapshot}>{tr('tabs.snapshot')}</button>
   {/* ⚠️ SNAPSHOT AND SCENES ARE TWO CONTROLS, not one — codex round 24, Medium 3. The item above
       CREATES a snapshot; this one OPENS the list. S6's first build shipped only the first and
       called it "the Scenes trigger", which left a coarse reader able to save a view and unable to
       return to one, at both coarse tiers. */}
   <button type="button" role="menuitem" className="v2-popitem"
    onClick={() => p.onScenes(true)}>{tr('tabs.short')}</button>
   {/* ── S7: THE TABLET'S SHARE GROUP, LIVE. The capture is here and NOT in the pill, because the
       tablet's pill is the desktop's and the desktop's camera button is already wired; one act,
       two surfaces, one callback. `spec.md`'s tablet priority order puts the share group last. */}
   <span className="v2-popsep"/>
   <button type="button" role="menuitem" className="v2-popitem" data-act="snapshot" onClick={p.onCapture}>{tr('nav.snapshot')}</button>
   <button type="button" role="menuitem" className="v2-popitem" data-act="copy-link" onClick={p.onCopyLink}>{tr('nav.link')}</button>
  </More>
 </div>;

 /**
  * ── THE TREE, AS ONE NODE, FOR TWO HOSTS — S6 ─────────────────────────────────────────────────
  *
  * The desktop draws it in the left sidebar; the tablet draws the SAME node in its right sheet
  * (`spec.md`: "Same S3 tree component, S6 placement"). Extracted rather than duplicated for the
  * reason the Ask surface was: a second copy of a 780-line tree is a second place for a membership
  * rule to drift, and this one carries the atomic refusal.
  */
 const treeBody = <>
  <div className="v2-side-filter">
   <label>
    <Ico d={P.find} size={14}/>
    <input type="search" value={p.treeQuery} onChange={(e) => p.onTreeQuery(e.target.value)}
     placeholder={tr('panel.filter')} aria-label={tr('panel.filter')}/>
   </label>
  </div>
  <Tree
   t={t} tr={tr} atlas={p.atlas} dicts={p.dicts} picks={p.picks} scene={p.scene}
   visible={p.state.visible} visibleIntent={p.visibleIntent} isolate={p.state.isolate} dispatch={p.dispatch}
   hidden={p.hidden} onHide={p.onHide} effectiveAlpha={p.effectiveAlpha} eyeState={p.eyeState}
   py={p.py} pinyin={p.pinyin}
   focusedId={p.focused?.id ?? null} onFocus={p.focusPick}
   query={p.treeQuery} coarse={p.coarse}
  />
  <div className="v2-side-foot">
   <div>{tr('panel.membership')}</div>
   <div>{tr('panel.visibility')}</div>
   <button type="button" disabled={p.hidden.size === 0}
    title={p.hidden.size ? tr('tree.sessionHidden', {n: p.hidden.size}) : undefined}
    onClick={() => p.onHide('*', false)}>{tr('panel.resetVisibility')}</button>
  </div>
 </>;

 // ── the left sidebar ────────────────────────────────────────────────────────────────────────
 const side = <aside className={`v2-side ${p.sideStub ? 'is-stub' : ''}`} aria-label={tr('panel.layers')}>
  <div className="v2-side-head">
   {!p.sideStub && <>
    <h2>{tr('panel.layers')}</h2>
    {/* THE COUNT IS THE ATLAS'S, not `SYSTEMS.length`: a system the manifest has no structures for
        is not a row in the tree, so counting the declaration would announce fifteen and draw
        fourteen. Before the atlas lands it falls back to the declaration, which is the same number
        it has always been on this manifest and does not move when the real one arrives. */}
    <em>{liveSystems}</em>
   </>}
   <span className="v2-grow"/>
   <button type="button" className="v2-tbtn" onClick={p.onToggleSide}
    aria-label={p.sideStub ? tr('panel.expand') : tr('panel.collapse')}
    title={p.sideStub ? tr('panel.expand') : tr('panel.collapse')}>
    <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" {...ICON}
     style={{transform: p.sideStub ? 'none' : 'scaleX(-1)'}}><path d={P.chev}/></svg>
   </button>
  </div>
  {/* ⚠️ THE FILTER IS LIVE AS OF S3, and it took until S3 because of WHAT it filters. S2 owned it
      on `spec.md`'s table and deliberately left it inert: the tree beneath it was fifteen
      presentational rows, so a wired filter would have honoured "systems or structures" for the
      systems and silently done nothing for the structures — a control that half-works against its
      own placeholder reads as broken rather than as forthcoming. It now narrows BOTH populations
      through the palette's own matcher (`find.ts best()`), so "胸骨" narrows this tree in an
      English interface exactly as it narrows the palette.
      ⚠️ S6: the filter, the tree and the foot are `treeBody` above — ONE node, two hosts. */}
  {!p.sideStub && treeBody}
 </aside>;

 // ── the right docks ─────────────────────────────────────────────────────────────────────────
 const selectionPane = <>
  <div className="v2-pane-body">
   {/* ── THE ATOMIC REFUSAL (`spec.md` D11) — AND THE STUDIO HAD NO SURFACE FOR IT AT ALL ───────
       ⚠️ FOUND BY S3's OWN ORACLE, and it is a defect S0 shipped rather than one S3 introduced:
       `refused` has been a `ShellProp` since S0 and was never rendered anywhere at ≥1180. Nothing
       noticed because until S3 no studio control could produce a refusal — the phone's margin drew
       it (`.v2-refused`) and the studio's copy of the same fact went nowhere. The first bulk tick of
       a 634-structure system refused correctly, changed nothing correctly, and said NOTHING.

       `spec.md`: "Refusal is amber and persistent near its origin (D11), not a fleeting toast:
       title, limit, unchanged count, corrective action." All four are here, and the dock is OPENED
       when a refusal arrives (page.tsx) so the message can never land in a closed panel — the same
       discipline as the phone's `setDetent('half')`. */}
   {p.refused && <div className="v2-refusal" role="alert">
    <b>{tr('refusal.title')}</b>
    {/* ⚠️ S4. This used to be `{p.refused}` — the controller's raw English — and it is the exact
        line the live 简体 smoke caught: a translated title, an English reason and a translated
        footer in one card. `RefusalText` resolves the key here, at draw time, in `lang`. */}
    <p><RefusalText lang={lang} r={p.refused}/></p>
    <p className="v2-refusal-unchanged">{tr('refusal.unchanged', {n: p.picks.length})}</p>
    <button type="button" className="v2-tbtn" onClick={() => p.focused && p.focusPick(p.focused.id)}>{tr('refusal.review')}</button>
   </div>}
   {p.basket.length > 0 && <p className="v2-limits">{tr('refusal.limit')}</p>}
   {p.basket.length === 0
    ? <p className="v2-empty-state">{tr('status.empty')}<br/>{tr('status.emptyHint')}</p>
    : <>
     <span className="v2-pill-count">{tr('panel.structures', {n: p.basket.length})} · {tr('margin.pieces', {n: pieces.toLocaleString()})}</span>
     {cards.map((b) => {
      const role = p.scene?.structures.find((s) => s.id === b.id)?.role;
      const on = p.focused?.id === b.id;
      return <div key={b.id} className={`v2-card ${on ? 'is-on' : ''}`}>
       <div className="v2-card-top">
        <div>
         <b title={t.name(b.id, b.name)}>{t.name(b.id, b.name)}</b>
         {/* S4 — THE READING GOES UNDER THE CHINESE NAME, ABOVE THE ENGLISH. `py` is handed the
             string actually being drawn, so in an English interface (where `t.name` returns the
             English) it returns null and nothing is rendered — no Latin line acquires a
             romanisation. The 18 px line was RESERVED in S0's preview row for exactly this. */}
         {p.py(b.id, t.name(b.id, b.name)) && <span className="v2-py">{p.py(b.id, t.name(b.id, b.name))}</span>}
         {t.secondary(b.id, b.name) && <i>{t.secondary(b.id, b.name)}</i>}
        </div>
        <button type="button" className="v2-card-act v2-card-focus" aria-label={`${tr('panel.focus')} ${t.name(b.id, b.name)}`}
         onClick={() => p.focusPick(b.id)}><Ico d={P.fit} size={14}/></button>
        <button type="button" className="v2-card-act v2-card-x" aria-label={`${tr('margin.clear')} ${t.name(b.id, b.name)}`}
         onClick={() => p.dispatch({type: 'remove', id: b.id})}><Ico d={P.x} size={13}/></button>
       </div>
       <div className="v2-card-row">
        {/* A ROLE BADGE ONLY WHEN THERE IS A ROLE. `spec.md`: "role badge only with role
            metadata" — a bare `?select=` visit has no incoming scene and therefore no roles, and
            inventing "Primary" for it would be a claim the link never made. */}
        {role && <span className={`v2-badge role-${role}`}>{tr(`role.${role}`)}</span>}
        <em>{tr('margin.pieces', {n: b.elements.length.toLocaleString()})}</em>
       </div>
       {/* ── THE OPACITY SLIDER (S3) — THE SAME FACT AS THE TREE'S MEMBER EYE ──────────────────
           `spec.md`: "Opacity expands only on the focused Selection row; 100% puts the thumb at the
           right endpoint." One fact, two controls, ONE command (`set-opacity`): the eye is the
           0 / restore end of this slider, so the two cannot report different numbers.

           ⚠️ IT IS A SCENE FIELD, so it exists only in scene mode. Outside one there is no `styles`
           to write and the controller says so rather than accepting the drag and dropping it — the
           row is `disabled` with the reason adjacent, which is the true-disabled case rather than
           the inert one. */}
       {on && <div className="v2-card-row v2-opacity">
        <span className="v2-badge">{tr('panel.opacity')}</span>
        {/* ⚠️ `mode === 'render'`, NOT merely "a scene exists" — codex round 3, H1. In EXPLORE mode
            `sceneOpacities` draws every named structure solid (scene-codec.js:427-430), so a slider
            at 0 would write 0 into the blob and change nothing on screen. Disabled with the reason
            adjacent, which is the true-disabled case: the control exists and this scene cannot
            express what it does. The tree's member eye is gated on the same fact. */}
        {/* ⚠️ AN EXPLICIT NUMBER AT EVERY POSITION, INCLUDING 100 — codex r4 H2. The old right
            endpoint sent `null`, which REMOVES the style entry and falls back to `roleOpacity`;
            dragging a context structure to 100% left it at 0.55. And any RAISE clears the session
            override first, or the drag is silently overridden by a hide the reader made earlier
            through the tree (codex r4 H1, the same stranding in its second surface). */}
        <input type="range" min={0} max={100} step={5} value={Math.round(alphaOf(b.id) * 100)}
         disabled={p.scene?.mode !== 'render'}
         aria-label={tr('tree.opacityOf', {name: t.name(b.id, b.name)})}
         onChange={(e) => {
          // ⚠️ THE COMMAND FIRST, THE SESSION SET ONLY IF IT WAS ACCEPTED — codex round 5, Medium 1.
          // Clearing the override before dispatching let a REFUSED edit still change the picture.
          const v = Number(e.target.value) / 100;
          if (!p.dispatch({type: 'set-opacity', id: b.id, opacity: v})) return;
          if (v > 0) p.onHide(b.id, false);
         }}/>
        <em>{alphaOf(b.id) === 0 ? tr('tree.hiddenWord') : `${Math.round(alphaOf(b.id) * 100)}%`}</em>
       </div>}
       {/* ⚠️ A `<p>`, AND IT WAS AN `<s>` UNTIL S5a — THE DEFECT ADRIAN WOULD HAVE READ.
           `.v2-note-sm` is prose, drawn as a `<p>` at every one of its six other call sites; here
           alone it was `<s>`, which is STRUCK THROUGH by default. S4 fixed exactly this mistake for
           the four pinyin readings and this fifth site survived, because every oracle in the suite
           asserts `textContent` and struck text has the identical `textContent`. The planner found
           it by LOOKING at a deployed screenshot.

           The durable fix is not this line — it is that `<s>` is gone from `app/v2` entirely (the
           supporting lines are `.v2-sub` spans now) and that `[s5a-strike]` asserts the computed
           `text-decoration-line` of every text node in the reading surfaces, on six viewports. */}
       {on && p.scene?.mode !== 'render' && <div className="v2-card-row">
        <p className="v2-note-sm">{tr(p.scene ? 'panel.opacityExplore' : 'json.none')}</p>
       </div>}
      </div>;
     })}
    </>}
  </div>
  <div className="v2-pane-foot">
   <button type="button" className={`v2-tbtn ${p.state.isolate ? 'is-on' : ''}`} disabled={!p.basket.length}
    onClick={() => p.dispatch({type: 'set-isolate', on: !p.state.isolate})}>{tr('margin.hideOthers')}</button>
   <span className="v2-grow"/>
   <button type="button" className="v2-tbtn v2-clear-all" disabled={!p.basket.length} onClick={p.clearPicks}>{tr('margin.clear')}</button>
  </div>
 </>;

 const infoPane = <div className="v2-pane-body">
  {!p.focused
   ? <p className="v2-empty-state">{tr('status.empty')}<br/>{tr('status.emptyHint')}</p>
   : <>
    <div className="v2-card">
     <b>{t.name(p.focused.id, p.focused.name)}</b>
     {p.py(p.focused.id, t.name(p.focused.id, p.focused.name)) && <span className="v2-py">{p.py(p.focused.id, t.name(p.focused.id, p.focused.name))}</span>}
     {t.secondary(p.focused.id, p.focused.name) && <i>{t.secondary(p.focused.id, p.focused.name)}</i>}
    </div>
    {p.systemId && <span className="v2-badge">{t.system(p.systemId, SYSTEMS.find((s) => s.id === p.systemId)?.name ?? p.systemId)}</span>}
    <div className="v2-kv"><span>{tr('info.reference')}</span><b>{p.focused.conceptId}</b></div>
    <div className="v2-kv"><span>{tr('margin.pieces', {n: p.focused.elements.length.toLocaleString()})}</span><b>{p.focused.elements.length}</b></div>
    <div className="v2-acc">
     <h3>{tr('info.systemNote')}</h3>
     <div>{p.describe(p.focused.name, p.systemId)}</div>
    </div>
    <div className="v2-acc">
     <h3>{tr('info.included')}</h3>
     <div>{p.basket.map((b) => <div key={b.id}>{t.name(b.id, b.name)}</div>)}</div>
    </div>
   </>}
 </div>;

 /**
  * ══ THE SCENE JSON DOCK — LIVE EDIT (S5a; spec.md D5 and X4) ══════════════════════════════════
  *
  * The canonical scene, pretty-printed, and an Edit mode that applies THROUGH THE CONTROLLER.
  *
  * ⚠️ NOTHING HERE VALIDATES A SCENE, and that is the design. `commitScene` already normalises,
  * runs `validateScene` and checks the encoded length, and it returns the caller's state untouched
  * on any failure — one atomic refusal, in one place, shared with every other edit. A second
  * validator here would be a second opinion about the same question, and the day the two disagreed
  * the dock would accept something the link cannot carry.
  *
  * So this component owns exactly two things the controller cannot: whether the text the reader
  * typed is JSON AT ALL (the controller takes a value, not a string), and WHERE the typo is.
  *
  * ⚠️ THE DRAFT SURVIVES A REFUSAL — spec.md X4: "invalid draft retained, error adjacent, current
  * field unchanged". Clearing the box on a bad parse destroys the reader's work at the exact moment
  * they need to look at it.
  */
 const [draft, setDraft] = useState<string | null>(null);
 const [jsonErr, setJsonErr] = useState<{text: string; detail?: string} | null>(null);
 const [jsonFlash, setJsonFlash] = useState<'' | 'applied' | 'copied'>('');
 const sceneText = p.scene ? JSON.stringify(p.scene, null, 1) : '';
 /**
  * `JSON.parse`'s message names a character POSITION; a reader needs a line. Derived from the draft
  * rather than from the message, because the message's wording is engine-specific and its position
  * is not.
  *
  * ⚠️ THE FALLBACK IS THE **LAST** LINE, NOT THE FIRST — codex round 13, Low 3. Some failures carry
  * no position at all: `JSON.parse('{\n "a":')` throws `Unexpected end of JSON input`, and the old
  * fallback sent the reader to line 1 when the problem is at the end of what they typed. Truncation
  * IS the no-position case, and the end of the text is where it is. Pointing at the wrong line is
  * worse than pointing at no line, because it is a claim.
  */
 const lineOf = (text: string, e: unknown): number | null => {
  /**
   * ⚠️ THE READER'S OWN TEXT IS INSIDE THE MESSAGE, AND IT USED TO SUPPLY THE LOCATION — codex round
   * 15, Low 1. V8 quotes the offending input back verbatim:
   *
   *     JSON.parse('{\n "line 99": \n @}')
   *     → Unexpected token '@', "{\n "line 99": \n @}" is not valid JSON
   *
   * An unrestricted `/line (\d+)/` read **99** out of the reader's own string for a token on line 3,
   * and `/position (\d+)/` read a position out of the draft `\n\nposition 0`. A confidently wrong
   * pointer, manufactured from the text it claims to be pointing into.
   *
   * ⚠️ STRIPPING THE QUOTED RUN IS NOT ENOUGH, which is why this does not do that. The quoted input
   * contains its own `"` characters, so the runs pair up wrongly and a draft keyed
   * `{"line 5 column 3": @}` still leaks a location through the gap. The location is taken ONLY from
   * the engine's own trailing metadata instead — ANCHORED AT THE END of the message, which is where
   * every engine puts it and where the quoted-input family cannot reach, because that family always
   * ends with `is not valid JSON` (V8) or `of the JSON data` (SpiderMonkey's own form, below).
   *
   * Measured on Node v23.7.0 / V8 — all four families, and the two round-15 spoofs:
   *     {"a":1,\n}        → Expected double-quoted property name in JSON at position 10 (line 3 column 1)
   *     {"a":1} x         → Unexpected non-whitespace character after JSON at position 8 (line 1 column 9)
   *     {\n "a":          → Unexpected end of JSON input                     (no location — null)
   *     bad\n\n           → Unexpected token 'b', "bad\n\n" is not valid JSON (no location — null)
   * The parenthesised `(line L column C)` is preferred over the position when the engine offers it:
   * it is the engine's own count, so it cannot disagree with the draft the way a recomputation can.
   */
  const msg = String((e as Error)?.message ?? '').trim();
  // V8: `… at position N` optionally followed by the engine's own line/column, at the very end.
  const v8 = /at position (\d+)(?: \(line (\d+) column \d+\))?$/.exec(msg);
  if (v8) return v8[2] ? Number(v8[2]) : text.slice(0, Number(v8[1])).split('\n').length;
  // SpiderMonkey: `… at line L column C of the JSON data`.
  const moz = /at line (\d+) column \d+ of the JSON data$/i.exec(msg);
  if (moz) return Number(moz[1]);
  // NO CLAIM. Round 13 returned the LAST line here, on the theory that a position-less error means
  // truncation. codex round 14 executed `bad\n\n` and `NaN\n\n`, whose invalid token is on
  // line 1, and got line 3. A line number is a claim about where to look, and a wrong one is worse
  // than none — the engine's own message is still shown beside it as a labelled quotation, so the
  // reader is not left with nothing, only without a wrong pointer.
  return null;
 };
 const applyDraft = () => {
  if (draft === null) return;
  let parsed: unknown;
  try { parsed = JSON.parse(draft); } catch (e) {
   // NOT A REFUSAL FROM THE CONTROLLER — the controller never saw this. Said in the dock, beside
   // the box, so the two kinds of "no" do not get confused with one another.
   const at = lineOf(draft, e);
   setJsonErr({
    text: at === null ? tr('json.invalidNoLine') : tr('json.invalid', {line: at}),
    detail: String((e as Error)?.message ?? '').slice(0, 120),
   });
   return;
  }
  setJsonErr(null);
  // The controller's own atomic refusal takes it from here: a `false` leaves picks, blob, camera
  // and URL exactly as they were, and `p.refused` draws the reason in the Selection dock's card.
  if (!p.dispatch({type: 'apply-scene', scene: parsed as Scene})) return;
  setDraft(null);
  setJsonFlash('applied');
 };
 const copyText = (text: string, flash: 'applied' | 'copied') => {
  // `navigator.clipboard` is absent on an insecure origin and rejects without a gesture in some
  // browsers. Either way the failure is silent to the reader unless it is said, so it is said.
  navigator.clipboard?.writeText(text).then(() => setJsonFlash(flash)).catch(() => setJsonErr({text: tr('json.copyFailed')}));
 };
 const jsonPane = <>
  <div className="v2-pane-body">
   <p className="v2-note-sm">{tr(draft === null ? 'json.read' : 'json.editing')}</p>
   {/* THE CANONICAL SCENE, from the controller — not the arrival blob, and not React state
       re-encoded. `null` when the page is not in scene mode, and it SAYS so rather than printing
       an empty object that reads as a scene with nothing in it. */}
   {!p.scene
    ? <p className="v2-empty-state">{tr('json.none')}</p>
    : draft === null
     ? <pre className="v2-json">{sceneText}</pre>
     : <textarea className="v2-jsonbox" value={draft} spellCheck={false} aria-label={dockTitle.json}
        aria-invalid={!!jsonErr} onChange={(e) => { setDraft(e.target.value); setJsonErr(null); }}/>}
   {/* ADJACENT, not in a toast: X4 puts the error next to the draft it is about. */}
   {jsonErr && <p className="v2-json-err" role="alert">
    {jsonErr.text}
    {jsonErr.detail && <span className="v2-refusal-detail">
     <b>{tr('refusal.detail')}:</b> <span lang="en">{jsonErr.detail}</span>
    </span>}
   </p>}
  </div>
  <div className="v2-pane-foot">
   <button type="button" className="v2-tbtn" disabled={!p.scene}
    onClick={() => copyText(draft ?? sceneText, 'copied')}>{tr('json.copy')}</button>
   {draft === null
    ? <button type="button" className="v2-tbtn" disabled={!p.scene}
       onClick={() => { setDraft(sceneText); setJsonErr(null); setJsonFlash(''); }}>{tr('json.edit')}</button>
    : <>
      <button type="button" className="v2-tbtn is-on" onClick={applyDraft}>{tr('json.apply')}</button>
      <button type="button" className="v2-tbtn"
       onClick={() => { setDraft(null); setJsonErr(null); }}>{tr('json.revert')}</button>
     </>}
   <span className="v2-grow"/>
   {/* THE BUDGET AS A LIVE NUMBER, not as a sentence about a maximum. The encoded length is the
       bound the refusal is written against, so a reader editing toward it can see it coming. */}
   <span className="v2-static">{jsonFlash
    ? tr(jsonFlash === 'applied' ? 'json.applied' : 'json.copied')
    : p.sceneBlob ? tr('json.chars', {n: p.sceneBlob.length}) : tr('json.limit')}</span>
  </div>
 </>;

 /**
  * THE ASK DOCK — ONE COMPONENT, SHARED WITH THE PHONE SHEET (S5b).
  *
  * S5a rendered the hand-off HERE and again in `PhoneSheets`, and the two copies had already
  * started to differ. S5b adds an optional chat with a live API key to that surface, so a second
  * copy would be a second place for a key-handling mistake to live: `ask.tsx` is now the only
  * implementation and both hosts render it. Without a key it is byte-for-byte S5a's hand-off.
  */
 const askPane = <AskPanel
  tr={tr} lang={p.lang} scene={p.scene} sceneBlob={p.sceneBlob} picks={p.picks}
  basket={p.basket} nameOf={(id, fallback) => t.name(id, fallback)} dispatch={p.dispatch}
  titleMax={LIMITS.TITLE_MAX} noteMax={LIMITS.NOTE_MAX} state={p.askState}/>;

 const paneBody: Record<DockKey, React.ReactNode> = {selection: selectionPane, info: infoPane, json: jsonPane, ask: askPane};
 const dock = p.docks.length > 0 && <div className="v2-dock">
  {p.docks.map((k) => <section key={k} className="v2-pane" style={{width: k === 'info' ? 300 : k === 'json' ? 360 : 320}}
   aria-label={dockTitle[k]}>
   <div className="v2-pane-head">
    <h2>{dockTitle[k]}</h2>
    {k === 'selection' && <em>{p.basket.length}</em>}
    <button type="button" className="v2-pane-x" aria-label={tr('panel.close', {name: dockTitle[k]})}
     onClick={() => p.onToggleDock(k)}>×</button>
   </div>
   {paneBody[k]}
  </section>)}
 </div>;

 // The ordinals for the strip: computed ONCE, from the same function the phone sheet uses.
 const tabOrds = tabOrdinals(p.tabs);

 // ── the status strip ────────────────────────────────────────────────────────────────────────
 const status = <footer className="v2-status">
  <span>{tr('nav.hint')}</span>
  {p.autoCollapsed && <span className="is-warn" role="status">{tr('status.autoCollapsed')}</span>}
  <span className="v2-grow"/>
  {/* S0 RESERVES THE STRIP with the current scene as one tab and an inert `+`. ⚠️ S5a then HIDES
      the strip when there is only one scene (`spec.md` §Geometry). That is a deliberate visual
      change between S0 and S5a, recorded so it does not read as a regression. */}
  {/* ⚠️ FINE POINTERS ONLY. `spec.md`: "Scene tabs live inside the 32 px status strip on fine
      pointers … On coarse screens use a 44 px Scenes trigger in Panels/More opening a sheet, never
      32 px touch tabs." A 28 px focusable tab on a 1366×1024 tablet is a target a finger cannot
      hit, and the coarse sweep said so. The coarse trigger arrives with S5a's sheet. */}
  {/* ⚠️ THE STRIP HIDES ITSELF WHEN THERE IS ONLY THE CURRENT SCENE — spec.md §Geometry, and a
      DELIBERATE visual change from S0, which reserved the region with one tab and an inert `+`.
      Recorded in the worklog so it does not read as a regression: a one-tab tab strip is chrome
      that teaches nothing, and the `+` moves into the tools row where a first snapshot is made.
      With snapshots on disk the strip returns, current scene first. */}
  {!p.coarse && p.tabs.length > 0 && <div className="v2-tabs" role="group" aria-label={tr('tabs.short')}>
   <span className="v2-tab is-on">{p.caption.title || tr('tabs.current')}</span>
   {p.tabs.map((t, i) => <button type="button" key={`${t.blob.slice(0, 12)}-${i}`} className="v2-tab"
    title={tabTip(tr, p.lang, t, tabOrds[i], tr('tabs.untitled'))}
    // THE ORDINAL TRAVELS INTO THE ACCESSIBLE NAME TOO. A screen-reader user hears "Open
    // Hamstrings & pelvis" twice otherwise — the same ambiguity, with no tooltip to fall back on.
    aria-label={tr('tabs.restore', {name: tabLabel(t, tabOrds[i], tr('tabs.untitled'))})}
    onClick={() => p.onApplyTab(t)}>{tabLabel(t, tabOrds[i], tr('tabs.untitled'))}</button>)}
   <button type="button" className="v2-tab v2-tab-add" disabled={!p.scene}
    title={p.tabsFull ? tr('tabs.full') : tr('tabs.snapshot')}
    aria-label={tr('tabs.snapshot')} onClick={p.onSnapshot}>+</button>
  </div>}
  {/* The `+` at its OTHER home: with no snapshots yet the strip is gone, so the one control that
      creates the first one lives in the status row on its own. */}
  {!p.coarse && p.tabs.length === 0 && <button type="button" className="v2-status-btn" disabled={!p.scene}
   title={p.scene ? tr('tabs.snapshot') : tr('tabs.noScene')}
   onClick={p.onSnapshot}>+ {tr('tabs.snapshot')}</button>}
 </footer>;

 /**
  * ══ THE TABLET'S ONE RIGHT SHEET — S6 ═════════════════════════════════════════════════════════
  *
  * Tabs Layers / Selection / Info over the SAME three nodes the desktop draws in its sidebar and
  * docks. `spec.md` T2/T3: "Selection+Info at T3 is one sheet with tabs and an expanded Info
  * accordion, not two squeezed columns", and "Exactly one sheet."
  *
  * TWO PRESENTATIONS, ONE CONTENT:
  *  · LANDSCAPE >= 1024 — a 300 px INLINE grid column. Not a dialog: it does not trap focus, does
  *    not dim the field, and the field keeps 724 px, which is the artboard's own number. A reader
  *    can drive the camera with the sheet open, which is the whole point of an inline panel.
  *  · PORTRAIT (and any narrow/short landscape) — a 360 px OVERLAY with a scrim, through the same
  *    `Overlay` primitive every other surface uses, so it inherits the trap, the Escape, the focus
  *    restore and the safe-area padding rather than re-inventing four of them.
  *
  * The tab list is the toolbar's three buttons (`tabletTools`) — there is no second row of tabs
  * inside the sheet. One control per panel, in one place, is why `aria-pressed` on the toolbar
  * button is a true statement about what is on screen.
  */
 const tSheetTitle = p.tSheet === 'layers' ? tr('panel.layers')
  : p.tSheet === 'selection' ? tr('panel.selection')
   : p.tSheet === 'json' ? tr('panel.json')
    : p.tSheet === 'ask' ? tr('panel.ask') : tr('panel.info');
 const tSheetBody = p.tSheet === 'layers' ? treeBody
  : p.tSheet === 'selection' ? selectionPane
   : p.tSheet === 'json' ? jsonPane
    : p.tSheet === 'ask' ? askPane : infoPane;
 const tabletSheet = p.tSheet && (p.tabletInline
  ? <aside className="v2-dock v2-tsheet" id="v2-tsheet" aria-label={tSheetTitle}>
   <section className="v2-pane">
    <div className="v2-pane-head">
     <h2>{tSheetTitle}</h2>
     {p.tSheet === 'selection' && <em>{p.basket.length}</em>}
     <button type="button" className="v2-pane-x" aria-label={tr('panel.close', {name: tSheetTitle})}
      onClick={() => p.onTSheet(null)}>×</button>
    </div>
    {tSheetBody}
   </section>
  </aside>
  : <Overlay open onClose={() => p.onTSheet(null)} sheet={false} kind="is-right" id="v2-tsheet"
   title={tSheetTitle} labelClose={tr('panel.close', {name: tSheetTitle})}>
   {/**
     * ⚠️ THE TABS LIVE INSIDE THE PORTRAIT SHEET — codex round 25, Low 3, and it is a product gap
     * rather than a test one. In portrait the sheet is an OVERLAY WITH A SCRIM: the toolbar tabs
     * that switch it are behind that scrim, so "switching tabs" was only reachable by closing the
     * sheet and pressing another button. The oracle hid the gap by clicking the buried controls
     * programmatically, which is exactly the shape of a test proving something a reader cannot do.
     * `spec.md` draws this anyway ("one sheet with tabs"); the toolbar buttons remain the invokers.
     */}
   <div className="v2-stabs" role="tablist" aria-label={tr('panel.panels')}>
    {TABLET_TABS.map((k) => {
     const on = p.tSheet === k;
     const label = k === 'layers' ? tr('panel.layers') : k === 'selection' ? tr('panel.selection') : tr('panel.info');
     return <button type="button" key={k} role="tab" aria-selected={on} aria-label={label}
      className={`v2-stab ${on ? 'is-on' : ''}`} onClick={() => p.onTSheet(k)}>{label}</button>;
    })}
   </div>
   {tSheetBody}
  </Overlay>);

 // THE GRID ITEMS ARE THE FRAGMENT'S CHILDREN. A React fragment emits no DOM node, so `bar`,
 // `tools`, `side`, `dock` and `status` are direct children of `.v2` and the `grid-area` on each
 // one resolves against it.
 if (p.tablet) return <>{bar}{tabletTools}{tabletSheet}{status}</>;
 return <>{bar}{tools}{side}{dock}{status}</>;
}

/**
 * ══ THE PHONE'S A8 (Ask) AND A9 (Scenes) SHEETS — S5a ══════════════════════════════════════════
 *
 * `spec.md` A8/A9 draw both as 724 px bottom sheets over the 390×844 artboard, and the mock-forced
 * amendment in the kickoff makes them this group's work rather than S6's: "build them in the same
 * group as their desktop counterpart".
 *
 * ⚠️ THE SAME `Overlay`, NOT A SECOND SHEET. That primitive was written at S0 precisely so that S5
 * would not invent a fifth handle height, a third focus trap and a first scroll leak — the 44 px
 * handle, the safe-area padding, the visual-viewport keyboard sizing, the trap and the focus
 * restore are its defaults. Nothing about the sheet is re-decided here.
 *
 * ⚠️ RC5 IS SATISFIED BY CONSTRUCTION, not by measurement afterwards. A sheet is a scrim ABOVE the
 * margin; the header (56), the rail (45) and both detents (108 / min(48dvh,420)) are untouched
 * because nothing here renders inside `.v2-margin`. The two invokers go into `.v2-actions`, which
 * is `flex-wrap:wrap` inside the already-scrolling `.v2-margin-scroll`, and every oracle that
 * reaches into that row selects its button BY TEXT — so two more cannot displace them.
 *
 * It is hosted at EVERY width and rendered only when `sheet` is true. One more instance of the
 * lesson `StudioOverlays` carries: a surface that only exists at one tier is a surface whose only
 * test is the one somebody remembers to write.
 */
export function PhoneSheets(p: {
 tr: ShellProps['tr']; lang: Lang; sheet: boolean;
 scene: Scene | null; sceneBlob: string; picks: string[]; basket: ShellProps['basket'];
 askOpen: boolean; onAsk(v: boolean): void;
 scenesOpen: boolean; onScenes(v: boolean): void;
 /** S6: a coarse pointer at ANY width gets the Scenes surface — the 32 px status tabs are refused
  *  there, so this overlay is the only way to reopen a snapshot. */
 coarse: boolean;
 tabs: SceneTab[]; tabsFull: boolean; onSnapshot(): void; onApplyTab(t: SceneTab): void;
 /** S5b — the two the chat needs and the S5a sheet did not: the UI-language name for a structure,
  *  and the controller, so a model-proposed view can be applied through the atomic refusal. */
 nameOf(id: string, fallback: string): string;
 dispatch(cmd: Command): boolean;
 askState: AskState;
}) {
 const {tr} = p;
 const ords = tabOrdinals(p.tabs);

 /**
  * A8 — the conversation hand-off, and from S5b the chat as well. `spec.md` drew this as "filled
  * prompt, explicit external handoff, copy-prompt; NO ANSWER BUBBLES", and the absence of bubbles
  * was exactly the S5a/S5b line: S5b is the side of it that has them, on the phone as on the
  * desktop, because a reader who pasted a key on this device did so for both.
  *
  * ⚠️ THE SAME COMPONENT AS THE DOCK (`ask.tsx`), in its sheet presentation. RC5 still holds by
  * construction: a sheet is a scrim ABOVE `.v2-margin`, and nothing here renders inside it.
  */
 const askSheet = <Overlay open={p.askOpen} onClose={() => p.onAsk(false)} sheet={p.sheet}
  title={tr('panel.ask')} labelClose={tr('settings.close')}>
  <AskPanel sheet
   tr={tr} lang={p.lang} scene={p.scene} sceneBlob={p.sceneBlob} picks={p.picks}
   basket={p.basket} nameOf={p.nameOf} dispatch={p.dispatch}
   titleMax={LIMITS.TITLE_MAX} noteMax={LIMITS.NOTE_MAX} state={p.askState}/>
 </Overlay>;

 // A9 — the local snapshots. `spec.md`: "three local snapshots, active scene, + cap 8, no
 // close/delete feature." The cap is said BEFORE the button is pressed, not after it evicts.
 /**
  * ⚠️ AND IT IS THE COARSE TIERS' SCENES SURFACE TOO — codex round 24, Medium 3.
  *
  * `spec.md`: "On coarse screens use a 44 px Scenes trigger in Panels/More opening a sheet, never
  * 32 px touch tabs." S0 correctly gated the 32 px status-strip tabs on `!coarse`; nothing ever
  * shipped the replacement, and codex traced the consequence exactly: at 768-1179 AND at 1366x1024
  * a reader could CREATE a snapshot and had no way to reopen one. The trigger is in More on the
  * tablet and in the tools row at >=1180 coarse; this is the surface both of them open.
  *
  * `sheet={p.sheet}` keeps the presentation honest: a bottom sheet on the phone, a centred modal on
  * a tablet, which is the same rule every other overlay in the shell follows.
  */
 const scenesSheet = <Overlay open={p.scenesOpen} onClose={() => p.onScenes(false)} sheet={p.sheet}
  title={tr('tabs.short')} labelClose={tr('settings.close')}>
  {p.tabs.length === 0
   ? <p className="v2-empty-state">{tr('tabs.empty')}</p>
   : <>
    <p className="v2-note-sm">{tr('tabs.note', {n: p.tabs.length})}</p>
    <div className="v2-scenelist">
     {p.tabs.map((t, i) => <button type="button" key={`${t.blob.slice(0, 12)}-${i}`} className="v2-scenerow"
      title={tabTip(tr, p.lang, t, ords[i], tr('tabs.untitled'))}
      aria-label={tr('tabs.restore', {name: tabLabel(t, ords[i], tr('tabs.untitled'))})}
      onClick={() => { p.onApplyTab(t); p.onScenes(false); }}>
      <b>{tabLabel(t, ords[i], tr('tabs.untitled'))}</b>
      {/* WHETHER THE POSE CAME WITH IT, said per row. A snapshot taken before the renderer was
          ready has no pose, and a row that promised one and did not restore it would read as a
          broken control rather than as an honest one. */}
      {t.cam && <span className="v2-sub">{tr('tabs.pose')}</span>}
     </button>)}
    </div>
   </>}
  <div className="v2-sheet-foot">
   <button type="button" className="v2-tbtn is-on" disabled={!p.scene}
    onClick={p.onSnapshot}>+ {tr('tabs.snapshot')}</button>
   {p.tabsFull && <span className="v2-static">{tr('tabs.full')}</span>}
   {!p.scene && <span className="v2-static">{tr('tabs.noScene')}</span>}
  </div>
 </Overlay>;

 // The ASK sheet is the phone's alone (the tablet has Ask as a panel in its own sheet, the desktop
 // as a dock). The SCENES sheet is every coarse tier's, for the reason above.
 if (!p.sheet && !p.coarse) return null;
 return <>{p.sheet && askSheet}{scenesSheet}</>;
}

/**
 * SETTINGS AND THE KEY MAP — their own component, hosted at EVERY width.
 *
 * `?` is a keyboard explanation, not a studio control, so it has to work on a narrow window too —
 * which is also what gives the sheet presentation of `Overlay` a reachable invoker at S0 rather
 * than an untested branch waiting for S4. Keeping them out of `Shell` means there is exactly one
 * instance of each, with one copy of the tab state, no matter which tier is rendering.
 */
export function StudioOverlays(p: {
 t: T; tr: ShellProps['tr']; lang: Lang; applyLang(l: Lang): void;
 background: 'light' | 'dark'; sheet: boolean;
 keysOpen: boolean; onKeys(v: boolean): void;
 settingsOpen: boolean; onSettings(v: boolean): void;
 /** Guard 7's tier. The key map is reachable at every width (`?` is not a studio command), so it
  *  has to say that the CAMERA rows are not — see the note beside `keys.cameraOff`. */
 studio: boolean;
 /** ── S4 ─────────────────────────────────────────────────────────────────────────────────────
  *  Settings is hosted at EVERY width (the phone's A6/A7 sheet is this same overlay in its sheet
  *  presentation), so the pinyin control lives here rather than in the studio's own tree — one
  *  control, one writer, both tiers. */
 pinyin: boolean; onPinyin(on: boolean): void;
 py(id: string, shown: string): string | null;
 /** S7: the key-pad preference. Same reasoning as pinyin — Settings is hosted at every width, so
  *  the control lives with the overlay and the state lives in the hook the page always calls. */
 keypad: KeypadMode; onKeypad(m: KeypadMode): void;
}) {
 const {tr, lang} = p;
 const [tab, setTab] = useState<'general' | 'language' | 'ai' | 'about'>('general');
 /**
  * ══ SETTINGS › AI — S5b ═══════════════════════════════════════════════════════════════════════
  *
  * ⚠️ THE KEY IS NEVER IN REACT STATE, INCLUDING WHILE IT IS BEING TYPED. The paste field is an
  * UNCONTROLLED input inside a `<form>`: its value lives in the DOM (where an input's value has to
  * live) and is read once, in the submit handler, from `FormData`. There is no `useState`, no
  * `useRef` and no `onChange` holding it — so a devtools component snapshot, a React error boundary
  * and a future props log have nothing to serialise. The field is `reset()` immediately after.
  *
  * Everything the panel DISPLAYS comes from the key-free accessors in `store.ts` (`hasOpenAi`,
  * `openAiMask`, `readOpenAiModel`); this component cannot obtain the key even if it wanted to.
  *
  * `mask` is the only "cached" value and it is a mask — a bump counter re-reads it after a write,
  * rather than holding a copy across renders.
  */
 const [keyTick, setKeyTick] = useState(0);
 const [keyFlash, setKeyFlash] = useState<'' | 'saved' | 'removed'>('');
 const mask = keyTick >= 0 ? openAiMask() : null;
 const model = readOpenAiModel();
 const custom = !!model && !(MODELS as readonly string[]).includes(model);
 /** Tell an OPEN Ask dock that the answer to `hasOpenAi()` changed. */
 const announceKey = () => {
  setKeyTick((n) => n + 1);
  try { window.dispatchEvent(new Event(OPENAI_CHANGED)); } catch { /* no window: nothing to tell */ }
 };
 // ── Settings ────────────────────────────────────────────────────────────────────────────────
 const settings = <Overlay open={p.settingsOpen} onClose={() => p.onSettings(false)} sheet={p.sheet}
  title={tr('settings.title')} labelClose={tr('settings.close')}>
  <div className="v2-mtabs" role="tablist" aria-label={tr('settings.title')}>
   {/* ⚠️ S4 — `data-autofocus` ON THE SELECTED TAB, which is what `spec.md` asks for and what S2's
       overlay rule was built to serve. `Overlay` used to focus the first focusable in DOM order,
       which is the panel header's `×` in every overlay — the defect that cost Find its typing
       (overlay.tsx). Settings now declares its target the same way Find declares its input. */}
   {(['general', 'language', 'ai', 'about'] as const).map((k) => <button type="button" key={k} role="tab"
    aria-selected={tab === k} className={`v2-mtab ${tab === k ? 'is-on' : ''}`}
    {...(tab === k ? {'data-autofocus': '1'} : {})}
    onClick={() => setTab(k)}>{tr(`settings.${k}`)}</button>)}
  </div>
  {tab === 'general' && <div>
   <div className="v2-srow">
    <div><b>{tr('settings.ground')}</b><p>{tr('settings.groundNote')}</p></div>
    {/* READ-ONLY, and it always was: there is no theme override — the SCENE decides the ground
        (page.tsx `background`). Showing the current value is honest; a toggle would not be. */}
    <div className="v2-srow-act"><span className="v2-static">{tr(p.background === 'dark' ? 'settings.dark' : 'settings.light')}</span></div>
   </div>
   <div className="v2-srow">
    <div><b>{tr('settings.keypad')}</b><p>{tr('settings.keypadNote')}</p>
     {/* ⚠️ S7 — LIVE, and it was the LAST of S0's eleven placeholders. It was also the only one that
         was WRONG rather than merely dead: it drew `off` as the selected value while the pad was on
         the screen, so a reader who opened Settings was told the app was in a state it was not in.
         The default is `full` — what has always been drawn — so nobody's screen changes until they
         choose. It changes what is DRAWN, never what the keys do (`use-shell.ts` says why). */}
     <div className="v2-seg" style={{marginTop: 10}} role="group" aria-label={tr('settings.keypad')}>
      {KEYPAD_MODES.map((k) => <button type="button" key={k}
       className={p.keypad === k ? 'is-on' : ''} aria-pressed={p.keypad === k}
       onClick={() => p.onKeypad(k)}>{tr(`settings.${k}`)}</button>)}
     </div>
    </div>
   </div>
   <div className="v2-srow">
    <div><b>{tr('settings.motion')}</b><p>{tr('settings.motionNote')}</p></div>
    <div className="v2-srow-act"><span className="v2-static">
     {tr(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion:reduce)').matches ? 'settings.on' : 'settings.off')}
    </span></div>
   </div>
   <div className="v2-srow">
    <div><b>{tr('settings.gated')}</b><p>{tr('settings.gatedNote')}</p></div>
    <div className="v2-srow-act"><Ico d={P.tick} size={17}/></div>
   </div>
  </div>}
  {tab === 'language' && <div>
   <div className="v2-srow">
    <div><b>{tr('lang.aria')}</b><p>{tr('settings.langNote')}</p>
     <div className="v2-seg" style={{marginTop: 12}}>
      {LANGS.map((l) => <button type="button" key={l} lang={l} className={lang === l ? 'is-on' : ''}
       aria-pressed={lang === l} onClick={() => p.applyLang(l)}>{LANG_LABELS[l]}</button>)}
     </div>
    </div>
   </div>
   {/* ⚠️ S4 — LIVE. It was `settings.pending` + `aria-disabled` behind the inert convention; the
       control now writes `localStorage['atlas.pinyin']` through the one owner (`use-shell.ts`
       `setPinyin`), and the map is fetched only on the transition to ON. */}
   <div className="v2-srow">
    <div><b>{tr('settings.pinyin')}</b><p>{tr('settings.pinyinNote')}</p></div>
    <div className="v2-srow-act">
     <button type="button" role="switch" aria-checked={p.pinyin}
      className={`v2-switch ${p.pinyin ? 'is-on' : ''}`}
      aria-label={tr('settings.pinyin')}
      onClick={() => p.onPinyin(!p.pinyin)}><i/></button>
    </div>
   </div>
   <div className="v2-srow">
    <div><b>{tr('settings.preview')}</b>
     {/* The 18 px pinyin line was RESERVED from S0, so turning the toggle on does not move every
         Chinese row down by a line the first time the map lands. The preview now SHOWS the reading
         when the setting is on — and it is the real one, read through `py` off the loaded map for
         胸骨体 (FMA7487), not a hardcoded string that could disagree with what the rows draw. */}
     <p style={{lineHeight: '18px', minHeight: 18}}>
      胸骨体
      {p.py('FMA7487', '胸骨体') && <><br/><span className="v2-py">{p.py('FMA7487', '胸骨体')}</span></>}
      <br/><span style={{color: 'var(--v2-ink-3)'}}>Body of sternum</span>
     </p>
    </div>
   </div>
  </div>}
  {tab === 'ai' && <div className="v2-ai-settings">
   <div className="v2-srow">
    <div><b>{tr('ai.title')}</b><p>{tr('ai.intro')}</p></div>
   </div>
   <div className="v2-srow">
    <div style={{width: '100%'}}>
     <b>{tr('ai.keyLabel')}</b>
     <p>{tr('ai.keyNote')}</p>
     {mask
      ? <div className="v2-ai-keyrow">
        {/* THE MASK, NOT THE KEY. `openAiMask()` derives `sk-***…abcd` from storage on demand; the
            whole value is never returned to this component, so it cannot be displayed, copied or
            logged from here even by accident. */}
        <code className="v2-ai-mask">{mask}</code>
        <span className="v2-static">{tr('ai.stored')}</span>
        <span className="v2-grow"/>
        {/* A REAL REMOVE: `localStorage.removeItem`, not a flag. RC11. */}
        <button type="button" className="v2-tbtn"
         onClick={() => { clearOpenAi(); setKeyFlash('removed'); announceKey(); }}>{tr('ai.remove')}</button>
       </div>
      : <p className="v2-empty-state">{tr('ai.none')}</p>}
     {/* ⚠️ UNCONTROLLED, AND THAT IS THE POINT — see the block comment above. `autoComplete="off"`
         and `type="password"` keep it out of the browser's own form store and off the screen;
         `FormData` reads it once; `reset()` clears the DOM node in the same handler. */}
     <form className="v2-ai-keyrow" style={{marginTop: 10}} onSubmit={(e) => {
       e.preventDefault();
       const form = e.currentTarget;
       const typed = String(new FormData(form).get('openai-key') ?? '');
       form.reset();
       if (saveOpenAiKey(typed)) { setKeyFlash('saved'); announceKey(); }
      }}>
      <input className="v2-ai-keyinput" type="password" name="openai-key" autoComplete="off"
       spellCheck={false} placeholder={tr('ai.placeholder')} aria-label={tr('ai.keyLabel')}/>
      <button type="submit" className="v2-tbtn is-on">{tr('ai.save')}</button>
     </form>
     {keyFlash && <p className="v2-note-sm">{tr(keyFlash === 'saved' ? 'ai.stored' : 'ai.removed')}</p>}
    </div>
   </div>
   <div className="v2-srow">
    <div style={{width: '100%'}}>
     <b>{tr('ai.model')}</b>
     <p>{tr('ai.modelNote')}</p>
     {/* A SHORT HARDCODED LIST — RC11 refuses `GET /v1/models`. The free-text box below sends what
         is typed, unprobed: a name OpenAI does not know comes back as its own 400/404 and the dock
         shows it, which is "fails loudly" rather than a silent downgrade to something cheaper. */}
     <div className="v2-seg" style={{marginTop: 10}}>
      {MODELS.map((m) => <button type="button" key={m}
       className={modelOf(model) === m ? 'is-on' : ''} aria-pressed={modelOf(model) === m}
       onClick={() => { setOpenAiModel(m); setKeyTick((n) => n + 1); }}>{m}</button>)}
     </div>
     <form className="v2-ai-keyrow" style={{marginTop: 10}} onSubmit={(e) => {
       e.preventDefault();
       setOpenAiModel(String(new FormData(e.currentTarget).get('openai-model') ?? ''));
       setKeyTick((n) => n + 1);
      }}>
      <input className="v2-ai-keyinput" name="openai-model" autoComplete="off" spellCheck={false}
       defaultValue={custom ? model : ''} placeholder={tr('ai.modelOther')} aria-label={tr('ai.modelOther')}/>
      <button type="submit" className="v2-tbtn">{tr('ai.saveModel')}</button>
     </form>
    </div>
   </div>
  </div>}
  {tab === 'about' && <div className="v2-about">
   <p>{tr('about.lead')}</p>
   <h3>{tr('about.code')}</h3>
   <p>{tr('about.repo')}</p>
   <p>
    <a href="https://github.com/ashemag/human-atlas" target="_blank" rel="noreferrer noopener">{tr('about.upstream')}</a>
    <a href="https://github.com/AdrianGanJY/human-anatomy-viewer" target="_blank" rel="noreferrer noopener">{tr('about.fork')}</a>
   </p>
   <h3>{tr('about.anatomy')}</h3>
   <p>{tr('about.attribution')}</p>
   <p>{tr('about.adapt')}</p>
   <p>{tr('about.legacy')}</p>
   <p>{tr('about.paper')}</p>
   <p>
    <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noreferrer noopener">BodyParts3D · licence</a>
    {/* S4: the DATASET link was in `public/ATTRIBUTION.md` and not here — an attribution panel that
        names the licence but not where the data came from is incomplete in the way that matters. */}
    <a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noreferrer noopener">{tr('about.dataset')}</a>
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">CC BY 4.0</a>
    <a href="https://doi.org/10.1093/nar/gkn613" target="_blank" rel="noreferrer noopener">10.1093/nar/gkn613</a>
   </p>
   <h3>{tr('about.language')}</h3>
   <p>{tr('about.translation')}</p>
   <p>{tr('about.pinyin', {lib: ATLAS_PINYIN, n: ATLAS_PINYIN_N.toLocaleString()})}</p>
   <h3>{tr('about.fonts')}</h3>
   <p>{tr('about.fontList')}</p>
   <h3>{tr('about.runtime')}</h3>
   <p>{tr('about.runtimeList', {deps: ATLAS_DEPS})}</p>
   <p>{tr('about.notices')}</p>
   <h3>{tr('about.historical')}</h3>
   <p>{tr('about.history')}</p>
   {/* S4: the historical set is credited in prose but its DOI was only in ATTRIBUTION.md. A CC BY
       attribution is for the reader to be able to FOLLOW, so the identifier travels with it. */}
   <p>
    <a href="https://doi.org/10.48539/HBM352.BTSQ.586" target="_blank" rel="noreferrer noopener">{tr('about.historyDoi')}</a>
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">CC BY 4.0</a>
   </p>
   <hr/>
   {/* DERIVED AT BUILD TIME (vite.config.ts `define`), never typed here. The literals that used to
       sit in this line said `l31v21a` / `07e76ee` two increments after both had moved — on the one
       panel whose whole job is to say what the reader is looking at (stand-in review S1 L1). */}
   {/* ⚠️ A STABLE SELECTOR AND THE COMMIT ON ITS OWN ATTRIBUTE — codex round 12, Low 5.
       The oracle used to find this line as "the last `<p>` in `.v2-about`" and search its text for
       a seven-hex substring. Round 10 had already broken the substring half (the UPSTREAM sha
       satisfied it); the positional half is the same shape of defect waiting for the day somebody
       adds a paragraph after this one. `data-commit` is the value itself, so the row compares
       `git rev-parse --short HEAD` to a field rather than to a sentence it happens to appear in. */}
   <p className="v2-about-build" data-build={ATLAS_BUILD} data-commit={ATLAS_COMMIT}
    style={{marginTop: 12, color: 'var(--v2-ink-3)'}}>{tr('about.build', {build: ATLAS_BUILD, commit: ATLAS_COMMIT})}</p>
  </div>}
 </Overlay>;

 // ── the key map ─────────────────────────────────────────────────────────────────────────────
 // EMPTY GROUPS ARE NOT RENDERED. The heading was emitted per group unconditionally, so the moment
 // S1 emptied one the overlay grew a bare "Camera" title with no rows under it — and no oracle saw
 // it, because the S1 rows count `dt` elements and `<s>` markers and both stayed correct
 // (stand-in review S1 M1). Belt as well as braces: the underlying grouping is fixed in `keys.ts`.
 const groups: {k: KeyGroup; rows: typeof KEY_MAP}[] = (['now', 'global', 'camera', 'tree'] as const)
  .map((k) => ({k, rows: KEY_MAP.filter((r) => r.group === k)}))
  .filter((g) => g.rows.length > 0);
 const keys = <Overlay open={p.keysOpen} onClose={() => p.onKeys(false)} sheet={p.sheet}
  title={tr('keys.title')} labelClose={tr('settings.close')}>
  <p className="v2-note-sm" style={{marginTop: 12}}>{tr('keys.scope')}</p>
  {groups.map(({k, rows}) => <div key={k}>
   <h3 style={{margin: '18px 0 8px', fontSize: 'var(--v2-type-sm)'}}>{tr(`keys.${k}`)}</h3>
   {/* GUARD 7, IN THE MAP. Below 1180 the camera commands and the held keys are withheld — there
       is no pill and no key pad there — and a map that went on listing them as live would be the
       leaflet this file exists to prevent. The `?` overlay itself stays reachable at every width,
       so the note travels with it (round 3, Medium).
       ⚠️ ONE NOTE PER GROUP WAS TOO COARSE: it covered `1 2 3 4` and `R`, which work at every tier
       and have on-screen buttons there — round 2's High inverted (round 4, Medium 1). The mark is
       now per ROW, from `studioOnly`, which is exactly the set guard 7 withholds. */}
   {k === 'camera' && !p.studio && rows.some((r) => r.studioOnly) &&
    <p className="v2-note-sm" style={{margin: '0 0 8px'}}>{tr('keys.cameraOff')}</p>}
   <dl className="v2-keys">
    {rows.map((r) => <div key={r.keys + r.cmd} style={{display: 'contents'}}>
     <dt><span className="v2-kbd">{r.keys}</span></dt>
     {/* A ROW THAT NAMES ITS GROUP IS NOT A PROMISE THAT THE KEY WORKS. Every binding a later
         group brings is labelled with that group, so the map never lists a key that does nothing
         without saying so. */}
     <dd>
      {tr(r.cmd)}
      {r.owner && <span className="v2-sub"> · {tr('inert.pending', {s: r.owner})}</span>}
      {/* PER ROW, so a reader at 390×844 can see that `1 2 3 4` works and `W A S D` does not,
          rather than being told the whole section is unavailable. */}
      {!r.owner && r.studioOnly && !p.studio && <span className="v2-sub" data-studio-only="1"> · {tr('keys.desktopOnly')}</span>}
     </dd>
    </div>)}
   </dl>
  </div>)}
 </Overlay>;

 return <>{settings}{keys}</>;
}
type KeyGroup = 'now' | 'global' | 'camera' | 'tree';
