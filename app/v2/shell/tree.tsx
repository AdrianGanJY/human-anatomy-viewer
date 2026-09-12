/**
 * THE LAYERS / SYSTEMS TREE — fifteen systems, 3,432 structures, one virtualised list.
 * L31 v2.1b+c, S3. Visual contract: `mock/spec.md` artboards D4 (desktop) and A3 (phone high
 * detent); behaviour: codex-plan-review.md §A.8, opus-plan-review-2.md RC8, the S2 worklog's
 * "What S3 inherits".
 *
 * ══ THE TWO FACTS THIS COMPONENT DRAWS, AND WHY THEY ARE TWO ═══════════════════════════════════
 * A row carries a TICK and an EYE, and conflating them is the defect the whole design is written
 * against:
 *   TICK = MEMBERSHIP — "is this structure in the view?" It is `state.picks`, the EXACT REQUESTED
 *          IDS, and every change goes through the controller's `tick` transaction. It is never a
 *          parallel set of checkbox booleans (R:57): a tick is a READING of the controller, and a
 *          click is a REQUEST to it, which is what makes a refusal actually refuse.
 *   EYE  = VISIBILITY — "is it drawn?" Three different facts depending on the row (see `eyeKind`),
 *          because the codec expresses three different things and pretending otherwise would put a
 *          control on screen whose link does not reproduce it.
 *
 * ══ WHAT A "COVERED" CHILD IS ══════════════════════════════════════════════════════════════════
 * `spec.md`: "A covered child remains unticked and receives 'Included through {parent}'; removing
 * its explicit ID does not subtract meshes from a selected parent." Two concepts can share meshes —
 * a picked concept may already draw every element of a row that is not itself picked. Drawing that
 * row as TICKED would be a lie (its id is not in `picks`, and unticking it would do nothing);
 * drawing it as plain unticked hides the reason it is visible. So it is unticked, and it SAYS why,
 * through `aria-describedby` rather than through a false checkmark (`spec.md` §Accessibility).
 *
 * ══ VIRTUALISED, AND WHY THAT IS NOT OPTIONAL ══════════════════════════════════════════════════
 * Expanding Arteries alone is 833 rows; the flattened tree is 3,447. React can mount that, and the
 * measured cost is a locked main thread on a phone and a scroll container the renderer competes
 * with for frames. The window is computed from a PREFIX SUM of row heights (two heights, 52 and
 * 54), so the scrollbar is the real one and `aria-posinset/setsize` still report the whole FILTERED
 * collection rather than the mounted slice — a screen reader must be told "3 of 833", not "3 of 14".
 *
 * ⚠️ THE ACTIVE ROW IS KEPT MOUNTED. Roving tabindex plus virtualisation is the combination that
 * breaks quietly: scroll the active row out of the window and its DOM node is destroyed, focus
 * falls to `<body>`, and the next arrow key goes to the CAMERA instead of the tree. So the window
 * is unioned with the active index, and the active row is scrolled back into view when the keyboard
 * moves it.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {SYSTEMS, type Atlas, type SystemId} from '../../anatomy';
import {searchEntries, systemEntries, type Dicts, type T} from '../../i18n/dict';
import type {Scene} from '../../scene-model';
import type {Command} from '../controller';
import {atlasIndex, best, norm} from '../find.ts';
import {alphaCause, eyeAction, eyeOn as eyeOnOf, type EyeKind} from '../visibility.ts';

/** Fixed heights. `spec.md` A3: "48/60 px rows"; D4 draws a 52 px system row over a 54 px child
 *  row, and the child is the taller one because it carries a second (paired-name) line. Fixed
 *  rather than measured: a prefix sum over measured heights is a layout read per row, which is the
 *  cost virtualisation exists to avoid. */
export const ROW_H = {system: 52, concept: 54} as const;
/** How many rows above and below the visible window stay mounted, so a fast scroll does not show
 *  blank. Four is roughly a flick at 60 Hz; more is wasted mounting. */
const OVERSCAN = 4;

export interface TreeRow {
 kind: 'system' | 'concept';
 id: string;
 name: string;
 /** The owning system — for a system row, itself. */
 system: SystemId;
 /** 1 for a system, 2 for a structure. `aria-level`. */
 level: 1 | 2;
 /** Concepts in this system (system rows only), after the filter. */
 count?: number;
 top: number;
 h: number;
}

export interface TreeProps {
 t: T;
 tr(k: string, v?: Record<string, string | number>): string;
 atlas: Atlas | null;
 dicts: Dicts;
 /** The controller's EXACT REQUESTED IDS. The tick is a reading of this and nothing else. */
 picks: string[];
 scene: Scene | null;
 /**
  * ⚠️ S3b — BOTH SYSTEM FACTS ARE PROPS NOW, and the row draws both. codex r4's fourth High:
  * S3 read `visibleIntent` and the renderer reads `render.visible`, so after a ghost scene the eye
  * said "skeletal hidden" over a drawn skeleton and the link it produced said `system=skeletal`.
  *
  * THE DECISION: the EYE reads `visible` (what is drawn — an eye that does not describe the picture
  * is the defect), and the row publishes `visibleIntent` as `data-intent` plus a one-line note when
  * the two disagree. Two facts, two surfaces. The `systems-intent` oracle is re-pointed at
  * `data-intent`, where it now asserts the DIVERGENCE directly rather than inferring it from a
  * control that had stopped carrying it.
  */
 /** `render.visible` — the EFFECTIVE system set, what the renderer draws and what `system=` writes. */
 visible: SystemId[];
 /** The human's own set. Not the eye's state; the row's `data-intent` and its override note. */
 visibleIntent: SystemId[];
 isolate: boolean;
 dispatch(cmd: Command): boolean;
 /** The session-only hidden set. ⚠️ READ ONLY AS A DECLARATION — "has the reader asked for this to
  *  be hidden?" — NEVER as the eye's state. The eye's state is `effectiveAlpha`. The two differ
  *  exactly when a shared mesh keeps a structure on screen, which is the case the note explains. */
 hidden: ReadonlySet<string>;
 onHide(id: string, on: boolean): void;
 /** What the RENDERER draws this concept at, 0..1, through the whole chain (`visibility.ts`). The
  *  single reading behind every eye and the Selection slider. */
 effectiveAlpha(conceptId: string): number;
 focusedId: string | null;
 onFocus(id: string): void;
 /** The filter box's query. Owned above so the box can live in the sidebar head. */
 query: string;
 /** Phone presentation: the A3 high-detent tree. Same component, shorter chrome. */
 phone?: boolean;
 /**
  * A COARSE POINTER, AND IT CHANGES THE CONTROL COUNT RATHER THAN THE ROW HEIGHT.
  *
  * ⚠️ MEASURED, at 1366×1024 — the one tier that is desktop-structured AND touch. Four 44 px
  * controls (disclosure, tick, name, eye) do not fit a 264 px sidebar: the arithmetic is 240 px of
  * content box, 40 px of gaps, 44 + 44 for the tick and the eye and ~30 for the count, which leaves
  * the NAME **34 px wide** — measured, and a fail against the same 44 px rule. `spec.md`'s coarse
  * guidance is explicit about which way to resolve that: "Large targets force more toolbar actions
  * into More, not taller toolbar rows" — reduce the number of controls, never shrink the targets.
  *
  * So on a coarse pointer the DISCLOSURE stops being its own button and becomes presentational: the
  * system row's NAME already expands and collapses it (it is the same command), so nothing becomes
  * unreachable — one target does one job instead of two adjacent targets doing nearly the same one,
  * which is the better touch design anyway. The keyboard keeps Right/Left at every tier.
  */
 coarse?: boolean;
}

/** Systems that actually have structures. A row for a system with zero concepts is a promise the
 *  atlas does not keep — and `page.tsx`'s phone list has always filtered them out, so including
 *  them here would make the two lists disagree about how many systems there are. */
const liveSystems = (idx: ReturnType<typeof atlasIndex> | null) =>
 SYSTEMS.filter((s) => (idx?.bySystem.get(s.id)?.length ?? 0) > 0);

export default function Tree(p: TreeProps) {
 const {t, tr} = p;
 const [expanded, setExpanded] = useState<ReadonlySet<SystemId>>(() => new Set());
 const [active, setActive] = useState(0);
 const [scrollTop, setScrollTop] = useState(0);
 const [height, setHeight] = useState(420);
 const boxRef = useRef<HTMLDivElement | null>(null);
 const idx = useMemo(() => (p.atlas ? atlasIndex(p.atlas) : null), [p.atlas]);

 /**
  * THE FILTER — the S2 matcher, over BOTH populations, uncapped.
  *
  * It reuses `best()` + `searchEntries`/`systemEntries` from the palette rather than a second
  * matcher, so "胸骨" narrows this tree in an English interface exactly as it narrows the palette.
  * UNCAPPED deliberately: `search()`'s `CAP` of 50 is right for a result LIST the reader scans and
  * wrong for a tree they navigate — a filter that silently stopped at 50 would report "50 of 3,432"
  * and hide the rest behind no affordance at all.
  */
 const q = norm(p.query);
 const filtered = useMemo(() => {
  const out = new Map<SystemId, {id: string; name: string}[]>();
  const sysHit = new Set<SystemId>();
  if (!idx) return {out, sysHit, concepts: 0, systems: 0};
  for (const s of liveSystems(idx)) {
   const kids = idx.bySystem.get(s.id) ?? [];
   if (!q) { out.set(s.id, kids); continue; }
   // A SYSTEM THAT MATCHES KEEPS ALL ITS CHILDREN. Filtering to "arteries" and then showing an
   // empty Arteries is the answer to a question nobody asked; the reader who typed a system name
   // wants the system.
   if (best(systemEntries(s.id, s.name, p.dicts), q)) { sysHit.add(s.id); out.set(s.id, kids); continue; }
   const hits = kids.filter((c) => best(searchEntries(c.id, c.name, p.dicts), q));
   if (hits.length) out.set(s.id, hits);
  }
  let concepts = 0;
  for (const v of out.values()) concepts += v.length;
  return {out, sysHit, concepts, systems: out.size};
 }, [idx, q, p.dicts]);

 /**
  * THE FLATTENED ROWS AND THEIR PREFIX SUM. One pass, memoised on the three things that can change
  * it. `aria-posinset`/`setsize` index into THIS array, which is the filtered collection.
  *
  * ⚠️ A FILTER AUTO-EXPANDS. With a query live, a system whose children matched is shown open —
  * otherwise the reader types a structure's name and is shown fifteen closed rows, i.e. the filter
  * appears to have found nothing. Without a query the reader's own expansion state stands.
  */
 const rows = useMemo(() => {
  const list: TreeRow[] = [];
  let top = 0;
  for (const s of liveSystems(idx)) {
   const kids = filtered.out.get(s.id);
   if (!kids) continue;
   list.push({kind: 'system', id: s.id, name: s.name, system: s.id, level: 1, count: kids.length, top, h: ROW_H.system});
   top += ROW_H.system;
   const open = q ? !filtered.sysHit.has(s.id) || expanded.has(s.id) : expanded.has(s.id);
   if (!open) continue;
   for (const c of kids) {
    list.push({kind: 'concept', id: c.id, name: c.name, system: s.id, level: 2, top, h: ROW_H.concept});
    top += ROW_H.concept;
   }
  }
  return {list, total: top};
 }, [idx, filtered, expanded, q]);

 /** The picked set, and the meshes it already draws — the two readings every row needs. */
 const picked = useMemo(() => new Set(p.picks), [p.picks]);
 /**
  * THE COVERED SET. Union the elements of every picked concept (at most 24 of them), then a row is
  * COVERED when it is not itself picked and every one of its elements is already in that union.
  * Bounded by `LIMITS.MAX_STRUCTURES`, so this is cheap however large the atlas is; the per-row
  * test is the only part that touches 3,432 concepts and it runs only for the mounted window.
  */
 const covered = useMemo(() => {
  if (!p.atlas || !p.picks.length) return null;
  const byId = new Map(p.atlas.concepts.map((c) => [c.id, c]));
  const els = new Set<string>();
  const owner = new Map<string, string>();
  for (const id of p.picks) {
   const c = byId.get(id);
   for (const e of c?.elements ?? [id]) { els.add(e); if (!owner.has(e)) owner.set(e, id); }
  }
  return {els, owner, byId};
 }, [p.atlas, p.picks]);
 const coverageOf = useCallback((id: string): string | null => {
  if (!covered || picked.has(id)) return null;
  const c = covered.byId.get(id);
  if (!c?.elements.length) return null;
  if (!c.elements.every((e) => covered.els.has(e))) return null;
  const own = covered.owner.get(c.elements[0]);
  return own ? (covered.byId.get(own)?.name ?? own) : null;
 }, [covered, picked]);

 /** A system's tri-state, over the FULL system rather than the filtered slice: "half of this system
  *  is in the view" is a claim about the system, and a filter is a lens on the list, not on the
  *  scene. Stated because the opposite reading is equally defensible and this one is the choice. */
 const sysState = useCallback((s: SystemId): 'on' | 'off' | 'mixed' => {
  const kids = idx?.bySystem.get(s) ?? [];
  if (!kids.length) return 'off';
  let n = 0;
  for (const c of kids) if (picked.has(c.id)) n++;
  return n === 0 ? 'off' : n === kids.length ? 'on' : 'mixed';
 }, [idx, picked]);

 /**
  * WHICH EYE THIS ROW HAS — the RC8 three-way split, decided by what the row IS **and by whether the
  * codec actually honours the fact in this scene's MODE**.
  *
  * ⚠️ THE MODE CLAUSE IS A HIGH (codex round 3, H1), and the audit in `controller.ts` had already
  * written the rule down: "PER-STRUCTURE ALPHA `styles[id].opacity`, resolved per MODE (explore
  * draws every named structure solid)". I quoted that sentence and then built a control on top of it
  * anyway. `sceneOpacities` (scene-codec.js:427-430) returns `{id: 1}` for EVERY member in explore
  * mode, so in an explore scene `set-opacity` writes 0 into the blob and the renderer keeps drawing
  * the structure at full alpha. codex executed it: `decodedStyle=[…"opacity":0]`, `uiEyeOn=false`,
  * `slider=0`, `rendererAlpha=1`, `shown=true` — two controls saying "hidden" over a visible
  * structure, which is the single worst thing a visibility control can do.
  *
  * So a scene member is a MEMBER row only in RENDER mode, where the style is honoured and
  * round-trips. In EXPLORE mode it is a SESSION row: the override is applied by the page's opacity
  * merge (so the picture always matches the control), nothing is written to the blob (so no
  * unhonoured style is saved), and the tooltip says session-only — which is the truth there.
  */
 const eyeKind = useCallback((row: TreeRow): EyeKind => {
  if (row.kind === 'system') return 'system';
  const isMember = p.scene?.structures.some((s) => s.id === row.id) ?? false;
  return isMember && p.scene?.mode === 'render' ? 'member' : 'session';
 }, [p.scene]);

 /**
  * ⚠️ ONE READING, AND IT IS THE RENDERER'S — codex r4, all four Highs.
  *
  * Every clause of this used to be a local declaration: the system eye read the intent, the member
  * eye read `styles[id].opacity ?? 1`, the session eye read the hidden set. Each is one link of a
  * five-link chain, and the renderer walks all five. `visibility.ts eyeOn` is now the only place
  * that decides, and it is fed the finished number.
  */
 const eyeOn = useCallback((row: TreeRow): boolean => eyeOnOf({
  kind: eyeKind(row), system: row.kind === 'system' ? row.system : undefined,
  visible: p.visible, alpha: row.kind === 'concept' ? p.effectiveAlpha(row.id) : undefined,
 }), [p.visible, p.effectiveAlpha, eyeKind]);

 /**
  * THE CLICK, also decided in `visibility.ts` so the two halves cannot drift apart. Three things
  * changed from round 4, all of them the same lesson:
  *   · "show" writes an EXPLICIT `1`. `null` removes the entry and `scene-codec.js:403` then
  *     inherits `roleOpacity[role]` — codex executed a ghost with `roleOpacity.ghost = 0`, where
  *     "show" left the structure completely invisible.
  *   · "show" ALSO clears the session override, whatever kind of row it is. A row hidden as a
  *     non-member and then TICKED became a member row whose eye could no longer reach the override
  *     that was blanking it.
  *   · a system click is computed from the EFFECTIVE set, so it does what it looks like it does.
  */
 const toggleEye = useCallback((row: TreeRow) => {
  const act = eyeAction({
   kind: eyeKind(row), on: eyeOn(row),
   system: row.kind === 'system' ? row.system : undefined,
   visible: p.visible, intent: p.visibleIntent,
  });
  if (act.visible) { p.dispatch({type: 'set-visible', visible: act.visible, intent: act.intent}); return; }
  /**
   * ⚠️ THE COMMAND GOES FIRST, AND THE SESSION SET MOVES ONLY IF IT WAS ACCEPTED — codex round 5,
   * Medium 1. Clearing the override BEFORE dispatching made the operation non-atomic: codex built a
   * scene 1,348 characters long, clicked "show" on a member, and the controller refused the 1,402
   * character result — correctly, atomically, changing nothing in the scene — while the override had
   * already been cleared, so the picture changed from alpha 0 to 0.55 under a message that said the
   * edit did not happen. A refusal that alters what is on screen is not a refusal.
   */
  if (act.session === 'hide') { p.onHide(row.id, true); return; }
  if (act.opacity !== undefined) {
   if (!p.dispatch({type: 'set-opacity', id: row.id, opacity: act.opacity})) return;
  }
  if (act.session === 'clear') p.onHide(row.id, false);
 }, [eyeOn, eyeKind, p]);

 /**
  * WHY A ROW THE READER HID IS STILL ON SCREEN — and it has to be SAID, or the click reads as
  * broken. codex r4 H3: hiding *Body of sternum* while *Sternum* is also selected leaves their
  * shared mesh at alpha 1, because the plate takes the MAX. The eye is now honest about that (it
  * stays on), which without this note would look like a control that does nothing.
  *
  * Returns the name of the structure keeping it visible, or null. Bounded by `picks` (≤ 24).
  */
 const drawnThrough = useCallback((row: TreeRow): string | null => {
  if (row.kind !== 'concept' || !covered) return null;
  const declaredOff = p.hidden.has(row.id)
   || (eyeKind(row) === 'member' && (p.scene?.styles.find((s) => s.id === row.id)?.opacity ?? 1) === 0);
  if (!declaredOff || p.effectiveAlpha(row.id) <= 0) return null;
  const mine = new Set(covered.byId.get(row.id)?.elements ?? []);
  for (const id of p.picks) {
   if (id === row.id) continue;
   const other = covered.byId.get(id);
   if (!other?.elements.some((e) => mine.has(e))) continue;
   /**
    * ⚠️ IT MUST BE A CONTRIBUTOR, NOT MERELY A NEIGHBOUR — codex round 5, Medium 5. The test was
    * `effectiveAlpha(id) > 0`, which proves the candidate is DRAWN, not that it is what draws the
    * shared mesh. With three concepts on one mesh (codex executed body-of-organ, sternum and
    * body-of-sternum, all sharing `FJ3178`, two of them declared 0), every candidate reads 1 because
    * the third keeps the mesh alive — so the note pointed the reader at another HIDDEN declaration.
    * The candidate's own DECLARED alpha is what contributes to the max, so that is the test.
    */
   if (p.hidden.has(id)) continue;
   const declared = eyeKind(row) === 'member'
    ? (p.scene?.styles.find((st) => st.id === id)?.opacity ?? 1)
    : 1;
   if (declared > 0 && p.effectiveAlpha(id) > 0) return t.name(id, other.name);
  }
  return null;
 }, [covered, p, eyeKind, t]);

 /** The eye's TOOLTIP NAMES ITS SERIALISATION. RC8 refuses to ship an eye that does not — the
  *  reader has to be able to tell, before clicking, whether the link they copy afterwards will
  *  reproduce what they are looking at. */
 const eyeTitle = useCallback((row: TreeRow): string => {
  const kind = eyeKind(row);
  if (kind === 'system') return p.isolate ? tr('tree.eyeSystemIsolate') : tr('tree.eyeSystem');
  return kind === 'member' ? tr('tree.eyeMember') : tr('tree.eyeSession');
 }, [eyeKind, p.isolate, tr]);

 const toggleTick = useCallback((row: TreeRow) => {
  if (row.kind === 'concept') { p.dispatch({type: 'tick', ids: [row.id], on: !picked.has(row.id)}); return; }
  // THE BULK TICK. Every descendant, atomically, subject to both bounds — which for a 634-concept
  // system means it REFUSES, visibly, and that is the correct and intended outcome rather than a
  // missing feature: `spec.md` says "exceeding 24 structures or 1,400 encoded characters refuses
  // the entire operation". Unticking a system is the case that routinely succeeds.
  const kids = (idx?.bySystem.get(row.system) ?? []).map((c) => c.id);
  p.dispatch({type: 'tick', ids: kids, on: sysState(row.system) === 'off'});
 }, [p, picked, idx, sysState]);

 const toggleOpen = useCallback((s: SystemId, open?: boolean) => {
  setExpanded((cur) => {
   const next = new Set(cur);
   const want = open ?? !next.has(s);
   if (want) next.add(s); else next.delete(s);
   return next;
  });
 }, []);

 // ── the window ──────────────────────────────────────────────────────────────────────────────
 useEffect(() => {
  const el = boxRef.current;
  if (!el || typeof ResizeObserver !== 'function') return;
  const ro = new ResizeObserver(() => setHeight(el.clientHeight || 420));
  ro.observe(el);
  setHeight(el.clientHeight || 420);
  return () => ro.disconnect();
 }, []);
 /** Binary search for the first row whose bottom is below the scroll position. */
 const firstAt = useCallback((y: number) => {
  const a = rows.list;
  if (!a.length) return 0;
  /**
   * ⚠️ THE PAST-THE-END ANSWER IS THE LAST ROW, NOT ROW ZERO — codex round 3, Medium 1.
   *
   * The seed was `out = 0`, so when no row's bottom exceeded `y` — which is every query at or past
   * the final row's bottom — the search returned 0. At the BOTTOM of the tree that made
   * `from = firstAt(scrollTop)` large and `to = firstAt(scrollTop + height)` zero, i.e. an end
   * before its start and an EMPTY window: the last screenful of the list rendered blank while the
   * scrollbar promised content. codex executed the unchanged body over the real expanded-Skeleton
   * sequence (649 rows, 35,016 px) at the phone's `height=260`, `scrollTop=34756`:
   * `from=640, to=5, mounted=0`. The supplied virtualisation evidence scrolls to the MIDDLE, so it
   * could not see the boundary.
   */
  let lo = 0, hi = a.length - 1, out = a.length - 1;
  while (lo <= hi) {
   const mid = (lo + hi) >> 1;
   if (a[mid].top + a[mid].h > y) { out = mid; hi = mid - 1; } else lo = mid + 1;
  }
  return out;
 }, [rows]);
 const window_ = useMemo(() => {
  const a = rows.list;
  if (!a.length) return {from: 0, to: 0, pinned: -1};
  const from = Math.max(0, firstAt(scrollTop) - OVERSCAN);
  const to = Math.min(a.length, firstAt(scrollTop + height) + 1 + OVERSCAN);
  /**
   * ⚠️ THE ACTIVE ROW STAYS MOUNTED — AS ONE EXTRA ROW, NOT BY WIDENING THE WINDOW.
   *
   * Why it must stay: scroll the focused row out of the window and its DOM node is destroyed, focus
   * falls to `<body>`, and the next arrow key reaches the CAMERA instead of the tree.
   *
   * Why the first attempt was wrong, MEASURED by S3's own virtualisation oracle: it did
   * `if (active < from) from = active`, which stretches the window to SPAN the gap. Scrolling to the
   * middle of an expanded Skeleton with the active row still at index 0 mounted **339 rows** — a
   * virtualiser that un-virtualises exactly when the list is long enough to need it, and the row
   * that caught it was the one asserting "< 60 rows mounted". Pinning ONE row costs one node.
   */
  /**
   * ⚠️ CLAMPED HERE, IN THE PURE COMPUTATION — a HIGH (codex round 3, H2).
   *
   * `active` was clamped in an EFFECT, which runs AFTER the render that uses it. Narrow the filter
   * while the active index is past the end of the new collection and this memo appended
   * `rows.list[active]` === `undefined`, and the row renderer dereferenced `row.system`. codex
   * executed it through a real render harness with `expanded={skeletal}`, `active=100`,
   * `query='femur'`: `TypeError: Cannot read properties of undefined (reading 'system')`. The
   * reachable interaction is ordinary — expand Skeleton, arrow down past row 100, type in the
   * filter. An effect cannot protect the render that schedules it.
   */
  const at = Math.min(active, a.length - 1);
  const pinned = (at < from || at >= to) ? at : -1;
  return {from, to, pinned};
 }, [rows, scrollTop, height, firstAt, active]);

 // Keep `active` inside the collection when the filter shrinks it.
 useEffect(() => { setActive((a) => Math.min(a, Math.max(0, rows.list.length - 1))); }, [rows.list.length]);

 const activeRef = useRef<HTMLLIElement | null>(null);
 const movedRef = useRef(false);
 useEffect(() => {
  if (!movedRef.current) return;
  movedRef.current = false;
  activeRef.current?.scrollIntoView({block: 'nearest'});
  activeRef.current?.focus({preventScroll: true});
 }, [active, window_]);
 const move = (to: number) => {
  const n = rows.list.length;
  if (!n) return;
  movedRef.current = true;
  setActive(Math.max(0, Math.min(n - 1, to)));
 };

 /**
  * ── THE TREE'S KEYBOARD ────────────────────────────────────────────────────────────────────────
  * `spec.md`: "Up/Down; Right/Left; Space — previous/next row; expand/collapse; toggle exact
  * membership". The camera never sees any of it: `keys.ts` guard 4 declines every arrow and Space
  * while focus is inside `[role="tree"]`, which is why this container claims that role for real
  * (S0 deliberately did NOT, because announcing a tree whose keyboard contract is unimplemented is
  * worse than announcing a list).
  *
  * `preventDefault` only on the keys actually consumed — Tab, Escape and everything else leave
  * untouched, or the tree would eat its own escape hatch.
  */
 const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
  const row = rows.list[active];
  if (!row) return;
  const k = e.key;
  if (k === 'ArrowDown') { move(active + 1); e.preventDefault(); return; }
  if (k === 'ArrowUp') { move(active - 1); e.preventDefault(); return; }
  if (k === 'Home') { move(0); e.preventDefault(); return; }
  if (k === 'End') { move(rows.list.length - 1); e.preventDefault(); return; }
  if (k === 'ArrowRight') {
   /**
    * ⚠️ S3b — "IS IT OPEN?" IS NOT "HAS THE READER EXPANDED IT?" (codex round 4, Medium 4).
    *
    * The guard was `!expanded.has(row.system) && !q`, i.e. the key stopped working the moment a
    * filter was live. The `!q` was there for the auto-expand rule — with a query, a system whose
    * CHILDREN matched is drawn open without being in `expanded` — but a system that matched BY NAME
    * (`filtered.sysHit`) is drawn CLOSED, and those are exactly the rows a reader filters to and
    * then tries to open. codex executed it with `query='Skeleton'`: `expanded=[]`,
    * `aria-expanded=false`, and ArrowRight moved to the next row instead of opening it.
    *
    * So the test is the row's ACTUAL open state — the same expression the row renders from, which is
    * why it is computed here rather than re-derived from `expanded`.
    */
   const openNow = row.kind === 'system'
     && (q ? !filtered.sysHit.has(row.system) || expanded.has(row.system) : expanded.has(row.system));
   if (row.kind === 'system' && !openNow) toggleOpen(row.system, true);
   else if (row.kind === 'system') move(active + 1);
   e.preventDefault(); return;
  }
  if (k === 'ArrowLeft') {
   if (row.kind === 'system') toggleOpen(row.system, false);
   else {
    // To the parent, which is the nearest system row above — found by walking, because the filter
    // can put an arbitrary number of siblings between them.
    let i = active;
    while (i > 0 && rows.list[i].kind !== 'system') i--;
    move(i);
   }
   e.preventDefault(); return;
  }
  /**
   * ⚠️ THE EYE HAS ITS OWN KEY, AND ACTIVATION KEYS ON THE EYE ARE LEFT ALONE — codex round 3,
   * Medium 3.
   *
   * Every control inside a row carries `tabIndex={-1}` so the roving tabindex stays on the ROW, and
   * the handler below bound Space and Enter unconditionally. Two consequences codex executed: a
   * keyboard reader could change MEMBERSHIP but had no way at all to reach VISIBILITY (the separate
   * control `spec.md` §Accessibility requires to be separately identifiable), and Enter/Space
   * delivered while the eye itself held focus performed the row's action instead of the eye's —
   * `Enter → ["focus FMA22359","preventDefault"]`, `Space → ["tick","preventDefault"]`.
   *
   * `V` is the visibility key. `spec.md`'s Tree row names Up/Down/Right/Left/Space and no more, so
   * this is an ADDITION — recorded in `KEY_MAP` under the tree group so the `?` overlay lists it,
   * rather than a shortcut only the source knows about. And when the event's target IS a button
   * inside the row, the handler declines: the button is a button and owns its own activation.
   */
  const onOwnControl = e.target instanceof Element && e.target !== e.currentTarget
    && !!e.target.closest('.v2-eye, .v2-tick, .v2-tw, .v2-tree-name');
  if (k === 'v' || k === 'V') { toggleEye(row); e.preventDefault(); return; }
  if (onOwnControl && (k === ' ' || k === 'Spacebar' || k === 'Enter')) return;
  if (k === ' ' || k === 'Spacebar') { toggleTick(row); e.preventDefault(); return; }
  if (k === 'Enter') {
   if (row.kind === 'system') toggleOpen(row.system);
   else if (picked.has(row.id)) p.onFocus(row.id);
   else p.dispatch({type: 'tick', ids: [row.id], on: true});
   e.preventDefault();
  }
 };

 const total = idx ? [...idx.bySystem.values()].reduce((a, b) => a + b.length, 0) : 0;
 const nSystems = liveSystems(idx).length;

 return <>
  {/* THE SUB-LINE CARRIES BOTH DENOMINATORS, and they are two populations: systems and structures
      are not one number. With a filter live it reports the narrowed count AGAINST the population it
      was drawn from — `feedback-a-rate-needs-its-denominator-named`, the same discipline the
      palette's footer follows. */}
  <p className="v2-side-sub">{q
   ? tr('tree.filtered', {s: filtered.systems, sn: nSystems, c: filtered.concepts.toLocaleString(), cn: total.toLocaleString()})
   : tr('tree.inventory', {s: nSystems, c: total.toLocaleString()})}</p>
  <div className="v2-tree-box" ref={boxRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
   {rows.list.length === 0
    ? <p className="v2-empty-state">{tr('tree.noMatch')}</p>
    : <ul className="v2-tree" role="tree" aria-label={tr('panel.layers')} onKeyDown={onKeyDown}
       style={{height: rows.total, position: 'relative'}}>
     {((): {row: TreeRow; at: number}[] => {
      const win = rows.list.slice(window_.from, window_.to).map((r, i) => ({row: r, at: window_.from + i}));
      // The pinned row is APPENDED, so it costs one extra node rather than a wider window.
      return window_.pinned >= 0 ? [...win, {row: rows.list[window_.pinned], at: window_.pinned}] : win;
     })().map(({row, at}) => {
      const isActive = at === active;
      const sys = SYSTEMS.find((s) => s.id === row.system);
      const on = eyeOn(row);
      const kind = eyeKind(row);
      const label = row.kind === 'system' ? t.system(row.system, row.name) : t.name(row.id, row.name);
      const second = row.kind === 'concept' ? t.secondary(row.id, row.name) : '';
      const state = row.kind === 'system' ? sysState(row.system) : (picked.has(row.id) ? 'on' : 'off');
      const cover = row.kind === 'concept' ? coverageOf(row.id) : null;
      const via = drawnThrough(row);
      /**
       * ⚠️ WHY IT IS NOT DRAWN — codex round 5, Medium 4. An ordinary row whose SYSTEM is switched
       * off reads effective 0, so the eye offered "show"; clicking it cleared an empty session set
       * and changed nothing. The eye owns the session override and the scene's style, and it owns
       * NEITHER the system switch — so on that cause it says so and declines, which is the S0 inert
       * convention rather than a control that silently fails.
       */
      const cause = row.kind === 'concept' ? alphaCause({
       alpha: p.effectiveAlpha(row.id),
       inSession: p.hidden.has(row.id),
       declaredZero: eyeKind(row) === 'member' && (p.scene?.styles.find((st) => st.id === row.id)?.opacity ?? 1) === 0,
       systemOn: p.visible.includes(row.system),
      }) : 'drawn';
      const eyeInert = cause === 'system';
      // The system row's OTHER fact: the human's own set, which a scene's arrival does not touch.
      const intent = row.kind === 'system' ? p.visibleIntent.includes(row.system) : undefined;
      const openNow = row.kind === 'system' && (q ? !filtered.sysHit.has(row.system) || expanded.has(row.system) : expanded.has(row.system));
      return <li
       key={`${row.kind}:${row.id}`}
       ref={isActive ? activeRef : undefined}
       role="treeitem"
       aria-level={row.level}
       aria-posinset={at + 1}
       aria-setsize={rows.list.length}
       aria-expanded={row.kind === 'system' ? openNow : undefined}
       aria-checked={state === 'mixed' ? 'mixed' : state === 'on'}
       aria-selected={p.focusedId === row.id}
       aria-describedby={[cover && `v2-cov-${row.id}`, via && `v2-via-${row.id}`].filter(Boolean).join(' ') || undefined}
       data-intent={intent === undefined ? undefined : (intent ? 'on' : 'off')}
       tabIndex={isActive ? 0 : -1}
       onFocus={() => setActive(at)}
       className={`v2-tree-row is-${row.kind} ${isActive ? 'is-active' : ''} ${p.focusedId === row.id ? 'is-on' : ''} ${on ? '' : 'is-hidden'}`}
       style={{position: 'absolute', top: row.top, left: 0, right: 0, height: row.h}}
      >
       {row.kind === 'system'
        // COARSE: presentational, and the name owns the command. See `coarse` on the props.
        ? p.coarse
         ? <span className="v2-tw" aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
             style={{transform: openNow ? 'rotate(90deg)' : 'none'}}><path d="M7.6 4.6 13 10l-5.4 5.4"/></svg>
           </span>
         : <button type="button" className="v2-tw" tabIndex={-1}
            aria-label={tr(openNow ? 'tree.collapse' : 'tree.expand', {name: label})}
            onClick={() => toggleOpen(row.system)}>
           <svg width="13" height="13" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"
            strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
            style={{transform: openNow ? 'rotate(90deg)' : 'none'}}><path d="M7.6 4.6 13 10l-5.4 5.4"/></svg>
          </button>
        : <span className="v2-tw" aria-hidden="true"/>}
       {/* THE TICK. A real button with its own accessible name — `spec.md` requires the disclosure,
           the membership checkbox and the visibility button to be separately identifiable. */}
       <button type="button" tabIndex={-1}
        className={`v2-tick is-${state}`}
        aria-label={tr(state === 'off' ? 'tree.tickOn' : 'tree.tickOff', {name: label})}
        title={row.kind === 'system' ? tr('tree.tickSystem') : tr('tree.tick')}
        onClick={() => toggleTick(row)}>
        {state === 'mixed'
         ? <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M5 10h10"/></svg>
         : state === 'on'
          ? <svg width="12" height="12" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.4l3.6 3.6L15.5 6.6"/></svg>
          : null}
       </button>
       {row.kind === 'system' && <span className="v2-swatch" style={{background: sys?.color}}/>}
       <button type="button" className="v2-tree-name" tabIndex={-1} title={label}
        onClick={() => (row.kind === 'system' ? toggleOpen(row.system) : (picked.has(row.id) ? p.onFocus(row.id) : p.dispatch({type: 'tick', ids: [row.id], on: true})))}>
        <b>{label}</b>
        {second && <i lang={second === row.name ? 'en' : undefined}>{second}</i>}
        {cover && <s id={`v2-cov-${row.id}`}>{tr('tree.covered', {name: cover})}</s>}
        {/* ⚠️ THE TWO NOTES THAT MAKE AN HONEST EYE LEGIBLE (S3b, codex r4 H3 + H4). Without them
            a truthful control looks like a broken one: the reader clicks hide and the eye stays on
            (a shared mesh), or the eye is on for a system they never asked for (a ghost scene). */}
        {via && <s id={`v2-via-${row.id}`}>{tr('tree.drawnThrough', {name: via})}</s>}
        {intent !== undefined && intent !== on && <s>{tr(intent ? 'tree.sysHiddenByView' : 'tree.sysShownByView')}</s>}
        {cause === 'system' && <s>{tr('tree.hiddenWithSystem', {name: t.system(row.system, SYSTEMS.find((x) => x.id === row.system)?.name ?? row.system)})}</s>}
       </button>
       {row.kind === 'system' && <em>{(row.count ?? 0).toLocaleString()}</em>}
       <button type="button" tabIndex={-1}
        className={`v2-eye is-${kind} ${on ? '' : 'is-off'} ${eyeInert ? 'is-inert' : ''}`}
        aria-pressed={!on}
        aria-disabled={eyeInert || undefined}
        aria-label={`${label} — ${tr(eyeInert ? 'tree.eyeSystemOff' : on ? 'tree.hide' : 'tree.show')}`}
        title={eyeInert ? tr('tree.eyeSystemOff') : eyeTitle(row)}
        onClick={() => { if (!eyeInert) toggleEye(row); }}>
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor"
         strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
         <path d={on
          ? 'M1.8 10S4.8 4.8 10 4.8 18.2 10 18.2 10S15.2 15.2 10 15.2 1.8 10 1.8 10M10 12.4a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8'
          : 'M3 3l14 14M8.2 8.3A2.4 2.4 0 0 0 10 12.4c.6 0 1.2-.2 1.7-.6M6.3 6.4C3.6 7.8 1.8 10 1.8 10s3 5.2 8.2 5.2c1.4 0 2.6-.4 3.7-.9M15.6 13C17.3 11.8 18.2 10 18.2 10S15.2 4.8 10 4.8c-.6 0-1.2.1-1.7.2'}/>
        </svg>
       </button>
      </li>;
     })}
    </ul>}
  </div>
 </>;
}
