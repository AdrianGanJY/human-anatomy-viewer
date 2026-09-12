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
 | 'fit' | 'home' | 'reset' | 'mode-orbit' | 'mode-pan'
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
/**
 * The commands guard 7 withholds below the studio tier — the ones whose ONLY surface is the studio.
 *
 * ⚠️ THE NAMED VIEWS AND RESET ARE NOT IN THIS SET, and putting them in it was an over-correction
 * that shipped as a High in round 2 of the S1 review. Round 1's M5 was about the camera KEYS —
 * W/A/S/D, the arrows and `H`, which reach `__atlasNav` and `studioHome()`, a formula tuned for a
 * tier the phone is not. `1 2 3 4` and `R` are something else entirely: they are controller
 * dispatches (`set-view`, `reset-view`) with real on-screen buttons rendered at the phone and
 * tablet tiers (app/v2/page.tsx), and they worked on every tier before S1 touched anything. Guard 7
 * killed them there — and the key-map oracle went on passing at 390×844, because the rows carry no
 * `owner` and therefore read as live. A green suite certifying a product claim that had just become
 * false, inside the round that was fixing exactly that class of defect.
 *
 * The rule this set encodes: withhold a command iff its SURFACE is studio-only. Escape, `?`, Stage
 * and Snapshot are global for the same reason.
 */
export const CAMERA_CMDS: ReadonlySet<Command> = new Set<Command>([
 'fit', 'home', 'mode-orbit', 'mode-pan',
]);

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
 /**
  * Drop every held code. The dispatcher clears itself on blur / pointercancel / visibilitychange,
  * but those are all WINDOW events — they do not fire when the pad is unmounted out from under a
  * finger, which is what a resize across 1180 does mid-gesture. A code stuck in `held` pans the
  * camera for ever AND makes its discrete twin unreachable (`Shift+S` while `KeyS` is stuck), so
  * every path that can orphan a press needs a way to say so (round 2, Medium 1).
  */
 clear(): void;
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
 /** Guard 7. False below the studio tier: the camera commands and the held keys are withheld where
  *  there is no pill, no key pad and no `manual` pose to preserve. Same ref rule as `run`. */
 cameraEnabled?(): boolean;
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
 * ── THE ONE CHORD THAT IS ALLOWED INSIDE AN EDITOR (L31 v2.1b+c, S2) ───────────────────────────
 *
 * `spec.md` scopes the two Find spellings DIFFERENTLY, and the difference is the whole reason this
 * predicate exists as its own function rather than a clause inside `bindingFor`:
 *
 *   Ctrl+K / ⌘K — "Global, outside composition"   → fires even with focus in a text field
 *   /           — "Global outside editors"        → must NOT fire while typing
 *
 * That asymmetry is right. `/` is a character: intercepting it inside the Ask box would make the
 * slash key untypeable, which is the exact class of defect guard 1 exists to prevent. Ctrl+K is not
 * a character in any field this app renders, and a reader who is mid-sentence in the filter box and
 * wants the palette should get it — every editor-bearing app behaves this way.
 *
 * It is matched on `event.code`, like the other letter bindings: `KeyK` is K on every layout.
 * `altKey` is excluded so Ctrl+Alt+K (AltGr on Windows produces exactly that) stays the browser's.
 */
export const findChord = (ev: KeyboardEvent): boolean =>
 (ev.ctrlKey || ev.metaKey) && !ev.altKey && ev.code === 'KeyK';

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
 // S2's CHORD, DECLARED ABOVE GUARD 5 — which is what makes it an exception TO guard 5 rather than
 // a hole in it. The header has always named Ctrl+K as one of the two sanctioned exceptions; this
 // is the line that cashes the promise.
 if (findChord(ev)) return 'find';
 if (ev.key === '?' && !modified(ev)) return 'keymap';
 if (modified(ev)) return null;            // guard 5 — Ctrl/Cmd/Alt belong elsewhere
 // `/` is a CHARACTER binding, matched on `ev.key` for the same reason `?` is: which physical key
 // produces a slash is genuinely layout-dependent. Guard 1 above has already declined it inside an
 // editor, which is the scope difference `findChord`'s note describes.
 if (ev.key === '/') return 'find';
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
  /**
   * ESCAPE IS THE ONE KEY AN EDITOR DOES NOT SWALLOW. Closing the dialog you are typing in is the
   * single most expected keystroke in any overlay, and a guard that blocked it would make the
   * Find box a trap. Everything else declines inside an editor.
   *
   * ⚠️ AND Ctrl+K, AS OF S2 — the SECOND exception, and the narrowest possible one. It is spelled
   * as `findChord(ev)` rather than as `cmd === 'find'` DELIBERATELY: the `find` command has two
   * bindings and only ONE of them is allowed here. Widening it to the command would let bare `/`
   * through as well, and `/` inside the Ask box is a slash the reader is trying to type — guard 1's
   * founding example. `spec.md` scopes the two spellings differently and so does this line.
   */
  const chord = findChord(ev);
  if (editor && ev.key !== 'Escape' && !chord) return;
  if (inTree(ev) && ev.key !== 'Escape' && !chord) return;    // guard 4

  const cmd = bindingFor(ev);
  /**
   * A KEYSTROKE IS EITHER DISCRETE OR HELD, NEVER BOTH. `Shift+S` is Stage and bare `S` pans; if
   * the hold set were filled before the binding was resolved, Shift+S would stage the view AND
   * start panning backwards — and the keyup, which arrives with Shift still down, releases the
   * same code, so it would at least stop. `Shift+P` is worse: snapshot has no matching hold, so
   * nothing would clear it. Resolving the binding first makes the rule general instead of a list
   * of exceptions.
   *
   * ⚠️ `!modified(ev)` IS LOAD-BEARING AND WAS MISSING (stand-in review S1 H1). `bindingFor`
   * returns null for every modified event — that IS guard 5 — so without this clause the branch
   * below read "no binding" as "hold it", and every Ctrl/Cmd/Alt + W A S D Q E / arrow was
   * `preventDefault`ed AND pushed into the held set. The reviewer executed it: Ctrl+A, Ctrl+S,
   * Ctrl+D, Alt+←/→, Cmd+A all came back `preventDefault=true held=[KeyX]`. Select-all, Save,
   * Bookmark, Focus-address-bar and Back/Forward were swallowed on every `/v2/` page, and the
   * camera panned while they were. Guard 5 inverted into its opposite for exactly the ten codes
   * in `HOLD`, under a header that states "inspected-and-declined ⇒ untouched".
   *
   * ⚠️ `!held.has(ev.code)` closes the other half (M7). The "either/or" rule held only for a FRESH
   * press: holding `S` to pan and then pressing Shift delivers an auto-repeat keydown that now
   * resolves to `stage`, so the reader entered presentation mode mid-pan. A code already in the
   * held set belongs to the hold that started it until its keyup.
   */
  /**
   * A CODE ALREADY HELD BELONGS TO THE HOLD THAT STARTED IT until its keyup — so a modifier pressed
   * mid-hold cannot fire a discrete command (M7), and an AUTO-REPEAT keydown is still consumed.
   *
   * ⚠️ THE `preventDefault` ON THE REPEAT PATH IS LOAD-BEARING and was missing for one commit
   * (round 2, Medium). Holding an arrow key delivers a keydown every ~30 ms after the first; the
   * first was consumed and every repeat fell through untouched, so the page scrolled underneath a
   * dolly — which is the exact case the comment below says the preventDefault exists for.
   */
  /**
   * ⚠️ `!modified(ev)` HERE TOO, AND ITS ABSENCE REOPENED ROUND 1's H1 FOR ONE COMMIT.
   *
   * This branch exists for auto-repeat (round 2, Medium 2) and for the modifier-mid-hold case
   * (round 1, M7). An auto-repeat is unmodified and `Shift` is not one of the three modifiers this
   * file guards, so both keep working — but WITHOUT the clause, `Ctrl+S` pressed while `S` was held
   * was swallowed again, exactly the defect round 1's H1 was about. Round 3, High 1, executed.
   *
   * The H1 oracle could not see it: it fires its synthetic modified events with `held` EMPTY, so it
   * never reaches this branch. A guard added in a corrective round needs its own reachable case,
   * not the previous round's.
   */
  /**
   * ── A MODIFIER ARRIVING MID-HOLD ENDS THE HOLD ─────────────────────────────────────────────────
   *
   * This is the resolution of a genuine conflict, stated rather than picked silently (round 4,
   * Medium 2). Two reasonable rules collide on one event — the auto-repeat of a held code that now
   * carries Ctrl/Cmd/Alt:
   *   · CONSUME IT and you keep the camera moving, but you swallow `Ctrl+S` from someone holding S
   *     to pan and reaching for Save. That was round 3's High.
   *   · DECLINE IT and Save works, but someone holding `←` to orbit who presses Alt hands `Alt+←`
   *     to the browser and loses the page to Back.
   *
   * Neither is right while the key is still counted as held, so the third option is to stop
   * counting it: a modifier is the reader moving on to a chord, so the HOLD ENDS and the browser
   * gets its shortcut. The camera stops rather than panning under a navigation — and this also
   * closes the latent case guard 6's own note describes, where a key held and then modified may
   * never deliver a keyup this page can match.
   *
   * The event is left untouched, which is the header's rule: we declined it.
   */
  if (modified(ev) && held.has(ev.code)) { drop(ev.code); return; }
  if (!modified(ev) && held.has(ev.code)) {
   if (!editor && !opts.modalOpen()) ev.preventDefault();
   return;
  }
  if (!cmd && !modified(ev) && holdCodes.has(ev.code) && !editor && !opts.modalOpen()) {   // guard 6
   if (opts.cameraEnabled && !opts.cameraEnabled()) return;   // guard 7 — see below
   add(ev.code);
   // A HELD CAMERA KEY IS CONSUMED. Without this, ArrowUp/ArrowDown scroll the page while they
   // dolly the camera, and Space-adjacent repeats fight the browser. It is inside the branch, so
   // a key we declined to track is still left alone (the `preventDefault` rule in the header).
   ev.preventDefault();
   return;
  }

  if (!cmd) return;
  /**
   * GUARD 7 — THE CAMERA COMMANDS BELONG TO THE TIER THAT HAS A CAMERA CONTROL SURFACE.
   *
   * (stand-in review S1 M5.) The dispatcher is installed at every width, because Escape and `?`
   * are not studio commands. The CAMERA commands are: below 1180 there is no pill and no key pad,
   * `manual` is only read behind `studioRef`, and `H` reached `studioHome()` — G3's whole-body
   * formula — on a tier it was never tuned for, after which the next resize discarded the pose. A
   * half-screen 1100 px window on a desktop is an ordinary thing, and there the keys did not feel
   * absent, they felt broken. Escape, `?` and the discrete non-camera commands stay global.
   */
  if (CAMERA_CMDS.has(cmd) && opts.cameraEnabled && !opts.cameraEnabled()) return;
  /**
   * guard 3 — a modal owns the keyboard, but Escape is how it is dismissed.
   *
   * ⚠️ `find` IS THE SECOND EXEMPTION (stand-in review S2 r1, M2). With the palette already open, a
   * second Ctrl+K fell through here and reached the BROWSER — measured `prevented:false` — so the
   * chord that opens Find silently did something else the moment Find was open. `spec.md:117`
   * scopes Ctrl+K as "Global, outside composition" with no modal carve-out; `spec.md:140`'s modal
   * suppression is about CAMERA commands.
   *
   * It is exempted here and ADJUDICATED in the handler: `use-shell` consumes it when the palette is
   * the open overlay (refocusing the input) and DECLINES it when the key map or Settings owns the
   * screen, because opening a palette on top of another modal is worse than doing nothing. A
   * declined command leaves the event untouched, which is this file's rule.
   */
  if (opts.modalOpen() && cmd !== 'escape' && cmd !== 'find') return;
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
  clear,
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
/**
 * `studioOnly` marks the rows GUARD 7 WITHHOLDS below 1180 — and it is per-ROW, not per-group,
 * because the camera group is mixed. The first version of the "Desktop only" note was rendered
 * above the whole group, so `1 2 3 4` and `R` were labelled desktop-only at 390×844 where they work
 * by keyboard AND have on-screen buttons: round 2's High inverted, in the fix for round 3's
 * Medium (round 4, Medium 1). The set here is exactly `CAMERA_CMDS` plus the held keys.
 */
export interface KeyRow {
 keys: string; cmd: string; group: 'now' | 'camera' | 'global' | 'tree'; owner?: string;
 studioOnly?: true;
 /**
  * The commands and/or physical codes this ROW stands for. It exists so `studioOnly` can be
  * CHECKED against `CAMERA_CMDS` and `HOLD_CODES` instead of being a hand-kept snapshot of them.
  *
  * ⚠️ WITHOUT IT THE MARK SILENTLY RE-OPENS. Round 5 executed the case: adding `reset` back to
  * `CAMERA_CMDS` — which is exactly how round 2's High happened — left BOTH instruments green,
  * because nothing tied the withheld set to the rows that advertise it. A guard whose two halves
  * can drift is a guard that fires once. The unit test now asserts the correspondence in both
  * directions, so S2 cannot widen guard 7 without the map following.
  */
 binds?: readonly (Command | string)[];
}
export const KEY_MAP: KeyRow[] = [
 {keys: 'Esc', cmd: 'keys.esc', group: 'now'},
 {keys: '?', cmd: 'keys.help', group: 'now'},
 /**
  * ── S2 BOUND THESE ─────────────────────────────────────────────────────────────────────────────
  *
  * Dropping `owner` is the whole edit — a row with no owner is a row that works today (the S1 note
  * below). Neither is `studioOnly`: Find is global. The palette renders as a centred modal in the
  * studio and as the A4 bottom sheet below 768, so unlike the camera keys it has a real surface at
  * every tier, and withholding it on the phone would be the round-2 High repeated on a new command.
  *
  * `binds: ['find']` is not decoration. The unit test asserts that nothing marked `studioOnly`
  * binds a command guard 7 does not withhold, AND that every withheld command is marked — so the
  * moment somebody adds `find` to `CAMERA_CMDS` these rows must gain the mark or the suite reds.
  * That correspondence is what stops guard 7 being widened quietly (round 5).
  */
 {keys: 'Ctrl K / ⌘K', cmd: 'keys.find', group: 'global', binds: ['find']},
 {keys: '/', cmd: 'keys.find', group: 'global', binds: ['find']},
 {keys: 'Ctrl , / ⌘,', cmd: 'keys.settings', group: 'global', owner: 'S4'},
 {keys: 'Alt 1…5', cmd: 'keys.panels', group: 'global', owner: 'S5'},
 {keys: '[  ]', cmd: 'keys.sides', group: 'global', owner: 'S6'},
 {keys: 'Shift P / Shift S', cmd: 'keys.snapStage', group: 'global'},
 /**
  * ── S1 BOUND THESE ───────────────────────────────────────────────────────────────────────────
  *
  * ⚠️ `group` IS WHAT KIND OF COMMAND; `owner` IS WHETHER IT WORKS YET. The first version of this
  * edit conflated them and moved all eleven camera rows to `group: 'now'` to mark them live. Two
  * consequences, both caught by the stand-in review (S1 M1): the overlay rendered a bare "Camera"
  * heading with nothing under it (the renderer emits an `h3` per group unconditionally), and the
  * eleven camera bindings were flattened into one list beside Esc and `?`. Dropping `owner` is the
  * whole edit — a row with no owner is a row that works today.
  */
 {keys: 'W A S D', cmd: 'keys.pan', group: 'camera', studioOnly: true, binds: ['KeyW', 'KeyA', 'KeyS', 'KeyD']},
 {keys: '← →', cmd: 'keys.orbit', group: 'camera', studioOnly: true, binds: ['ArrowLeft', 'ArrowRight']},
 {keys: '↑ ↓', cmd: 'keys.dolly', group: 'camera', studioOnly: true, binds: ['ArrowUp', 'ArrowDown']},
 {keys: 'Q E', cmd: 'keys.tilt', group: 'camera', studioOnly: true, binds: ['KeyQ', 'KeyE']},
 {keys: 'O P', cmd: 'keys.modes', group: 'camera', studioOnly: true, binds: ['mode-orbit', 'mode-pan']},
 {keys: 'F / Shift F', cmd: 'keys.focusFit', group: 'camera', studioOnly: true, binds: ['fit']},
 {keys: 'H', cmd: 'keys.home', group: 'camera', studioOnly: true, binds: ['home']},
 // NOT studio-only: `set-view` and `reset-view` are controller dispatches with on-screen buttons at
 // every tier, and they worked on every tier before S1 existed.
 {keys: '1 2 3 4', cmd: 'keys.views', group: 'camera', binds: ['view-three-quarter', 'view-front', 'view-side', 'view-back']},
 {keys: 'R', cmd: 'keys.reset', group: 'camera', binds: ['reset']},
 // `+ −` and `I / Shift ⌫` were inert copy for commands v2 does not have: zoom IS the dolly
 // (↑ ↓) rather than a second pair of keys, and there is no per-structure hide until the tree's
 // eyes arrive in S3. A key map that lists a key nobody bound is the thing this file exists to
 // prevent, so they are removed rather than left promising S1.
 {keys: 'I / Shift ⌫', cmd: 'keys.hideClear', group: 'tree', owner: 'S3'},
 {keys: '↑ ↓ ← →', cmd: 'keys.treeMove', group: 'tree', owner: 'S3'},
 {keys: 'Space', cmd: 'keys.treeTick', group: 'tree', owner: 'S3'},
];
