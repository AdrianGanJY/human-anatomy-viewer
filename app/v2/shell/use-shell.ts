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
import {HOLD, HOLD_CODES, installDispatcher, type Command as KeyCommand, type Dispatcher} from './keys.ts';
import {isStudio, ladder, openDock, tierOf, type Tier} from './layout.ts';
import {effectiveDocks, readDocks, writeDocks, type DockKey} from './store.ts';

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

export interface ShellState {
 tier: Tier;
 studio: boolean;
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

export function useShell(onCommand?: (cmd: KeyCommand) => boolean | void): ShellState {
 const vp = useViewport();
 const tier = tierOf(vp.w, vp.h, vp.coarse);
 const studio = isStudio(tier);
 const wide = tier === 'studio-wide';

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

 const [keysOpen, setKeysOpen] = useState(false);
 const [settingsOpen, setSettingsOpen] = useState(false);
 const [findOpen, setFindOpen] = useState(false);
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
 const modalRef = useRef(false);
 modalRef.current = keysOpen || settingsOpen || findOpen;
 const studioRef = useRef(false);
 studioRef.current = studio;
 const cmdRef = useRef<((cmd: KeyCommand) => boolean | void) | null>(null);
 const dispRef = useRef<Dispatcher | null>(null);

 cmdRef.current = (cmd: KeyCommand) => {
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

 useEffect(() => {
  const d = installDispatcher({
   modalOpen: () => modalRef.current,
   run: (cmd) => cmdRef.current?.(cmd) ?? false,
   holdCodes: HOLD_CODES,
   onHold: setHoldN,
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
 useEffect(() => { nav()?.mode(navMode); }, [navMode, studio]);

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
 useEffect(() => { dispRef.current?.clear(); }, [studio]);

 // OPENING A MODAL CLEARS THE HELD SET — one of the six ways a keyup goes missing. The dispatcher
 // clears on blur / pointercancel / visibilitychange itself; a modal that takes focus within the
 // same document fires none of those.
 useEffect(() => { if (keysOpen || settingsOpen || findOpen) window.dispatchEvent(new Event('blur')); }, [keysOpen, settingsOpen, findOpen]);

 return {
  tier, studio, sheet: vp.w < 768, coarse: vp.coarse,
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
 };
}
