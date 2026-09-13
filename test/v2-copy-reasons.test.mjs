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
import {REFUSAL_KEYS} from '../app/v2/controller.ts';
import {V2, v2t, reasonText} from '../app/v2/copy.ts';

/**
 * ── WHY `typescript` IS IMPORTED CONDITIONALLY — S5b prelude ────────────────────────────────────
 *
 * `import ts from 'typescript'` at the top of this file made it UNLOADABLE in a review snapshot.
 * The snapshot has no `node_modules`, so the specifier does not resolve, and an ESM link failure
 * takes the WHOLE FILE down before a single test registers — measured in a bare copy of `app/` +
 * this file: `ERR_MODULE_NOT_FOUND`, `tests 1 · pass 0 · fail 1`.
 *
 * That is not a cosmetic cost. codex rounds 9 through 21 each reported the unit totals as
 * "331 passed / 4 failed … missing TypeScript, OpenCC and OrbitControls dependencies" — i.e. NO
 * codex round has ever executed the refusal-copy contract, which is the one guard standing between
 * a Chinese reader and an untranslated English refusal. A guard the reviewer cannot run is a guard
 * only its author has ever seen fire.
 *
 * So the compiler is now OPTIONAL, and the fallback is a vendored lexer (`scanLexical`) rather than
 * a regex — because codex round 12's verdict on regexes over source stands: three spellings escaped
 * three successive patches. The lexer does not read text either; it tokenises, so a `key` inside a
 * comment or a quotation is not a token at all.
 *
 * ⚠️ AND THE FALLBACK IS NOT TAKEN ON TRUST. Where `typescript` IS installed, two tests below assert
 * the lexer returns the SAME emission set and the SAME refusals as the compiler's own parse — on
 * the real `controller.ts` and on the five escape spellings rounds 10–13 found. So the scanner the
 * reviewer executes is the one proven equivalent here on every developer run.
 */
let ts = null;
try { ts = (await import('typescript')).default; } catch { /* review snapshot: the lexer runs */ }
const SCANNER = ts ? 'ast' : 'lexical';

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
const scanAst = (src, filename = 'controller.ts') => {
 const sf = ts.createSourceFile(filename, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
 const emitted = new Set(), nonLiteral = [];
 const at = (n) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
 const visit = (node) => {
  if (ts.isObjectLiteralExpression(node)) {
   for (const prop of node.properties) {
    /**
     * ⚠️ A COMPUTED NAME IS REFUSED, NOT SKIPPED — codex round 13, Low 1.
     *
     * The first walk classified only identifier and string-literal names and `continue`d past
     * everything else, so `{['key']: 'refusal.tamperProof'}` was neither collected NOR rejected —
     * an escape INSIDE controller.ts, which is precisely the file the walk claims completeness
     * over. `{['k' + 'ey']: …}` likewise.
     *
     * A computed name cannot be resolved without evaluating it, so it is refused by position, the
     * same way a computed VALUE already is. That keeps the completeness claim true: every property
     * in this file is either classified or reported.
     */
    // `prop.name` is ABSENT on a spread (`{...x}`), so the existence check comes first — a
    // property with no name is not a `key` property, and the spread's own object literal is
    // visited separately by the walk.
    if (prop.name && ts.isComputedPropertyName(prop.name)) {
     nonLiteral.push(`computed property name ${prop.name.getText(sf).slice(0, 30)} at ${at(prop)}`);
     continue;
    }
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

/**
 * ── THE VENDORED SCANNER — A LEXER, NOT A REGEX ────────────────────────────────────────────────
 *
 * It tokenises the source once and then asks questions of TOKENS. That is the whole difference
 * from the three regexes rounds 10–13 defeated: `// the key: 'refusal.x' case` is a comment and
 * produces no tokens at all, `"key: 'refusal.x'"` is one string token, and `key : 'refusal.x'`
 * with any whitespace is the same three tokens as without it.
 *
 * ⚠️ IT DOES NOT KNOW WHAT AN OBJECT LITERAL IS, and that is a deliberate WIDENING, not a gap.
 * The AST walk collects `key` properties of object literals; this collects every `key` that is
 * followed by `:` or is a shorthand/computed form, wherever it appears. A `key:` in a type
 * annotation or a labelled statement would therefore be reported here and not there — which makes
 * the lexer strictly MORE suspicious, never less. The equivalence tests below are what establish
 * that on THIS file the two agree; if a future edit makes them disagree, that test goes red on
 * every developer machine before the reviewer ever sees the fallback.
 *
 * Escapes it must not fall for, all of them measured in `the two scanners agree` below:
 *   `{['key']: 'refusal.x'}`  computed  -> refused by position (never collected)
 *   `{key}`                   shorthand -> refused
 *   `{vars:{}, key: someVar}`  computed value -> refused
 *   `key : "refusal.x"`        whitespace     -> collected
 *   `` key: `refusal.x` ``     no-substitution template -> collected
 */
const lex = (src) => {
 const toks = [];
 const idStart = (c) => /[A-Za-z_$]/.test(c);
 const idPart = (c) => /[A-Za-z0-9_$]/.test(c);
 /** After these, a `/` starts a REGEX; after a value it is division. Only enough to keep the
  *  lexer from swallowing half the file when it meets one — controller.ts has several. */
 const regexOk = () => {
  const p = toks[toks.length - 1];
  if (!p) return true;
  if (p.k === 'str' || p.k === 'num') return false;
  if (p.k === 'name') return !['this', 'true', 'false', 'null', 'undefined'].includes(p.v);
  return ![')', ']', '}'].includes(p.v);
 };
 let i = 0;
 const n = src.length;
 /** A template literal, including its `${ … }` substitutions — which may themselves contain
  *  strings, braces and further templates. Returns the end index. `simple` is false the moment a
  *  substitution appears, which is exactly the AST's `isNoSubstitutionTemplateLiteral` line. */
 const template = (start) => {
  let j = start + 1, cooked = '', simple = true;
  while (j < n) {
   if (src[j] === '\\') { cooked += src[j + 1] ?? ''; j += 2; continue; }
   if (src[j] === '`') { j += 1; break; }
   if (src[j] === '$' && src[j + 1] === '{') {
    simple = false;
    let depth = 1; j += 2;
    while (j < n && depth > 0) {
     const c = src[j];
     if (c === '{') { depth += 1; j += 1; continue; }
     if (c === '}') { depth -= 1; j += 1; continue; }
     if (c === '`') { j = template(j).end; continue; }
     if (c === '"' || c === "'") { j = quoted(j).end; continue; }
     if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j += 1; continue; }
     if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j + 2); j = j < 0 ? n : j + 2; continue; }
     j += 1;
    }
    continue;
   }
   cooked += src[j]; j += 1;
  }
  return {end: j, cooked, simple};
 };
 const quoted = (start) => {
  const q = src[start];
  let j = start + 1, cooked = '';
  while (j < n) {
   if (src[j] === '\\') { cooked += src[j + 1] ?? ''; j += 2; continue; }
   if (src[j] === q) { j += 1; break; }
   if (src[j] === '\n') { j += 1; break; }  // unterminated; stop rather than eat the file
   cooked += src[j]; j += 1;
  }
  return {end: j, cooked};
 };
 while (i < n) {
  const c = src[i];
  if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
  if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
  if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i += 1; continue; }
  if (c === '"' || c === "'") { const r = quoted(i); toks.push({k: 'str', v: r.cooked, simple: true, i}); i = r.end; continue; }
  if (c === '`') { const r = template(i); toks.push({k: 'str', v: r.cooked, simple: r.simple, i}); i = r.end; continue; }
  if (c === '/' && regexOk()) {
   let j = i + 1, cls = false;
   while (j < n) {
    if (src[j] === '\\') { j += 2; continue; }
    if (src[j] === '[') cls = true;
    else if (src[j] === ']') cls = false;
    else if (src[j] === '/' && !cls) { j += 1; break; }
    else if (src[j] === '\n') break;
    j += 1;
   }
   while (j < n && idPart(src[j])) j += 1;
   toks.push({k: 'regex', v: src.slice(i, j), i});
   i = j; continue;
  }
  if (/[0-9]/.test(c)) { let j = i; while (j < n && /[0-9a-fA-FxXoObBeE._n+-]/.test(src[j]) && !(src[j] === '-' && src[j - 1] !== 'e' && j > i)) j += 1; toks.push({k: 'num', v: src.slice(i, j), i}); i = j; continue; }
  if (idStart(c)) { let j = i; while (j < n && idPart(src[j])) j += 1; toks.push({k: 'name', v: src.slice(i, j), i}); i = j; continue; }
  toks.push({k: 'punct', v: c, i});
  i += 1;
 }
 return toks;
};

/**
 * ⚠️ AN OBJECT LITERAL, NOT "ANY BRACE" — and this is the ONE place the lexer has to reason about
 * structure, because without it `export interface R { key: string }` is reported as a non-literal
 * key and the AST (which only visits object literals) reports nothing. That exact interface is in
 * `controller.ts` and in this file's own escape fixtures, so the disagreement is not hypothetical.
 *
 * The classification is made from the token BEFORE the `{`, which is enough to separate the three
 * kinds that occur here: a value position (`= { , ( : [ return =>` …) opens a literal; a name or a
 * closing bracket before it means a declaration body or a block. Ambiguous residue (`case 'x': {`)
 * errs toward LITERAL, i.e. toward reporting — the safe direction for a completeness claim.
 */
const VALUE_BEFORE_BRACE = new Set(['=', ',', '(', ':', '[', '?', '&', '|', '!', '+', ';']);
const VALUE_NAME_BEFORE_BRACE = new Set(['return', 'of', 'in', 'typeof', 'yield', 'await', 'default']);

const scanLexical = (src) => {
 const toks = lex(src);
 const emitted = new Set(), nonLiteral = [];
 const lineAt = (idx) => `line ${src.slice(0, idx).split('\n').length}`;
 /** `true` for each open brace that is an object literal. */
 const braces = [];
 const inLiteral = () => braces.length > 0 && braces[braces.length - 1];
 for (let t = 0; t < toks.length; t += 1) {
  const tok = toks[t];
  if (tok.k === 'punct' && tok.v === '{') {
   const p = toks[t - 1], pp = toks[t - 2];
   const arrowBody = p && p.k === 'punct' && p.v === '>' && pp && pp.k === 'punct' && pp.v === '=';
   braces.push(!arrowBody && !!p && (
    (p.k === 'punct' && VALUE_BEFORE_BRACE.has(p.v)) || (p.k === 'name' && VALUE_NAME_BEFORE_BRACE.has(p.v))
   ));
   continue;
  }
  if (tok.k === 'punct' && tok.v === '}') { braces.pop(); continue; }
  if (!inLiteral()) continue;
  // `['key']` / `['k'+'ey']` — a computed name. Refused by POSITION, the AST's round-13 rule.
  /**
   * ⚠️ EVERY COMPUTED NAME IS REFUSED, NOT ONLY ONE THAT VISIBLY SPELLS `key` — and the first
   * version got this wrong in exactly the way the AST's own round-13 note warns about. It looked
   * for a `'key'` string inside the brackets, so `{['k' + 'ey']: 'refusal.tamperProof'}` — this
   * file's own tamper fixture — was neither collected NOR refused. The compiler refuses by
   * POSITION: a name it cannot resolve without executing it is uncheckable, whatever it spells.
   * Caught by running this file in a bare snapshot, which is the condition it now exists for.
   */
  if (tok.k === 'punct' && tok.v === '[') {
   const p = toks[t - 1];
   if (!(p && p.k === 'punct' && (p.v === '{' || p.v === ','))) continue;
   let j = t + 1, depth = 1, raw = '';
   while (j < toks.length && depth > 0) {
    const x = toks[j];
    if (x.k === 'punct' && x.v === '[') depth += 1;
    else if (x.k === 'punct' && x.v === ']') { depth -= 1; if (!depth) break; }
    raw += x.k === 'str' ? `'${x.v}'` : x.v;
    j += 1;
   }
   const after = toks[j + 1];
   if (after && after.k === 'punct' && after.v === ':') {
    nonLiteral.push(`computed property name [${raw}] at ${lineAt(tok.i)}`);
    t = j; continue;
   }
   continue;
  }
  const isKey = (tok.k === 'name' && tok.v === 'key') || (tok.k === 'str' && tok.simple && tok.v === 'key');
  if (!isKey) continue;
  const next = toks[t + 1];
  const prev = toks[t - 1];
  // `{key}` / `{key,` — shorthand. Only inside braces: `key` as a bare identifier elsewhere
  // (a variable read, a member name after `.`) is not a property at all.
  if (prev && prev.k === 'punct' && (prev.v === '{' || prev.v === ',')
      && next && next.k === 'punct' && (next.v === '}' || next.v === ',')) {
   nonLiteral.push(`shorthand key at ${lineAt(tok.i)}`);
   continue;
  }
  if (!next || next.k !== 'punct' || next.v !== ':') continue;
  if (prev && prev.k === 'punct' && prev.v === '.') continue;   // `x.key: …` cannot occur; belt
  const init = toks[t + 2];
  if (init && init.k === 'str' && init.simple && /^refusal\.[A-Za-z.]+$/.test(init.v)) { emitted.add(init.v); t += 2; continue; }
  nonLiteral.push(`${init ? (init.k === 'str' ? `'${init.v}'` : init.v) : '<eof>'} at ${lineAt(tok.i)}`);
 }
 return {emitted, nonLiteral};
};

/** What the tests below run: the compiler where it exists, the lexer where it does not. */
const scanReasons = (src, filename = 'controller.ts') => (ts ? scanAst(src, filename) : scanLexical(src));

/** The five spellings that escaped three successive regexes, plus the two that must be COLLECTED.
 *  Shared by the equivalence test and available as documentation of what "escape" means here. */
const ESCAPES = [
 `const a = {['key']: 'refusal.computed'};`,
 `const a2 = {['k' + 'ey']: 'refusal.tamperProof'};`,
 `const a3 = {a: [1, 2], key: 'refusal.arrayValueNearby'};`,
 `const b = {key};`,
 `const c = {vars: {}, key: someVar};`,
 `const d = {key : "refusal.spaced"};`,
 'const e = {key: `refusal.template`};',
 `// key: 'refusal.inAComment'\nconst f = {key: 'refusal.real'};`,
 `const g = "key: 'refusal.inAString'";`,
 `export interface R { key: string; vars?: object }`,
 `function h(){ if (x) { const key = 1; return key; } }`,
];

/**
 * ⚠️ THE EQUIVALENCE IS THE WHOLE WARRANT FOR THE FALLBACK. Without it the reviewer runs a scanner
 * nobody has ever compared to anything, which is the "green from a scanner that did not look" codex
 * round 12 rejected — one level out. These two skip (LOUDLY, with a reason) where `typescript` is
 * absent, because they cannot run there; every developer machine and CI runs them.
 */
test('the vendored lexer agrees with the TypeScript AST on the real controller.ts', (t) => {
 if (!ts) { t.skip('typescript is not installed — this run executed the vendored lexer; equivalence is asserted wherever the compiler exists'); return; }
 const src = readFileSync(CONTROLLER, 'utf8');
 const a = scanAst(src), l = scanLexical(src);
 assert.deepEqual([...l.emitted].sort(), [...a.emitted].sort(),
  'the lexer and the compiler disagree about what controller.ts emits — the fallback the reviewer runs is no longer the scanner this file proved');
 assert.deepEqual(l.nonLiteral, a.nonLiteral,
  'the lexer and the compiler disagree about which key properties are uncheckable');
 assert.ok(a.emitted.size >= 10, `the comparison must be over a non-empty set (found ${a.emitted.size})`);
});

test('the vendored lexer agrees with the AST on every escape spelling', (t) => {
 if (!ts) { t.skip('typescript is not installed — see the note on the equivalence test above'); return; }
 for (const src of ESCAPES) {
  const a = scanAst(src, 'fixture.ts'), l = scanLexical(src);
  assert.deepEqual([...l.emitted].sort(), [...a.emitted].sort(), `emissions differ for: ${src}`);
  assert.equal(l.nonLiteral.length, a.nonLiteral.length, `refusals differ for: ${src}\n  ast=${JSON.stringify(a.nonLiteral)}\n  lex=${JSON.stringify(l.nonLiteral)}`);
 }
});

test(`REFUSAL_KEYS is exactly the set of refusal keys the controller emits [scanner=${SCANNER}]`, () => {
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

 // codex round 13's two computed-name escapes join the list, red-proved the same way.
 for (const form of ['{key}', '{key: someVar}', '{key: cond ? a : b}',
  "{['key']: 'refusal.tamperProof'}", "{['k' + 'ey']: 'refusal.tamperProof'}"]) {
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
