/**
 * THE SHELL'S OWN STATE — tier, docks, sidebar, the collapse ladder, the dispatcher.
 * L31 v2.1b+c, S0.
 *
 * It is a hook rather than component state so that `app/v2/page.tsx` can call it UNCONDITIONALLY —
 * at every width, including the phone — while the shell itself renders only at >=1180. Hooks may
 * not be conditional, and "the studio's state exists but the studio does not render" is both legal
 * and cheap: two matchMedia listeners and a localStorage read.
 */
import {useCallback, useEffect, useMemo, useState} from 'react';
import {installDispatcher, type Command as KeyCommand} from './keys.ts';
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
}

export function useShell(): ShellState {
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

 // THE DISPATCHER. Installed at every width — Escape and `?` are not studio commands — and it reads
 // `modalOpen` through a ref-free closure over the two booleans, which is correct precisely because
 // the effect re-installs when they change. S1 replaces the two bindings; the guards do not move.
 useEffect(() => {
  const d = installDispatcher({
   modalOpen: () => keysOpen || settingsOpen,
   run(cmd: KeyCommand) {
    if (cmd === 'escape') {
     // TOP OVERLAY FIRST. The overlays handle their own Escape when focus is inside them; this is
     // the case where focus has left the panel (a click on the scrim's edge, say) and the key still
     // has to close the thing on top.
     if (keysOpen) { setKeysOpen(false); return true; }
     if (settingsOpen) { setSettingsOpen(false); return true; }
     return false;   // declined: `?stage=1`'s own exit still owns Escape (page.tsx)
    }
    if (cmd === 'keymap') { setKeysOpen(true); return true; }
    return false;
   },
  });
  return () => d.destroy();
 }, [keysOpen, settingsOpen]);

 // OPENING A MODAL CLEARS THE HELD SET — one of the six ways a keyup goes missing. The dispatcher
 // clears on blur / pointercancel / visibilitychange itself; a modal that takes focus within the
 // same document fires none of those.
 useEffect(() => { if (keysOpen || settingsOpen) window.dispatchEvent(new Event('blur')); }, [keysOpen, settingsOpen]);

 return {
  tier, studio, sheet: vp.w < 768, coarse: vp.coarse,
  docks: studio ? lad.open : [],
  sideStub: studio ? lad.sideW <= 44 : false,
  autoCollapsed: studio ? lad.autoCollapsed : false,
  steps: lad.steps, sideW: lad.sideW, dockW: lad.dockW,
  toggleDock, toggleSide,
  keysOpen, setKeysOpen, settingsOpen, setSettingsOpen,
 };
}
