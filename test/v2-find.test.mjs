/**
 * THE FIND PALETTE'S PURE CONTRACTS. L31 v2.1b+c, S2.
 *
 * The ranking, the three denominators and the per-lane dictionary retry are statements about VALUES,
 * and every defect they are written against is invisible in a screenshot: a matcher that returns the
 * right rows in the wrong order looks identical to one that does not, and a lane that failed to load
 * looks exactly like a query with no matches. So they are asserted here as arithmetic, and only the
 * rendered palette — focus, the request budget, the IME — goes to `scripts/verify-ux.mjs`.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, readFileSync} from 'node:fs';
import {CAP, LANE_ORDER, norm, rankKey, search} from '../app/v2/find.ts';
import {searchEntries, systemEntries} from '../app/i18n/dict.ts';
import {CAMERA_CMDS, HOLD_CODES, KEY_MAP, findChord} from '../app/v2/shell/keys.ts';

/** A miniature atlas. Real ids and real names, because the ranking tiers are about the shape of
 *  anatomical names ("Body of sternum" must beat a name that merely contains "sternum"). */
const ATLAS = {
  version: 't', triangles: 0, chunks: [],
  concepts: [
    {id: 'FMA7485', name: 'Sternum', elements: ['p1']},
    {id: 'FMA7487', name: 'Body of sternum', elements: ['p2']},
    {id: 'FMA7488', name: 'Manubrium of sternum', elements: ['p3']},
    {id: 'FMA22538', name: 'Gluteus maximus', elements: ['p4']},
    {id: 'FMA9611', name: 'Heart', elements: ['p5']},
    /**
     * ⚠️ THE POPULATION THE OLD FIXTURE COULD NOT MODEL — and therefore the defect it could not
     * catch (stand-in review S2 r1, H2 / M4).
     *
     * Every other concept above is the `conceptId` of exactly one part, so a matcher that derived a
     * concept's system from `parts[].conceptId` passed the scope test perfectly. In the REAL atlas
     * **1,773 of 3,432 concepts are not any part's `conceptId`** — they own their meshes only
     * through `elements`, and all 1,773 silently vanished from scoped results AND from the scoped
     * denominator. The fixture asserted the right claim over the one population that could not
     * exhibit it.
     *
     * `p4` belongs to `FMA22538` by `conceptId`, so this concept reaches the muscular system ONLY
     * through its `elements` — exactly the shape that was broken.
     */
    {id: 'FMA-ELEM-ONLY', name: 'Gluteal region', elements: ['p4']},
  ],
  parts: [
    {id: 'p1', name: 'Sternum mesh', conceptId: 'FMA7485', system: 'skeletal', chunk: 0, positions: 0, normals: 0, indices: 0, vertexCount: 0, indexCount: 0, bounds: [[0, 0, 0], [1, 1, 1]]},
    {id: 'p2', name: 'Body of sternum mesh', conceptId: 'FMA7487', system: 'skeletal', chunk: 0, positions: 0, normals: 0, indices: 0, vertexCount: 0, indexCount: 0, bounds: [[0, 0, 0], [1, 1, 1]]},
    {id: 'p3', name: 'Manubrium mesh', conceptId: 'FMA7488', system: 'skeletal', chunk: 0, positions: 0, normals: 0, indices: 0, vertexCount: 0, indexCount: 0, bounds: [[0, 0, 0], [1, 1, 1]]},
    {id: 'p4', name: 'Gluteus maximus mesh', conceptId: 'FMA22538', system: 'muscular', chunk: 0, positions: 0, normals: 0, indices: 0, vertexCount: 0, indexCount: 0, bounds: [[0, 0, 0], [1, 1, 1]]},
    {id: 'p5', name: 'Heart mesh', conceptId: 'FMA9611', system: 'cardiac', chunk: 0, positions: 0, normals: 0, indices: 0, vertexCount: 0, indexCount: 0, bounds: [[0, 0, 0], [1, 1, 1]]},
  ],
};

/** Both scripts, as the real dictionaries are shaped. */
const DICTS = {
  'zh-Hans': {
    version: 1, lang: 'zh-Hans', explanations: {}, ui: {},
    concepts: {FMA7485: '胸骨', FMA7487: '胸骨体', FMA7488: '胸骨柄', FMA22538: '臀大肌', FMA9611: '心脏'},
    parts: {},
    systems: {muscular: {name: '肌肉', description: ''}, skeletal: {name: '骨骼', description: ''}},
  },
  'zh-Hant': {
    version: 1, lang: 'zh-Hant', explanations: {}, ui: {},
    concepts: {FMA7485: '胸骨', FMA7487: '胸骨體', FMA7488: '胸骨柄', FMA22538: '臀大肌', FMA9611: '心臟'},
    parts: {},
    systems: {muscular: {name: '肌肉', description: ''}, skeletal: {name: '骨骼', description: ''}},
  },
};

// ── the rank tiers ──────────────────────────────────────────────────────────────────────────────

test('the rank tiers are exact > prefix > token > contains, and a non-match is null', () => {
  assert.equal(rankKey('sternum', 'sternum'), 0);
  assert.equal(rankKey('sternum mesh', 'sternum'), 1);
  // TOKEN: the query begins a WORD. This is the tier that puts "Body of sternum" above a name that
  // merely happens to contain the letters, and it is the reason a plain `includes` matcher ranks
  // anatomical names badly.
  assert.equal(rankKey('body of sternum', 'sternum'), 2);
  assert.equal(rankKey('presternumoid', 'sternum'), 3);
  assert.equal(rankKey('heart', 'sternum'), null);
  // An empty query matches NOTHING rather than everything — the palette shows recents there, and a
  // matcher that returned all 3,432 rows for "" would be 3,432 DOM nodes on every open.
  assert.equal(rankKey('anything', ''), null);
  // CJK has no delimiters, so a Chinese query falls straight from prefix to contains. That is
  // correct rather than a tokenizer we would have to be right about.
  assert.equal(rankKey('胸骨体', '胸骨'), 1);
  assert.equal(rankKey('左胸骨', '胸骨'), 3);
});

test('normalisation lowercases and collapses whitespace, and leaves scripts alone', () => {
  assert.equal(norm('  Body   OF  Sternum '), 'body of sternum');
  assert.equal(norm('胸骨體'), '胸骨體');
});

// ── the three populations ───────────────────────────────────────────────────────────────────────

test('every lane carries its OWN denominator, and they are never summed', () => {
  const r = search(ATLAS, DICTS, 'sternum');
  // 3 concepts match, out of 5 concepts. 3 parts match, out of 5 parts. No system is called
  // "sternum", out of 15 systems. Three fractions, three populations.
  assert.equal(r.concept.matched, 3);
  assert.equal(r.concept.total, ATLAS.concepts.length);
  // TWO parts, not three — `Manubrium mesh` does not contain the word, though its CONCEPT
  // (`Manubrium of sternum`) does. That asymmetry is deliberate in the fixture: it proves the lanes
  // are counted independently rather than one number being reported twice.
  assert.equal(r.part.matched, 2);
  assert.equal(r.part.total, ATLAS.parts.length);
  assert.equal(r.system.matched, 0);
  assert.equal(r.system.total, 15, 'the system population is SYSTEMS, not a slice of the atlas');
  // ⚠️ THE DEFECT THIS ROW EXISTS FOR. `spec.md`: never "16 of 3,432". A single merged denominator
  // would be the sum of three unrelated populations, and the footer would then describe a set the
  // palette never searched.
  assert.notEqual(r.concept.total, r.concept.total + r.part.total + r.system.total);
});

test('the SYSTEM lane matches on the system dictionary, which searchEntries cannot see', () => {
  // The bug this prevents: systems live in `dict.systems[id].name`, NOT in `concepts`/`parts`. A
  // system folded into the structure matcher matches only its English name and its id, so 肌肉
  // finds nothing — silently, because "no results" is a legal answer.
  assert.equal(searchEntries('muscular', 'Muscles', DICTS).some((e) => e.k === '肌肉'), false);
  assert.equal(systemEntries('muscular', 'Muscles', DICTS).some((e) => e.k === '肌肉'), true);
  const r = search(ATLAS, DICTS, '肌肉');
  assert.equal(r.system.matched, 1);
  assert.equal(r.system.hits[0].id, 'muscular');
});

// ── cross-script, which is the feature ──────────────────────────────────────────────────────────

test('a Chinese query matches in an ENGLISH interface, and reports which spelling it hit', () => {
  // The kickoff's oracle, as arithmetic: in EN, 胸骨 returns >= 1 AND the row can render 胸骨体.
  const r = search(ATLAS, DICTS, '胸骨');
  assert.ok(r.concept.matched >= 1, `${r.concept.matched} concept matches for 胸骨`);
  const body = r.all.find((h) => h.id === 'FMA7487');
  assert.ok(body, 'Body of sternum is among the matches');
  // WITHOUT `matched`, the palette shows an English row for a Chinese query and the reader cannot
  // see why it is there. This is the accessor `alt` was added for in v2.1a.
  assert.ok(body.matched, 'the hit records the spelling that matched');
  assert.equal(body.matched.k, '胸骨体');
  assert.ok(body.matched.script === 'zh-Hans' || body.matched.script === 'zh-Hant');
  // Exact beats prefix: 胸骨 IS the Sternum's Chinese name, so the Sternum ranks first.
  assert.equal(r.all[0].id, 'FMA7485');
});

test('an English query matches in a CHINESE interface — the matcher is language-independent', () => {
  const r = search(ATLAS, DICTS, 'gluteus');
  assert.ok(r.concept.matched >= 1);
  assert.equal(r.concept.hits[0].id, 'FMA22538');
  // Matched on the ENGLISH name, so there is no extra spelling to show: the Chinese is already the
  // row's display name in a Chinese interface, and `secondary` supplies the English pair.
  assert.equal(r.concept.hits[0].matched, null);
});

// ── stability, which is what makes Enter predictable ────────────────────────────────────────────

test('ties break on kind then id, so the first row — the one Enter commits — is deterministic', () => {
  const a = search(ATLAS, DICTS, 'sternum').all.map((h) => `${h.lane}:${h.id}`);
  // Same query, a dictionary map built in a different key order: the RESULT ORDER must not move.
  const reordered = {'zh-Hant': DICTS['zh-Hant'], 'zh-Hans': DICTS['zh-Hans']};
  const b = search(ATLAS, reordered, 'sternum').all.map((h) => `${h.lane}:${h.id}`);
  assert.deepEqual(a, b);
  /**
   * ⚠️ `all` IS IN RENDER ORDER, LANE BY LANE — NOT GLOBAL RANK ORDER, and that is the H3 fix.
   *
   * The palette draws its results GROUPED by lane while `rows = res.all` drives the arrow keys, so
   * the two orders have to be the same object or the highlight walks a list nobody can see. (A real
   * browser measured one ArrowDown moving the highlight 29 screen rows.) So the invariant asserted
   * here is the one the product actually needs: `all` is exactly the lanes concatenated in
   * LANE_ORDER, and rank is non-decreasing WITHIN each lane.
   */
  const r = search(ATLAS, DICTS, 'sternum');
  const expected = LANE_ORDER.flatMap((l) => r[l].hits);
  assert.deepEqual(r.all.map((h) => `${h.lane}:${h.id}`), expected.map((h) => `${h.lane}:${h.id}`),
    'all === the lanes concatenated in LANE_ORDER');
  for (const l of LANE_ORDER) {
    const hits = r[l].hits;
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1].rank <= hits[i].rank, `${l}: ranks are non-decreasing within the lane`);
    }
  }
});

test('a scope narrows the POPULATION, not just the list', () => {
  const all = search(ATLAS, DICTS, '', null);
  const scoped = search(ATLAS, DICTS, 'sternum', 'muscular');
  // The denominators MOVE with the scope. A footer that kept reporting "of 3,432" while searching
  // one system would describe a population the palette is no longer looking at — the
  // named-denominator discipline, in the one place a reader would never check it.
  //
  // TWO muscular concepts: `Gluteus maximus` (reached by `parts[].conceptId`) and `Gluteal region`
  // (reached ONLY through `elements`). The second is the one the old implementation dropped.
  assert.equal(scoped.concept.total, 2, 'both muscular concepts are in the scoped population');
  assert.equal(scoped.part.total, 1);
  assert.equal(scoped.system.total, 1, 'a scope is a system, so the system lane is that system');
  assert.notEqual(scoped.concept.total, all.concept.total);
  // And "sternum" is not in the muscular system, so the scoped search finds nothing.
  assert.equal(scoped.concept.matched, 0);
});

test('a concept reachable ONLY through `elements` survives its own system scope', () => {
  // ⚠️ THE DIRECT FORM OF H2. Unscoped, `Gluteal region` is found; scoped to the very system its
  // meshes belong to, it must still be found — and must still be COUNTED. The old matcher dropped
  // it from both, so narrowing to a system could delete an exact match from that system.
  const unscoped = search(ATLAS, DICTS, 'gluteal');
  assert.ok(unscoped.concept.hits.some((h) => h.id === 'FMA-ELEM-ONLY'), 'found unscoped');
  const scoped = search(ATLAS, DICTS, 'gluteal', 'muscular');
  assert.ok(scoped.concept.hits.some((h) => h.id === 'FMA-ELEM-ONLY'),
    'an elements-only concept survives a scope to its own system');
  // And the colour dot: `system` came back null for all 1,773 of these even unscoped.
  assert.equal(unscoped.concept.hits.find((h) => h.id === 'FMA-ELEM-ONLY').system, 'muscular');
});

test('the REAL atlas, if it is built: scoping to Arteries keeps the concept named "artery"', () => {
  // ⚠️ A FIXTURE CAN ONLY EXHIBIT WHAT ITS AUTHOR THOUGHT OF. H2 was found against the real
  // manifest, so the real manifest is what guards it — when it is present. `dist/` is a build
  // artefact, so the test SKIPS rather than fails when it is absent, and says which.
  const file = ['dist/models/atlas.json', 'public/models/atlas.json'].find((f) => existsSync(f));
  if (!file) { assert.ok(true, 'atlas.json not built — skipped'); return; }
  const atlas = JSON.parse(readFileSync(file, 'utf8'));
  const scoped = search(atlas, {}, 'artery', 'arterial');
  assert.ok(scoped.concept.hits.some((h) => h.id === 'FMA50720'),
    'FMA50720 "artery" — an exact match, rank 0, the row Enter commits — survives the Arteries scope');
  // The denominator is the TRUE membership count, computed here independently of find.ts.
  const partSystem = new Map(atlas.parts.map((p) => [p.id, p.system]));
  const truth = atlas.concepts.filter((c) => c.elements.some((e) => partSystem.get(e) === 'arterial')).length;
  assert.equal(scoped.concept.total, truth,
    `scoped denominator must equal the true arterial-concept count (${truth})`);
  assert.ok(truth > 800, `sanity: the arterial population is large (${truth})`);
});

test('a missing atlas gives empty lanes and ZERO denominators, not the copy table\'s numbers', () => {
  const r = search(null, {}, 'heart');
  assert.equal(r.concept.total, 0);
  assert.equal(r.part.total, 0);
  assert.equal(r.concept.matched, 0);
  // The system lane does NOT depend on the atlas — SYSTEMS is a module constant — so it still works
  // before the manifest lands, and "Heart" IS a system. Saying "0 of 0" for the structures is true;
  // saying "0 of 3,432" would claim the app had searched a population it had not loaded.
  assert.equal(r.system.total, 15);
  assert.equal(r.all.length, 1);
  assert.equal(r.all[0].id, 'cardiac');
});

test('a lane that overflows the cap SAYS so rather than truncating silently', () => {
  const many = {
    ...ATLAS,
    concepts: Array.from({length: CAP + 7}, (_, i) => ({id: `X${i}`, name: `Sternum variant ${i}`, elements: []})),
  };
  const r = search(many, {}, 'sternum');
  assert.equal(r.concept.matched, CAP + 7, 'the MATCH count is the true count, not the shown count');
  assert.equal(r.concept.hits.length, CAP, 'the shown list is capped');
  assert.equal(r.capped, true, 'and the palette is told, so the footer can say it');
});

// ── RC9: the dictionaries load PER LANE ─────────────────────────────────────────────────────────

test('a lane that 500s is retried on the next open, and the loaded lane is NOT refetched', async () => {
  /**
   * ⚠️ RED-PROVED AGAINST THE PRE-S2 CODE (evidence: `.artifacts/L31/v21bc/s2/rc9-red-proof.txt`).
   *
   * The old `loadZhDicts` memoised the PAIR — one `inflight` promise, cleared only when BOTH lanes
   * failed. So a PARTIAL failure, which is the ordinary shape of a CDN hiccup because the two
   * dictionaries are two separate requests, was cached as SUCCESS for the life of the page. 繁體
   * search then stayed silently broken until a reload, and the palette could not tell the reader
   * the difference between "that lane failed" and "your query has no matches".
   *
   * Run against git 6d7782e the assertions below read `hant attempts = 1` and the second open
   * returns `{zh-Hans}`; against this file's implementation, `hant = 2` and `{zh-Hans, zh-Hant}`.
   */
  let hant = 0, hans = 0;
  const body = (lang) => ({version: 1, lang, concepts: {FMA7487: '胸骨体'}, parts: {}, systems: {}, explanations: {}, ui: {ok: '1'}});
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (path) => {
    const isHant = String(path).includes('zh-Hant');
    if (isHant) hant++; else hans++;
    // The FIRST zh-Hant attempt fails; everything else succeeds.
    if (isHant && hant === 1) return {ok: false, status: 500, headers: {get: () => 'text/html'}, json: async () => ({})};
    return {ok: true, status: 200, headers: {get: () => 'application/json'}, json: async () => body(isHant ? 'zh-Hant' : 'zh-Hans')};
  };
  try {
    // A FRESH MODULE INSTANCE. `loaded`/`inflight` are module state, and the assertions above
    // already imported `dict.ts` — without the cache-buster this test would read another test's
    // dictionaries and assert nothing.
    const {loadZhDicts, loadedLanes, zhPartial} = await import('../app/i18n/dict.ts?rc9');

    const first = await loadZhDicts();          // the first palette open
    assert.ok(first['zh-Hans'], 'the lane that succeeded is loaded');
    assert.equal(first['zh-Hant'], undefined, 'the lane that 500d is ABSENT, not an empty dictionary');
    assert.equal(zhPartial(), true, 'and the palette can see that it is partial, so it can say so');
    assert.deepEqual(loadedLanes(), ['zh-Hans']);

    const second = await loadZhDicts();         // reopening the palette
    assert.ok(second['zh-Hant'], 'THE RETRY: the missing lane is fetched again on the next open');
    assert.equal(hant, 2, 'zh-Hant attempted exactly twice');
    // A retry that re-downloaded the GOOD lane too would double the request budget on every open,
    // which RC10's rows would then have to absorb as an unexplained increase.
    assert.equal(hans, 1, 'zh-Hans fetched once and reused');
    assert.equal(zhPartial(), false, 'and the palette stops warning once both lanes are in');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── the dispatcher seam ─────────────────────────────────────────────────────────────────────────

test('Ctrl/Cmd+K is the one chord allowed inside an editor, and bare / is not', () => {
  // `findChord` is what the editor guard consults. Widening that exception to the COMMAND would let
  // `/` through as well — and `/` inside the Ask box is a slash the reader is trying to type.
  assert.equal(findChord({ctrlKey: true, metaKey: false, altKey: false, code: 'KeyK'}), true);
  assert.equal(findChord({ctrlKey: false, metaKey: true, altKey: false, code: 'KeyK'}), true);
  // AltGr on Windows arrives as Ctrl+Alt. It belongs to the layout, not to us.
  assert.equal(findChord({ctrlKey: true, metaKey: false, altKey: true, code: 'KeyK'}), false);
  assert.equal(findChord({ctrlKey: false, metaKey: false, altKey: false, code: 'KeyK'}), false);
  assert.equal(findChord({ctrlKey: true, metaKey: false, altKey: false, code: 'Slash'}), false);
});

test('the key map marks Find as LIVE at every tier, and guard 7 does not withhold it', () => {
  for (const k of ['Ctrl K / ⌘K', '/']) {
    const row = KEY_MAP.find((r) => r.keys === k);
    assert.ok(row, `${k} is in the map`);
    assert.equal(row.owner, undefined, `${k} is no longer marked forthcoming`);
    // ⚠️ NOT studio-only. Find has a real surface below 1180 (the A4 sheet), so marking it would
    // repeat round 2's High — a key advertised as desktop-only that works on the phone — on a new
    // command. The row declares `binds` so the correspondence test in v2-shell can see it.
    assert.equal(row.studioOnly, undefined, `${k} works at every tier`);
    assert.deepEqual(row.binds, ['find']);
  }
  assert.equal(CAMERA_CMDS.has('find'), false, 'find is not a camera command');
  assert.equal(HOLD_CODES.includes('KeyK'), false, 'K is not a held key');
});

test('exactly four key-map rows are still forthcoming after S3 binds the tree', () => {
  // The arithmetic, carried forward one group: 21 rows, 2 live at S0 (Esc, ?), 10 bound by S1, 2 by
  // S2, 3 by S3 (the tree's arrows, Space, and the new `V`) => 4 still owned by S4/S5/S6. The oracle
  // asserts the same number against the RENDERED overlay; this asserts it against the DATA, so a row
  // added without an owner cannot drift the two apart silently — and it is exactly the row that went
  // red when S3 wired the tree, which is the point of having it.
  //
  // ⚠️ 20 -> 21 IS AN ADDITION, NOT A RETUNE: the tree's eye had no keyboard path at all (codex
  // round 3, Medium 3), so `V` was bound and had to be advertised in the map.
  const forthcoming = KEY_MAP.filter((r) => r.owner);
  assert.equal(KEY_MAP.length, 21);
  assert.equal(forthcoming.length, 4, forthcoming.map((r) => `${r.keys}=${r.owner}`).join(' '));
  assert.deepEqual([...new Set(forthcoming.map((r) => r.owner))].sort(), ['S4', 'S5', 'S6']);
  // And the three S3 bound are present and UNOWNED — a row whose owner survived its wiring would
  // tell the reader a live key is still a promise.
  for (const keys of ['↑ ↓ ← →', 'Space', 'V']) {
    const row = KEY_MAP.find((r) => r.keys === keys);
    assert.ok(row, `the map lists ${keys}`);
    assert.equal(row.owner, undefined, `${keys} is no longer marked forthcoming`);
  }
});
