/**
 * ONE OVERLAY PRIMITIVE — a centred modal on a fine pointer, a bottom SHEET below 768.
 * L31 v2.1b+c, S0. opus-plan-review-2.md §B.6; `spec.md` §Accessibility and focus order.
 *
 * WHY IT EXISTS BEFORE ANYTHING NEEDS IT. S2 adds the Find palette, S3 a tree in the phone's high
 * detent, S4 Settings, S5 Ask and Scenes — four sheets, in four groups, by whoever is building that
 * group. Four independently-invented sheets is the single most likely way this increment ends up
 * feeling unfinished: four different handle heights, three of them without a focus trap, one that
 * lets the field's gesture handler eat its scroll. So the sheet is written once, here, and the
 * things that are easy to forget are its DEFAULT rather than its checklist:
 *
 *  · a 44 px drag handle that is a real target, not a 4 px hairline with a hit area;
 *  · `env(safe-area-inset-bottom)` INSIDE the sheet, additional to its own padding;
 *  · the VISUAL viewport for keyboard height — `window.innerHeight` does not move when iOS opens
 *    the keyboard, so a sheet sized from it puts its input under the keys;
 *  · a focus trap, and focus RESTORED to the invoker on close (`spec.md`: "Escape and close return
 *    focus to invoker");
 *  · `overscroll-behavior:contain` on the body, so a scroll that reaches the end of the sheet does
 *    not become a page scroll — and, on the phone, does not reach the field's gesture handler.
 *
 * IT IS NOT DEAD CODE AT S0. `?` opens the key map through it at every width, so the SHEET branch
 * has a reachable invoker below 768 (a keyboard on a narrow window) and an oracle can press `?` at
 * 390×844 and measure the handle, the trap and the restore. An unreachable primitive is an untested
 * one, and this project has a rule about guards that cannot fire.
 */
import {useCallback, useEffect, useId, useRef} from 'react';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface OverlayProps {
 open: boolean;
 onClose(): void;
 title: string;
 /** `sheet` below 768 — passed in rather than measured here so the tier lives in ONE place. */
 sheet: boolean;
 labelClose: string;
 children: React.ReactNode;
 /** Extra class on the panel, for per-overlay width/height. */
 kind?: string;
}

export default function Overlay({open, onClose, title, sheet, labelClose, children, kind = ''}: OverlayProps) {
 const panel = useRef<HTMLDivElement | null>(null);
 const invoker = useRef<Element | null>(null);
 const titleId = useId();

 // REMEMBER THE INVOKER BEFORE ANYTHING IS FOCUSED. Reading it in the cleanup would read whatever
 // the trap last focused, which is inside the overlay that is closing.
 useEffect(() => {
  if (!open) return;
  invoker.current = document.activeElement;
  const el = panel.current;
  // Autofocus the first real control, or the panel itself. `spec.md` asks for the input on Find and
  // the selected tab on Settings; both are simply the first focusable in their own markup.
  const first = el?.querySelector<HTMLElement>(FOCUSABLE);
  (first ?? el)?.focus();
  return () => {
   const back = invoker.current as HTMLElement | null;
   // Only restore if the invoker is still in the document AND focus has not already moved somewhere
   // deliberate — stealing focus back from wherever the human went next is worse than not restoring.
   if (back?.isConnected && (document.activeElement === document.body || document.activeElement === null)) back.focus?.();
  };
 }, [open]);

 // THE TRAP. Tab and Shift+Tab wrap inside the panel; Escape closes. Bound on the panel rather than
 // the window so it cannot fight the global dispatcher, which declines every command while a modal
 // is open (keys.ts guard 3) except Escape — and Escape is handled here, first, by the top overlay.
 const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
  if (ev.key === 'Escape') { ev.stopPropagation(); ev.preventDefault(); onClose(); return; }
  if (ev.key !== 'Tab') return;
  const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter((n) => n.offsetParent !== null || n === document.activeElement);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  else if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
 }, [onClose]);

 // THE KEYBOARD'S REAL HEIGHT. `visualViewport` is the only API that moves when iOS opens the
 // keyboard; `innerHeight` does not. The sheet is sized against it so its input and close control
 // stay above the keys and its body scrolls beneath them. No-op on desktop, where the two agree.
 useEffect(() => {
  if (!open || !sheet) return;
  const vv = window.visualViewport;
  if (!vv) return;
  const apply = () => { panel.current?.style.setProperty('--v2-vv', `${Math.round(vv.height)}px`); };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  return () => { vv.removeEventListener('resize', apply); vv.removeEventListener('scroll', apply); };
 }, [open, sheet]);

 if (!open) return null;
 return <div className={`v2-scrim ${sheet ? 'is-sheet' : ''}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
  <div
   ref={panel} className={`v2-modal ${sheet ? 'is-sheet' : ''} ${kind}`}
   role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown}
  >
   {/* The handle is a real 44 px control on the sheet: tapping it closes, which is what a human
       tries first, and dragging it is S6's job. It is `aria-hidden` because the close button below
       carries the accessible name — two controls with one purpose read as two to a screen reader. */}
   {sheet && <button type="button" className="v2-sheet-handle" aria-hidden="true" tabIndex={-1} onClick={onClose}><i/></button>}
   <header className="v2-modal-head">
    <h2 id={titleId}>{title}</h2>
    <button type="button" className="v2-modal-x" onClick={onClose} aria-label={labelClose}>×</button>
   </header>
   <div className="v2-modal-body">{children}</div>
  </div>
 </div>;
}
