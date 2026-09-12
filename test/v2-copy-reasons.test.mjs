/**
 * EVERY REFUSAL THE CONTROLLER CAN EMIT HAS WORDS IN ALL THREE LANGUAGES.
 * L31 v2.1b+c, S4.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────────────────────────
 *
 * S3 shipped a studio refusal card, and the first Chinese reader to over-tick a system got:
 *
 *   未添加 — 当前视图未作更改 that is 838 structures and the maximum is 24 — remove some first
 *   你的 5 个结构保持不变
 *
 * A translated frame around a raw English reason. S4 made the reasons keyed — and keying them
 * introduces a NEW way to ship the same defect, which is why this is a test and not a checklist:
 * `v2t` returns the KEY when a row is missing, so a refusal whose copy nobody wrote renders the
 * Latin-only string `refusal.limitStructures` in a Chinese card. That has already happened once in
 * this increment: S2 shipped `tr('refusal.tooMany')` against a key that did not exist and the
 * palette drew the key (worklog, S2).
 *
 * ── THE THREE CLAIMS ───────────────────────────────────────────────────────────────────────────
 *
 * 1. `REFUSAL_KEYS` is EXACTLY the set of keys appearing in `controller.ts` — so adding an
 *    eleventh refusal and not declaring it fails here, rather than at a Chinese reader.
 * 2. Every declared key has a `V2` row whose three columns are all present and non-empty.
 * 3. Both Chinese columns contain CJK and NO Latin word. A row someone pasted the English into
 *    passes claim 2 and fails this one, which is the failure this whole file is about.
 *
 * ── ITS OWN RED PROOF ──────────────────────────────────────────────────────────────────────────
 *
 * A guard that cannot fire is not tested (memory: `feedback-a-guard-that-cannot-fire-is-not-tested`).
 * The last test here TAMPERS with a copy of the table in memory — one row's Chinese replaced by its
 * English, one row deleted — and asserts the same predicates REJECT it. The predicates are shared
 * with the live checks above rather than re-typed, because a red-proof that evaluates a hand-written
 * copy of the thing it audits proves nothing (codex round 8, Medium 3 — the same mistake, caught).
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import ts from 'typescript';
import {REFUSAL_KEYS} from '../app/v2/controller.ts';
import {V2, v2t, reasonText} from '../app/v2/copy.ts';

const CONTROLLER = new URL('../app/v2/controller.ts', import.meta.url);
const LANGS = ['en', 'zh-Hans', 'zh-Hant'];
const CJK = /[㐀-鿿]/;
/** A Latin WORD, not a Latin character: "MB", "JSON" and "CC BY" are legitimate in Chinese copy,
 *  an untranslated English sentence is not. Four letters is the shortest run that cannot be an
 *  abbreviation we would actually keep. */
const LATIN_WORD = /[A-Za-z]{4,}/;

/** THE PREDICATES, defined once and used by both the live checks and the tamper proof. */
const missingRow = (table, key) => !table[key] || LANGS.some((l) => !table[key][l]);
const untranslated = (table, key) =>
 ['zh-Hans', 'zh-Hant'].some((l) => !CJK.test(table[key]?.[l] ?? '') || LATIN_WORD.test(table[key]?.[l] ?? ''));

/**
 * -- THE SCANNER IS AN AST WALK NOW, NOT A REGEX -- codex round 12, Low 3 -----------------------
 *
 * Rounds 10 and 11 each found a spelling the regex could not see (`key : "..."` with whitespace
 * before the colon; `{vars:{}, key: someVar}` with the property in second position; `{key}`
 * shorthand). Each was patched, and codex's verdict on the third patch was the right one: a regex
 * over source cannot support a COMPLETENESS claim at all -- there is always another spelling, and a
 * green from a scanner that did not look is worse than a red.
 *
 * So the emission set is read from the TypeScript compiler's own parse of `controller.ts`. Every
 * object literal in the file is visited; every property named `key` is classified as a quoted
 * `refusal.*` literal (collected) or as anything else (refused by name and position). There is no
 * spelling of an object-literal property that this misses, because it is not reading text.
 *
 * WARNING -- THE OTHER HALF OF THE CONTRACT: a `Reason` may only ever be built as an object literal
 * in this file. A helper elsewhere that returned one would be invisible here exactly as the three
 * escapes were. The last test in this group is that half, and the `REFUSAL_KEYS` round trip is what
 * makes both meet: a key nothing emits is a dead row, an emission nothing declares is a missing
 * translation.
 */
const scanReasons = (src, filename = 'controller.ts') => {
 const sf = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
 const emitted = new Set(), nonLiteral = [];
 const at = (n) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
 const visit = (node) => {
  if (ts.isObjectLiteralExpression(node)) {
   for (const prop of node.properties) {
    const named = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) ? prop.name.text : null;
    if (named !== 'key') continue;
    if (ts.isShorthandPropertyAssignment(prop)) { nonLiteral.push(`shorthand key at ${at(prop)}`); continue; }
    if (!ts.isPropertyAssignment(prop)) { nonLiteral.push(`non-assignment key at ${at(prop)}`); continue; }
    const init = prop.initializer;
    const lit = (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) ? init.text : null;
    if (lit && /^refusal\.[A-Za-z.]+$/.test(lit)) emitted.add(lit);
    else nonLiteral.push(`${init.getText(sf).slice(0, 40)} at ${at(prop)}`);
   }
  }
  ts.forEachChild(node, visit);
 };
 visit(sf);
 return {emitted, nonLiteral};
};

test('REFUSAL_KEYS is exactly the set of refusal keys the controller emits', () => {
 const src = readFileSync(CONTROLLER, 'utf8');
 const {emitted, nonLiteral} = scanReasons(src);
 assert.deepEqual(nonLiteral, [],
  'a refusal key must be a QUOTED LITERAL -- a computed key cannot be covered by the copy check, so it is refused at the source');
 assert.ok(emitted.size >= 10, `the scan must FIND the emissions, not silently match nothing (found ${emitted.size})`);
 const declared = new Set(REFUSAL_KEYS);
 assert.deepEqual(
  [...emitted].filter((k) => !declared.has(k)), [],
  'a refusal is emitted that REFUSAL_KEYS does not declare -- declare it, so the copy check covers it',
 );
 assert.deepEqual(
  [...declared].filter((k) => !emitted.has(k)), [],
  'REFUSAL_KEYS declares a key nothing emits -- a dead row, or a renamed emission',
 );
});

/**
 * THE RED PROOF FOR THE SCANNER, and it runs codex's OWN three escapes plus the ones an AST walk
 * makes newly reachable. A guard that cannot fire is not tested; these fire it.
 *
 * Note what changed with the parser: `{key : "..."}` and `{vars:{}, key: '...'}` are now simply
 * SEEN -- they are legal object literals and the walk collects them, so they land in `emitted` and
 * are caught one layer up by the `REFUSAL_KEYS` round trip. The regex had to special-case both.
 * Only the genuinely uncheckable forms are refused by name.
 */
test('the AST scanner catches every escape the regex missed, and refuses the uncheckable forms', () => {
 const base = readFileSync(CONTROLLER, 'utf8');
 const seen = (extra) => scanReasons(`${base}\nconst __probe = ${extra};\n`);

 assert.ok(seen('{key : "refusal.tamperProof"}').emitted.has('refusal.tamperProof'),
  'whitespace before the colon must not hide an emission');
 assert.ok(seen("{vars: {}, key: 'refusal.tamperProof'}").emitted.has('refusal.tamperProof'),
  'property ORDER must not hide an emission');

 for (const form of ['{key}', '{key: someVar}', '{key: cond ? a : b}']) {
  const {nonLiteral} = seen(form);
  assert.equal(nonLiteral.length, 1, `${form} must be refused as non-literal, got ${JSON.stringify(nonLiteral)}`);
  assert.match(nonLiteral[0], /line \d+/, 'and the refusal must name where it is');
 }
 // An INTERPOLATED template is the fourth form, written out here rather than in the list above so
 // the backtick nesting stays readable.
 const interp = seen('{key: ' + String.fromCharCode(96) + 'refusal.${x}' + String.fromCharCode(96) + '}');
 assert.equal(interp.nonLiteral.length, 1, 'an interpolated template key must be refused');
 assert.equal(interp.emitted.size >= 10, true, 'and the real emissions are still found beside it');

 // The `Reason` INTERFACE's own `key: string` is a TYPE, not an emission. The regex needed an
 // explicit type-position exclusion for it; the walk never visits a `PropertySignature`, so the
 // exclusion is structural rather than a special case that could be forgotten.
 assert.equal(scanReasons('export interface R { key: string; vars?: object }').nonLiteral.length, 0);
 assert.equal(scanReasons('export interface R { key: string }').emitted.size, 0);
});

/**
 * THE OTHER HALF: a `Reason` is only ever built where the scanner can see it.
 *
 * The AST walk is complete over `controller.ts`, which leaves one hole -- a `Reason` built
 * SOMEWHERE ELSE, a helper in `visibility.ts` or a shortcut in the shell. This walks the whole v2
 * tree for `refusal.` string LITERALS outside the two files allowed to carry them (the controller
 * emits, `copy.ts` translates) and fails on any third.
 */
test('no Reason object is BUILT outside controller.ts', () => {
 const root = new URL('../app/v2/', import.meta.url);
 const files = [];
 const walk = (dir) => {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
   const u = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
   if (e.isDirectory()) walk(u);
   else if (/\.tsx?$/.test(e.name)) files.push(u);
  }
 };
 walk(root);
 const strays = [];
 for (const f of files) {
  const name = decodeURIComponent(f.pathname).split('/').pop();
  if (name === 'controller.ts') continue;
  // LITERALS ONLY out here, and the limit is stated rather than papered over: `scanReasons`
  // recognises an object literal by its `key` PROPERTY, and plenty of non-`Reason` objects have
  // one (`store.ts` returns `{v:1, key, model}` for the S5b OpenAI prefs). So outside the
  // controller this can assert "nobody writes a refusal key here", which is the escape that
  // actually happened, but NOT "nobody builds a Reason here by some other spelling" -- that would
  // need the type checker, and claiming it from this scan would be the false completeness codex
  // objected to in the first place.
  for (const k of scanReasons(readFileSync(f, 'utf8'), name).emitted) strays.push(`${name} builds {key: '${k}'}`);
 }
 assert.deepEqual(strays, [],
  'a Reason built outside controller.ts is invisible to the scanner above -- route it through the controller');
});

test('every refusal key has a row in all three languages', () => {
 const bad = REFUSAL_KEYS.filter((k) => missingRow(V2, k));
 assert.deepEqual(bad, [], 'a missing row renders the KEY itself — a Latin-only string in a Chinese card');
});

test('both Chinese columns are really Chinese — no English pasted through', () => {
 const bad = REFUSAL_KEYS.filter((k) => untranslated(V2, k));
 assert.deepEqual(bad, [], 'these rows carry a Latin word or no CJK in a Chinese column');
});

test('the resolved sentence never IS the key, in any language', () => {
 for (const k of REFUSAL_KEYS) {
  for (const l of LANGS) {
   const s = v2t(l, k, {n: 838, max: 24});
   assert.notEqual(s, k, `${k} resolves to its own key in ${l}`);
   assert.ok(!/\{\w+\}/.test(s), `${k} left an unfilled placeholder in ${l}: ${s}`);
  }
 }
});

test('THE LIVE DEFECT, as an assertion: the over-tick refusal is Chinese in 简体', () => {
 // The exact refusal the live 简体 smoke produced — 838 structures against a bound of 24.
 const r = {key: 'refusal.limitStructures', vars: {n: 838, max: 24}};
 const hans = reasonText('zh-Hans', r);
 assert.ok(CJK.test(hans.text), 'the reason must be in Chinese');
 assert.ok(!LATIN_WORD.test(hans.text), `no English sentence may survive: ${hans.text}`);
 assert.match(hans.text, /838/, 'and it still names the measured count');
 assert.match(hans.text, /24/, 'and the bound');
 assert.equal(hans.detail, undefined, 'a bound refusal has no codec detail to quote');
 // The English is unchanged from the sentence that shipped, so no EN oracle row moves.
 assert.equal(reasonText('en', r).text, 'that is 838 structures and the maximum is 24 — remove some first');
});

test('a codec refusal translates its SENTENCE and quotes its English detail separately', () => {
 const r = {key: 'refusal.linkInvalid', detail: 'unknown emphasis "glow" — one of neutral, highlight'};
 const hans = reasonText('zh-Hans', r);
 assert.ok(CJK.test(hans.text) && !LATIN_WORD.test(hans.text), 'the sentence is Chinese');
 // The detail STAYS English on purpose — `validateScene` lives in a render-path file S4 may not
 // touch — and it is returned as its own field so the UI can label it rather than splice it in.
 assert.equal(hans.detail, r.detail);
});

test('RED PROOF — the predicates reject a tampered table', () => {
 // (a) English pasted into a Chinese column: passes "row exists", must fail "is Chinese".
 const pasted = {...V2, 'refusal.nothing': {...V2['refusal.nothing'], 'zh-Hans': 'nothing to select'}};
 assert.equal(missingRow(pasted, 'refusal.nothing'), false, 'the row is present, so claim 2 cannot catch it');
 assert.equal(untranslated(pasted, 'refusal.nothing'), true, 'claim 3 must catch it');
 // (b) a deleted row.
 const deleted = {...V2};
 delete deleted['refusal.addFull'];
 assert.equal(missingRow(deleted, 'refusal.addFull'), true, 'claim 2 must catch a missing row');
 // (c) an EMPTY Chinese column — present as a key, useless as copy.
 const blank = {...V2, 'refusal.encoded': {...V2['refusal.encoded'], 'zh-Hant': ''}};
 assert.equal(missingRow(blank, 'refusal.encoded'), true, 'an empty string is a missing row');
 // (d) and the untouched table passes all three, so the proof is not vacuous.
 assert.deepEqual(REFUSAL_KEYS.filter((k) => missingRow(V2, k) || untranslated(V2, k)), []);
});
