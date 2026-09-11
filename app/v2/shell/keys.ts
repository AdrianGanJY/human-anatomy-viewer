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
 // ── declared, bound by later groups. Listed so the map is one document rather than five. ──
 | 'find' | 'settings' | 'panel-1' | 'panel-2' | 'panel-3' | 'panel-4' | 'panel-5'
 | 'side-toggle' | 'dock-toggle' | 'snapshot' | 'stage';

export interface Dispatcher {
 /** The physical codes currently held. Read by S1's animation loop; empty until S1 binds one. */
 held: ReadonlySet<string>;
 destroy(): void;
}

export interface DispatcherOptions {
 /** Called for a command this dispatcher decided to consume. Return false to decline it after all
  *  (so a binding can be conditional without the guard set having to know why). */
 run(cmd: Command, ev: KeyboardEvent): boolean | void;
 /** True while any modal, sheet or palette owns the keyboard. */
 modalOpen(): boolean;
 /** Codes to track as HELD. Empty at S0; S1 passes the W/A/S/D + arrow set. */
 holdCodes?: readonly string[];
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
 return null;
}

export function installDispatcher(opts: DispatcherOptions): Dispatcher {
 const held = new Set<string>();
 const holdCodes = new Set(opts.holdCodes ?? []);
 const clear = () => held.clear();

 const onKeyDown = (ev: KeyboardEvent) => {
  if (composing(ev)) return;                                  // guard 2 — before anything else
  const editor = inEditor(ev);                                // guard 1
  // ESCAPE IS THE ONE KEY AN EDITOR DOES NOT SWALLOW. Closing the dialog you are typing in is the
  // single most expected keystroke in any overlay, and a guard that blocked it would make the
  // Find box a trap. Everything else declines inside an editor.
  if (editor && ev.key !== 'Escape') return;
  if (inTree(ev) && ev.key !== 'Escape') return;              // guard 4

  if (holdCodes.has(ev.code) && !editor && !opts.modalOpen()) held.add(ev.code);   // guard 6

  const cmd = bindingFor(ev);
  if (!cmd) return;
  // guard 3 — a modal owns the keyboard, but Escape is how it is dismissed.
  if (opts.modalOpen() && cmd !== 'escape') return;
  if (opts.run(cmd, ev) === false) return;                    // declined: leave the event alone
  ev.preventDefault();
 };
 const onKeyUp = (ev: KeyboardEvent) => { held.delete(ev.code); };

 window.addEventListener('keydown', onKeyDown);
 window.addEventListener('keyup', onKeyUp);
 // EVERY WAY A KEYUP CAN GO MISSING. Alt-tabbing away with W held delivers no keyup at all; so does
 // a pointercancel that steals the gesture, and so does opening a modal that moves focus.
 window.addEventListener('blur', clear);
 window.addEventListener('pointercancel', clear);
 document.addEventListener('visibilitychange', clear);

 return {
  held,
  destroy() {
   window.removeEventListener('keydown', onKeyDown);
   window.removeEventListener('keyup', onKeyUp);
   window.removeEventListener('blur', clear);
   window.removeEventListener('pointercancel', clear);
   document.removeEventListener('visibilitychange', clear);
   held.clear();
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
 {keys: '[  ]', cmd: 'keys.sides', group: 'global', owner: 'S1'},
 {keys: 'Shift P / Shift S', cmd: 'keys.snapStage', group: 'global', owner: 'S1'},
 {keys: 'W A S D', cmd: 'keys.pan', group: 'camera', owner: 'S1'},
 {keys: '← →', cmd: 'keys.orbit', group: 'camera', owner: 'S1'},
 {keys: '↑ ↓', cmd: 'keys.dolly', group: 'camera', owner: 'S1'},
 {keys: 'Q E', cmd: 'keys.tilt', group: 'camera', owner: 'S1'},
 {keys: '+ −', cmd: 'keys.zoom', group: 'camera', owner: 'S1'},
 {keys: 'O P', cmd: 'keys.modes', group: 'camera', owner: 'S1'},
 {keys: '1 2 3 4', cmd: 'keys.views', group: 'camera', owner: 'S1'},
 {keys: 'F / Shift F', cmd: 'keys.focusFit', group: 'camera', owner: 'S1'},
 {keys: 'H / R', cmd: 'keys.homeReset', group: 'camera', owner: 'S1'},
 {keys: 'I / Shift ⌫', cmd: 'keys.hideClear', group: 'camera', owner: 'S1'},
 {keys: '↑ ↓ ← →', cmd: 'keys.treeMove', group: 'tree', owner: 'S3'},
 {keys: 'Space', cmd: 'keys.treeTick', group: 'tree', owner: 'S3'},
];
