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
 * INERT ≠ DISABLED, and conflating them is a defect every later group would inherit:
 *   INERT    — "this is where that will be". Focusable, dashed neutral border, tooltip `S1`…`S5`.
 *              Enter and Space announce and do nothing. `.v2-inert`.
 *   DISABLED — "not now, and here is why": Fit with nothing selected, Ask with an empty box, `+`
 *              at cap 8. Real `disabled`, with the reason adjacent and readable.
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
import {useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent} from 'react';
import {SYSTEMS, type Atlas, type Part, type SceneState, type SystemId, type View} from '../../anatomy';
import type {T} from '../../i18n/dict';
import {LANGS, LANG_LABELS, type Lang} from '../../i18n/ui';
import type {Scene} from '../../scene-model';
import type {Command} from '../controller';
import {KEY_MAP} from './keys.ts';
/** Injected by `vite.config.ts`'s `define`. Declared rather than imported because that is what a
 *  compile-time constant is; the fallbacks keep a bare `tsc`/test run honest. */
declare const __ATLAS_BUILD__: string | undefined;
declare const __ATLAS_COMMIT__: string | undefined;
const ATLAS_BUILD = typeof __ATLAS_BUILD__ === 'string' ? __ATLAS_BUILD__ : 'dev';
const ATLAS_COMMIT = typeof __ATLAS_COMMIT__ === 'string' ? __ATLAS_COMMIT__ : 'dev';
import type {NavMode} from './use-shell.ts';
import Overlay from './overlay.tsx';
import {DOCK_KEYS, type DockKey} from './store.ts';

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
 refused: string;
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
 keysOpen: boolean; onKeys(open: boolean): void;
 settingsOpen: boolean; onSettings(open: boolean): void;
 /** Sheet presentation below 768 — the phone path for the `?` map. */
 sheet: boolean;
}

const MB = (n: number) => (n / 1048576).toFixed(1);

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
const PAD: ({label: string; code: string} | null)[] = [
 null, {label: 'W', code: 'KeyW'}, null, null, {label: '↑', code: 'ArrowUp'}, null,
 {label: 'A', code: 'KeyA'}, {label: 'S', code: 'KeyS'}, {label: 'D', code: 'KeyD'},
 {label: '←', code: 'ArrowLeft'}, {label: '↓', code: 'ArrowDown'}, {label: '→', code: 'ArrowRight'},
];

export function StudioField(p: {
 tr: ShellProps['tr']; caption: ShellProps['caption']; state: SceneState;
 dispatch: ShellProps['dispatch']; structures: number; pieces: number; onKeys(open: boolean): void;
 navMode: NavMode; onNavMode(m: NavMode): void;
 held: ReadonlySet<string>; press(code: string): void; release(code: string): void;
 onFit(): void; onHome(): void; onSnapshot(): void;
}) {
 const {tr} = p;
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
   <s>{tr('view.this')}</s>
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
  <div className="v2-pad" aria-label={tr('nav.keypad')} role="group">
   {PAD.map((k, i) => (k
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
  </div>
  <div className="v2-legend">
   <div><span>{tr('legend.inView')}</span><b>{p.structures}</b></div>
   <div><span>{tr('legend.pieces')}</span><b>{p.pieces.toLocaleString()}</b></div>
  </div>
 </>;
}

export default function Shell(p: ShellProps) {
 const {t, tr, lang} = p;
 const [tab, setTab] = useState<'general' | 'language' | 'about'>('general');

 /**
  * THE SIDEBAR'S NUMBERS, DERIVED — never the fifteen literals the mock printed.
  *
  * `Concept` carries no `system` (app/anatomy.ts:20); only `Part` does. So a concept's system is the
  * MODAL system of its elements — "assigned once by dominant system", which is exactly what
  * `spec.md` §Fixture truth specifies those counts to be. Computing it means the column can never
  * disagree with the atlas that ships beside it, which a hardcoded 634 would do the first time a
  * grouping is re-curated. Ties go to the first element's system: deterministic, and the case is
  * vanishingly rare because a concept's parts are almost always one system by construction.
  */
 const systemConcepts = useMemo(() => {
  const out = Object.fromEntries(SYSTEMS.map((s) => [s.id, 0])) as Record<SystemId, number>;
  if (!p.atlas) return out;
  const partSystem = new Map<string, SystemId>(p.atlas.parts.map((x: Part) => [x.id, x.system]));
  for (const c of p.atlas.concepts) {
   const tally = new Map<SystemId, number>();
   for (const el of c.elements) {
    const s = partSystem.get(el);
    if (s) tally.set(s, (tally.get(s) ?? 0) + 1);
   }
   let best: SystemId | null = null, bestN = 0;
   for (const [s, n] of tally) if (n > bestN) { best = s; bestN = n; }
   if (best) out[best] += 1;
  }
  return out;
 }, [p.atlas]);
 const conceptTotal = useMemo(() => Object.values(systemConcepts).reduce((a, b) => a + b, 0), [systemConcepts]);
 /**
  * DETERMINISTIC ORDER = THE DECLARATION ORDER IN `anatomy.ts`, and that is a MEASURED decision
  * rather than the obvious one.
  *
  * ⚠️ The mock's column is sorted by concept count descending, and so was the first build. But the
  * counts are derived from the ATLAS, which arrives ~1 s after the first paint — so every one of the
  * fifteen rows was in one place before it landed and somewhere else after. The CLS oracle measured
  * it immediately: 0.0124 at 1440×900 and 0.0062 at 1920×860, attributed by the browser's own
  * observer to `li.v2-tree-row`, against a budget of 0.001. This page's whole layout thesis is that
  * nothing moves after the first frame; a sorted-by-late-data list cannot hold that.
  *
  * The declaration order is static, deterministic and available in frame one. `spec.md` asks for
  * "deterministic order", which this is — it simply is not the mock's order, and the trade is a
  * visual nicety for the CLS property the design is built on. Recorded in the worklog.
  */
 const ordered = SYSTEMS;

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
  {/* FIND is S2's. It is inert rather than disabled: the palette is not "unavailable right now",
      it is not built yet, and those read differently to anyone trying to use the app. */}
  {/* `aria-label` as well as the visible label: the button's textContent is "Find" + its shortcut
      chip, so a reachability oracle matching on an exact name needs the accessible name to BE the
      name. A screen reader needed it anyway. */}
  <button type="button" className="v2-tbtn v2-findbtn v2-inert" aria-disabled="true" title="S2" aria-label={tr('search.open')}>
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
  <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S1"><Ico d={P.camera}/>{tr('nav.snapshot')}</button>
  <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S1"><Ico d={P.link}/>{tr('nav.link')}</button>
  <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S1"><Ico d={P.plate}/>{tr('nav.plate')}</button>
  <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S1" aria-label={tr('nav.more')}><Ico d={P.more}/></button>
 </div>;

 // ── the left sidebar ────────────────────────────────────────────────────────────────────────
 const side = <aside className={`v2-side ${p.sideStub ? 'is-stub' : ''}`} aria-label={tr('panel.layers')}>
  <div className="v2-side-head">
   {!p.sideStub && <>
    <h2>{tr('panel.layers')}</h2>
    <em>{SYSTEMS.length}</em>
   </>}
   <span className="v2-grow"/>
   <button type="button" className="v2-tbtn" onClick={p.onToggleSide}
    aria-label={p.sideStub ? tr('panel.expand') : tr('panel.collapse')}
    title={p.sideStub ? tr('panel.expand') : tr('panel.collapse')}>
    <svg width="15" height="15" viewBox="0 0 20 20" aria-hidden="true" {...ICON}
     style={{transform: p.sideStub ? 'none' : 'scaleX(-1)'}}><path d={P.chev}/></svg>
   </button>
  </div>
  <p className="v2-side-sub">{tr('panel.inventory')}</p>
  {/* INERT: the filter is S2's, and it shares S2's matcher and denominators. Rendered as a real
      box rather than an input, so a keyboard reader cannot type into something that does nothing. */}
  <div className="v2-side-filter"><div className="v2-inert" title="S2" tabIndex={0} aria-disabled="true">
   <Ico d={P.find} size={14}/>{tr('panel.filter')}
  </div></div>
  {/* PURE PRESENTATION. S3 replaces every row here with a virtualised tree carrying roving
      tabindex, aria-posinset/setsize over the FILTERED collection and tri-state checkboxes — so
      this deliberately builds no row component and holds no state. `role="tree"` is NOT claimed:
      announcing a tree whose keyboard contract is not implemented is worse than announcing a list.
      The eyes and ticks are `aria-disabled` controls, not decorations, because a reader must be
      able to reach one and be told which group brings it. */}
  <ul className="v2-tree">
   {ordered.map((s) => {
    // `state.visible` DELIBERATELY, and it is not the stale-reader defect the intent field exists to
    // end. The EYE describes what is DRAWN — the effective visibility, which a scene's skeletal
    // ghost legitimately overrides — where the TICK would describe the human's membership choice.
    // Two facts, two sources; the eye reads the render and says so. (The phone's system CHECKBOX is
    // the human's choice and reads `visibleIntent`; see page.tsx.)
    const on = p.state.visible.includes(s.id);
    return <li key={s.id} className="v2-tree-row">
     <span className="v2-tw"><Ico d={P.chev} size={13}/></span>
     {/* THE TICK IS EMPTY AT S0, and that is a correctness decision rather than laziness. The tick
         means MEMBERSHIP ("in this view") and membership per system is not computed until S3;
         driving it from `state.visible` would draw VISIBILITY in the membership control — which is
         precisely the confusion the eye/tick split exists to prevent (RC8). The EYE does show real
         system visibility, because that fact is live today and true. */}
     <span className="v2-tick" title="S3" aria-hidden="true"/>
     <span className="v2-swatch" style={{background: s.color}}/>
     <span className="v2-tree-name" title={t.system(s.id, s.name)}>{t.system(s.id, s.name)}</span>
     <em>{systemConcepts[s.id].toLocaleString()}</em>
     <button type="button" className="v2-eye v2-inert" aria-disabled="true" title="S3"
      aria-label={`${t.system(s.id, s.name)} — ${tr('panel.visibility')}`}>
      <Ico d={on ? P.eye : P.eyeOff} size={14}/>
     </button>
    </li>;
   })}
  </ul>
  {/* ⚠️ NOTHING LATE-ARRIVING IN THE FOOT. It printed the derived concept total, which is 0 until
      the atlas lands and 3,432 after — a longer string that re-wrapped the foot, shrank the tree's
      flex box and moved every row. The CLS oracle attributed 0.0124 to `li.v2-tree-row` for exactly
      that reason. The total is already on screen, at the top of the sidebar, in a line whose text is
      static. */}
  <div className="v2-side-foot">
   <div>{tr('panel.membership')}</div>
   <div>{tr('panel.visibility')}</div>
   <button type="button" className="v2-inert" aria-disabled="true" title="S3">{tr('panel.resetVisibility')}</button>
  </div>
 </aside>;

 // ── the right docks ─────────────────────────────────────────────────────────────────────────
 const selectionPane = <>
  <div className="v2-pane-body">
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
       {/* The opacity slider is S3's — it is the same fact as the member eye (one fact, two
           controls), so shipping it before the tree exists would put the two out of step. */}
       {on && <div className="v2-card-row v2-opacity v2-inert" title="S3" tabIndex={0} aria-disabled="true">
        <span className="v2-badge">{tr('panel.opacity')}</span><em>100%</em>
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

 const jsonPane = <>
  <div className="v2-pane-body">
   <p className="v2-note-sm">{tr('json.read')}</p>
   {/* THE CANONICAL SCENE, from the controller — not the arrival blob, and not React state
       re-encoded. `null` when the page is not in scene mode, and it SAYS so rather than printing
       an empty object that reads as a scene with nothing in it. */}
   {p.scene
    ? <pre className="v2-json">{JSON.stringify(p.scene, null, 1)}</pre>
    : <p className="v2-empty-state">{tr('json.none')}</p>}
  </div>
  <div className="v2-pane-foot">
   <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S5">{tr('json.copy')}</button>
   <button type="button" className="v2-tbtn v2-inert" aria-disabled="true" title="S5">{tr('json.edit')}</button>
   <span className="v2-grow"/>
   <span className="v2-static">{tr('json.limit')}</span>
  </div>
 </>;

 // THE ASK DOCK. The deep link is permitted at S0 by the kickoff, so this is LIVE — and it opens
 // ChatGPT in a new tab with the prompt and the scene link, generating no answer here. The in-app
 // chat (and its CSP, and its key handling) is S5b and is deliberately absent, not stubbed.
 const askHref = (q: string) => {
  const link = `${location.origin}${location.pathname}${p.sceneBlob ? `?scene=${p.sceneBlob}` : `?select=${p.picks.join(',')}`}`;
  return `https://chatgpt.com/?q=${encodeURIComponent(`${q}\n\n${link}`)}`;
 };
 const [ask, setAsk] = useState('');
 const askPane = <>
  <div className="v2-pane-body">
   <p className="v2-note-sm"><b>{tr('ask.lead')}</b></p>
   <textarea className="v2-askbox" value={ask} onChange={(e) => setAsk(e.target.value)}
    placeholder={tr('ask.placeholder')} aria-label={tr('panel.ask')}/>
   <p className="v2-note-sm" style={{marginTop: 10}}>{tr('ask.context', {n: p.basket.length})}</p>
   <p className="v2-note-sm">{tr('ask.note')}</p>
  </div>
  <div className="v2-pane-foot">
   {/* DISABLED, not inert: the control exists and works, it just needs a question first. */}
   <a className={`v2-tbtn ${ask.trim() ? 'is-on' : ''}`} href={ask.trim() ? askHref(ask.trim()) : undefined}
    target="_blank" rel="noreferrer noopener" aria-disabled={!ask.trim()}
    style={ask.trim() ? undefined : {opacity: .45, pointerEvents: 'none'}}>{tr('ask.open')}</a>
  </div>
 </>;

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
  {!p.coarse && <div className="v2-tabs" role="group" aria-label={tr('tabs.short')}>
   <span className="v2-tab is-on">{p.caption.title || tr('tabs.current')}</span>
   <span className="v2-tab v2-inert" title="S5" tabIndex={0} aria-disabled="true">+ {tr('tabs.snapshot')}</span>
  </div>}
 </footer>;

 // THE GRID ITEMS ARE THE FRAGMENT'S CHILDREN. A React fragment emits no DOM node, so `bar`,
 // `tools`, `side`, `dock` and `status` are direct children of `.v2` and the `grid-area` on each
 // one resolves against it.
 return <>{bar}{tools}{side}{dock}{status}</>;
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
}) {
 const {tr, lang} = p;
 const [tab, setTab] = useState<'general' | 'language' | 'about'>('general');
 // ── Settings ────────────────────────────────────────────────────────────────────────────────
 const settings = <Overlay open={p.settingsOpen} onClose={() => p.onSettings(false)} sheet={p.sheet}
  title={tr('settings.title')} labelClose={tr('settings.close')}>
  <div className="v2-mtabs" role="tablist" aria-label={tr('settings.title')}>
   {(['general', 'language', 'about'] as const).map((k) => <button type="button" key={k} role="tab"
    aria-selected={tab === k} className={`v2-mtab ${tab === k ? 'is-on' : ''}`}
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
    <div><b>{tr('settings.keypad')}</b><p>{tr('nav.touch')}</p>
     <div className="v2-seg" style={{marginTop: 10}} title="S1">
      {(['off', 'arrows', 'full'] as const).map((k) => <button type="button" key={k}
       className={`v2-inert ${k === 'off' ? 'is-on' : ''}`} aria-disabled="true" title="S1">{tr(`settings.${k}`)}</button>)}
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
   <div className="v2-srow">
    <div><b>{tr('settings.pinyin')}</b><p>{tr('settings.pinyinNote')}</p></div>
    <div className="v2-srow-act">
     <span className="v2-static v2-inert" tabIndex={0} aria-disabled="true" title="S4">{tr('settings.pending')}</span>
    </div>
   </div>
   <div className="v2-srow">
    <div><b>{tr('settings.preview')}</b>
     {/* The 18 px pinyin line is RESERVED from S0, so turning the toggle on in S4 does not move
         every Chinese row down by a line the first time it loads. */}
     <p style={{lineHeight: '18px', minHeight: 18}}>胸骨体<br/><span style={{color: 'var(--v2-ink-3)'}}>Body of sternum</span></p>
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
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer noopener">CC BY 4.0</a>
    <a href="https://doi.org/10.1093/nar/gkn613" target="_blank" rel="noreferrer noopener">10.1093/nar/gkn613</a>
   </p>
   <h3>{tr('about.language')}</h3>
   <p>{tr('about.translation')}</p>
   <p>{tr('about.pinyin')}</p>
   <h3>{tr('about.fonts')}</h3>
   <p>{tr('about.fontList')}</p>
   <h3>{tr('about.runtime')}</h3>
   <p>{tr('about.runtimeList')}</p>
   <p>{tr('about.notices')}</p>
   <h3>{tr('about.historical')}</h3>
   <p>{tr('about.history')}</p>
   <hr/>
   {/* DERIVED AT BUILD TIME (vite.config.ts `define`), never typed here. The literals that used to
       sit in this line said `l31v21a` / `07e76ee` two increments after both had moved — on the one
       panel whose whole job is to say what the reader is looking at (stand-in review S1 L1). */}
   <p style={{marginTop: 12, color: 'var(--v2-ink-3)'}}>{tr('about.build', {build: ATLAS_BUILD, commit: ATLAS_COMMIT})}</p>
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
   <dl className="v2-keys">
    {rows.map((r) => <div key={r.keys + r.cmd} style={{display: 'contents'}}>
     <dt><span className="v2-kbd">{r.keys}</span></dt>
     {/* A ROW THAT NAMES ITS GROUP IS NOT A PROMISE THAT THE KEY WORKS. Every binding a later
         group brings is labelled with that group, so the map never lists a key that does nothing
         without saying so. */}
     <dd>{tr(r.cmd)}{r.owner && <s> · {tr('inert.pending', {s: r.owner})}</s>}</dd>
    </div>)}
   </dl>
  </div>)}
 </Overlay>;

 return <>{settings}{keys}</>;
}
type KeyGroup = 'now' | 'global' | 'camera' | 'tree';
