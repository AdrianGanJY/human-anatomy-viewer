/**
 * build-zh.mjs — the Chinese name layer (L30 P3, 2026-09-06).
 *
 * Writes `public/i18n/zh-Hans.json` + `public/i18n/zh-Hant.json`, the dictionaries the app
 * lazy-loads when the language switch is set to 简体 / 繁體, plus `scripts/zh-sources.json`
 * (provenance per id) and `scripts/zh-review-sample.md` (60 terms for Adrian's eyes).
 *
 * WHY THIS EXISTS
 * ---------------
 * Upstream has no i18n at all: `atlas.json` carries English names only, and BodyParts3D's own
 * metadata is English + Japanese. Chinese has to be built. Measured (Wikidata SPARQL over
 * wdt:P1402, the FMA id): 3,420 of 3,432 concepts map to a Wikidata item, but only 656 carry
 * ANY Chinese label — ~19% coverage.
 *
 * Those 656 were then used as a MEASUREMENT rather than as an authority, and the measurement
 * changed the design: see the PRECEDENCE note further down. Short version — the model's
 * mainland-standard term ships, the Wikidata label corroborates it where they agree and
 * fills in where the model has nothing.
 *
 * THIS SCRIPT IS DETERMINISTIC AND OFFLINE. It never calls a model and never touches the
 * network — it is run by `deploy.ps1` on every deploy, so it must produce the same bytes from
 * the same inputs. The translations come from `scripts/zh-llm-cache.json`, which is filled in
 * separately by `scripts/translate-zh.mjs` (the codex lane) and committed. If the cache is
 * short, this script SAYS SO and writes `scripts/zh-missing.json` rather than shipping a
 * dictionary with holes in it.
 *
 * Inputs   public/models/atlas.json · scripts/zh-wikidata.json · scripts/zh-llm-cache.json
 *          app/anatomy.ts (systems + explanations) · app/i18n/ui.ts (interface copy)
 * Outputs  public/i18n/zh-Hans.json · public/i18n/zh-Hant.json
 *          scripts/zh-sources.json · scripts/zh-review-sample.md · scripts/zh-missing.json
 *
 * 繁體 is DERIVED from 简体 with opencc-js (cn -> tw), never translated twice: two independent
 * translations of the same term would drift, and a reader comparing the two scripts would be
 * reading translation noise rather than script conversion. A Wikidata label that arrives in
 * Traditional is normalised to Simplified first (t -> cn) so both files come off one source.
 *
 * Flags: --strict makes a short cache a non-zero exit (used by CI-style checks); by default a
 * short cache still writes what it has, so the site never regresses to English-only mid-build.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as OpenCC from 'opencc-js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...bits) => join(ROOT, ...bits);
const STRICT = process.argv.includes('--strict');

const { SYSTEMS, EXPLANATIONS } = await import('../app/anatomy.ts');
const { UI } = await import('../app/i18n/ui.ts');
if (!Array.isArray(SYSTEMS) || !SYSTEMS.length) throw new Error('app/anatomy.ts gave no SYSTEMS');
if (!UI || !Object.keys(UI).length) throw new Error('app/i18n/ui.ts gave no UI strings');

const atlas = JSON.parse(readFileSync(p('public', 'models', 'atlas.json'), 'utf8'));
if (!Array.isArray(atlas.parts) || !Array.isArray(atlas.concepts)) throw new Error('atlas.json is not an atlas');

const anchors = existsSync(p('scripts', 'zh-wikidata.json'))
  ? JSON.parse(readFileSync(p('scripts', 'zh-wikidata.json'), 'utf8'))
  : { concepts: {}, preference_order: [] };
const cache = existsSync(p('scripts', 'zh-llm-cache.json'))
  ? JSON.parse(readFileSync(p('scripts', 'zh-llm-cache.json'), 'utf8'))
  : { terms: {}, prose: {} };
cache.terms ||= {};
cache.prose ||= {};

// ── script conversion ───────────────────────────────────────────────────────
// `t -> cn` normalises whatever script a Wikidata label arrives in; `cn -> tw` produces the
// 繁體 file. Converting an already-Simplified string with t2s is a no-op, which is exactly
// why it is safe to run every anchor through it rather than guessing the label's script.
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
const s2t = OpenCC.Converter({ from: 'cn', to: 'tw' });

const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]/;
const HAS_LATIN = /[A-Za-z]/;
/** Numbering that legitimately keeps Latin characters (C7, T3, L5, S1 vertebral levels). */
const NUMBERING_EN = /\b(vertebra|vertebrae|rib|costa|digit|phalanx|phalanges|molar|premolar|incisor|canine|[CTLS]\d)\b/i;

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();

// ── the atlas, indexed ──────────────────────────────────────────────────────

const partSystem = new Map(atlas.parts.map((x) => [x.id, x.system]));
const conceptById = new Map(atlas.concepts.map((c) => [c.id, c]));

/** The dominant system of a concept, tie-broken by the SYSTEMS order — the same rule
 *  `scripts/build-index.mjs` uses, so the review sample and the index agree about which
 *  concepts are "muscles" and which are "bones". */
function dominantSystem(c) {
  const tally = new Map();
  for (const e of c.elements) {
    const s = partSystem.get(e);
    if (s) tally.set(s, (tally.get(s) || 0) + 1);
  }
  let best = -1; let dominant = null;
  for (const s of SYSTEMS) {
    const n = tally.get(s.id) || 0;
    if (n > best) { best = n; dominant = s.id; }
  }
  return best > 0 ? dominant : null;
}
const conceptSystem = new Map(atlas.concepts.map((c) => [c.id, dominantSystem(c)]));

// ── the work list ───────────────────────────────────────────────────────────
// One entry per DISTINCT lowercased English string across concepts and parts. Two ids that
// read the same in English get the same Chinese by construction — which is also how "a part
// whose name equals its concept's name reuses the concept's Chinese" is implemented, without
// a special case that could disagree with itself.

/** @type {Map<string,{en:string,system:string|null,parent:string|null,ids:string[]}>} */
const terms = new Map();
function want(en, system, parent, id) {
  const k = key(en);
  if (!k) return k;
  const hit = terms.get(k);
  if (hit) { hit.ids.push(id); if (!hit.parent && parent) hit.parent = parent; return k; }
  terms.set(k, { en: norm(en), system: system ?? null, parent: parent ?? null, ids: [id] });
  return k;
}
for (const c of atlas.concepts) want(c.name, conceptSystem.get(c.id), null, c.id);
for (const part of atlas.parts) {
  want(part.name, part.system, conceptById.get(part.conceptId)?.name ?? null, part.id);
}

/** Prose — full sentences, a different translation problem from a term. */
const prose = new Map();
const proseWant = (k, en, kind, context) => prose.set(k, { en: norm(en), kind, context });
for (const s of SYSTEMS) {
  proseWant(`system.name:${s.id}`, s.name, 'system-name', `label for the ${s.id} system in a 3D anatomy explorer`);
  proseWant(`system.desc:${s.id}`, s.description, 'system-description', `one-paragraph description of the ${s.id} system`);
}
for (const [name, text] of Object.entries(EXPLANATIONS)) {
  proseWant(`explanation:${name}`, text, 'explanation', `explanation shown when the user selects "${name}"`);
}
for (const [k, text] of Object.entries(UI)) proseWant(`ui:${k}`, text, 'ui', `interface string, key ${k}`);

// ── resolve every term ──────────────────────────────────────────────────────

const ZH_PREF = anchors.preference_order?.length ? anchors.preference_order : ['zh-hans', 'zh-cn', 'zh', 'zh-hant', 'zh-tw'];
/** The anchored Simplified form of a concept, or null. Preference order is data, not code —
 *  it travels with the anchor file so a later re-scrape can change it in one place. */
function anchorHans(conceptId) {
  const zh = anchors.concepts?.[conceptId]?.zh;
  if (!zh) return null;
  for (const k of ZH_PREF) {
    if (zh[k]) return { hans: norm(t2s(zh[k])), variant: k, raw: zh[k], qid: anchors.concepts[conceptId].qid };
  }
  return null;
}

/** term key -> {hans, source, detail} */
const termHans = new Map();
const anchoredTerms = new Map(); // term key -> anchor info, for the agreement gate
for (const c of atlas.concepts) {
  const a = anchorHans(c.id);
  if (a) anchoredTerms.set(key(c.name), a);
}

// PRECEDENCE: the model first, the Wikidata anchor as the fallback.
//
// The plan had it the other way round ("Wikidata wins where present"), and the measurement
// overturned it. Exact agreement across the 656 anchored concepts came out at 60.2%, and
// reading the disagreements showed the divergence is SYSTEMATIC, not noise: Wikidata's labels
// are encyclopedia article TITLES and often Taiwan usage, while the model was asked for — and
// returns — the mainland terminology standard (《人体解剖学名词》). Measured examples:
//
//   common carotid artery   wikidata 总颈动脉    model 颈总动脉   (standard word order)
//   internal jugular vein   wikidata 内颈静脉    model 颈内静脉
//   supraspinatus           wikidata 棘上肌      model 冈上肌
//   external oblique        wikidata 外斜肌      model 腹外斜肌
//   esophagus               wikidata 食道        model 食管      (colloquial vs standard)
//
// and, worse, a nonzero rate of outright WRONG CONCEPTS, which is the error a learner cannot
// catch: vertebra -> 椎骨切迹 ("vertebral notch"), nasolacrimal duct -> 泪器 ("lacrimal
// apparatus"), mylohyoid -> 颏舌肌 (that is genioglossus), skin -> 人类皮肤 (an article
// title), and parasympathetic ganglion -> "副交感神经节（parasympathetic ganglion）" with the
// English still in it.
//
// So the anchors keep two jobs — CORROBORATION (a term both sources agree on is confirmed by
// two independent sources, and `sources.json` says so) and FALLBACK (a term the model never
// answered) — and lose the third, overriding. Every disagreement is listed in the report and
// in `scripts/zh-review-sample.md`, so this decision is Adrian's to reverse per-term with a
// `"lane":"manual"` entry, not something buried in a build script.
const missingTerms = [];
for (const [k, meta] of terms) {
  const hit = cache.terms[k];
  if (!hit?.zh) missingTerms.push({ key: k, en: meta.en, system: meta.system, parent: meta.parent });
  const anchor = anchoredTerms.get(k);
  if (hit?.zh) {
    const hans = norm(hit.zh);
    const manual = hit.lane === 'manual';
    const agrees = anchor && anchor.hans === hans;
    termHans.set(k, {
      hans,
      source: manual ? 'manual' : 'llm',
      detail: hit.lane || 'llm',
      ...(agrees ? { corroborated: `wikidata:${anchor.qid}` } : {}),
      ...(anchor && !agrees ? { wikidata_differs: anchor.hans } : {}),
    });
  } else if (anchor) {
    termHans.set(k, { hans: anchor.hans, source: 'wikidata', detail: `${anchor.qid}/${anchor.variant}` });
  }
}

// ── one terminology normalisation, because the collapse check found a real error ──────────
//
// The validation below flags distinct English names that collapsed onto one Chinese string.
// It caught a class that matters: `hallucis` (great TOE) and `pollicis` (THUMB) both came back
// as 拇 — so "extensor hallucis brevis" and "extensor pollicis brevis" were the same word, and
// a learner would have been told the thumb muscle is in his foot. The model was also
// inconsistent with itself: it wrote 𧿹展肌 for abductor hallucis but 拇短屈肌 for flexor
// hallucis brevis, in the same run.
//
// The standard character is 𧿹 (U+27FF9), but it lives in CJK Ext B. I could NOT establish
// from this host whether Adrian's phone renders it — the control character in my glyph probe
// rendered too, so the probe cannot tell "present" from "tofu" here, and a tofu box is a
// silent, unrecoverable failure for a reader. 踇 (U+8E47) is the BMP variant used for exactly
// this reason in Chinese medical typesetting, and BMP coverage is universal. So: 踇.
//
// Applied as a RULE rather than 59 hand-written cache entries, so it cannot drift out of sync
// with a later re-translation.
const HALLUCIS_EN = /\bhallucis\b/i;
let hallucisFixed = 0;
for (const [k, meta] of terms) {
  if (!HALLUCIS_EN.test(meta.en)) continue;
  const hit = termHans.get(k);
  if (!hit) continue;
  const fixed = hit.hans.replace(/拇|\u{27FF9}/gu, '踇');
  if (fixed === hit.hans) continue;
  termHans.set(k, { ...hit, hans: fixed, detail: `${hit.detail}+hallucis-踇` });
  hallucisFixed++;
}

const proseZh = new Map();
const missingProse = [];
for (const [k, meta] of prose) {
  const hit = cache.prose[k];
  if (hit?.zh) proseZh.set(k, { hans: norm(hit.zh), source: 'llm', detail: hit.lane || 'llm' });
  else missingProse.push({ key: k, en: meta.en, kind: meta.kind, context: meta.context });
}

// ── the quality gate: do Wikidata and the model agree? ──────────────────────
// Measured, not assumed. Every anchored concept was ALSO sent to the model; where both exist,
// the two answers are compared. `loose` ignores a leading 左/右 and the particle 的, which are
// the two places the two sources legitimately differ in form rather than in meaning.
const loosen = (s) => s.replace(/^[左右]/, '').replace(/的/g, '').replace(/\s+/g, '');
const agreement = { compared: 0, exact: 0, loose: 0, disagreements: [] };
for (const [k, a] of anchoredTerms) {
  const llm = cache.terms[k]?.zh;
  if (!llm) continue;
  agreement.compared++;
  const l = norm(llm);
  if (l === a.hans) { agreement.exact++; agreement.loose++; continue; }
  if (loosen(l) === loosen(a.hans)) { agreement.loose++; }
  agreement.disagreements.push({ en: terms.get(k)?.en ?? k, wikidata: a.hans, llm: l, qid: a.qid, variant: a.variant });
}

// ── emit the dictionaries ───────────────────────────────────────────────────

const conceptsHans = {}; const partsHans = {};
const sources = { concepts: {}, parts: {}, prose: {} };
let conceptsMissing = 0; let partsMissing = 0;

for (const c of atlas.concepts) {
  const hit = termHans.get(key(c.name));
  if (!hit) { conceptsMissing++; continue; }
  conceptsHans[c.id] = hit.hans;
  sources.concepts[c.id] = { source: hit.source, detail: hit.detail, ...(hit.corroborated ? { corroborated: hit.corroborated } : {}), ...(hit.wikidata_differs ? { wikidata_differs: hit.wikidata_differs } : {}) };
}
for (const part of atlas.parts) {
  const hit = termHans.get(key(part.name));
  if (!hit) { partsMissing++; continue; }
  partsHans[part.id] = hit.hans;
  sources.parts[part.id] = { source: hit.source, detail: hit.detail };
}

const systemsHans = {}; const explanationsHans = {}; const uiHans = {};
for (const s of SYSTEMS) {
  const n = proseZh.get(`system.name:${s.id}`); const d = proseZh.get(`system.desc:${s.id}`);
  if (n || d) systemsHans[s.id] = { name: n?.hans ?? s.name, description: d?.hans ?? s.description };
  sources.prose[`system.name:${s.id}`] = n ? { source: n.source, detail: n.detail } : { source: 'english-fallback' };
  sources.prose[`system.desc:${s.id}`] = d ? { source: d.source, detail: d.detail } : { source: 'english-fallback' };
}
for (const name of Object.keys(EXPLANATIONS)) {
  const e = proseZh.get(`explanation:${name}`);
  if (e) explanationsHans[name] = e.hans;
  sources.prose[`explanation:${name}`] = e ? { source: e.source, detail: e.detail } : { source: 'english-fallback' };
}
for (const k of Object.keys(UI)) {
  const u = proseZh.get(`ui:${k}`);
  if (u) uiHans[k] = u.hans;
  sources.prose[`ui:${k}`] = u ? { source: u.source, detail: u.detail } : { source: 'english-fallback' };
}

const mapTo = (obj, f) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, f(v)]));
const VERSION = 3;
const stamp = new Date().toISOString();
const bundle = (lang, conv) => ({
  version: VERSION,
  lang,
  generated_at: stamp,
  source: 'Wikidata (P1402 anchors) + machine translation, 繁體 derived from 简体 with opencc-js',
  concepts: mapTo(conceptsHans, conv),
  parts: mapTo(partsHans, conv),
  systems: mapTo(systemsHans, (v) => ({ name: conv(v.name), description: conv(v.description) })),
  explanations: mapTo(explanationsHans, conv),
  ui: mapTo(uiHans, conv),
});
const hans = bundle('zh-Hans', (s) => s);
const hant = bundle('zh-Hant', (s) => s2t(s));

// ── validation, reported not assumed ────────────────────────────────────────

const noCjk = []; const latin = []; const empty = [];
const check = (kind, id, en, zh) => {
  if (!zh || !norm(zh)) { empty.push({ kind, id, en }); return; }
  if (!HAS_CJK.test(zh)) { noCjk.push({ kind, id, en, zh }); return; }
  if (HAS_LATIN.test(zh)) latin.push({ kind, id, en, zh, expected: NUMBERING_EN.test(en) });
};
for (const c of atlas.concepts) if (conceptsHans[c.id] !== undefined) check('concept', c.id, c.name, conceptsHans[c.id]);
for (const part of atlas.parts) if (partsHans[part.id] !== undefined) check('part', part.id, part.name, partsHans[part.id]);

/** Distinct English names that collapsed onto one Chinese string. Some are genuine synonyms
 *  ("great toe" / "hallux"); some are translation errors. Listed rather than judged. */
const byZh = new Map();
for (const c of atlas.concepts) {
  const zh = conceptsHans[c.id]; if (!zh) continue;
  const set = byZh.get(zh) || new Set(); set.add(c.name); byZh.set(zh, set);
}
const collapsed = [...byZh.entries()].filter(([, ens]) => ens.size > 1)
  .map(([zh, ens]) => ({ zh, english: [...ens].sort() }))
  .sort((a, b) => b.english.length - a.english.length || a.zh.localeCompare(b.zh));

// ── the 60-term review sample (deterministic) ───────────────────────────────
// Seeded, so re-running the build does not reshuffle the page Adrian is reading.
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function sample(list, n, seed) {
  const rnd = mulberry32(seed); const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy.slice(0, n);
}
const bySystem = (id) => atlas.concepts.filter((c) => conceptSystem.get(c.id) === id && conceptsHans[c.id]);
const sampleRows = [
  ...sample(bySystem('muscular'), 30, 30303).map((c) => ({ group: 'muscular', c })),
  ...sample(bySystem('skeletal'), 30, 50505).map((c) => ({ group: 'skeletal', c })),
];
const reviewMd = [
  '# 60 terms to eyeball — L30 P3 Chinese names',
  '',
  'Generated by `scripts/build-zh.mjs`. 30 random muscles + 30 random bones, drawn with a fixed',
  'seed so this page does not reshuffle between builds.',
  '',
  '**What to look for**: a term that is not what a Chinese anatomy textbook would call it, a',
  'left/right that flipped, or a number that drifted. `source` says where the Chinese came from —',
  '`wikidata` is an anchored label, `llm` is machine translation.',
  '',
  '| # | system | English | 简体 | 繁體 | source |',
  '|---|---|---|---|---|---|',
  ...sampleRows.map((row, i) => {
    const zh = conceptsHans[row.c.id];
    return `| ${i + 1} | ${row.group} | ${row.c.name} | ${zh} | ${s2t(zh)} | ${sources.concepts[row.c.id]?.source ?? '-'} |`;
  }),
  '',
  '## Where Wikidata disagreed',
  '',
  `Of the ${agreement.compared} concepts that Wikidata also has a Chinese label for, ${agreement.exact}`,
  `(${agreement.compared ? (agreement.exact / agreement.compared * 100).toFixed(1) : '0'}%) came out identical — those are confirmed by two independent sources.`,
  `The other ${agreement.disagreements.length} are below. **The shipped name is the "简体" column**; Wikidata is shown so`,
  'you can overrule. Reading the first 40 is what set that precedence: Wikidata is Wikipedia',
  'article titles and often Taiwan usage, the model was asked for the mainland standard, and',
  'Wikidata carries some outright wrong concepts (`vertebra` → 椎骨切迹, `nasolacrimal duct` → 泪器).',
  '',
  '| English | 简体 (shipped) | Wikidata says |',
  '|---|---|---|',
  ...agreement.disagreements.slice(0, 120).map((d) => `| ${d.en} | ${d.llm} | ${d.wikidata} |`),
  ...(agreement.disagreements.length > 120 ? ['', `_…and ${agreement.disagreements.length - 120} more, all in \`scripts/zh-build-report.json\`._`] : []),
  '',
  '## If something is wrong',
  '',
  'Tell any agent the English term and the Chinese it should be. The fix is one line in',
  '`scripts/zh-llm-cache.json` (`terms["<lowercase english>"] = {"zh":"…","lane":"manual"}`),',
  'then `node scripts/build-zh.mjs` and a redeploy. A manual entry beats everything.',
  '',
].join('\n');

// ── write ───────────────────────────────────────────────────────────────────

mkdirSync(p('public', 'i18n'), { recursive: true });
writeFileSync(p('public', 'i18n', 'zh-Hans.json'), JSON.stringify(hans));
writeFileSync(p('public', 'i18n', 'zh-Hant.json'), JSON.stringify(hant));
writeFileSync(p('scripts', 'zh-sources.json'), JSON.stringify(sources, null, 0));
writeFileSync(p('scripts', 'zh-review-sample.md'), reviewMd);
writeFileSync(p('scripts', 'zh-missing.json'), JSON.stringify({ generated_at: stamp, terms: missingTerms, prose: missingProse }, null, 1));

const tally = { wikidata: 0, llm: 0, manual: 0, llm_corroborated_by_wikidata: 0 };
for (const v of [...Object.values(sources.concepts), ...Object.values(sources.parts)]) {
  if (v.source === 'wikidata') tally.wikidata++;
  else if (v.source === 'manual') tally.manual++;
  else tally.llm++;
  if (v.corroborated) tally.llm_corroborated_by_wikidata++;
}
// NO timestamp in the two files that are COMMITTED (this report and the review sample): the
// build is deterministic, so identical inputs must produce identical bytes, or every deploy
// dirties the working tree with a re-stamp and the next session cannot tell a real change from
// a rerun. The SHIPPED dictionaries keep theirs — they are generated and gitignored.
const report = {
  atlas_version: atlas.version ?? null,
  terms_distinct: terms.size,
  concepts: { total: atlas.concepts.length, translated: Object.keys(conceptsHans).length, missing: conceptsMissing },
  parts: { total: atlas.parts.length, translated: Object.keys(partsHans).length, missing: partsMissing },
  prose: { total: prose.size, translated: proseZh.size, missing: missingProse.length },
  provenance: tally,
  agreement: {
    compared: agreement.compared,
    exact: agreement.exact,
    loose: agreement.loose,
    exact_rate: agreement.compared ? +(agreement.exact / agreement.compared).toFixed(4) : null,
    loose_rate: agreement.compared ? +(agreement.loose / agreement.compared).toFixed(4) : null,
    disagreements: agreement.disagreements,
  },
  validation: {
    empty: empty.length,
    no_cjk: noCjk.length,
    no_cjk_examples: noCjk.slice(0, 20),
    latin_total: latin.length,
    latin_expected: latin.filter((x) => x.expected).length,
    latin_unexpected: latin.filter((x) => !x.expected).slice(0, 40),
  },
  normalisation: { hallucis_terms_rewritten_to_踇: hallucisFixed },
  collapsed: {
    groups: collapsed.length,
    english_names_involved: collapsed.reduce((n, g) => n + g.english.length, 0),
    sample: collapsed.slice(0, 20),
  },
  missing: { terms: missingTerms.length, prose: missingProse.length },
};
writeFileSync(p('scripts', 'zh-build-report.json'), JSON.stringify(report, null, 1));

console.log(
  `build-zh: ${report.concepts.translated}/${report.concepts.total} concepts, `
  + `${report.parts.translated}/${report.parts.total} parts, ${report.prose.translated}/${report.prose.total} prose `
  + `(wikidata ${tally.wikidata} · llm ${tally.llm} · manual ${tally.manual}) -> public/i18n/*.json`,
);
console.log(
  `build-zh: agreement vs Wikidata ${agreement.exact}/${agreement.compared} exact`
  + `${agreement.compared ? ` (${(agreement.exact / agreement.compared * 100).toFixed(1)}%)` : ''}, `
  + `${agreement.loose}/${agreement.compared} loose`
  + `${agreement.compared ? ` (${(agreement.loose / agreement.compared * 100).toFixed(1)}%)` : ''}`,
);
console.log(
  `build-zh: validation — ${empty.length} empty, ${noCjk.length} without CJK, `
  + `${latin.length} containing Latin (${latin.filter((x) => x.expected).length} where the English is numbered), `
  + `${collapsed.length} Chinese strings shared by 2+ English names`,
);
// Two different shortfalls, kept apart on purpose: a term with NO Chinese at all is a hole in
// the shipped dictionary; an anchored term the model has not answered yet only weakens the
// agreement measurement. Reporting them as one number would hide the first behind the second.
const missingForOutput = conceptsMissing + partsMissing + missingProse.length;
if (missingTerms.length || missingProse.length) {
  console.log(
    `build-zh: ${missingTerms.length} terms + ${missingProse.length} prose strings are NOT in `
    + `scripts/zh-llm-cache.json -> scripts/zh-missing.json (run scripts/translate-zh.mjs). `
    + `Of those, ${missingForOutput} leave the shipped dictionary short; the rest are anchored `
    + `terms wanted only for the agreement gate.`,
  );
  if (STRICT && missingForOutput) process.exitCode = 1;
}
if (empty.length) { console.error(`build-zh: ${empty.length} empty translations — refusing to call this done`); process.exitCode = 1; }
