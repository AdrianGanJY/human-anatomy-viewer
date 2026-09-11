/**
 * THE SCOPED KEYBOARD DISPATCHER — the full guard set at S0, with exactly two bindings.
 * L31 v2.1b+c, S0. `spec.md` §Keyboard and touch; opus-plan-review-2.md §B.3.
 *
 * WHY THE GUARDS SHIP BEFORE THE COMMANDS DO. S0 binds Escape and `?` and nothing else, so on the
 * face of it the guards below protect nothing. They ship anyway because of what happens otherwise:
 * S1 would not "extend" a naive `keydown` listener, it would REWRITE it — and then every binding
 * S2–S6 adds lands on whichever version happened to win, with the guard set re-derived from memory
 * each time. The expensive part of a keyboard layer is not the bindings; it is knowing every place
 * a key must NOT fire. That list is written once, here, while it is cheap to get right.
 *
 * ══ THE SIX GUARDS, and the defect each one is ═══════════════════════════════════════════════════
 *  1. EDITORS. input / textarea / select / contenteditable. Typing "was" in the Ask box must not
 *     pan the camera three times. codex-app-review.md §5 names this as the first thing to get right.
 *  2. COMPOSITION. `event.isComposing` OR `keyCode === 229`. An IME sends keystrokes to the
 *     composition buffer and reports 229 for them; a dispatcher that reads `event.key` sees real
 *     letters. Both checks are needed: `isComposing` is false for the very first keydown of a
 *     composition in several engines, which is exactly the one that would fire a command.
 *  3. MODALS. While an overlay is open, the field does not own the keyboard. Escape still reaches
 *     the overlay because the overlay binds it itself.
 *  4. TREE NAVIGATION. `spec.md`: "Use right/left to expand/collapse, not pan." A focused tree row
 *     owns the arrow keys; the camera must not also consume them.
 *  5. MODIFIERS. A bare key is a command; Ctrl/Cmd/Alt variants belong to the browser or to a
 *     different binding. Ctrl+K and Ctrl+, are declared separately (S2/S4) and are the exceptions.
 *  6. HELD KEYS ARE PHYSICAL. `event.code`, never `event.key`: `key` changes with the layout and
 *     with Shift, so a key held down and then modified reports a different identity on keyup and is
 *     never released — the camera then pans forever. And the held set is cleared on blur,
 *     pointercancel, visibilitychange and modal open, because a keyup that happens while the window
 *     is not focused is a keyup this page never receives.
 *
 * `preventDefault` ONLY WHEN CONSUMING. A dispatcher that preventDefaults everything it inspects
 * breaks the browser's own shortcuts and breaks scrolling; one that never does lets `?` type into
 * the page. The rule is: consumed ⇒ prevented, inspected-and-declined ⇒ untouched.
 */

export type Command =
 | 'escape' | 'keymap'
 // ── S1: NAVIGATION AND FRAMING. Discrete commands only — the four pans, the orbit, the dolly
 //    and the tilt are HELD keys and travel through `held`, not through `run`. ──
 | 'view-three-quarter' | 'view-front' | 'view-side' | 'view-back'
 | 'fit' | 'home' | 'reset' | 'mode-orbit' | 'mode-pan' | 'mode-toggle'
 // ── declared, bound by later groups. Listed so the map is one document rather than five. ──
 | 'find' | 'settings' | 'panel-1' | 'panel-2' | 'panel-3' | 'panel-4' | 'panel-5'
 | 'side-toggle' | 'dock-toggle' | 'snapshot' | 'stage';

/**
 * ── THE HELD SET, as data (L31 v2.1b+c, S1) ────────────────────────────────────────────────────
 *
 * PHYSICAL `event.code`, never `event.key` — guard 6 in the header. On a French AZERTY keyboard
 * `KeyW` produces "z"; a `key`-based map would pan the wrong way there and, worse, a key held and
 * then Shift-modified reports a different `key` on keyup and is never released, so the camera pans
 * for ever. `code` is the physical key and does not move.
 *
 * The DIRECTION each code contributes is here rather than in the frame loop, so the `?` key map,
 * the on-screen pad and the physical keyboard cannot disagree about which way W goes.
 *   pan  — W/A/S/D, in fractions of the field per second
 *   orbit — Left/Right (azimuth) and Q/E (polar tilt), radians per second
 *   dolly — Up/Down, as a per-second multiplicative rate
 */
export interface HoldAxis {pan?: [number, number]; orbit?: [number, number]; dolly?: number}
export const HOLD: Record<string, HoldAxis> = {
 KeyW: {pan: [0, 1]}, KeyS: {pan: [0, -1]}, KeyA: {pan: [-1, 0]}, KeyD: {pan: [1, 0]},
 ArrowLeft: {orbit: [-1, 0]}, ArrowRight: {orbit: [1, 0]},
 ArrowUp: {dolly: -1}, ArrowDown: {dolly: 1},
 KeyQ: {orbit: [0, -1]}, KeyE: {orbit: [0, 1]},
};
export const HOLD_CODES = Object.keys(HOLD);

export interface Dispatcher {
 /**
  * The physical codes currently held — ONE Set for the dispatcher's whole lifetime.
  *
  * ⚠️ THE IDENTITY IS THE CONTRACT (stand-in review round 1, M4). S0 re-installed the dispatcher
  * on every overlay toggle, so every consumer of `held` got a fresh empty `Set` each time — an
  * animation loop that captured it would read an object nothing writes to any more, and the
  * camera would silently stop responding to a held key after somebody opened Settings once. S1
  * installs ONCE (see `use-shell.ts`) and this Set is stable, so a loop may capture it.
  */
 held: ReadonlySet<string>;
 /**
  * THE ON-SCREEN PAD'S DOOR INTO THE SAME SET. `spec.md` requires the pill, the key pad and the
  * physical keyboard to be three inputs to ONE set of commands; a pad that called `nav.pan()`
  * directly would be a second implementation with its own speed, and the first time one of them
  * changed they would disagree. The pad presses the PHYSICAL CODE instead, and from there the
  * frame loop cannot tell a finger from a keyboard.
  */
 press(code: string): void;
 release(code: string): void;
 destroy(): void;
}

export interface DispatcherOptions {
 /**
  * Called for a command this dispatcher decided to consume. Return false to decline it after all
  * (so a binding can be conditional without the guard set having to know why).
  *
  * ⚠️ READ THROUGH A REF. The dispatcher is installed once and never re-installed, so a closure
  * captured here lives for the page's lifetime — it must not close over render-time state.
  */
 run(cmd: Command, ev: KeyboardEvent): boolean | void;
 /** True while any modal, sheet or palette owns the keyboard. Same ref rule as `run`. */
 modalOpen(): boolean;
 /** Codes to track as HELD. S1 passes `HOLD_CODES`. */
 holdCodes?: readonly string[];
 /**
  * Fired whenever the held set's SIZE changes, with the new size. It exists so the consumer can
  * run its animation loop only while something is held: a `requestAnimationFrame` loop that
  * spins for the life of the page to discover that nothing is pressed is a measurable battery
  * cost on a laptop and shows up as constant main-thread work in a trace.
  */
 onHold?(n: number): void;
}

const EDITOR = /^(input|textarea|select)$/i;

/** Guard 1. Walks composed path rather than reading `event.target` alone, so a key pressed inside a
 *  web component's shadow input is still seen as an editor. */
export function inEditor(ev: KeyboardEvent): boolean {
 const path = (typeof ev.composedPath === 'function' ? ev.composedPath() : []) as EventTarget[];
 const nodes = path.length ? path : [ev.target as EventTarget];
 for (const n of nodes) {
  const el = n as HTMLElement;
  if (!el || typeof el.tagName !== 'string') continue;
  if (EDITOR.test(el.tagName)) return true;
  if (el.isContentEditable) return true;
  if (el.getAttribute?.('role') === 'textbox') return true;
 }
 return false;
}
/** Guard 2. BOTH signals — see the header. */
export const composing = (ev: KeyboardEvent): boolean => ev.isComposing === true || ev.keyCode === 229;
/** Guard 4. A focused `treeitem` owns the arrows and Space. */
export function inTree(ev: KeyboardEvent): boolean {
 const el = ev.target as HTMLElement | null;
 return !!el?.closest?.('[role="tree"]');
}
/** Guard 5. */
export const modified = (ev: KeyboardEvent): boolean => ev.ctrlKey || ev.metaKey || ev.altKey;

/**
 * THE BINDINGS S0 ACTUALLY INSTALLS. Two, and both are global rather than field-scoped, because
 * neither moves the camera: Escape closes whatever is on top, and `?` explains the keyboard to
 * someone who has not got one of the other commands to work.
 *
 * `?` is Shift+/ on most layouts, so it cannot be excluded by guard 5's Shift rule — there isn't
 * one; guard 5 is about Ctrl/Cmd/Alt only. It is matched on `ev.key === '?'` rather than on a code,
 * because WHICH physical key produces `?` genuinely is layout-dependent and this is a character
 * binding, not a held one.
 */
function bindingFor(ev: KeyboardEvent): Command | null {
 if (ev.key === 'Escape') return 'escape';
 if (ev.key === '?' && !modified(ev)) return 'keymap';
 if (modified(ev)) return null;            // guard 5 — Ctrl/Cmd/Alt belong elsewhere
 /**
  * S1's DISCRETE bindings. `spec.md`'s map, and matched on `event.code` for the letter keys for
  * the same reason the held set is: `KeyF` is F on every layout, `ev.key === 'f'` is not.
  *
  * `Shift+F` is fit-to-selection and bare `F` is focus — but v2 has no separate "focus the
  * camera without changing the selection" operation (focusing IS selecting, through the
  * controller), so both spellings map to `fit` and the key map says Fit for both. Claiming two
  * commands and shipping one would make the `?` overlay a leaflet rather than a specification.
  */
 switch (ev.code) {
  case 'Digit1': return 'view-three-quarter';
  case 'Digit2': return 'view-front';
  case 'Digit3': return 'view-side';
  case 'Digit4': return 'view-back';
  case 'KeyF': return 'fit';
  case 'KeyH': return 'home';
  case 'KeyR': return 'reset';
  case 'KeyO': return ev.shiftKey ? null : 'mode-orbit';
  case 'KeyP': return ev.shiftKey ? 'snapshot' : 'mode-pan';
  // Shift+S is Stage. Bare S is a HELD pan key, which is why this returns null for it rather
  // than falling through — see the `cmd` check in `onKeyDown`.
  case 'KeyS': return ev.shiftKey ? 'stage' : null;
  default: return null;
 }
}

export function installDispatcher(opts: DispatcherOptions): Dispatcher {
 const held = new Set<string>();
 const holdCodes = new Set(opts.holdCodes ?? []);
 // ONE place reports the size, so `press`, `release`, a keyup and every clear path report it the
 // same way and none of them can forget.
 let lastN = 0;
 const announce = () => { if (held.size !== lastN) { lastN = held.size; opts.onHold?.(lastN); } };
 const add = (code: string) => { held.add(code); announce(); };
 const drop = (code: string) => { held.delete(code); announce(); };
 const clear = () => { held.clear(); announce(); };

 const onKeyDown = (ev: KeyboardEvent) => {
  if (composing(ev)) return;                                  // guard 2 — before anything else
  const editor = inEditor(ev);                                // guard 1
  // ESCAPE IS THE ONE KEY AN EDITOR DOES NOT SWALLOW. Closing the dialog you are typing in is the
  // single most expected keystroke in any overlay, and a guard that blocked it would make the
  // Find box a trap. Everything else declines inside an editor.
  if (editor && ev.key !== 'Escape') return;
  if (inTree(ev) && ev.key !== 'Escape') return;              // guard 4

  const cmd = bindingFor(ev);
  /**
   * A KEYSTROKE IS EITHER DISCRETE OR HELD, NEVER BOTH. `Shift+S` is Stage and bare `S` pans; if
   * the hold set were filled before the binding was resolved, Shift+S would stage the view AND
   * start panning backwards — and the keyup, which arrives with Shift still down, releases the
   * same code, so it would at least stop. `Shift+P` is worse: snapshot has no matching hold, so
   * nothing would clear it. Resolving the binding first makes the rule general instead of a list
   * of exceptions.
   */
  if (!cmd && holdCodes.has(ev.code) && !editor && !opts.modalOpen()) {   // guard 6
   add(ev.code);
   // A HELD CAMERA KEY IS CONSUMED. Without this, ArrowUp/ArrowDown scroll the page while they
   // dolly the camera, and Space-adjacent repeats fight the browser. It is inside the branch, so
   // a key we declined to track is still left alone (the `preventDefault` rule in the header).
   ev.preventDefault();
   return;
  }

  if (!cmd) return;
  // guard 3 — a modal owns the keyboard, but Escape is how it is dismissed.
  if (opts.modalOpen() && cmd !== 'escape') return;
  if (opts.run(cmd, ev) === false) return;                    // declined: leave the event alone
  ev.preventDefault();
 };
 const onKeyUp = (ev: KeyboardEvent) => { drop(ev.code); };

 window.addEventListener('keydown', onKeyDown);
 window.addEventListener('keyup', onKeyUp);
 // EVERY WAY A KEYUP CAN GO MISSING. Alt-tabbing away with W held delivers no keyup at all; so does
 // a pointercancel that steals the gesture, and so does opening a modal that moves focus.
 window.addEventListener('blur', clear);
 window.addEventListener('pointercancel', clear);
 document.addEventListener('visibilitychange', clear);

 return {
  held,
  press(code) { if (holdCodes.has(code)) add(code); },
  release(code) { drop(code); },
  destroy() {
   window.removeEventListener('keydown', onKeyDown);
   window.removeEventListener('keyup', onKeyUp);
   window.removeEventListener('blur', clear);
   window.removeEventListener('pointercancel', clear);
   document.removeEventListener('visibilitychange', clear);
   clear();
  },
 };
}

/**
 * THE KEY MAP, as data. It is the `?` overlay's content AND the specification every later group
 * binds against — one document, so a binding cannot drift from what the app tells the reader it
 * does. Every row whose `group` is not `now` is INERT copy at S0: it describes what will exist,
 * and the overlay marks it so, rather than listing a key that does nothing.
 *
 * The map is `spec.md`'s, including its two deliberate corrections to earlier drafts: W/A/S/D PAN
 * (they do not zoom), and Ctrl/⌘L is NOT intercepted — the browser's address bar owns it, and Copy
 * link is an explicit button instead.
 */
export interface KeyRow {keys: string; cmd: string; group: 'now' | 'camera' | 'global' | 'tree'; owner?: string}
export const KEY_MAP: KeyRow[] = [
 {keys: 'Esc', cmd: 'keys.esc', group: 'now'},
 {keys: '?', cmd: 'keys.help', group: 'now'},
 {keys: 'Ctrl K / ⌘K', cmd: 'keys.find', group: 'global', owner: 'S2'},
 {keys: '/', cmd: 'keys.find', group: 'global', owner: 'S2'},
 {keys: 'Ctrl , / ⌘,', cmd: 'keys.settings', group: 'global', owner: 'S4'},
 {keys: 'Alt 1…5', cmd: 'keys.panels', group: 'global', owner: 'S5'},
 {keys: '[  ]', cmd: 'keys.sides', group: 'global', owner: 'S6'},
 {keys: 'Shift P / Shift S', cmd: 'keys.snapStage', group: 'now'},
 // ── S1 BOUND THESE. `group: 'now'` is what the overlay reads to stop marking a row as
 //    forthcoming, so moving a key from inert copy to a live binding is one edit here. ──
 {keys: 'W A S D', cmd: 'keys.pan', group: 'now'},
 {keys: '← →', cmd: 'keys.orbit', group: 'now'},
 {keys: '↑ ↓', cmd: 'keys.dolly', group: 'now'},
 {keys: 'Q E', cmd: 'keys.tilt', group: 'now'},
 {keys: 'O P', cmd: 'keys.modes', group: 'now'},
 {keys: '1 2 3 4', cmd: 'keys.views', group: 'now'},
 {keys: 'F / Shift F', cmd: 'keys.focusFit', group: 'now'},
 {keys: 'H / R', cmd: 'keys.homeReset', group: 'now'},
 // `+ −` and `I / Shift ⌫` were inert copy for commands v2 does not have: zoom IS the dolly
 // (↑ ↓) rather than a second pair of keys, and there is no per-structure hide until the tree's
 // eyes arrive in S3. A key map that lists a key nobody bound is the thing this file exists to
 // prevent, so they are removed rather than left promising S1.
 {keys: 'I / Shift ⌫', cmd: 'keys.hideClear', group: 'tree', owner: 'S3'},
 {keys: '↑ ↓ ← →', cmd: 'keys.treeMove', group: 'tree', owner: 'S3'},
 {keys: 'Space', cmd: 'keys.treeTick', group: 'tree', owner: 'S3'},
];
