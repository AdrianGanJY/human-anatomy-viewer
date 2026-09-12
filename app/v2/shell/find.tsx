/**
 * THE FIND PALETTE — Ctrl/⌘K on the desktop, the A4 bottom sheet on the phone, ONE component.
 * L31 v2.1b+c, S2. `spec.md` artboards D3 / T4L / T4P / A4; kickoff S2; opus-plan-review-2.md RC9.
 *
 * WHY ONE COMPONENT FOR BOTH. The S0 overlay primitive already switches between a centred modal and
 * a bottom sheet on the `sheet` prop, and it carries the focus trap, the invoker restore, the
 * safe-area padding and the visual-viewport keyboard handling. A separate phone palette would be a
 * second matcher, a second ranking and a second set of denominators — and the first time one of them
 * changed they would disagree about what the app had found. So the palette is written once and
 * PRESENTED twice; the only branch below is the placeholder text's length.
 *
 * ══ WHAT THIS REPLACED ON THE PHONE ═════════════════════════════════════════════════════════════
 * The phone previously searched inside the margin (`.v2-search` in page.tsx), which could never host
 * what `spec.md` A4 draws: a 724 px sheet, when the margin's own high detent is min(48dvh, 420). The
 * margin's Find button now opens THIS, and the results container keeps the `.v2-search` class so the
 * existing regression assertion ("Find opens a search field", verify-regress.mjs:1140) still matches
 * the thing it was written about — it is the same product claim, on a better surface.
 *
 * ══ THE FOUR STATES THAT ARE EASY TO GET WRONG ══════════════════════════════════════════════════
 *  1. LOADING. `spec.md`: "No 'no results' before dictionaries finish." A Chinese query typed while
 *     zh-Hans is still in flight matches nothing — and saying "No structures match" there is a false
 *     statement about the atlas, not a slow render.
 *  2. PARTIAL. One lane 500s. The palette says which, keeps the results it has, and the NEXT open
 *     retries just the missing lane (dict.ts `loadLane`). It does not pretend the load succeeded.
 *  3. EMPTY QUERY. Recents, then the current selection — never a blank panel, which reads as broken.
 *  4. CAPPED. More matches than `CAP` in a lane: the footer says so. A silent truncation reads as
 *     "that is all there is", which is the one thing a result count must never imply.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {SYSTEMS, type Atlas, type SystemId} from '../../anatomy.ts';
import {type Lang} from '../../i18n/ui.ts';
import {loadZhDicts, loadedLanes, zhPartial, type Dicts, type T} from '../../i18n/dict.ts';
import {CAP, LANE_ORDER, search, type Hit, type Lane} from '../find.ts';
import Overlay from './overlay.tsx';

/**
 * RECENTS LIVE IN MEMORY, NOT localStorage — and that is a deliberate refusal, not an omission.
 *
 * RC12 declared the WHOLE localStorage schema at S0 (`atlas.dock`, `atlas.pinyin`, `atlas.scenes`,
 * `atlas.openai`) precisely so that a later group could not quietly add a fifth key with a shape
 * nobody reviewed. `atlas.recent` is not in that schema, so S2 does not write one. Recents are
 * session-scoped, which is also the honest reading of `spec.md`'s "up to 8 remembered IDs": it is a
 * convenience inside one sitting, not a preference worth persisting to a reader's machine.
 */
const RECENT_MAX = 8;
let recents: string[] = [];
const remember = (id: string): void => { recents = [id, ...recents.filter((r) => r !== id)].slice(0, RECENT_MAX); };
/** Exported for the unit test, and so a future group can clear it rather than reaching into module
 *  scope. */
export const readRecents = (): readonly string[] => recents;
export const clearRecents = (): void => { recents = []; };

export interface FindProps {
 open: boolean;
 onClose(): void;
 sheet: boolean;
 atlas: Atlas | null;
 dicts: Dicts;
 /** Called when a lane arrives, so the page can re-render with the wider dictionary set. */
 onDicts(d: Dicts): void;
 t: T;
 tr(key: string, vars?: Record<string, string | number>): string;
 /** The controller's two commitments. Both return false when the controller REFUSES the edit (the
  *  24-structure / 1,400-character atomic bounds), and the palette stays open and says so rather
  *  than closing on an edit that did not happen. */
 replace(ids: readonly string[], focus?: string | null): boolean;
 add(id: string): boolean;
 /** The current selection, shown under an empty query. */
 picks: readonly string[];
 /**
  * THE CONTROLLER'S OWN REFUSAL SENTENCE, passed in rather than invented here.
  *
  * The first version of this component rendered `tr('refusal.tooMany')` — a copy key that does not
  * exist. `v2t` returns the KEY when a row is missing, so a reader who exceeded the 24-structure
  * bound would have been shown the literal string "refusal.tooMany". Worse, it would have been a
  * SECOND wording of a refusal the controller already words precisely (which bound, by how much,
  * and that the selection is unchanged) — two sources for one fact, and the invented one less
  * informative. The page already renders this string in the margin; the palette shows the same one.
  */
 refused: string;
}

/** `en`/`id` never reach here — `Hit.matched` is null for those (find.ts). */
const SCRIPT_LABEL: Record<string, string> = {'zh-Hans': '简', 'zh-Hant': '繁'};

export default function FindPalette(p: FindProps) {
 const [q, setQ] = useState('');
 const [scope, setScope] = useState<SystemId | null>(null);
 const [active, setActive] = useState(0);
 const [loading, setLoading] = useState(false);
 /** Set when a commit came back false. The TEXT is the controller's (`p.refused`); this only records
  *  that the refusal belongs to something the reader did IN the palette, so a stale refusal from an
  *  earlier edit is not re-shown over an unrelated query. */
 const [refusedHere, setRefusedHere] = useState(false);
 /** Bumped whenever a dictionary lane arrives, purely to re-run the memo below. */
 const [lanes, setLanes] = useState(() => loadedLanes().length);
 const listRef = useRef<HTMLUListElement | null>(null);
 const inputRef = useRef<HTMLInputElement | null>(null);

 /**
  * ── THE DICTIONARIES LOAD ON OPEN, NEVER ON MOUNT ──────────────────────────────────────────────
  *
  * This effect is the whole of "never on mount": it is keyed on `open`, and `open` is false until a
  * human presses Ctrl+K. A fresh English visit therefore issues ZERO `/i18n/zh-*` requests, which
  * is what the request-budget rows in verify-ux.mjs assert (kickoff item 4, RC10) — the budget is
  * the gate, and this line is the thing it gates.
  *
  * It runs on EVERY open, not just the first, because `loadZhDicts` is now per-lane: a lane that
  * failed dropped its memo, so re-calling retries exactly the missing one and leaves the loaded one
  * untouched. That is the RC9 retry, and it costs nothing when both lanes are already in.
  */
 useEffect(() => {
  if (!p.open) {
   // ⚠️ CLEAR THE FLAG ON CLOSE. Without this, a close DURING the fetch left `loading` true for
   // ever: the next open early-returns at `!zhPartial()` below and never reaches a `setLoading`,
   // so the palette showed "Loading the Chinese names…" permanently and — because `search.empty`
   // is gated on `!loading` — showed neither results nor "No structures match".
   setLoading(false);
   return;
  }
  if (!zhPartial()) { setLoading(false); return; }   // both lanes in: no request at all
  setLoading(true);
  /**
   * ⚠️ NO `alive` LATCH — AND ITS ABSENCE IS THE FIX FOR A HIGH (stand-in review S2 r1, H1).
   *
   * The latch was the obvious React hygiene and it was exactly wrong here, because this component
   * is NEVER UNMOUNTED: it returns `null` when closed, and `page.tsx` renders it unconditionally.
   * So "the effect was cleaned up" does not mean "nobody is listening" — it only means the reader
   * pressed Escape. With the latch, closing the palette during the ~2 × 174 KB cold fetch skipped
   * `p.onDicts(d)`, and since `search()` reads the PAGE's `dicts` (not the module cache), the
   * dictionaries sat loaded in `loaded` where nothing could see them. Cross-script search was then
   * dead for the rest of the page session — terminal, behind a single Escape, and only for the
   * ENGLISH reader, because `page.tsx:145` rescues every Chinese interface. That reader is the one
   * S2 exists for.
   *
   * Executed by the reviewer: a 4 s route delay on `/i18n/zh-*`, close at 600 ms, then reopen and
   * type 胸骨 — 0 rows, no lane headings, a stuck "Loading…" note; the same page with the palette
   * held open returned 17 rows. Both dictionaries were on the wire in both arms.
   *
   * So the cache-population path runs UNCONDITIONALLY. Every call here is idempotent — `setLoading`,
   * `setLanes` and `onDicts` all just publish what has already arrived — and a setState on a mounted
   * component that happens to be rendering `null` is free.
   */
  void loadZhDicts().then((d) => {
   setLoading(false);
   setLanes(loadedLanes().length);
   p.onDicts(d);
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `p.onDicts` is stable; re-running on it
  // would refetch on every parent render.
 }, [p.open]);

 /** RETRY IN PLACE — the query and the scope survive, which is what `spec.md` §92 asks for and what
  *  a reopen (which clears both) could never deliver. `loadZhDicts` is per-lane, so this re-fetches
  *  only what is actually missing. */
 const retry = useCallback(() => {
  setLoading(true);
  void loadZhDicts().then((d) => { setLoading(false); setLanes(loadedLanes().length); p.onDicts(d); });
  inputRef.current?.focus();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `p.onDicts` is stable.
 }, []);

 // A CLOSED PALETTE FORGETS ITS QUERY BUT NOT ITS RECENTS. Reopening onto the previous query would
 // show a stale result set as though it had just been searched.
 useEffect(() => { if (!p.open) { setQ(''); setScope(null); setActive(0); setRefusedHere(false); } }, [p.open]);

 const res = useMemo(
  () => search(p.atlas, p.dicts, q, scope),
  // `lanes` is in the list so a dictionary arriving mid-session re-runs the search: without it the
  // memo would hold the pre-dictionary result and a Chinese query would stay empty after the load.
  [p.atlas, p.dicts, q, scope, lanes],
 );

 /** Under an EMPTY query: recents first, then the current selection. Both as real hits, so one row
  *  renderer serves every state. */
 const idle = useMemo(() => {
  if (q.trim()) return [];
  const seen = new Set<string>();
  const out: Hit[] = [];
  // BOTH VOCABULARIES. A pick may be a PART id as well as a concept id (`toPick` in selection.ts
  // resolves either, and the parts lane commits through the same path), so a concept-only lookup
  // would silently drop a mesh the reader had just selected from the palette — it would vanish from
  // "Recent and selected" while being visibly selected in the field.
  const byId = new Map<string, {name: string; lane: Lane}>();
  for (const c of p.atlas?.concepts ?? []) byId.set(c.id, {name: c.name, lane: 'concept'});
  for (const pt of p.atlas?.parts ?? []) if (!byId.has(pt.id)) byId.set(pt.id, {name: pt.name, lane: 'part'});
  for (const id of [...recents, ...p.picks]) {
   const hit = byId.get(id);
   if (seen.has(id) || !hit) continue;
   seen.add(id);
   out.push({lane: hit.lane, id, en: hit.name, parent: null, system: null, rank: 0, matched: null});
  }
  return out;
 }, [q, p.picks, p.atlas]);

 const rows = q.trim() ? res.all : idle;
 // CLAMP, never trust. The active index survives a keystroke that shortens the list, and an index
 // past the end would make Enter commit `undefined`.
 const at = Math.min(active, Math.max(0, rows.length - 1));

 const commit = useCallback((hit: Hit | undefined, addTo: boolean) => {
  if (!hit) return;
  if (hit.lane === 'system') {
   // A SYSTEM ROW SCOPES THE SEARCH; it does not write to the scene.
   //
   // This is a deliberate boundary. The obvious alternative — a system row toggles that system's
   // visibility — is `set-visible`, which RC8 assigns to S3's tree eye and which forces
   // `isolate:false` as a side effect. Two controls writing one fact, shipped a group apart, is how
   // the systems checkbox defect of v2.1a happened. So in S2 a system is a FILTER: it narrows both
   // the list and the denominators, and the chip says so.
   setScope(hit.id as SystemId);
   setActive(0);
   inputRef.current?.focus();
   return;
  }
  const ok = addTo ? p.add(hit.id) : p.replace([hit.id], hit.id);
  // THE PALETTE STAYS OPEN ON A REFUSAL. Closing would report an edit that did not happen, and the
  // reader would be left looking at an unchanged view with no explanation.
  if (!ok) { setRefusedHere(true); return; }
  setRefusedHere(false);
  remember(hit.id);
  // ADD KEEPS THE PALETTE OPEN, REPLACE CLOSES IT. Shift+Enter exists to build a set, and closing
  // after each one would make building a five-structure view five round trips.
  if (!addTo) p.onClose();
 }, [p]);

 const onKeyDown = useCallback((ev: React.KeyboardEvent) => {
  // IME FIRST, exactly as the global dispatcher does (keys.ts guard 2). Enter DURING a composition
  // is the IME accepting a candidate — committing a structure there would select whatever happened
  // to be first while the reader was still typing the word.
  if (ev.nativeEvent.isComposing || ev.keyCode === 229) return;
  if (ev.key === 'ArrowDown') { ev.preventDefault(); byKey.current = true; setActive((i) => Math.min(rows.length - 1, i + 1)); }
  else if (ev.key === 'ArrowUp') { ev.preventDefault(); byKey.current = true; setActive((i) => Math.max(0, i - 1)); }
  else if (ev.key === 'Enter') { ev.preventDefault(); commit(rows[at], ev.shiftKey); }
  else if (ev.key === 'Backspace' && !q && scope) { ev.preventDefault(); setScope(null); }
  // Escape is the Overlay's — it closes and restores focus to the invoker.
 }, [rows, at, commit, q, scope]);

 /**
  * KEEP THE ACTIVE ROW ON SCREEN — BUT ONLY WHEN THE KEYBOARD MOVED IT.
  *
  * ⚠️ THE UNCONDITIONAL VERSION IS A JITTER LOOP. Rows set the active index on `mouseenter`; if
  * every change scrolled, hovering a row near the edge would scroll the list UNDER the stationary
  * cursor, which lands the cursor on a different row, which fires another `mouseenter`, which
  * scrolls again. The reader sees the list twitch away from the thing they were pointing at.
  *
  * Scrolling belongs to the keyboard because that is the input that can move the selection OFF
  * screen. A mouse cannot: the row was under the cursor, so it was already visible.
  */
 const byKey = useRef(false);
 useEffect(() => {
  if (!byKey.current) return;
  byKey.current = false;
  const el = listRef.current?.querySelector<HTMLElement>('[data-at="1"]');
  el?.scrollIntoView({block: 'nearest'});
 }, [at, rows.length]);

 if (!p.open) return null;

 const laneOf = (l: Lane) => (l === 'system' ? res.system : l === 'concept' ? res.concept : res.part);
 const laneName: Record<Lane, string> = {
  system: p.tr('search.laneSystems'), concept: p.tr('search.laneConcepts'), part: p.tr('search.laneParts'),
 };

 /** ONE ROW RENDERER for every state. */
 const row = (h: Hit, i: number) => {
  // The display name in the interface language, and the pair beneath it.
  //
  // `t.alt(id, script)` rather than `h.matched.k`: the matcher's keys are LOWERCASED for comparison,
  // and showing a reader a lowercased version of their own language's spelling is sloppy where the
  // dictionary has the real one. `matched.k` remains the fallback for the case `alt` cannot serve.
  const display = h.lane === 'system' ? p.t.system(h.id, h.en) : p.t.name(h.id, h.en);
  const altText = h.matched ? (p.t.alt(h.id, h.matched.script as Lang) ?? h.matched.k) : null;
  // In a Chinese interface the English pair is already `secondary`; in English the pair is whatever
  // script actually matched. Both are "the spelling you cannot otherwise see".
  const pair = altText && altText !== display ? altText : (p.t.secondary(h.id, h.en) || null);
  const sys = h.system ? SYSTEMS.find((s) => s.id === h.system) : null;
  return <li key={`${h.lane}:${h.id}`} data-at={i === at ? '1' : '0'} data-lane={h.lane}>
   <button
    type="button" className={`v2-result ${i === at ? 'is-at' : ''}`}
    // `aria-selected` on a plain button would be a lie about the widget; the active row is reported
    // through the input's `aria-activedescendant` contract instead, and the id is stable per row.
    id={`v2-find-${i}`}
    onMouseEnter={() => setActive(i)}
    onClick={(e) => commit(h, e.shiftKey)}
   >
    {sys && <span className="v2-dot" style={{background: sys.color}} aria-hidden="true"/>}
    <span className="v2-find-name">
     {display}
     {pair && <i>{pair}{h.matched && <em className="v2-find-script">{SCRIPT_LABEL[h.matched.script] ?? ''}</em>}</i>}
    </span>
    {h.parent && <span className="v2-find-parent">{h.parent}</span>}
    {h.lane === 'system' && <span className="v2-kbd">{p.tr('search.scopeTo')}</span>}
   </button>
   {h.lane !== 'system' && <button
    type="button" className="v2-plus" aria-label={p.tr('search.add', {name: display})}
    onClick={() => commit(h, true)}
   >+</button>}
  </li>;
 };

 const scopeSys = scope ? SYSTEMS.find((s) => s.id === scope) : null;
 /**
  * THE RUNNING INDEX INTO `res.all`, computed once per lane instead of `res.all.indexOf(h)` per row.
  * `all` is now built in LANE_ORDER (find.ts), so the nth row drawn IS `all[n]` — which is exactly
  * what H3 was about: the arrow keys index `all`, the eye reads the groups, and before the fix those
  * were two different orders. Deriving the row ids from a running offset makes them the same
  * arithmetic rather than two computations that agree by luck.
  */
 let drawn = 0;

 return <Overlay
  open={p.open} onClose={p.onClose} sheet={p.sheet} kind="is-find"
  title={p.tr('search.open')} labelClose={p.tr('search.close')}
 >
  <div className="v2-search v2-find">
   <div className="v2-find-box">
    {/* THE SCOPE CHIP. Backspace on an empty query removes it — the shape every palette with a
        scope uses, and the reason `onKeyDown` watches Backspace. */}
    {scopeSys && <button type="button" className="v2-find-scope" onClick={() => { setScope(null); inputRef.current?.focus(); }}>
     {p.t.system(scopeSys.id, scopeSys.name)}<span aria-hidden="true">×</span>
     <span className="sr-only">{p.tr('search.scopeClear')}</span>
    </button>}
    <input
     // `data-autofocus` is what the Overlay honours; `autoFocus` alone was overridden by the
     // primitive's own "first focusable" rule, which resolved to the header's close button. See the
     // note in overlay.tsx — measured, not theorised.
     ref={inputRef} value={q} autoFocus data-autofocus
     onChange={(e) => { setQ(e.target.value); setActive(0); setRefusedHere(false); }}
     onKeyDown={onKeyDown}
     placeholder={p.tr('search.placeholder')} aria-label={p.tr('search.open')}
     // `aria-expanded` follows the LIST, not the palette (L4): announcing an expanded listbox with
     // nothing in it is a false statement to a screen reader.
     role="combobox" aria-expanded={rows.length > 0} aria-controls="v2-find-list" aria-autocomplete="list"
     aria-activedescendant={rows.length ? `v2-find-${at}` : undefined}
    />
   </div>

   {/* CROSS-SCRIPT, SAID OUT LOUD. An English reader typing 胸骨 has no reason to expect it to work;
       a line that says the search covers every script is the difference between a feature and a
       coincidence. */}
   <p className="v2-find-cross">{p.tr('search.cross')}</p>

   {refusedHere && p.refused && <p className="v2-refused" role="alert">{p.refused}</p>}

   {/* STATE 1 — LOADING. Never "no results" while a lane is in flight. */}
   {loading && <p className="v2-find-note" role="status">{p.tr('search.loading')}</p>}
   {/**
     * STATE 2 — PARTIAL, AND THE TOTAL-FAILURE CASE THAT USED TO FALL THROUGH IT.
     *
     * ⚠️ The gate was `loadedLanes().length > 0`, so when BOTH lanes failed the banner vanished and
     * a Chinese query got a bare "No structures match." — a statement about the ATLAS, made when
     * the truth was that no dictionary had loaded. That is precisely what this component's own
     * header (state 1) forbids, one branch away from where it is written (stand-in review, M1).
     *
     * The retry is also a BUTTON now, not just a sentence promising that reopening will retry.
     * `search.retry` was authored in three languages and rendered nowhere (L3), and `spec.md`'s
     * "query retained on retry" could not hold while the only retry was a reopen — and a reopen
     * clears the query (M5). Retrying in place keeps both the query and the scope.
     */}
   {!loading && zhPartial() &&
    <p className="v2-find-note is-warn" role="status">
     {loadedLanes().length ? p.tr('search.partial') : p.tr('search.noneLoaded')}
     <button type="button" className="v2-find-retry" onClick={retry}>{p.tr('search.retry')}</button>
    </p>}

   <ul className="v2-find-list" id="v2-find-list" role="listbox" aria-label={p.tr('search.open')} ref={listRef}>
    {q.trim()
     ? LANE_ORDER.map((l) => {
      const hits = res.all.filter((h) => h.lane === l);
      if (!hits.length) return null;
      const lr = laneOf(l);
      return <li key={l} className="v2-find-group">
       {/* THE DENOMINATOR IS PER LANE, and it is the population actually searched — narrowed with
           the scope, measured from the atlas, never the copy table's fixed number. */}
       {/* `toLocaleString` on BOTH numbers: the copy table writes the population as "3,432" and a
           bare `3432` beside it would read as a different figure. `v2t`'s singular branch strips
           separators before parsing, so the grouped form is the established convention here. */}
       <h3>{laneName[l]}<em>{p.tr('search.results', {n: lr.matched.toLocaleString(), total: lr.total.toLocaleString()})}</em></h3>
       <ul>{hits.map((h) => row(h, drawn++))}</ul>
      </li>;
     })
     : idle.length
      ? <li className="v2-find-group">
       <h3>{p.tr('search.recent')}</h3>
       <ul>{idle.map(row)}</ul>
      </li>
      : <li className="v2-empty">{p.tr('status.emptyHint')}</li>}

    {/* STATE 3 — genuinely nothing, and only once the dictionaries are in. */}
    {q.trim() && !res.all.length && !loading && <li className="v2-empty">{p.tr('search.empty')}</li>}
   </ul>

   {/* STATE 4 — CAPPED. Said, never silent. */}
   <p className="v2-find-foot">
    {res.capped ? p.tr('search.capped', {n: CAP}) : p.tr('search.footer')}
   </p>
  </div>
 </Overlay>;
}
