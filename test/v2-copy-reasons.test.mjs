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
import {readFileSync} from 'node:fs';
import {REFUSAL_KEYS} from '../app/v2/controller.ts';
import {V2, v2t, reasonText} from '../app/v2/copy.ts';

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

test('REFUSAL_KEYS is exactly the set of refusal keys the controller emits', () => {
 const src = readFileSync(new URL('../app/v2/controller.ts', import.meta.url), 'utf8');
 // Only the EMITTING form — `key: 'refusal.x'` — so the declaration list itself and the prose do
 // not feed the set they are meant to be checked against.
 /**
  * ⚠️ BOTH QUOTE STYLES, AND NON-LITERAL FORMS ARE REFUSED — codex round 10's Low.
  *
  * It executed the narrow version: appending an emission written `key: "refusal.tamperProof"` left
  * the scanned set UNCHANGED, and rendering that reason echoed the key. A scanner that understands
  * only one spelling yields a green meaning "I did not look", which is worse than a red.
  *
  * So single, double and backtick quotes are all scanned — and a SECOND pass FAILS on any `key:`
  * whose value is not a quoted `refusal.*` literal (computed, a variable, an interpolated template,
  * shorthand). Rather than try to evaluate those forms, the test refuses them: the contract is that
  * every refusal key is a visible literal, and that contract is what makes this file able to check
  * them at all.
  */
 const emitted = new Set([...src.matchAll(/\bkey\s*:\s*['"`](refusal\.[A-Za-z.]+)['"`]/g)].map((m) => m[1]));
 /**
  * ⚠️ THREE MORE ESCAPES, CLOSED — codex round 11's third Low. It executed these against the
  * round-10 scans and every one left the emitted set unchanged with no non-literal finding:
  *
  *   {key : "refusal.tamperProof"}   whitespace BEFORE the colon defeated both passes
  *   {vars: {}, key: someVar}        property ORDER defeated the `{`-anchored non-literal pass
  *   {key}                           SHORTHAND defeated it too
  *
  * The non-literal pass no longer anchors on `{`: it inspects every `key` PROPERTY position
  * wherever it sits in the object, plus shorthand. The `Reason` interface's own `key: string` — the
  * false positive the `{` anchor was covering for — is excluded by rejecting bare TypeScript types
  * instead, which is what it actually is.
  *
  * ⚠️ AND THE HONEST LIMIT, because codex is right that a regex over source is the wrong tool for a
  * completeness claim: it can always be escaped by a spelling nobody has thought of. The durable
  * fix is an AST check, or a constructor that is the ONLY way to build a `Reason` — recorded for
  * S5a. What this buys today is that the three known escapes fail loudly rather than silently
  * widening the surface.
  */
 const TYPE_POS = /^(string|number|boolean|any|unknown)\b/;
 const nonLiteral = [
  ...[...src.matchAll(/[,{]\s*key\s*:\s*([^,}\n]+)/g)].map((m) => m[1].trim()),
  ...[...src.matchAll(/[,{]\s*key\s*[,}]/g)].map(() => 'shorthand `key`'),
 ].filter((v) => !/^['"`]refusal\.[A-Za-z.]+['"`]$/.test(v) && !TYPE_POS.test(v));
 assert.deepEqual(nonLiteral, [],
  'a refusal key must be a QUOTED LITERAL — a computed or interpolated key cannot be scanned, so it cannot be covered');
 assert.ok(emitted.size >= 10, `the scan must FIND the emissions, not silently match nothing (found ${emitted.size})`);
 const declared = new Set(REFUSAL_KEYS);
 assert.deepEqual(
  [...emitted].filter((k) => !declared.has(k)), [],
  'a refusal is emitted that REFUSAL_KEYS does not declare — declare it, so the copy check covers it',
 );
 assert.deepEqual(
  [...declared].filter((k) => !emitted.has(k)), [],
  'REFUSAL_KEYS declares a key nothing emits — a dead row, or a renamed emission',
 );
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
