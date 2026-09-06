/**
 * zh-apply-grades.mjs — turn the P3r grader's verdicts into edits (L30 P3r, 2026-09-07).
 *
 * Reads `scripts/zh-grades.json` (written by `scripts/zh-grade.mjs --report`) and writes the
 * accepted corrections back into `scripts/zh-llm-cache.json`, which is the ONE input
 * `build-zh.mjs` translates from. Nothing is written to `public/i18n/*.json` directly — those are
 * generated, and hand-editing them would be silently undone by the next deploy.
 *
 * THE POLICY, and why each half of it exists
 * ------------------------------------------
 * - verdict "wrong"              -> replace with the grader's `standard`, but ONLY if the standard
 *                                  survives the guards below. A grader is a second opinion, not an
 *                                  oracle; an unguarded apply would let one bad reply corrupt a
 *                                  term that was already right.
 * - verdict "acceptable_variant" -> KEEP P3's term. The instruction to the grader was explicit that
 *                                  a Taiwan/HK variant is acceptable, so churning these would trade
 *                                  one defensible term for another and lose the corroboration P3
 *                                  measured.
 * - Traditional characters found inside zh-Hans.json -> normalised with opencc (t -> cn) whatever
 *                                  the verdict. A Traditional glyph in the SIMPLIFIED dictionary is
 *                                  a defect on its face, and `build-zh.mjs` already runs every
 *                                  Wikidata anchor through the same converter for this reason.
 * - PROTECTED terms                   -> a term with independent corroboration is not changed on one
 *                                  call. P3 measured 395 terms where Wikidata and the model agreed
 *                                  independently; those need a SECOND grading call, on that single
 *                                  term, to agree before anything is touched.
 *
 *   (The brief named `wikidata`-sourced terms as the protected class. That population is EMPTY —
 *   `zh-sources.json` is llm 5,666 / wikidata 0 / manual 0, because P3 inverted the precedence and
 *   the anchors ended up corroborating rather than supplying. The corroborated 395 are the terms
 *   that class was meant to protect, so the double-call rule is applied to them, and this note is
 *   the record that the substitution was deliberate.)
 *
 * GUARDS on an accepted `standard` (any failure = NOT applied, recorded as unresolved residue):
 *   non-empty · differs from the shipped term · contains CJK · contains no Latin letters ·
 *   laterality matches the ENGLISH exactly · every number in the English is present, and no extra.
 *
 * Modes:
 *   node scripts/zh-apply-grades.mjs --dry     report what would change, write nothing
 *   node scripts/zh-apply-grades.mjs --apply   write zh-llm-cache.json + zh-fixes.json
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as OpenCC from 'opencc-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...bits) => join(ROOT, ...bits);
const APPLY = process.argv.includes('--apply');
const WORK = p('.zh-grade');

const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2FA1F}]/u;
const HAS_LATIN = /[A-Za-z]/;

// ── laterality + numbering, the two things that must survive a rewrite ───────

/** 'left' | 'right' | 'both' | null — read off the ENGLISH, which is the authority. */
function lateralityEn(en) {
  const l = /\bleft\b/i.test(en); const r = /\bright\b/i.test(en);
  return l && r ? 'both' : l ? 'left' : r ? 'right' : null;
}
function lateralityZh(zh) {
  const l = zh.includes('左'); const r = zh.includes('右');
  return l && r ? 'both' : l ? 'left' : r ? 'right' : null;
}

const WORD_N = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12 };
const ZH_DIGIT = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** Every number the English names, as a sorted unique list. */
function numbersEn(en) {
  const out = new Set();
  for (const m of en.matchAll(/\b(\d+)(?:st|nd|rd|th)?\b/gi)) out.add(Number(m[1]));
  for (const m of en.matchAll(/\b[CTLS](\d+)\b/g)) out.add(Number(m[1]));
  for (const [w, n] of Object.entries(WORD_N)) if (new RegExp(`\\b${w}\\b`, 'i').test(en)) out.add(n);
  return [...out].sort((a, b) => a - b);
}
/** Every number the Chinese names — Arabic and the 一..十二 forms both count. */
function numbersZh(zh) {
  const out = new Set();
  for (const m of zh.matchAll(/(\d+)/g)) out.add(Number(m[1]));
  for (const m of zh.matchAll(/十[一二]|十|[一二三四五六七八九]/g)) {
    const s = m[0];
    out.add(s === '十' ? 10 : s.startsWith('十') ? 10 + ZH_DIGIT[s[1]] : ZH_DIGIT[s]);
  }
  return [...out].sort((a, b) => a - b);
}
const sameNums = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** null when the candidate is safe to ship, else the reason it was refused. */
function refuse(en, current, candidate) {
  if (!candidate) return 'grader returned no standard';
  if (candidate === current) return 'standard identical to the shipped term';
  if (!HAS_CJK.test(candidate)) return 'standard has no CJK';
  if (HAS_LATIN.test(candidate)) return 'standard contains Latin letters';
  const wantL = lateralityEn(en);
  if (lateralityZh(candidate) !== wantL) return `laterality ${lateralityZh(candidate) ?? 'none'} != English ${wantL ?? 'none'}`;
  const wantN = numbersEn(en);
  if (!sameNums(numbersZh(candidate), wantN)) return `numbering [${numbersZh(candidate)}] != English [${wantN}]`;
  return null;
}

// ── inputs ──────────────────────────────────────────────────────────────────
// Gated on an explicit flag so `test/zh-review.test.mjs` can import the guards without the
// pipeline running (and without needing the grader's output on disk to exist).
if (!APPLY && !process.argv.includes('--dry')) {
  // imported for the exported guards only
} else {

const grades = JSON.parse(readFileSync(p('scripts', 'zh-grades.json'), 'utf8'));
const set = JSON.parse(readFileSync(join(WORK, 'set.json'), 'utf8'));
const meta = new Map(set.map((x) => [x.key, x]));
const cache = JSON.parse(readFileSync(p('scripts', 'zh-llm-cache.json'), 'utf8'));

const applied = []; const unresolved = []; const kept = []; const normalised = []; const protectedHeld = [];

for (const g of grades.results) {
  const it = meta.get(g.key);
  if (!it) { unresolved.push({ ...g, why: 'term not in the grading set' }); continue; }
  const shipped = it.zh;
  const cached = it.cache_zh;

  // (1) Traditional glyphs inside the Simplified dictionary — a defect regardless of verdict.
  const simplified = norm(t2s(cached ?? shipped));
  if (cached && simplified !== cached) {
    normalised.push({ key: g.key, en: g.en, from: cached, to: simplified, verdict: g.verdict, reason: 'Traditional characters in zh-Hans' });
    cache.terms[g.key] = { ...cache.terms[g.key], zh: simplified, lane: 'claude-opus:p3r-normalised', was: cached, p3r: 'traditional->simplified' };
    continue;
  }

  if (g.verdict !== 'wrong') { kept.push(g.key); continue; }

  // (2) a corroborated term is held unless a second, single-term call agreed.
  const isProtected = !!it.corroborated;
  if (isProtected && g.confirm?.verdict !== 'wrong') {
    protectedHeld.push({ key: g.key, en: g.en, zh: shipped, standard: g.standard, reason: g.reason, corroborated: it.corroborated, confirm: g.confirm?.verdict ?? 'not-confirmed' });
    continue;
  }

  // (3) the guards. A standard that arrives Traditional is converted before judging, because the
  //     grader was asked for Simplified and a script slip is not a reason to lose a real fix.
  const candidate = norm(t2s(norm(g.standard)));
  const why = refuse(g.en, shipped, candidate);
  if (why) { unresolved.push({ key: g.key, en: g.en, zh: shipped, standard: norm(g.standard), reason: g.reason, why, ids: it.ids, system: it.sys, ...(isProtected ? { corroborated: it.corroborated } : {}) }); continue; }

  applied.push({
    key: g.key, en: g.en, system: it.sys, from: shipped, to: candidate, reason: g.reason,
    ids: it.ids, ...(isProtected ? { corroborated: it.corroborated, confirmed_by_second_call: true } : {}),
  });
  cache.terms[g.key] = { ...cache.terms[g.key], zh: candidate, lane: 'claude-opus:p3r-fix', was: cached ?? shipped, p3r: g.reason };
}

const fixes = {
  task: 'L30 P3r — second-model review of the Chinese name layer',
  graded_by: grades.grader,
  translated_by: grades.translator,
  policy: 'wrong -> standard (guarded); acceptable_variant -> kept; Traditional-in-Hans -> normalised; corroborated terms held unless a second single-term call agreed',
  counts: { applied: applied.length, normalised: normalised.length, kept: kept.length, unresolved: unresolved.length, protected_held: protectedHeld.length },
  applied, normalised, unresolved, protected_held: protectedHeld,
};

if (APPLY) {
  writeFileSync(p('scripts', 'zh-llm-cache.json'), JSON.stringify(cache));
  writeFileSync(p('scripts', 'zh-fixes.json'), JSON.stringify(fixes, null, 1));
  console.log('zh-apply: WROTE scripts/zh-llm-cache.json + scripts/zh-fixes.json');
} else {
  console.log('zh-apply: DRY RUN — nothing written');
}
console.log(`zh-apply: applied ${applied.length} · normalised ${normalised.length} · kept ${kept.length} · unresolved ${unresolved.length} · protected-held ${protectedHeld.length}`);
for (const a of applied.slice(0, 40)) console.log(`  FIX  ${a.en}  ${a.from} -> ${a.to}   (${a.reason})`);
for (const u of unresolved.slice(0, 25)) console.log(`  KEEP ${u.en}  ${u.zh}  refused "${u.standard}" :: ${u.why}`);

}

export { refuse, lateralityEn, lateralityZh, numbersEn, numbersZh, sameNums };
