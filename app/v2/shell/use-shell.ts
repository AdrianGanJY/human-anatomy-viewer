/**
 * THE SHELL'S OWN STATE — tier, docks, sidebar, the collapse ladder, the dispatcher.
 * L31 v2.1b+c, S0.
 *
 * It is a hook rather than component state so that `app/v2/page.tsx` can call it UNCONDITIONALLY —
 * at every width, including the phone — while the shell itself renders only at >=1180. Hooks may
 * not be conditional, and "the studio's state exists but the studio does not render" is both legal
 * and cheap: two matchMedia listeners and a localStorage read.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {HOLD, HOLD_CODES, POSE_CMDS, installDispatcher, type Command as KeyCommand, type Dispatcher} from './keys.ts';
import {isStudio, ladder, openDock, tierOf, type Tier} from './layout.ts';
import {effectiveDocks, readDocks, readPinyin, readScenes, writeDocks, writePinyin, writeScenes, SCENES_CAP, type DockKey, type SceneTab} from './store.ts';
import type {AskState, Turn as AskTurn} from './ask.tsx';
import {loadPinyin, pinyinOf} from '../pinyin.ts';

/** A live viewport reading. `matchMedia` rather than a resize listener: the browser coalesces the
 *  change events, and the four queries below are exactly the four boundaries that matter, so a
 *  drag-resize fires four times instead of sixty. */
function useViewport() {
 const read = () => ({
  w: window.innerWidth, h: window.innerHeight,
  coarse: typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches,
 });
 const [vp, setVp] = useState(read);
 useEffect(() => {
  const on = () => setVp(read());
  window.addEventListener('resize', on);
  const mqs = ['(min-width:768px)', '(min-width:1180px)', '(min-width:1600px)', '(pointer:coarse)', '(max-height:520px)']
   .map((q) => matchMedia(q));
  for (const m of mqs) m.addEventListener('change', on);
  on();
  return () => {
   window.removeEventListener('resize', on);
   for (const m of mqs) m.removeEventListener('change', on);
  };
 }, []);
 return vp;
}

/**
 * The panels the tablet's ONE right sheet can show. `spec.md` T2/T3: "Tablet tabs are Layers /
 * Selection / Info, with JSON and Ask in Panels/More" — five destinations, three of them in the
 * toolbar and two behind the overflow, all of them the SAME sheet.
 */
export type TabletTab = 'layers' | 'selection' | 'info' | 'json' | 'ask';

export interface ShellState {
 tier: Tier;
 studio: boolean;
 /** ── S6 ─────────────────────────────────────────────────────────────────────────────────── */
 /** 768-1179. The studio chrome, one shared right sheet instead of a sidebar and docks. */
 tablet: boolean;
 /** `studio || tablet` — the tiers that render the shell at all. */
 chrome: boolean;
 /** Which panel the tablet sheet is showing, or null when it is closed. Closed on entry, never
  *  persisted: `atlas.dock` is a DESKTOP choice and must not open a sheet over a tablet field. */
 tSheet: TabletTab | null; setTSheet(v: TabletTab | null): void;
 /** True when the sheet is a 300 px INLINE column (landscape >= 1024) rather than a 360 px overlay
  *  with a scrim. The overlay is focus-trapped and closes on Escape; the inline column is not a
  *  modal and does not steal focus. */
 tabletInline: boolean;
 /** Below 768 an overlay presents as a bottom sheet. */
 sheet: boolean;
 /** `pointer:coarse`. Read once here so no component re-derives it. */
 coarse: boolean;
 docks: DockKey[];
 sideStub: boolean;
 autoCollapsed: boolean;
 /** The ladder's own account of what it did — the oracle's measured string. */
 steps: string[];
 sideW: number; dockW: number;
 toggleDock(k: DockKey): void;
 toggleSide(): void;
 keysOpen: boolean; setKeysOpen(v: boolean): void;
 settingsOpen: boolean; setSettingsOpen(v: boolean): void;
 /** ── S2 ─────────────────────────────────────────────────────────────────────────────────── */
 /** The Find palette. It lives HERE rather than in the page because the dispatcher opens it and the
  *  dispatcher is installed here — and because `modalOpen()` has to count it, or the camera keys
  *  would fire behind an open palette. */
 findOpen: boolean; setFindOpen(v: boolean): void;
 /** ── S1 ─────────────────────────────────────────────────────────────────────────────────── */
 /** The drag mode the field is in. The pill shows it; `O`/`P` and the pill both set it. */
 navMode: NavMode; setNavMode(m: NavMode): void;
 /** How many camera keys are down. The pad highlights its keys from this, so a PHYSICAL W lights
  *  the on-screen W — the cheapest possible proof to a reader that the two are one thing. */
 held: ReadonlySet<string>; holdN: number;
 /** The pad's press/release, straight into the dispatcher's held set. */
 press(code: string): void; release(code: string): void;
 /** ── S4 ─────────────────────────────────────────────────────────────────────────────────── */
 /** The pinyin setting, from `localStorage['atlas.pinyin']`. It lives here, in the hook the page
  *  calls at EVERY width, because the phone's A6 Settings sheet writes the same key as the studio's
  *  Settings modal — one owner, or the two would drift into two settings with one name. */
 pinyin: boolean; setPinyin(on: boolean): void;
 /**
  * THE READING FOR ONE ROW, or null — the single accessor every pinyin surface uses.
  *
  * It folds in three things the call sites must not each remember: the toggle state, whether the
  * map has arrived, and whether the string being drawn is Chinese at all (`pinyinOf`). Threading a
  * function rather than the map is what makes "pinyin is off" and "pinyin has not loaded"
  * indistinguishable to a row, which is correct — a row draws nothing in both cases.
  */
 py(id: string, shown: string): string | null;
 /** ── S5a ─────────────────────────────────────────────────────────────────────────────────── */
 /**
  * THE SNAPSHOT TABS, from `localStorage['atlas.scenes']` (the shape S0 declared, RC12).
  *
  * They live HERE, in the hook the page calls at every width, for the same reason the pinyin
  * setting does: the studio's bottom strip and the phone's A9 sheet are two presentations of ONE
  * list. Two owners would be two lists with one key, and whichever rendered last would win.
  *
  * ⚠️ NO APPLY HERE. Applying a tab is a controller transaction plus a camera restore, and the
  * controller lives in `page.tsx`. This hook owns the LIST; the page owns what a click does.
  */
 /** S5b: the Ask surface's draft + conversation, owned here so a close cannot discard them. */
 askState: AskState;
 tabs: SceneTab[];
 /** Append, newest last, capped at 8 by dropping the OLDEST — and persisted in the same call, so
  *  there is no window where the rendered list and the stored list disagree. */
 addTab(t: SceneTab): void;
 /** True when a snapshot would evict one, so the control can say so BEFORE it is clicked. */
 tabsFull: boolean;
}

export type NavMode = 'orbit' | 'pan';

/**
 * ── THE NAVIGATION RATES ───────────────────────────────────────────────────────────────────────
 * Per SECOND, never per frame: a per-frame step moves twice as fast on a 120 Hz display, and the
 * ONE thing a camera control must not do is behave differently on different hardware.
 *
 * PAN is a fraction of the FIELD — 0.55 of the visible height per second — so it feels the same at
 * every zoom and every viewport, which is why `navPan` takes fractions rather than metres.
 * ORBIT is ~46°/s: a little under two seconds for a quarter turn, which is the speed at which the
 * eye can still follow which way a structure went.
 * DOLLY is a RATE, applied as `rate^dt` — multiplicative, because distance is: a fixed step that
 * looks gentle at 4 m slams into `minDistance` at 0.1 m.
 */
const PAN_RATE = 0.55, ORBIT_RATE = 0.8, DOLLY_RATE = 2.2;

/** The renderer's navigation surface (app/scene.tsx). Absent until the scene effect has run —
 *  every call site checks, because a key pressed during the first second is a real case. */
interface AtlasNav {
 orbit(dTheta: number, dPhi: number): void;
 pan(dx: number, dy: number): void;
 dolly(factor: number): void;
 home(): void;
 fit(): string;
 mode(m: string): string;
 pose(): {x: number; y: number; z: number; tx: number; ty: number; tz: number; manual: boolean};
}
const nav = (): AtlasNav | null => (window as unknown as {__atlasNav?: AtlasNav}).__atlasNav ?? null;
/** Returned on the very first render, before the install effect has run. A frozen module-level
 *  constant rather than a fresh `new Set()`, so it cannot be mistaken for a live set. */
const EMPTY_HELD: ReadonlySet<string> = new Set<string>();

export function useShell(
 onCommand?: (cmd: KeyCommand) => boolean | void,
 /**
  * ⚠️ CALLED FOR **EVERY** COMMAND, BEFORE ANY OF THEM IS HANDLED — codex round 14's M1.
  *
  * Round 13 put the page's `cancelPoseRestore()` inside `onCommand`, which looked complete and was
  * not: `home`, `fit` and the drag-mode commands are answered HERE and `return` before
  * `onCommandRef` is ever reached, because the renderer's navigation surface is a global rather
  * than React state. So pressing H or F — or clicking Home or Fit on the pill — left an in-flight
  * pose restore live, and codex executed it:
  *
  *     home: apply A -> setPose x=1 scene=A -> new camera x=99 -> setPose x=1 scene=A
  *
  * The reader asked for Home, got Home, and then had the tab's old pose written back over it.
  *
  * A second hook rather than a re-ordering: "something happened that the page may need to know
  * about" is a different question from "does the page want to handle this", and folding them
  * together is what produced a cancellation that covered only the commands this hook declines.
  *
  * ══ S5a-2 — AND IT IS NOW "CAMERA INTENT", NOT "ANY COMMAND" ═══════════════════════════════════
  *
  * Round 15 measured the other half of the same design error: opening the keyboard-help overlay
  * (`keymap`) cancelled a pending restore — `job=2`, zero writes, the pose never restored — and that
  * is not a camera request. A hook that fires for EVERY command is too broad in exactly the way the
  * enumeration it replaced was too narrow.
  *
  * So it fires for:
  *   · `POSE_CMDS` (`home`, `fit`) — the only commands that move the camera WITHOUT the controller,
  *     and therefore the only ones a pending restore's controller signature cannot already see;
  *   · any HELD camera key going down (below, in `onHold`) — `HOLD_CODES` is a camera-only map by
  *     construction, so there is nothing to classify there. This is round 15's second entry point:
  *     `installDispatcher` routes held keys through `onHold`, never through `cmdRef`, so a reader
  *     holding W fought the restore frame by frame.
  * The named views and `reset` are deliberately absent — they dispatch through the controller, which
  * bumps `render.reset`, which is what the signature is watching. See `POSE_CMDS` in `keys.ts`.
  */
 onCameraIntent?: (why: KeyCommand | 'held') => void,
 /**
  * ⚠️ SCENES IS AN OVERLAY AND MUST BE COUNTED — codex round 25, Medium 1. It executed the dispatcher
  * with the Scenes sheet open at 768, 1024 and 1366: `W` entered the held camera set, `2` dispatched
  * a named view, and Ctrl+K opened Find on top of it. The state lives in `page.tsx` because the
  * PHONE opens the same surface from its margin, so it is threaded in rather than moved — two owners
  * for one sheet is the defect S5b already paid for with the Ask draft.
  */
 scenesOpen = false,
): ShellState {
 const vp = useViewport();
 const tier = tierOf(vp.w, vp.h, vp.coarse);
 const studio = isStudio(tier);
 const wide = tier === 'studio-wide';

 /**
  * ══ THE TABLET TIER — S6 ══════════════════════════════════════════════════════════════════════
  *
  * 768-1179 kept "today's behaviour" through S0-S5b by the kickoff's own instruction, which meant
  * the legacy v2 page: a 340 px right MARGIN, the phone's detent state, no studio chrome. S6 gives
  * it the studio's bar / tools / field / status and ONE shared right sheet — `spec.md`'s explicit
  * exception to the desktop's left sidebar ("The brief asks tablet Layers in the right sheet …
  * desktop Layers remains left"), because two overlapping drawers on a touch screen block each
  * other and a 768 px portrait viewport has no room for a 264 px column beside a field.
  *
  * ⚠️ CLOSED ON ENTRY, AND NOT PERSISTED. `spec.md`: "Shared right sheet closed on entry." The
  * desktop's `atlas.dock` deliberately does NOT reach here: a reader who opened Info on a 1920 px
  * monitor has not asked for a sheet covering a third of their tablet.
  *
  * The two presentations are the spec's, and the boundary is its own: portrait (or a short/narrow
  * landscape) gets a 360 px OVERLAY with a scrim — over the field, focus-trapped, Escape closes;
  * a landscape >= 1024 wide gets 300 px INLINE, a real grid column, because at that width the field
  * survives it (1024 - 300 = 724, the artboard's own number).
  */
 const tablet = tier === 'tablet';
 /** The studio chrome renders here too — the tier only changes its arrangement. */
 const chrome = studio || tablet;
 const [tSheet, setTSheet] = useState<TabletTab | null>(null);
 const tabletInline = tablet && vp.w >= 1024 && vp.h > 520;
 // Read by `setFindOpen`, which is memoised with no dependencies so that the palette's opener does
 // not change identity on every resize.
 const tabletInlineRef = useRef(false);
 tabletInlineRef.current = tabletInline;
 // A resize that leaves the tablet takes its sheet with it: the desktop has docks for these three
 // panels, and a sheet left open across the boundary would be a fourth, trapped, invisible one.
 useEffect(() => { if (!tablet) setTSheet(null); }, [tablet]);

 // Read ONCE, lazily. Re-reading on every tier change would discard an in-session choice the moment
 // the window crossed 1600 — the persisted value is the SEED, not the live truth.
 //
 // ⚠️ NOTHING IS WRITTEN ON ENTRY. The first build seeded the tier's default into `atlas.dock` when
 // the key was absent, which turned "we picked this for you at 1440" into "the human chose one dock"
 // and made G2's two-panel default at >=1600 permanently unreachable for anyone whose first visit
 // was narrower — a door no later group could reopen (stand-in review H1). So `open` stays null
 // until a human OPENS OR CLOSES something, and `effectiveDocks` derives the set from the tier in
 // the meantime, live, so it follows the window until there is a real choice to respect.
 const [prefs, setPrefs] = useState(() => readDocks());

 const lad = useMemo(() => ladder({
  width: vp.w, side: prefs.side, sideCollapsed: prefs.sideCollapsed, open: effectiveDocks(prefs, wide),
 }), [vp.w, prefs, wide]);

 const toggleDock = useCallback((k: DockKey) => {
  // The FIRST toggle is also the moment the set becomes the human's, so it starts from what they
  // were actually looking at — the tier default — not from an empty set.
  setPrefs((cur) => {
   const next = {...cur, open: openDock(effectiveDocks(cur, wide), k)};
   writeDocks(next); return next;
  });
 }, [wide]);
 const toggleSide = useCallback(() => {
  setPrefs((cur) => { const next = {...cur, sideCollapsed: !cur.sideCollapsed}; writeDocks(next); return next; });
 }, []);

 /**
  * ── S4 — THE PINYIN SETTING, AND WHY THE FETCH IS IN AN EFFECT ON `pinyin` ────────────────────
  *
  * RC10 gives this feature two request-ledger rows: OFF ⇒ zero starts for `/i18n/pinyin.json` on a
  * fresh English visit, ON ⇒ exactly one. Both fall out of the shape rather than out of care: the
  * only call to `loadPinyin()` in the app is guarded by `if (!on) return` inside an effect whose
  * dependency IS the setting, and `loadPinyin` memoises its success. There is no eager warm-up and
  * no prefetch, because either would be a third row nobody asked for.
  *
  * `pyRev` exists because the map is module state, not React state: when the fetch lands, nothing
  * React can see has changed. Bumping a counter is what gives `py` a new identity so the rows
  * holding it re-render once, when the readings actually become available.
  */
 const [pinyin, setPinyinState] = useState(() => readPinyin().on);
 const [pyRev, setPyRev] = useState(0);
 useEffect(() => {
  if (!pinyin) return;
  let alive = true;
  loadPinyin().then(() => { if (alive) setPyRev((r) => r + 1); });
  return () => { alive = false; };
 }, [pinyin]);
 const setPinyin = useCallback((on: boolean) => {
  setPinyinState(on);
  writePinyin({v: 1, on});
 }, []);
 // `pyRev` is in the dependency list precisely so this closure is REPLACED when the map arrives;
 // an eslint-style "unused dependency" reading of it would be wrong.
 const py = useCallback(
  (id: string, shown: string) => (pinyin ? pinyinOf(id, shown) : null),
  [pinyin, pyRev],
 );

 /**
  * ── S5a — THE SNAPSHOT LIST ───────────────────────────────────────────────────────────────────
  *
  * Read ONCE, lazily, and through `readScenes`, which is corruption-tolerant by construction: a
  * malformed value, a wrong `v`, a non-array `tabs`, a tab with no blob or a half-written six-tuple
  * camera all degrade to "no tabs" or "this tab has no pose" rather than to a white page. The
  * oracle for that is the RC12 corrupt-value row, extended to this key.
  */
/**
  * ── THE ASK SURFACE'S STATE, OWNED ABOVE THE SURFACE — codex round 22, Medium 5 ────────────────
  *
  * The dock and the phone sheet are CONDITIONALLY MOUNTED: closing either unmounts `AskPanel`. S5a
  * kept the unsent draft in `Shell`/`PhoneSheets`, which stay mounted through a close, so the draft
  * survived; S5b moved the surface into its own component and the draft moved with it. codex
  * executed the lifecycle and measured an unsent draft becoming `""` on reopen -- so "without a key
  * the dock is exactly S5a" was false, on both surfaces, and no oracle saw it because every row
  * types and reads inside one mount.
  *
  * Owned here, the draft and the conversation survive closing the dock, opening the sheet, and the
  * tier switch between them -- which is also the only reason a reader can carry a question from the
  * desktop into a rotated phone. (The SPEND is owned higher still, in `ai.ts`, for the page's
  * lifetime: closing a panel is not the same event as ending a session -- Medium 1.)
  */
 const [askDraft, setAskDraft] = useState('');
 const [askTurns, setAskTurns] = useState<AskTurn[]>([]);

 const [tabs, setTabs] = useState<SceneTab[]>(() => readScenes().tabs);
 const addTab = useCallback((t: SceneTab) => {
  setTabs((cur) => {
   // NEWEST LAST, OLDEST DROPPED. The strip reads left to right, so appending is what makes the
   // new snapshot appear where the eye already is — and the cap has to bite somewhere, so it bites
   // the end nobody has looked at in eight snapshots.
   const next = [...cur, t].slice(-SCENES_CAP);
   writeScenes({v: 1, tabs: next});
   return next;
  });
 }, []);

 const [keysOpen, setKeysOpen] = useState(false);
 const [settingsOpen, setSettingsOpen] = useState(false);
 const [findOpen, setFindOpenState] = useState(false);
 /**
  * ⚠️ FIND REPLACES THE PORTRAIT SHEET RATHER THAN STACKING ON IT — codex round 25, Medium 1.
  *
  * `Ctrl+K` deliberately bypasses the dispatcher's modal guard (keys.ts: the palette is reachable
  * from anywhere, which is the whole point of a command palette). codex executed it with the
  * portrait Selection sheet open and got `tSheet='selection'` AND `findOpen=true` at once — two
  * focus traps over one field, and Escape closing whichever of them React happened to mount last.
  *
  * The INLINE sheet stays, because it is a column beside the field and Find is a modal over it —
  * the same rule as everywhere else in this file: the overlay presentation is a dialog, the inline
  * one is a panel.
  */
 const setFindOpen = useCallback((v: boolean) => {
  setFindOpenState(v);
  if (v) setTSheet((cur) => (cur && !tabletInlineRef.current ? null : cur));
 }, []);
 const [navMode, setNavModeState] = useState<NavMode>('orbit');
 const [holdN, setHoldN] = useState(0);

 /**
  * ── THE EXTENSION SEAM (stand-in review round 1, M4; kickoff item 3) ──────────────────────────
  *
  * S0 re-installed the dispatcher whenever an overlay opened, because its `run` closed over
  * `keysOpen`/`settingsOpen` directly. That was harmless while nothing read `held` — and would
  * have been a silent defect the moment something did, since every consumer would have captured a
  * `Set` that the CURRENT dispatcher no longer writes to. S1 reads `held` in an animation loop, so
  * the seam has to come first: state is read through REFS, the effect has NO dependencies, and the
  * dispatcher (and its `held`) is created exactly once per mount.
  *
  * The cost of getting this order wrong is not a crash — it is a camera that stops answering W
  * after somebody opens Settings once, which nobody would attribute to the keyboard layer.
  */
 // EVERY OVERLAY COUNTS, and the palette is the one most likely to be forgotten because it is not a
 // "dialog" in the everyday sense. If it were missing here, W A S D typed into the Find box would
 // reach guard 1 (which declines inside an editor) but a bare `1` or `R` pressed with focus on a
 // RESULT ROW — a button, not an editor — would change the camera behind the open palette.
 /**
  * ⚠️ THE TABLET'S PORTRAIT SHEET IS A MODAL AND MUST BE COUNTED — codex round 24, Medium 1.
  *
  * It executed the hook and the dispatcher with a portrait Selection sheet open: `W` entered the
  * held camera set, `2` dispatched a named view, and Ctrl+K opened the palette ON TOP of it, so the
  * page held two modal surfaces at once. Clearing the held set when the sheet opens (which S6 does)
  * stops a key that was already down; it does nothing about the next one.
  *
  * ⚠️ AND THE INLINE COLUMN IS DELIBERATELY NOT IN THIS LIST. A landscape tablet's sheet is a grid
  * column beside a live field, not a dialog over it — it does not dim the field, does not trap
  * focus, and a reader with it open is expected to keep driving the camera. Folding both
  * presentations in would have taken the keyboard away from the tier that has the most room for it.
  */
 const modalRef = useRef(false);
 modalRef.current = keysOpen || settingsOpen || findOpen || scenesOpen || !!(tSheet && !tabletInline);
 /**
  * ⚠️ GUARD 7 READS `chrome`, NOT `studio`, SINCE S6 — and that is the guard's own rule applied, not
  * a widening of it. `keys.ts`: "withhold a command iff its SURFACE is studio-only". The camera
  * commands were withheld below 1180 because below 1180 there was no pill, no key pad and no
  * `__atlasNav` — S6 gives the tablet all three, so the surface exists and the reason to withhold
  * does not. The key map reads the same flag, so it stops marking those seven rows "desktop only"
  * at exactly the tier where they start working. The PHONE is unchanged: it has no field chrome and
  * the seven stay withheld and marked.
  */
 const studioRef = useRef(false);
 studioRef.current = chrome;
 const cmdRef = useRef<((cmd: KeyCommand) => boolean | void) | null>(null);
 const dispRef = useRef<Dispatcher | null>(null);

 cmdRef.current = (cmd: KeyCommand) => {
  // FIRST, before any branch can return — but ONLY for a command that moves the camera outside the
  // controller. See `onCameraIntent` and `POSE_CMDS`.
  if (POSE_CMDS.has(cmd)) anyRef.current?.(cmd);
  if (cmd === 'escape') {
   // TOP OVERLAY FIRST. The overlays handle their own Escape when focus is inside them; this is
   // the case where focus has left the panel (a click on the scrim's edge, say) and the key still
   // has to close the thing on top.
   if (keysOpen) { setKeysOpen(false); return true; }
   if (settingsOpen) { setSettingsOpen(false); return true; }
   if (findOpen) { setFindOpen(false); return true; }
   // ⚠️ FALLS THROUGH TO THE PAGE, which leaves the stage. The comment here used to say
   // "declined: `?stage=1`'s own exit still owns Escape (page.tsx)" and there was NO Escape
   // handler in page.tsx — `grep -rn Escape app/v2/` found only the overlay's own trap and that
   // sentence (stand-in review S1 M6). S1 made the stage reachable by keystroke (Shift+S), and in
   // stage the pill and the pad are unrendered, so a reader who pressed it had one small button
   // and an Escape key that did nothing. The comment is now true because the code is.
   return onCommandRef.current?.('escape') ?? false;
  }
  if (cmd === 'keymap') { setKeysOpen(true); return true; }
  /**
   * S2. Consumed at EVERY tier — the palette is a modal in the studio and the A4 sheet on the
   * phone, so unlike the camera commands it has somewhere to go below 1180.
   *
   * ⚠️ AND IT ADJUDICATES THE MODAL CASE, because `keys.ts` guard 3 now lets `find` through (M2).
   * A second Ctrl+K with the PALETTE open is consumed — it re-focuses rather than doing nothing
   * visible, and crucially it does not escape to the browser, which is what it used to do. With the
   * key map or Settings open it is DECLINED: stacking a palette on another modal is worse than
   * leaving the chord alone, and declining hands the event back untouched.
   */
  if (cmd === 'find') {
   if (keysOpen || settingsOpen) return false;
   if (findOpen) { document.querySelector<HTMLElement>('.v2-find [data-autofocus]')?.focus(); return true; }
   setFindOpen(true);
   return true;
  }
  // ── S1's OWN COMMANDS. The camera ones are answered here because the renderer's surface is a
  //    global rather than React state; the ones that change the SCENE (a named view, Reset,
  //    Stage) go out to the page, which owns the controller. ──
  if (cmd === 'home') { const n = nav(); if (!n) return false; n.home(); return true; }
  if (cmd === 'fit') { const n = nav(); if (!n) return false; n.fit(); return true; }
  if (cmd === 'mode-orbit' || cmd === 'mode-pan') { setNavMode(cmd === 'mode-pan' ? 'pan' : 'orbit'); return true; }
  return onCommandRef.current?.(cmd) ?? false;
 };
 const onCommandRef = useRef(onCommand);
 onCommandRef.current = onCommand;
 const anyRef = useRef(onCameraIntent);
 anyRef.current = onCameraIntent;

 useEffect(() => {
  const d = installDispatcher({
   modalOpen: () => modalRef.current,
   run: (cmd) => cmdRef.current?.(cmd) ?? false,
   holdCodes: HOLD_CODES,
   /**
    * ⚠️ A HELD CAMERA KEY IS CAMERA INTENT — round 15's second M1 entry point, and it is reported
    * HERE because this is the only seam it has: `installDispatcher` announces held keys through
    * `onHold` and never through `run`/`cmdRef`, so `POSE_CMDS` above cannot see W going down.
    * `HOLD` is a camera-only map (pan / orbit / dolly), so "the set became non-empty" IS "a reader
    * is driving the camera" — no classification, and nothing to keep in step when a key is added.
    */
   onHold: (n: number) => { setHoldN(n); if (n > 0) anyRef.current?.('held'); },
   // Guard 7, through a ref for the same reason `modalOpen` is: the dispatcher is installed once.
   cameraEnabled: () => studioRef.current,
  });
  dispRef.current = d;
  return () => { d.destroy(); dispRef.current = null; };
 }, []);

 /**
  * ── THE HELD-KEY LOOP ─────────────────────────────────────────────────────────────────────────
  *
  * Runs ONLY while something is held (`holdN`), so an idle page schedules no frames at all. `dt`
  * is real elapsed seconds, so the camera moves at the same speed on a 60 Hz and a 120 Hz display
  * — and the FIRST frame after a press gets `dt = 0`, because `performance.now()` at that moment
  * says nothing about how long the key has been down.
  *
  * Axes are SUMMED before they are applied: W+A is one diagonal pan, not two sequential ones that
  * each re-read the camera basis and curve.
  */
 useEffect(() => {
  if (!holdN) return;
  const held = dispRef.current?.held;
  if (!held) return;
  let raf = 0, last = 0;
  const step = (now: number) => {
   raf = requestAnimationFrame(step);
   const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
   last = now;
   const n = nav();
   if (!n || !dt) return;
   let px = 0, py = 0, ot = 0, op = 0, dz = 0;
   for (const code of held) {
    const a = HOLD[code];
    if (!a) continue;
    if (a.pan) { px += a.pan[0]; py += a.pan[1]; }
    if (a.orbit) { ot += a.orbit[0]; op += a.orbit[1]; }
    if (a.dolly) dz += a.dolly;
   }
   if (px || py) n.pan(px * PAN_RATE * dt, py * PAN_RATE * dt);
   if (ot || op) n.orbit(ot * ORBIT_RATE * dt, op * ORBIT_RATE * dt);
   if (dz) n.dolly(Math.pow(DOLLY_RATE, dz * dt));
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
 }, [holdN]);

 /** The mode lives in TWO places — React (so the pill can show it) and OrbitControls (so the drag
  *  actually changes) — and this is the only writer of both, so they cannot drift. */
 const setNavMode = useCallback((m: NavMode) => {
  setNavModeState(m);
  nav()?.mode(m);
 }, []);
 // The renderer is created after the first render, so a mode chosen before it exists (or restored
 // across a scene remount) has to be re-applied rather than assumed to have landed.
 useEffect(() => { nav()?.mode(navMode); }, [navMode, studio, tablet]);

 /**
  * LOSING THE STUDIO CLEARS THE HELD SET, and so does gaining it.
  *
  * A resize across 1180 unmounts `StudioField` — the on-screen pad — which means a finger that was
  * holding a pad key never delivers its `pointerup`, `pointerleave` or `pointercancel` to a node
  * that still exists. None of the dispatcher's own clearing paths (blur, pointercancel,
  * visibilitychange) are window-level events here, so the code stays in `held` for ever: the rAF
  * loop pans the camera indefinitely, and the discrete twin of that code becomes unreachable
  * (`Shift+S` is dead while `KeyS` is stuck). Round 2, Medium 1 — found by execution, and it had
  * already produced one red that was attributed to something else.
  */
 useEffect(() => { dispRef.current?.clear(); }, [studio, tablet]);

 // OPENING A MODAL CLEARS THE HELD SET — one of the six ways a keyup goes missing. The dispatcher
 // clears on blur / pointercancel / visibilitychange itself; a modal that takes focus within the
 // same document fires none of those.
 // S6: the tablet's OVERLAY sheet is a modal too — it traps focus and takes the pointer, so a key
 // held when it opens has the same missing-keyup problem as Settings.
 useEffect(() => { if (keysOpen || settingsOpen || findOpen || (tSheet && !tabletInline)) window.dispatchEvent(new Event('blur')); }, [keysOpen, settingsOpen, findOpen, tSheet, tabletInline]);

 return {
  tier, studio, tablet, chrome, sheet: vp.w < 768, coarse: vp.coarse,
  tSheet, setTSheet, tabletInline,
  docks: studio ? lad.open : [],
  sideStub: studio ? lad.sideW <= 44 : false,
  autoCollapsed: studio ? lad.autoCollapsed : false,
  steps: lad.steps, sideW: lad.sideW, dockW: lad.dockW,
  toggleDock, toggleSide,
  keysOpen, setKeysOpen, settingsOpen, setSettingsOpen,
  findOpen, setFindOpen,
  navMode, setNavMode,
  // `held` is the dispatcher's OWN set — the stable one. `holdN` is what makes React re-render
  // when it changes; reading `.size` off a mutated Set would never re-render the pad.
  held: dispRef.current?.held ?? EMPTY_HELD, holdN,
  press: useCallback((code: string) => dispRef.current?.press(code), []),
  release: useCallback((code: string) => dispRef.current?.release(code), []),
  pinyin, setPinyin, py,
  askState: {draft: askDraft, setDraft: setAskDraft, turns: askTurns, setTurns: setAskTurns},
  tabs, addTab, tabsFull: tabs.length >= SCENES_CAP,
 };
}
