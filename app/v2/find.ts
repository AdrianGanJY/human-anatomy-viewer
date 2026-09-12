/**
 * THE PALETTE'S MATCHER — three populations, one ranking, no hidden truncation.
 * L31 v2.1b+c, S2. `spec.md` §"Search normalization"; codex-plan-review.md §A.8; RC9.
 *
 * It is a plain module with no React and no DOM so that the ranking can be tested as arithmetic
 * (`test/v2-find.test.mjs`) rather than through a browser. Every defect this file is written against
 * is a RANKING or a COUNTING defect, and both are invisible in a screenshot.
 *
 * ══ THE THREE POPULATIONS ═══════════════════════════════════════════════════════════════════════
 * Concepts (3,432), parts (2,234 unique meshes) and systems (15) are three different things a query
 * can hit, and a result count is only meaningful against the population it was drawn from. Merging
 * them produces the specific lie `spec.md` forbids — "16 of 3,432" for a query that matched one
 * system and fifteen structures — so each lane carries its own denominator all the way to the
 * footer. The denominators are MEASURED from the atlas that is loaded, never the copy table's fixed
 * numbers: a manifest that changes must move the footer with it.
 *
 * ══ THE RANK ═══════════════════════════════════════════════════════════════════════════════════
 * exact(0) > prefix(1) > token(2) > contains(3), then a STABLE tiebreak — kind, then id. Stability
 * is the point: a matcher that sorts only by score lets the browser's sort implementation decide the
 * order of the twenty rows that all score `contains`, and the same query then returns a different
 * first row on a different engine. The first row is what Enter commits.
 *
 * A `token` match is the query at the start of any space- or hyphen-delimited token, which is what
 * makes "sternum" rank the *Body of sternum* above a structure that merely contains the letters. CJK
 * has no such delimiters, so Chinese queries simply never reach the token tier and fall from prefix
 * to contains — correct, rather than a tokenizer we would have to be right about.
 */
import {SYSTEMS, type Atlas, type SystemId} from '../anatomy.ts';
import {searchEntries, systemEntries, type Dicts, type SearchKey} from '../i18n/dict.ts';

export type Lane = 'system' | 'concept' | 'part';
/**
 * SYSTEMS FIRST, and it is a judgement recorded rather than an accident of object order: a system is
 * a coarser thing than a structure, there are only fifteen of them, and a query that names one
 * ("muscular", "肌肉") almost certainly means the system rather than a structure whose name contains
 * the word. Concepts before parts for the same reason — a concept is the named structure, a part is
 * one mesh of it.
 */
const KIND_ORDER: Record<Lane, number> = {system: 0, concept: 1, part: 2};
/**
 * THE DRAWN ORDER, EXPORTED, so the renderer cannot disagree with the matcher about it. After H3
 * this is load-bearing rather than cosmetic: `all` is concatenated in exactly this order and the
 * palette renders its groups in exactly this order, and the arrow keys index into `all`. Three
 * copies of one list is how they drifted the first time.
 */
export const LANE_ORDER: readonly Lane[] = ['system', 'concept', 'part'];

export interface Hit {
 lane: Lane;
 id: string;
 /** The English name, always — the row needs it whatever the interface language is. */
 en: string;
 /** For a part, the concept it belongs to; for a concept or system, null. Shown as the row's origin
  *  so two parts with similar names are distinguishable. */
 parent: string | null;
 system: SystemId | null;
 rank: number;
 /**
  * THE SPELLING THAT MATCHED, and the script it is written in — null when the match was on the
  * English name or the id, because then there is nothing extra to show. This is the whole reason
  * `searchEntries` exists: without it an English interface shows an English row for a Chinese query
  * and the reader cannot see why it is there.
  */
 matched: SearchKey | null;
}

export interface LaneResult {hits: Hit[]; total: number; matched: number}
export interface Results {
 system: LaneResult; concept: LaneResult; part: LaneResult;
 /** Every lane's hits, already in final order. The list the palette renders. */
 all: Hit[];
 /** True when at least one lane had more matches than `CAP` and the list is therefore partial. The
  *  palette SAYS so. A cap nobody is told about reads as "that is all there is". */
 capped: boolean;
}

/** Per lane. Enough that scrolling is the rare case, small enough that the list stays a list. */
export const CAP = 50;

/** Lowercase and collapse whitespace. Deliberately NOT stripping punctuation or accents: the atlas
 *  is English + Chinese, and a stripper tuned for neither would only add ways to be wrong. */
export const norm = (s: string): string => s.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * The rank of ONE key against the query, or null when it does not match at all.
 * Exported for the unit test — the tiers are the specification, so they are asserted directly.
 */
export function rankKey(key: string, q: string): number | null {
 if (!q) return null;
 if (key === q) return 0;
 if (key.startsWith(q)) return 1;
 // Token: the query begins a word. `\b` is useless here (it is ASCII-only and CJK has no word
 // boundaries), so the delimiters are named.
 for (const sep of [' ', '-', '(', ',', '/']) {
  if (key.includes(sep + q)) return 2;
 }
 return key.includes(q) ? 3 : null;
}

/** The best rank across every spelling, and WHICH spelling achieved it. A structure that matches on
 *  both its English and its Chinese name shows the Chinese, because that is the one the reader
 *  cannot otherwise see. */
function best(entries: SearchKey[], q: string): {rank: number; matched: SearchKey | null} | null {
 let rank: number | null = null, matched: SearchKey | null = null;
 for (const e of entries) {
  const r = rankKey(e.k, q);
  if (r === null) continue;
  // `<` not `<=`: the FIRST entry to achieve a rank wins, and `searchEntries` puts English and the
  // id first — so a tie between an English and a Chinese spelling shows the English. It is the
  // STRICT improvement that promotes the Chinese, which is the case that matters: a query the
  // English name does not match as well.
  if (rank === null || r < rank) { rank = r; matched = e.script === 'en' || e.script === 'id' ? null : e; }
 }
 return rank === null ? null : {rank, matched};
}

const order = (a: Hit, b: Hit): number =>
 a.rank - b.rank || KIND_ORDER[a.lane] - KIND_ORDER[b.lane] || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * ── A CONCEPT'S SYSTEMS COME FROM `elements`, NOT FROM `parts[].conceptId` ──────────────────────
 *
 * ⚠️ THIS WAS A HIGH (stand-in review S2 r1, H2), and the executed counterexample is worth keeping:
 * in the real atlas **1,773 of 3,432 concepts are never any part's `conceptId`**. They own their
 * meshes through `Concept.elements`, which the first version of this file never read — so under a
 * scope every one of them vanished from the results AND from the denominator. Scoping to Arteries
 * reported `423` where the truth is `875`, and the concept literally named "artery" (`FMA50720`,
 * an exact match, rank 0, the row Enter commits) disappeared from its own system.
 *
 * The app's own resolver had it right all along — `dominantSystem(parts, c.elements)` in
 * `app/selection.ts:23`. This file disagreed with it, which is the tell: two vocabularies for one
 * fact, and the newer one wrong.
 *
 * A concept may span SEVERAL systems (an anastomosis is arterial and venous), so membership is a
 * SET and `inScope` is a membership test rather than an equality. `dominant` is kept separately for
 * the row's colour dot, where one answer is wanted.
 *
 * MEMOISED PER ATLAS. Walking 3,432 concepts' elements on every keystroke is work proportional to
 * the whole manifest; the `WeakMap` makes it once per atlas and lets it be collected with one.
 */
interface AtlasIndex {
 partSystem: Map<string, SystemId>;
 conceptSystems: Map<string, Set<SystemId>>;
 conceptDominant: Map<string, SystemId | null>;
 conceptName: Map<string, string>;
}
const INDEX = new WeakMap<Atlas, AtlasIndex>();
function indexOf(atlas: Atlas): AtlasIndex {
 const cached = INDEX.get(atlas);
 if (cached) return cached;
 const partSystem = new Map<string, SystemId>();
 for (const p of atlas.parts) partSystem.set(p.id, p.system);
 const conceptSystems = new Map<string, Set<SystemId>>();
 const conceptDominant = new Map<string, SystemId | null>();
 const conceptName = new Map<string, string>();
 for (const c of atlas.concepts) {
  conceptName.set(c.id, c.name);
  const tally = new Map<SystemId, number>();
  for (const e of c.elements) {
   const s = partSystem.get(e);
   if (s) tally.set(s, (tally.get(s) ?? 0) + 1);
  }
  conceptSystems.set(c.id, new Set(tally.keys()));
  // Same rule as `dominantSystem`: the most-represented system wins, null when nothing resolved.
  let best = 0, dom: SystemId | null = null;
  for (const [s, n] of tally) if (n > best) { best = n; dom = s; }
  conceptDominant.set(c.id, dom);
 }
 // BELT AND BRACES: a concept whose `elements` resolved to nothing still inherits any part that
 // names it as its `conceptId`. This is the ONLY thing the old code did, kept as the fallback it
 // always should have been rather than as the whole rule.
 for (const p of atlas.parts) {
  const set = conceptSystems.get(p.conceptId);
  if (set && set.size === 0) { set.add(p.system); conceptDominant.set(p.conceptId, p.system); }
 }
 const idx = {partSystem, conceptSystems, conceptDominant, conceptName};
 INDEX.set(atlas, idx);
 return idx;
}

/**
 * Search every lane. `atlas` may be null (the palette is openable before the manifest lands), in
 * which case the structure lanes are empty and their denominators are zero — the footer then reads
 * "0 of 0", which is true, rather than a fixed 3,432 the app cannot currently search.
 */
export function search(atlas: Atlas | null, dicts: Dicts, query: string, scope: SystemId | null = null): Results {
 const q = norm(query);
 const concepts = atlas?.concepts ?? [];
 const parts = atlas?.parts ?? [];
 const idx: AtlasIndex = atlas
  ? indexOf(atlas)
  : {partSystem: new Map(), conceptSystems: new Map(), conceptDominant: new Map(), conceptName: new Map()};

 // THE SCOPE NARROWS THE POPULATION, NOT JUST THE LIST. When the reader has scoped to a system, the
 // denominator is that system's count — otherwise the footer would report a fraction of a
 // population the palette is no longer searching, which is precisely the defect
 // `feedback-a-rate-needs-its-denominator-named` is about.
 const conceptPop = scope ? concepts.filter((c) => idx.conceptSystems.get(c.id)?.has(scope)) : concepts;
 const partPop = scope ? parts.filter((p) => p.system === scope) : parts;
 // A scope is a system, so the system lane is the scoped system alone once one is chosen.
 const systemPop = scope ? SYSTEMS.filter((s) => s.id === scope) : SYSTEMS;

 const lane = <T>(pop: T[], toHit: (x: T) => Hit | null): LaneResult => {
  const hits: Hit[] = [];
  for (const x of pop) { const h = toHit(x); if (h) hits.push(h); }
  hits.sort(order);
  return {hits: hits.slice(0, CAP), total: pop.length, matched: hits.length};
 };

 const system = lane(systemPop, (s) => {
  const b = best(systemEntries(s.id, s.name, dicts), q);
  return b && {lane: 'system' as const, id: s.id, en: s.name, parent: null, system: s.id, ...b};
 });
 const concept = lane(conceptPop, (c) => {
  const b = best(searchEntries(c.id, c.name, dicts), q);
  return b && {lane: 'concept' as const, id: c.id, en: c.name, parent: null, system: idx.conceptDominant.get(c.id) ?? null, ...b};
 });
 const part = lane(partPop, (p) => {
  const b = best(searchEntries(p.id, p.name, dicts), q);
  return b && {lane: 'part' as const, id: p.id, en: p.name, parent: idx.conceptName.get(p.conceptId) ?? null, system: idx.partSystem.get(p.id) ?? null, ...b};
 });

 return {
  system, concept, part,
  /**
   * ⚠️ `all` IS IN RENDER ORDER — LANE BY LANE — AND THAT IS THE FIX FOR A HIGH.
   *
   * It used to be the three lanes concatenated and then re-sorted by `order`, i.e. RANK-first. The
   * palette renders GROUPED BY LANE, so the keyboard walked one order while the eye read another:
   * with the query "inferior" over the real atlas, one ArrowDown moved the highlight 29 screen rows,
   * and after 77 presses it sat ABOVE where it had been at press 47. `Enter` commits `rows[at]`, so
   * the row that committed was not reliably the row highlighted — measured in a real browser
   * (stand-in review S2 r1, H3: 75 of 169 sampled queries disagreed).
   *
   * Concatenating the already-rank-sorted lanes in the order they are DRAWN makes the two orders the
   * same object rather than two things that have to be kept in step. `KIND_ORDER` still decides that
   * drawn order, so nothing about the intent changed — only where it is applied.
   */
  all: LANE_ORDER.flatMap((l) => (l === 'system' ? system.hits : l === 'concept' ? concept.hits : part.hits)),
  capped: system.matched > CAP || concept.matched > CAP || part.matched > CAP,
 };
}
