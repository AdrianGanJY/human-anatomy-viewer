/**
 * BUILD `public/i18n/pinyin.json` — one romanisation per atlas id, at BUILD time.
 * L31 v2.1b+c, S4.
 *
 * ── WHY BUILD-TIME AND NOT IN THE BROWSER ───────────────────────────────────────────────────────
 *
 * `pinyin-pro` carries its own dictionaries; shipping the library to the client to convert 5,681
 * fixed strings would download a segmenter and a word list in order to compute the same answer on
 * every visit. The strings never change between deploys, so the answer is a build artifact. The
 * page then downloads ONE small map, and only when the reader turns the toggle on (RC10: pinyin.json
 * must not be fetched on mount — two request-ledger rows enforce it).
 *
 * ── OFFLINE AND DETERMINISTIC ───────────────────────────────────────────────────────────────────
 *
 * `deploy.ps1` runs this between `build-zh.mjs` and `build-index.mjs`, and the same rule applies to
 * it as to its neighbours: no network, no model, same input ⇒ same bytes. Its only input is
 * `public/i18n/zh-Hans.json`, which `build-zh.mjs` has just written, plus a version-pinned library
 * in `devDependencies` (`--save-exact`, so a patch bump cannot silently change a reading).
 * `generated_at` is the one non-deterministic field and it is metadata, never read by the app.
 *
 * ── WHY zh-Hans IS THE SOURCE, AND WHAT IS THEREFORE TRUE OF zh-Hant ────────────────────────────
 *
 * Pinyin is the Mandarin READING of a word, and the reading is the same whether it is written
 * 胸骨体 or 胸骨體 — the two dictionaries are OpenCC conversions of one another. So one map keyed by
 * atlas id serves both scripts, and the app says so rather than implying a per-script conversion:
 * `about.pinyin` and `settings.pinyinNote` both state that the reading is derived from the 简体
 * spelling. Building a second map from zh-Hant would produce the same strings at twice the size and
 * invite the reader to believe the two had been checked independently.
 *
 * ── SYSTEMS ARE INCLUDED, AND THE KICKOFF SAID "CONCEPT/PART" ───────────────────────────────────
 *
 * Recorded as a deliberate widening rather than done quietly. The Layers tree's TOP-LEVEL rows are
 * the 15 system names, in Chinese, and the kickoff names the tree rows as a pinyin surface. A tree
 * whose structure rows carry a reading while its parent rows do not reads as a broken feature, not
 * as a scope boundary. Fifteen ids is ~0.3% of the file.
 *
 * usage: node scripts/build-pinyin.mjs
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {pinyin} from 'pinyin-pro';

const require = createRequire(import.meta.url);
const LIB_VERSION = require('pinyin-pro/package.json').version;
const SRC = new URL('../public/i18n/zh-Hans.json', import.meta.url);
const OUT = new URL('../public/i18n/pinyin.json', import.meta.url);

if (!existsSync(SRC)) {
  // A LOUD FAILURE, because the silent one is worse: an absent map makes the toggle a no-op, and a
  // no-op toggle is indistinguishable from "this build has no pinyin" to everyone including me.
  console.error('build-pinyin: public/i18n/zh-Hans.json is missing — run scripts/build-zh.mjs first');
  process.exit(1);
}

const dict = JSON.parse(readFileSync(SRC, 'utf8'));

const HAN = /[㐀-䶿一-鿿豈-﫿]/;
/**
 * `pinyin('第 3 腰椎')` returns `"dì   3   yāo zhuī"` — the library pads around characters it does
 * not convert, so the raw output carries runs of three spaces. Measured, not assumed: that exact
 * string is in the probe log for this commit. Collapsing whitespace is the whole of the cleanup.
 */
const romanise = (s) => pinyin(s, {toneType: 'symbol', type: 'string'}).replace(/\s+/g, ' ').trim();

const py = {};
const counts = {concepts: 0, parts: 0, systems: 0, skippedNoHan: 0, skippedEmpty: 0};
/** A name that contains NO Han character has no reading to give — romanising it would echo the
 *  Latin back and the UI would draw a second identical line under the first. Counted, not hidden. */
const add = (id, name, bucket) => {
  if (typeof id !== 'string' || typeof name !== 'string' || !name) return;
  if (py[id] !== undefined) return;          // first writer wins; concepts before parts, stated below
  if (!HAN.test(name)) { counts.skippedNoHan++; return; }
  const v = romanise(name);
  if (!v) { counts.skippedEmpty++; return; }
  py[id] = v;
  counts[bucket]++;
};

// CONCEPTS FIRST, then parts, then systems — the same precedence `makeT`'s `look()` uses
// (`dict.concepts[id] ?? dict.parts[id]`), so an id present in both resolves to the reading of the
// name the UI actually shows. A different order here would put a part's reading under a concept's
// name for any id the two share.
for (const [id, name] of Object.entries(dict.concepts ?? {})) add(id, name, 'concepts');
for (const [id, name] of Object.entries(dict.parts ?? {})) add(id, name, 'parts');
for (const [id, entry] of Object.entries(dict.systems ?? {})) add(id, entry?.name, 'systems');

// ── VALIDATION. The same shape `build-zh.mjs` ends with, and for the same reason: a build step that
//    cannot fail is a build step nobody checks. Each of these has a defect behind it.
const ids = Object.keys(py);
const problems = [];
if (ids.length < 5000) problems.push(`only ${ids.length} readings — the dictionaries did not load`);
const empty = ids.filter((id) => !py[id]);
if (empty.length) problems.push(`${empty.length} empty readings (e.g. ${empty[0]})`);
// A LEFTOVER HAN CHARACTER means the conversion did not complete for that entry, and the UI would
// draw half a romanisation as if it were the whole reading.
const unconverted = ids.filter((id) => HAN.test(py[id]));
if (unconverted.length) problems.push(`${unconverted.length} readings still contain Han (e.g. ${unconverted[0]} -> ${py[unconverted[0]]})`);
if (counts.systems === 0) problems.push('no system readings — the tree\'s top-level rows would have none');
if (problems.length) {
  console.error('build-pinyin: FAILED\n  ' + problems.join('\n  '));
  process.exit(1);
}

// ── ONE LINE PER ID, so a diff of this file is readable and a single changed reading is a
//    one-line change rather than a re-flowed blob. `JSON.stringify(_, null, 1)` would indent every
//    entry; this writes the wrapper by hand and the entries one per line.
const body = ids.sort().map((id) => `  ${JSON.stringify(id)}: ${JSON.stringify(py[id])}`).join(',\n');
const out = [
  '{',
  '  "version": 1,',
  '  "source": "zh-Hans",',
  `  "library": ${JSON.stringify(`pinyin-pro@${LIB_VERSION}`)},`,
  `  "generated_at": ${JSON.stringify(new Date().toISOString())},`,
  `  "counts": ${JSON.stringify(counts)},`,
  '  "py": {',
  body,
  '  }',
  '}',
  '',
].join('\n');
writeFileSync(OUT, out, 'utf8');

console.log(`build-pinyin: ${ids.length} readings from pinyin-pro@${LIB_VERSION} ` +
  `(${counts.concepts} concepts, ${counts.parts} parts, ${counts.systems} systems; ` +
  `${counts.skippedNoHan} names had no Han character) -> public/i18n/pinyin.json (${(out.length / 1024).toFixed(1)} KB)`);
// The sample is the one the live smoke reads, and it is looked up BY ID rather than by a guessed
// one: the first version printed `FMA7485` and called it 胸骨体, which is 胸骨 — a sample line that
// misnames its own subject is the kind of small lie a reader would carry forward. 胸骨体 is FMA7487
// (the concept) and FJ3178 (the mesh), and both resolve to the same reading.
console.log(`build-pinyin: validation — 0 empty, 0 with leftover Han, sample FMA7487 (胸骨体) = ${py['FMA7487'] ?? '(absent)'}`);
