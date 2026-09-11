/**
 * THE TIERS AND THE 420 px FIELD FLOOR — as pure functions, so they are assertable without a browser.
 * L31 v2.1b+c, S0. `spec.md` §Geometry and responsive contract + §420 px field floor.
 *
 * WHY THIS IS NOT CSS. The tier boundaries themselves ARE css (`@media`), and the grid is declared
 * there — but the COLLAPSE LADDER is an algorithm with state: which dock was opened last, whether
 * the sidebar was collapsed by the human or by the floor, and what to announce. CSS can express
 * "shrink until it fits"; it cannot express "close the last-opened right panel, then the one before
 * it, then collapse the sidebar, and say which of those you did". Expressed here, it is one pure
 * function and five unit tests; expressed in CSS it is a behaviour nobody can assert.
 *
 * Every later group adds panels that feed this ladder, so it ships in S0 even though S0 opens only
 * two of the four docks (opus-plan-review-2.md §B.5).
 */
import {DOCK_W, FIELD_MIN, SIDE_MAX, SIDE_MIN, SIDE_STUB, type DockKey} from './store.ts';

export type Tier = 'phone' | 'tablet' | 'studio' | 'studio-wide' | 'compact';

/**
 * THE BOUNDARIES: 768 / 1180 / 1600, and the coarse-landscape exception.
 *
 * 1180, NOT 1200 (codex-plan-review.md §A.6). Today's stylesheet says 1200 (v2.css:265) and moving
 * it hands 1180–1199 to the studio — which is why S0 measures 1179 and 1180 explicitly
 * (opus-plan-review-2.md RC7): no oracle viewport is within 240 px of the boundary, so a
 * mis-ordered `@media` would be invisible.
 *
 * THE COARSE-LANDSCAPE EXCEPTION IS CHECKED FIRST, and it is not an optimisation. A rotated
 * 390×844 phone is 844×390: it matches `min-width:768` and would otherwise land in the tablet tier
 * with a 340 px margin eating 40% of the width (v2.css:271). `spec.md` is explicit that this is
 * "distinct from 1024×768 compact controls. Do not accidentally activate the new tablet drawers on
 * 844×390." Height, not width, is what identifies it.
 */
export function tierOf(width: number, height: number, coarse: boolean): Tier {
 if (coarse && height <= 520) return 'compact';
 if (width < 768) return 'phone';
 if (width < 1180) return 'tablet';
 return width < 1600 ? 'studio' : 'studio-wide';
}
export const isStudio = (t: Tier): boolean => t === 'studio' || t === 'studio-wide';

export interface LadderInput {
 /** The viewport width in CSS pixels. */
 width: number;
 /** The persisted sidebar width. Clamped here, not by the caller. */
 side: number;
 /** True when the HUMAN collapsed the sidebar (D10). Distinct from the floor collapsing it. */
 sideCollapsed: boolean;
 /** Open docks, LEAST- to MOST-recently-opened. Eviction takes from the end. */
 open: readonly DockKey[];
 /** Widths, injectable so the spec's own worked example can be reproduced exactly in a test. */
 widths?: Readonly<Record<string, number>>;
}
export interface Ladder {
 sideW: number;
 open: DockKey[];
 dockW: number;
 field: number;
 /** True when the ladder closed a dock or collapsed the sidebar to protect the field. The status
  *  strip announces this (`status.autoCollapsed`) — `spec.md`: "Announce automatic collapse and
  *  retain panel toggle access." */
 autoCollapsed: boolean;
 /** What it did, in order, for the worklog and for the oracle's measured string. */
 steps: string[];
}

/**
 * THE LADDER, deterministic and in the spec's own order:
 *   0. clamp an invalid persisted width FIRST (a single 780 dock is brought into range before any
 *      decision is taken on it — otherwise the ladder evicts a panel because of a number that was
 *      never legal);
 *   1. close the last-opened right panel, repeatedly, until the field is >= 420;
 *   2. only then collapse the left sidebar to its 44 px stub.
 * Right docks collapse to ZERO, not to stubs: a stub per dock would eat the width the ladder is
 * trying to recover, and there is nothing a 44 px vertical strip of a Selection panel can show.
 *
 * The spec's worked example, reproduced by `test/v2-shell.test.mjs`: at 1180 with side 420 and two
 * docks totalling 780, the field would be -20; removing the last (420) leaves 400 — still short —
 * and removing the remaining 360 leaves 760, with the sidebar never collapsing.
 */
export function ladder(input: LadderInput): Ladder {
 const w = input.widths ?? DOCK_W;
 const steps: string[] = [];
 const persisted = Number.isFinite(input.side) ? input.side : SIDE_MIN;
 const clamped = Math.min(SIDE_MAX, Math.max(SIDE_MIN, persisted));
 if (clamped !== persisted) steps.push(`clamped sidebar ${persisted} -> ${clamped}`);
 let sideW = input.sideCollapsed ? SIDE_STUB : clamped;
 const open = [...input.open];
 const total = () => open.reduce((n, k) => n + (w[k] ?? 0), 0);
 const field = () => input.width - sideW - total();

 let auto = false;
 while (field() < FIELD_MIN && open.length) {
  const dropped = open.pop() as DockKey;
  auto = true;
  steps.push(`closed ${dropped} (${w[dropped] ?? 0}px)`);
 }
 if (field() < FIELD_MIN && sideW !== SIDE_STUB) {
  sideW = SIDE_STUB;
  auto = true;
  steps.push(`collapsed the sidebar to its ${SIDE_STUB}px stub`);
 }
 return {sideW, open, dockW: total(), field: field(), autoCollapsed: auto, steps};
}

/**
 * OPENING A DOCK — "Opening a third dock closes the least recently focused right panel"
 * (`spec.md` §Geometry). `open` is least- to most-recent, so the least recently focused is at index
 * 0 and eviction is a shift. Toggling one already open CLOSES it; that is the same control.
 */
export function openDock(open: readonly DockKey[], key: DockKey, max = 2): DockKey[] {
 if (open.includes(key)) return open.filter((k) => k !== key);
 const next = [...open, key];
 while (next.length > max) next.shift();
 return next;
}
