/**
 * THE STUDIO SHELL'S PURE CONTRACTS. L31 v2.1b+c, S0.
 *
 * The tiers, the 420 px collapse ladder, the third-dock eviction rule and the whole localStorage
 * schema are statements about VALUES, so they are assertable without a browser — which is the only
 * reason they were written as pure functions in the first place. The GEOMETRY those values produce
 * is asserted in `scripts/verify-ux.mjs` against a rendered page, because a computed
 * `grid-template-areas` is the one thing a unit test genuinely cannot see.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isStudio, ladder, openDock, tierOf} from '../app/v2/shell/layout.ts';
import {
  DOCK_W, FIELD_MIN, SIDE_DEFAULT, SIDE_MAX, SIDE_MIN, SIDE_STUB,
  defaultDocks, effectiveDocks, maskKey, readDocks, readOpenAi, readPinyin, readScenes,
} from '../app/v2/shell/store.ts';
import {CAMERA_CMDS, HOLD, HOLD_CODES, KEY_MAP} from '../app/v2/shell/keys.ts';

// ── tiers ───────────────────────────────────────────────────────────────────────────────────────

test('the boundaries are 768 / 1180 / 1600, and 1180 is not 1200', () => {
  assert.equal(tierOf(767, 900, false), 'phone');
  assert.equal(tierOf(768, 1024, true), 'tablet');
  // THE ONE THE ORACLE CANNOT SEE FROM 240 px AWAY. `v2.css:265` says 1200 today; the studio starts
  // at 1180 (codex-plan-review.md §A.6), so these two lines are the boundary itself.
  assert.equal(tierOf(1179, 900, false), 'tablet');
  assert.equal(tierOf(1180, 900, false), 'studio');
  assert.equal(tierOf(1599, 900, false), 'studio');
  assert.equal(tierOf(1600, 900, false), 'studio-wide');
  assert.equal(isStudio(tierOf(1179, 900, false)), false);
  assert.equal(isStudio(tierOf(1180, 900, false)), true);
});

test('a rotated phone is COMPACT, not tablet — height decides, not width', () => {
  // 390x844 rotated is 844x390: it matches min-width:768 and would otherwise take the tablet's
  // 340 px margin across 40% of the screen (v2.css:271).
  assert.equal(tierOf(844, 390, true), 'compact');
  assert.equal(tierOf(1024, 520, true), 'compact', 'the boundary is inclusive');
  assert.equal(tierOf(1024, 521, true), 'tablet');
  // A FINE pointer at the same size is a small window, not a rotated phone.
  assert.equal(tierOf(844, 390, false), 'tablet');
  assert.equal(isStudio('compact'), false);
});

// ── the 420 px field floor ──────────────────────────────────────────────────────────────────────

test('a comfortable window keeps everything open and the field is the remainder', () => {
  const l = ladder({width: 1440, side: SIDE_DEFAULT, sideCollapsed: false, open: ['selection']});
  assert.equal(l.sideW, 264);
  assert.equal(l.dockW, 320);
  assert.equal(l.field, 856, '1440 - 264 - 320, which is the mock D1 field exactly');
  assert.equal(l.autoCollapsed, false);
  assert.deepEqual(l.steps, []);
});

test('two docks at 1920 is the wide default, and it fits', () => {
  const l = ladder({width: 1920, side: SIDE_DEFAULT, sideCollapsed: false, open: defaultDocks(true)});
  assert.deepEqual(l.open, ['selection', 'info']);
  assert.equal(l.dockW, DOCK_W.selection + DOCK_W.info);
  assert.equal(l.field, 1036, 'mock D2');
  assert.equal(l.autoCollapsed, false);
});

test("the ladder reproduces spec.md's own worked example, in its order", () => {
  // "At 1180 with side 420 + two docks 780, the field would be -20; remove the last 420 dock -> 400;
  //  remove remaining 360 -> 760 (side need not collapse)."
  const l = ladder({
    width: 1180, side: 420, sideCollapsed: false,
    open: ['info', 'selection'], widths: {info: 360, selection: 420},
  });
  assert.equal(l.field, 760);
  assert.deepEqual(l.open, [], 'both docks closed');
  assert.equal(l.sideW, 420, 'and the SIDEBAR never collapses — the field is already over 420');
  assert.deepEqual(l.steps, ['closed selection (420px)', 'closed info (360px)'],
    'last-opened first, and each step named');
  assert.equal(l.autoCollapsed, true);
});

test('the sidebar collapses only AFTER every dock is closed, and only if still short', () => {
  // The ladder is width-agnostic on purpose, so the rule can be asserted at the width where it
  // actually bites rather than only where the studio tier is reachable.
  //
  // THE ORDER IS THE CLAIM. At 700 the dock alone is enough — 700-264 = 436 is over the floor, so
  // the sidebar must NOT collapse. (The first version of this test asserted a collapse here and was
  // WRONG; the code was right. Both cases are kept, because "it collapsed" and "it collapsed only
  // when it had to" are different assertions and only the pair pins the order.)
  const enough = ladder({width: 700, side: 264, sideCollapsed: false, open: ['selection']});
  assert.deepEqual(enough.open, []);
  assert.equal(enough.sideW, 264, 'one step was enough; the sidebar is untouched');
  assert.equal(enough.field, 436);
  assert.deepEqual(enough.steps, ['closed selection (320px)']);

  const l = ladder({width: 640, side: 264, sideCollapsed: false, open: ['selection']});
  assert.deepEqual(l.open, []);
  assert.equal(l.sideW, SIDE_STUB, '640-264 = 376 is still short, so now it collapses');
  assert.equal(l.field, 640 - SIDE_STUB);
  assert.deepEqual(l.steps, ['closed selection (320px)', `collapsed the sidebar to its ${SIDE_STUB}px stub`]);
});

test('an out-of-range persisted width is CLAMPED before any decision is taken on it', () => {
  // spec.md: "With a single 780 invalid persisted dock, clamp to its allowed width before this
  // ladder." The same rule for the sidebar: evicting a panel because of a number that was never
  // legal would be the ladder acting on corrupt input.
  const wide = ladder({width: 1440, side: 780, sideCollapsed: false, open: ['selection']});
  assert.equal(wide.sideW, SIDE_MAX);
  assert.equal(wide.steps[0], `clamped sidebar 780 -> ${SIDE_MAX}`);
  assert.equal(wide.autoCollapsed, false, 'a clamp is not an auto-collapse and must not announce as one');
  const narrow = ladder({width: 1440, side: 10, sideCollapsed: false, open: ['selection']});
  assert.equal(narrow.sideW, SIDE_MIN);
  const broken = ladder({width: 1440, side: NaN, sideCollapsed: false, open: ['selection']});
  assert.ok(Number.isFinite(broken.sideW), 'NaN must not propagate into a CSS length');
});

test('a manual collapse is not announced as an automatic one', () => {
  const l = ladder({width: 1440, side: 264, sideCollapsed: true, open: ['selection']});
  assert.equal(l.sideW, SIDE_STUB);
  assert.equal(l.autoCollapsed, false, 'D10 is the human collapsing it; status.autoCollapsed must stay silent');
  assert.equal(l.field, 1440 - SIDE_STUB - 320);
});

test('the field floor actually holds wherever it can', () => {
  for (let w = 1180; w <= 1920; w += 20) {
    const l = ladder({width: w, side: SIDE_MAX, sideCollapsed: false, open: ['selection', 'json'], widths: DOCK_W});
    assert.ok(l.field >= FIELD_MIN, `field ${l.field} at width ${w}`);
  }
});

// ── opening docks ───────────────────────────────────────────────────────────────────────────────

test('opening a third dock evicts the least recently focused, never a third column', () => {
  assert.deepEqual(openDock(['selection', 'info'], 'json'), ['info', 'json']);
  assert.deepEqual(openDock(['info', 'json'], 'ask'), ['json', 'ask']);
});
test('the same control closes an open dock', () => {
  assert.deepEqual(openDock(['selection', 'info'], 'info'), ['selection']);
  assert.deepEqual(openDock([], 'ask'), ['ask']);
});

// ── the localStorage schema ─────────────────────────────────────────────────────────────────────

/** A localStorage stand-in. `node --test` has no DOM; the readers only need getItem/setItem, and
 *  the THROWING case is the one that matters (Safari private browsing throws rather than
 *  returning null, which is why every access is wrapped). */
function withStorage(values, fn) {
  const prev = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (k in values ? values[k] : null),
    setItem: () => {},
    removeItem: () => {},
  };
  try { return fn(); } finally { globalThis.localStorage = prev; }
}

test('an ABSENT key returns the tier-appropriate defaults', () => {
  withStorage({}, () => {
    assert.deepEqual(effectiveDocks(readDocks(), false), ['selection']);
    assert.deepEqual(effectiveDocks(readDocks(), true), ['selection', 'info'], 'G2: two panels at >=1600');
    assert.equal(readDocks().side, SIDE_DEFAULT);
    assert.equal(readPinyin().on, false);
    assert.deepEqual(readScenes().tabs, []);
    assert.equal(readOpenAi(), null);
  });
});

test('a CORRUPT value in each of the four keys still yields a renderable shape', () => {
  // The S0 oracle is "a corrupt value in each key still renders the shell"; this is that claim at
  // the level where it can be exhaustive.
  const junk = ['', 'null', '[]', '{}', '"a string"', '{"v":99}', '{"v":1}', 'not json at all', '0'];
  for (const bad of junk) {
    withStorage({'atlas.dock': bad, 'atlas.pinyin': bad, 'atlas.scenes': bad, 'atlas.openai': bad}, () => {
      const d = readDocks();
      assert.ok(d.open === null || (Array.isArray(d.open) && d.open.length <= 2), bad);
      assert.ok(d.side >= SIDE_MIN && d.side <= SIDE_MAX, bad);
      assert.equal(typeof d.sideCollapsed, 'boolean', bad);
      assert.equal(typeof readPinyin().on, 'boolean', bad);
      assert.ok(Array.isArray(readScenes().tabs), bad);
      assert.doesNotThrow(() => readOpenAi(), bad);
    });
  }
});

test('localStorage THROWING (private browsing) is not an exception the shell sees', () => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = {getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); }, removeItem() { throw new Error('SecurityError'); }};
  try {
    assert.deepEqual(effectiveDocks(readDocks(), true), ['selection', 'info']);
    assert.equal(readPinyin().on, false);
    assert.deepEqual(readScenes().tabs, []);
    assert.equal(readOpenAi(), null);
  } finally { globalThis.localStorage = prev; }
});

test('a persisted dock set is validated, deduplicated, capped at two and unknown names dropped', () => {
  withStorage({'atlas.dock': JSON.stringify({v: 1, open: ['ask', 'ask', 'nope', 'json', 'info'], side: 300, sideCollapsed: true})}, () => {
    const d = readDocks();
    assert.deepEqual(d.open, ['ask', 'json'], 'deduped, unknown dropped, capped at 2 — never three columns');
    assert.equal(d.side, 300);
    assert.equal(d.sideCollapsed, true);
  });
});

test('a scene tab needs a blob, and a half-written camera pose is discarded rather than half-applied', () => {
  withStorage({'atlas.scenes': JSON.stringify({v: 1, tabs: [
    {blob: 'aaa', title: 'one', cam: [1, 2, 3, 4, 5, 6]},
    {blob: '', title: 'no blob', cam: null},
    {blob: 'bbb', cam: [1, 2, 3]},
    ...Array.from({length: 12}, (_, i) => ({blob: `x${i}`, title: '', cam: null})),
  ]})}, () => {
    const s = readScenes();
    assert.equal(s.tabs.length, 8, 'cap 8');
    assert.deepEqual(s.tabs[0].cam, [1, 2, 3, 4, 5, 6]);
    assert.equal(s.tabs[1].blob, 'bbb', 'the blobless tab is gone');
    assert.equal(s.tabs[1].cam, null, 'a three-number pose is not a pose');
  });
});

test('the OpenAI key is masked to its last four and never returned whole by the mask', () => {
  assert.equal(maskKey('sk-proj-abcdefgh1234'), 'sk-***…1234');
  assert.equal(maskKey('ab'), 'sk-***');
  assert.ok(!maskKey('sk-proj-abcdefgh1234').includes('abcdefgh'));
  withStorage({'atlas.openai': JSON.stringify({v: 1, key: 'sk-live-xyz', model: ''})}, () => {
    const k = readOpenAi();
    assert.equal(k.key, 'sk-live-xyz');
    assert.equal(k.model, '', 'an empty model is normalised, never undefined');
  });
});

// ── the S0 stand-in review, H1: the dock seed that closed a door ────────────────────────────────
// "open: null" means the human has never chosen; "open: []" means they closed everything. Collapsing
// the two is what made G2's two-panel default unreachable for anyone whose first visit was narrower.

test('an untouched profile follows the TIER, and a chosen one does not', () => {
  withStorage({}, () => {
    const fresh = readDocks();
    assert.equal(fresh.open, null, 'absent means never chosen, NOT the narrow default');
    assert.deepEqual(effectiveDocks(fresh, true), ['selection', 'info'], 'so >=1600 gets G2 two panels');
    assert.deepEqual(effectiveDocks(fresh, false), ['selection'], 'and below it, one');
  });
  // THE COUNTEREXAMPLE THE REVIEW EXECUTED: a human whose first visit was a phone or a 1440 window.
  // The old build had written the narrow default to disk on that visit, and every later wide visit
  // read it back as a choice.
  withStorage({'atlas.dock': JSON.stringify({v: 1, open: ['selection'], side: 264, sideCollapsed: false})}, () => {
    const chosen = readDocks();
    assert.deepEqual(chosen.open, ['selection'], 'an explicit choice IS honoured');
    assert.deepEqual(effectiveDocks(chosen, true), ['selection'], 'and it beats the tier default, as it should');
  });
});

test('a corrupt or absent open list stays "never chosen" rather than becoming a fake choice', () => {
  for (const bad of ['{"v":1}', '{"v":1,"open":"selection"}', '{"v":1,"open":null}', '{"v":1,"open":7}']) {
    withStorage({'atlas.dock': bad}, () => {
      assert.equal(readDocks().open, null, bad);
      assert.deepEqual(effectiveDocks(readDocks(), true), ['selection', 'info'], bad);
    });
  }
  // Closing everything is a real choice and must survive as one.
  withStorage({'atlas.dock': JSON.stringify({v: 1, open: [], side: 264, sideCollapsed: false})}, () => {
    assert.deepEqual(readDocks().open, [], 'an empty ARRAY is "I closed them all"');
    assert.deepEqual(effectiveDocks(readDocks(), true), [], 'which the tier must not override');
  });
});

test('the ladder at 1920 gives D2 its two docks on an untouched profile', () => {
  withStorage({}, () => {
    const l = ladder({width: 1920, side: SIDE_DEFAULT, sideCollapsed: false, open: effectiveDocks(readDocks(), true)});
    assert.equal(l.dockW, 620);
    assert.equal(l.field, 1036, 'mock D2 — the board the seed used to make unreachable');
  });
});

// ── S1: the key layer's pure contracts ──────────────────────────────────────────────────────────

test('every held code carries exactly one axis, and the map is the mock keyboard', () => {
  // L2 from the S1 stand-in review: the title said "exactly one axis" and nothing asserted it.
  for (const [code, axis] of Object.entries(HOLD)) {
    assert.equal(Object.keys(axis).length, 1, `${code} carries exactly one axis`);
  }
  // W A S D pan, arrows orbit/dolly, Q E tilt — mock/NOTES.md amendment 4, which is binding.
  assert.deepEqual(Object.keys(HOLD).sort(), HOLD_CODES.slice().sort());
  assert.deepEqual(HOLD.KeyW.pan, [0, 1]);
  assert.deepEqual(HOLD.KeyS.pan, [0, -1]);
  assert.deepEqual(HOLD.KeyA.pan, [-1, 0]);
  assert.deepEqual(HOLD.KeyD.pan, [1, 0]);
  // OPPOSITES MUST CANCEL. Holding A and D together has to leave the camera still; a typo in one
  // sign gives a pad that drifts whenever two keys are down, which is invisible one key at a time.
  for (const [a, b] of [['KeyW', 'KeyS'], ['KeyA', 'KeyD'], ['ArrowLeft', 'ArrowRight'], ['ArrowUp', 'ArrowDown'], ['KeyQ', 'KeyE']]) {
    const ax = HOLD[a], bx = HOLD[b];
    for (const k of ['pan', 'orbit']) {
      if (!ax[k]) continue;
      assert.deepEqual([ax[k][0] + bx[k][0], ax[k][1] + bx[k][1]], [0, 0], `${a} + ${b} (${k})`);
    }
    if (ax.dolly !== undefined) assert.equal(ax.dolly + bx.dolly, 0, `${a} + ${b} (dolly)`);
  }
  // PHYSICAL CODES ONLY. `event.key` changes with the layout and with Shift, so a held key matched
  // on `key` is never released when it is modified mid-hold — guard 6's whole reason.
  for (const c of HOLD_CODES) {
    assert.ok(/^(Key[A-Z]|Arrow(Up|Down|Left|Right))$/.test(c), `${c} is a physical code`);
  }
});

test('the key map lists every S1 binding and no key nobody bound', () => {
  const keys = KEY_MAP.map((r) => r.keys);
  for (const k of ['W A S D', '← →', '↑ ↓', 'Q E', 'O P', '1 2 3 4', 'F / Shift F', 'H', 'R', 'Shift P / Shift S']) {
    assert.ok(keys.includes(k), `${k} is in the map`);
    // NO OWNER means "this works today". `group` is what KIND of command it is and must stay
    // semantic — conflating the two emptied the Camera section (stand-in review S1 M1).
    assert.equal(KEY_MAP.find((r) => r.keys === k).owner, undefined, `${k} is no longer marked forthcoming`);
  }
  // AND NO GROUP IS EMPTY, which is the defect that conflation produced.
  for (const g of ['now', 'global', 'camera', 'tree']) {
    assert.ok(KEY_MAP.some((r) => r.group === g), `the ${g} section has rows`);
  }
  // `+ −` was inert copy for a zoom command v2 does not have — zoom IS the dolly, on ↑ ↓. A map
  // that lists a key nobody will ever bind is the defect `keys.ts` exists to prevent.
  assert.ok(!keys.includes('+ −'), 'the unbindable zoom row is gone');
  // `studioOnly` must be EXACTLY the rows guard 7 withholds: the ten held codes collapse to five
  // rows (W A S D / arrows / Q E), plus the mode pair, Fit and Home. `1 2 3 4` and `R` are
  // controller dispatches that work at every tier and must NOT be marked (round 4, Medium 1).
  const studioOnly = KEY_MAP.filter((r) => r.studioOnly).map((r) => r.keys).sort();
  assert.deepEqual(studioOnly, ['F / Shift F', 'H', 'O P', 'Q E', 'W A S D', '← →', '↑ ↓'].sort());

  /**
   * ⚠️ THE MARK IS TIED TO THE WITHHELD SET, IN BOTH DIRECTIONS — the literal above is a
   * convenience, this is the invariant.
   *
   * Round 5 executed the gap: adding `reset` back to `CAMERA_CMDS` (which is exactly how round 2's
   * High happened) left BOTH instruments green, because nothing connected the commands guard 7
   * withholds to the rows that advertise them. A guard whose two halves can drift is a guard that
   * fires once. S2 widens this dispatcher; this is what makes it impossible to widen it quietly.
   */
  const marked = new Set(KEY_MAP.filter((r) => r.studioOnly).flatMap((r) => r.binds ?? []));
  for (const c of CAMERA_CMDS) {
    assert.ok(marked.has(c), `guard 7 withholds "${c}" — some key-map row must be marked studioOnly for it`);
  }
  for (const code of HOLD_CODES) {
    assert.ok(marked.has(code), `"${code}" is a held camera key — its row must be marked studioOnly`);
  }
  // And nothing is marked that is NOT withheld: every `binds` entry on a marked row is either a
  // withheld command or a held code.
  for (const b of marked) {
    assert.ok(CAMERA_CMDS.has(b) || HOLD_CODES.includes(b),
      `"${b}" is marked desktop-only but guard 7 does not withhold it`);
  }
  // Every camera row declares what it binds, or the check above is silently partial.
  for (const r of KEY_MAP.filter((x) => x.group === 'camera')) {
    assert.ok((r.binds ?? []).length > 0, `${r.keys} must declare what it binds`);
  }
  for (const k of ['1 2 3 4', 'R', 'Esc', '?', 'Shift P / Shift S']) {
    assert.equal(KEY_MAP.find((r) => r.keys === k).studioOnly, undefined, `${k} works at every tier`);
  }
  // Every row in the "now" group is live by definition, so none of them may name an owner.
  for (const r of KEY_MAP) {
    if (r.group === 'now') assert.equal(r.owner, undefined, `${r.keys}: a "now" row cannot be forthcoming`);
  }
});
