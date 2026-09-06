/**
 * zh-grade.mjs — the P3r second-model review of the Chinese name layer (L30 P3r, 2026-09-07).
 *
 * WHY THIS EXISTS
 * ---------------
 * P3 shipped 5,666 Chinese names produced by ONE model (codex `gpt-6-astra`) and Adrian ruled
 * "just do it, tired to review" — he will not eyeball them. A machine translation nobody reads is
 * not verified, it is merely shipped. This script is the second pair of eyes: it grades EVERY
 * translated term with a DIFFERENT model (`claude -p --model opus`, the lane P3 did not use), so
 * the two lanes are independent and a shared blind spot is less likely.
 *
 * It grades at the CACHE-KEY level — one entry per distinct lowercased English string — because
 * that is the unit `build-zh.mjs` translates and the unit a fix is written at. 3,432 distinct
 * strings cover all 3,432 concepts and 2,234 parts; grading per-id would re-ask the same question
 * 5,666 times.
 *
 * WHAT IT GRADES IS THE SHIPPED STRING, NOT THE CACHE STRING. `build-zh.mjs` applies the
 * hallucis -> 踇 rule after the cache lookup, so 26 terms differ between the two. The reader sees
 * the shipped one, so the shipped one is what gets judged.
 *
 * Modes:
 *   node scripts/zh-grade.mjs --emit            build the grading set -> --work/set.json
 *   node scripts/zh-grade.mjs --run [--jobs 4]  grade every batch (resumable; one file per batch)
 *   node scripts/zh-grade.mjs --confirm         second call on each protected term flagged wrong
 *   node scripts/zh-grade.mjs --report          collate -> scripts/zh-grades.json (committed)
 *
 * `--run` is RESUMABLE: a finished batch writes `--work/grade-NNN.json` and is skipped on a
 * re-run. A batch whose reply does not parse, or comes back with a different item count, is
 * RETRIED (3 attempts) and then recorded as failed — never silently accepted short, because a
 * short batch would read downstream as "those terms were graded correct".
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { spawn } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...bits) => join(ROOT, ...bits);
const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? (argv[i + 1] ?? true) : fallback;
};
const WORK = String(flag('--work', join(ROOT, '.zh-grade')));
const BATCH = Number(flag('--batch-size', 200));
const JOBS = Number(flag('--jobs', 4));
const MODEL = String(flag('--model', 'opus'));
mkdirSync(WORK, { recursive: true });

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const key = (s) => norm(s).toLowerCase();
const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]|[\u{20000}-\u{2FA1F}]/u;
const HAS_LATIN = /[A-Za-z]/;

// ── the grading set ─────────────────────────────────────────────────────────

/** Rebuild `build-zh.mjs`'s term map — same construction, so the keys line up exactly. */
async function buildSet() {
  const { SYSTEMS } = await import('../app/anatomy.ts');
  const atlas = JSON.parse(readFileSync(p('public', 'models', 'atlas.json'), 'utf8'));
  const hans = JSON.parse(readFileSync(p('public', 'i18n', 'zh-Hans.json'), 'utf8'));
  const sources = JSON.parse(readFileSync(p('scripts', 'zh-sources.json'), 'utf8'));
  const cache = JSON.parse(readFileSync(p('scripts', 'zh-llm-cache.json'), 'utf8'));

  const partSystem = new Map(atlas.parts.map((x) => [x.id, x.system]));
  const conceptById = new Map(atlas.concepts.map((c) => [c.id, c]));
  function dominantSystem(c) {
    const tally = new Map();
    for (const e of c.elements) { const s = partSystem.get(e); if (s) tally.set(s, (tally.get(s) || 0) + 1); }
    let best = -1; let dominant = null;
    for (const s of SYSTEMS) { const n = tally.get(s.id) || 0; if (n > best) { best = n; dominant = s.id; } }
    return best > 0 ? dominant : null;
  }
  const conceptSystem = new Map(atlas.concepts.map((c) => [c.id, dominantSystem(c)]));

  /** key -> {en, system, parent, conceptIds[], partIds[]} */
  const terms = new Map();
  const want = (en, system, parent, id, kind) => {
    const k = key(en); if (!k) return;
    let hit = terms.get(k);
    if (!hit) { hit = { key: k, en: norm(en), system: system ?? null, parent: parent ?? null, conceptIds: [], partIds: [] }; terms.set(k, hit); }
    if (!hit.parent && parent) hit.parent = parent;
    if (!hit.system && system) hit.system = system;
    hit[kind === 'concept' ? 'conceptIds' : 'partIds'].push(id);
  };
  for (const c of atlas.concepts) want(c.name, conceptSystem.get(c.id), null, c.id, 'concept');
  for (const part of atlas.parts) want(part.name, part.system, conceptById.get(part.conceptId)?.name ?? null, part.id, 'part');

  // The 60 Adrian was asked to eyeball, and the collapsed groups — both already inside the set,
  // but tagged so the report can state their rate separately rather than assert coverage.
  const sampleEn = new Set();
  if (existsSync(p('scripts', 'zh-review-sample.md'))) {
    for (const line of readFileSync(p('scripts', 'zh-review-sample.md'), 'utf8').split('\n')) {
      const m = line.match(/^\|\s*\d+\s*\|\s*(muscular|skeletal)\s*\|\s*([^|]+?)\s*\|/);
      if (m) sampleEn.add(key(m[2]));
    }
  }
  const collapsedEn = new Set();
  if (existsSync(p('scripts', 'zh-build-report.json'))) {
    const rep = JSON.parse(readFileSync(p('scripts', 'zh-build-report.json'), 'utf8'));
    for (const g of rep.collapsed?.sample ?? []) for (const en of g.english) collapsedEn.add(key(en));
  }

  const items = [];
  let i = 0;
  for (const t of terms.values()) {
    // The SHIPPED string, read back off the dictionary the browser downloads.
    const id = t.conceptIds[0] ?? t.partIds[0];
    const zh = t.conceptIds[0] ? hans.concepts[t.conceptIds[0]] : hans.parts[t.partIds[0]];
    if (!zh) continue;
    const src = t.conceptIds[0] ? sources.concepts[t.conceptIds[0]] : sources.parts[t.partIds[0]];
    items.push({
      i: i++,
      key: t.key,
      en: t.en,
      sys: t.system,
      parent: t.parent,
      zh,
      cache_zh: cache.terms[t.key]?.zh ?? null,
      source: src?.source ?? null,
      detail: src?.detail ?? null,
      corroborated: src?.corroborated ?? null,
      wikidata_differs: src?.wikidata_differs ?? null,
      ids: { concepts: t.conceptIds.length, parts: t.partIds.length },
      sample_id: id,
      in_review_sample: sampleEn.has(t.key),
      in_collapsed: collapsedEn.has(t.key),
    });
  }
  return items;
}

// ── the prompt ──────────────────────────────────────────────────────────────

const RULES = `You are a Chinese medical terminologist grading machine-translated anatomical terms for a 3D
human anatomy atlas used by a Malaysian Chinese learner. The atlas names come from BodyParts3D/FMA.

Grade each term against MAINLAND STANDARD Simplified Chinese anatomical terminology —
全国科学技术名词审定委员会《人体解剖学名词》. That standard, not Wikipedia article titles, is the bar.

VERDICTS
- "correct"            the mainland standard term, or an exact equivalent of it.
- "acceptable_variant" understandable and not misleading, but not the standard form.
                       A Taiwan / Hong Kong variant (食道, 棘上肌, 內頸靜脈-style usage) is
                       acceptable_variant — NOT wrong. A defensible descriptive rendering of a
                       region/zone/set name is also acceptable_variant.
- "wrong"              names a DIFFERENT anatomical structure, is not Chinese anatomical usage at
                       all, contains Latin letters, or loses/alters laterality or numbering.

HARD RULES
- Laterality and numbering must be preserved EXACTLY. English "left"/"right" must appear as 左/右;
  a term that drops, adds or flips 左/右 is "wrong". Ordinals (1st..12th rib, C1-C7, T1-T12,
  L1-L5, S1-S5, 第1..第12) must match the English number exactly; a drifted number is "wrong".
- "standard" is the 全国科学技术名词审定委员会 term, and ONLY when it differs from the given term.
  Omit it (or "") when the verdict is "correct".
- "standard" must be Simplified Chinese characters only — never English, never pinyin, never
  Traditional characters, never a parenthetical gloss.
- Do NOT invent a standard you are unsure of. If the shipped term is defensible, say "correct" or
  "acceptable_variant". A churned term that was already fine is worse than a term left alone.
- Judge the term, not the translation style. 肌/骨/动脉/静脉/神经 word order follows the standard
  (颈总动脉, not 总颈动脉).

Each item gives: "i" index, "en" the English name, "sys" the body system, "parent" the parent
structure where the item is a sub-part (may be null), "zh" the shipped Simplified term.

OUTPUT: one JSON array, EXACTLY the same number of objects as there are items, in the same order,
each {"i":<i>,"verdict":"correct|acceptable_variant|wrong","standard":"","reason":"<=12 words"}.
No markdown fence. No prose before or after. Nothing but the array.`;

const promptFor = (batch) => `${RULES}\n\nITEMS (N=${batch.length}):\n${
  batch.map((it) => JSON.stringify({ i: it.i, en: it.en, sys: it.sys, parent: it.parent || undefined, zh: it.zh })).join('\n')
}\n\nReturn exactly ${batch.length} objects.`;

/** Pull the JSON array out of a reply that may still carry a fence or a stray line. */
function parseArray(raw) {
  let s = String(raw).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('['); const b = s.lastIndexOf(']');
  if (a < 0 || b <= a) throw new Error('no JSON array in reply');
  const arr = JSON.parse(s.slice(a, b + 1));
  if (!Array.isArray(arr)) throw new Error('parsed value is not an array');
  return arr;
}

/**
 * ASYNC on purpose. `execSync` would block the event loop, which silently turns the worker pool
 * below into a sequential loop — 18 batches at ~170 s each is 51 minutes pretending to be 13.
 * `spawn` + a promise makes the concurrency real. `shell: true` because `claude` is a .cmd shim
 * and Node 23 refuses to execFile one without a shell; the prompt still goes over STDIN, never
 * argv, because a multiline prompt through a Windows shell layer arrives mangled.
 */
function callModel(prompt, timeoutMs = 1_800_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(`claude -p --model ${MODEL}`, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let settled = false;
    const timer = setTimeout(() => { settled = true; child.kill(); reject(new Error(`timeout after ${timeoutMs}ms`)); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      if (settled) return; settled = true; clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`));
      resolve(out);
    });
    child.stdin.end(prompt, 'utf8');
  });
}

/** One batch, with retries. Throws only after every attempt failed — never returns short. */
async function gradeBatch(batch, label, attempts = 3) {
  const errors = [];
  for (let n = 1; n <= attempts; n++) {
    try {
      const raw = await callModel(promptFor(batch) + (n > 1 ? `\n\nYour previous reply was rejected: ${errors[errors.length - 1]}. Return ONLY the JSON array, with exactly ${batch.length} objects.` : ''));
      const arr = parseArray(raw);
      if (arr.length !== batch.length) throw new Error(`count ${arr.length} != ${batch.length}`);
      const byI = new Map(arr.map((r) => [Number(r.i), r]));
      const out = batch.map((it) => {
        const r = byI.get(it.i);
        if (!r) throw new Error(`no verdict for i=${it.i}`);
        const verdict = String(r.verdict || '').trim();
        if (!['correct', 'acceptable_variant', 'wrong'].includes(verdict)) throw new Error(`bad verdict "${verdict}" at i=${it.i}`);
        return { i: it.i, key: it.key, en: it.en, zh: it.zh, verdict, standard: norm(r.standard || ''), reason: norm(r.reason || '') };
      });
      return { label, ok: true, attempts: n, results: out };
    } catch (e) {
      errors.push(String(e.message || e).slice(0, 200));
      console.error(`  ${label} attempt ${n}/${attempts} failed: ${errors[errors.length - 1]}`);
    }
  }
  return { label, ok: false, attempts, errors, results: [] };
}

// ── modes ───────────────────────────────────────────────────────────────────

if (argv.includes('--emit')) {
  const items = await buildSet();
  writeFileSync(join(WORK, 'set.json'), JSON.stringify(items));
  const bySrc = {}; for (const it of items) bySrc[it.source] = (bySrc[it.source] || 0) + 1;
  console.log(`zh-grade: ${items.length} distinct terms -> ${join(WORK, 'set.json')}`);
  console.log(`zh-grade: by source ${JSON.stringify(bySrc)} · review-sample ${items.filter((x) => x.in_review_sample).length} · collapsed ${items.filter((x) => x.in_collapsed).length}`);
  console.log(`zh-grade: ${Math.ceil(items.length / BATCH)} batches of ${BATCH}`);
}

if (argv.includes('--run')) {
  const items = JSON.parse(readFileSync(join(WORK, 'set.json'), 'utf8'));
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH));
  const only = flag('--only', null);
  const todo = batches
    .map((b, n) => ({ b, n, file: join(WORK, `grade-${String(n).padStart(3, '0')}.json`) }))
    .filter((x) => !existsSync(x.file))
    .filter((x) => only === null || String(x.n) === String(only));
  console.log(`zh-grade: ${batches.length} batches, ${todo.length} to run (jobs=${JOBS}, model=${MODEL})`);
  let cursor = 0;
  const worker = async () => {
    while (cursor < todo.length) {
      const job = todo[cursor++];
      const t0 = Date.now();
      console.log(`  -> batch ${job.n} (${job.b.length} terms)`);
      const res = await gradeBatch(job.b, `batch-${job.n}`);
      writeFileSync(job.file, JSON.stringify(res));
      console.log(`  <- batch ${job.n} ${res.ok ? 'ok' : 'FAILED'} in ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, Math.max(todo.length, 1)) }, worker));
  console.log('zh-grade: run complete');
}

if (argv.includes('--control')) {
  // THE CONTROL ARM. The first 2,000 terms came back with ZERO "wrong", which is either a very
  // good translation or a grader that cannot say no. Those two look identical in a tally, so this
  // mode settles it: real shipped terms are DELIBERATELY corrupted in the ways that actually
  // matter here — flipped/dropped laterality, a drifted number, a different structure entirely,
  // Latin left in — and mixed with untouched terms the grader must leave alone. It reports
  // sensitivity (planted errors caught) and specificity (clean terms not churned). A pass rate
  // that does not separate the two arms means the review measured nothing.
  const items = JSON.parse(readFileSync(join(WORK, 'set.json'), 'utf8'));
  const find = (en) => items.find((x) => x.key === en.toLowerCase());
  const mutants = [];
  const plant = (en, zh, kind) => { const it = find(en); if (it) mutants.push({ ...it, zh, planted: kind, real: it.zh }); };

  // laterality — the error a learner cannot catch, and the one the app's ids make most likely
  for (const en of ['left gluteus medius', 'left psoas major', 'left first rib', 'left kidney']) {
    const it = find(en); if (it) plant(en, it.zh.replace('左', '右'), 'laterality-flipped');
  }
  for (const en of ['right gluteus maximus', 'right second rib', 'right lung']) {
    const it = find(en); if (it) plant(en, it.zh.replace('右', ''), 'laterality-dropped');
  }
  // numbering
  for (const [en, from, to] of [['first rib', '1', '7'], ['second rib', '2', '9'], ['fourth costal cartilage', '4', '11']]) {
    const it = find(en); if (it) plant(en, it.zh.replace(from, to), 'number-drifted');
  }
  // a different structure entirely — the substitution that reads perfectly and teaches a lie
  plant('gluteus medius', '股四头肌', 'wrong-structure');
  plant('psoas major', '膈肌', 'wrong-structure');
  plant('heart', '肝', 'wrong-structure');
  plant('femur', '肱骨', 'wrong-structure');
  plant('esophagus', '气管', 'wrong-structure');
  plant('scapula', '锁骨', 'wrong-structure');
  // not Chinese anatomical usage at all
  plant('tibia', '小腿的那根大骨头', 'not-terminology');
  plant('mandible', '下巴骨头', 'not-terminology');
  plant('sternum', 'sternum', 'latin-left-in');
  plant('patella', '髌骨 (patella)', 'latin-left-in');

  // the clean arm — untouched shipped terms the grader must NOT churn
  const controls = ['gluteus maximus', 'humerus', 'liver', 'spleen', 'trachea', 'left lung', 'right kidney',
    'thoracic vertebra', 'biceps brachii', 'deltoid', 'aorta', 'urinary bladder', 'thyroid gland', 'sternum',
    'clavicle', 'diaphragm'].map(find).filter(Boolean).filter((x) => !mutants.some((m) => m.key === x.key));

  const batch = [...mutants, ...controls].map((x, i) => ({ ...x, i }));
  console.log(`zh-grade: control arm — ${mutants.length} planted errors + ${controls.length} clean terms`);
  const res = await gradeBatch(batch, 'control', 3);
  if (!res.ok) { console.error('control arm FAILED to grade', res.errors); process.exitCode = 1; }
  else {
    const byI = new Map(res.results.map((r) => [r.i, r]));
    const caught = []; const missed = []; const churned = []; const held = [];
    for (const b of batch) {
      const r = byI.get(b.i);
      if (b.planted) (r.verdict === 'wrong' ? caught : missed).push({ ...b, got: r.verdict, standard: r.standard, reason: r.reason });
      else (r.verdict === 'wrong' ? churned : held).push({ ...b, got: r.verdict, standard: r.standard, reason: r.reason });
    }
    const out = {
      planted: mutants.length, caught: caught.length, missed: missed.length,
      clean: controls.length, churned: churned.length, held: held.length,
      sensitivity: mutants.length ? +(caught.length / mutants.length).toFixed(3) : null,
      specificity: controls.length ? +(held.length / controls.length).toFixed(3) : null,
      caught, missed, churned,
    };
    writeFileSync(join(WORK, 'control.json'), JSON.stringify(out, null, 1));
    console.log(`zh-grade: CAUGHT ${caught.length}/${mutants.length} planted errors · churned ${churned.length}/${controls.length} clean terms`);
    for (const m of missed) console.log(`  MISSED  [${m.planted}] ${m.en}: shipped ${m.real}, shown ${m.zh} -> graded "${m.got}" (${m.reason})`);
    for (const c of churned) console.log(`  CHURNED ${c.en}: ${c.zh} -> "${c.standard}" (${c.reason})`);
  }
}

if (argv.includes('--confirm')) {
  // A term that Wikidata and the model already agreed on independently is not overturned on one
  // reply. This asks the SAME question again, on that term alone and with no mention of the first
  // verdict — anchoring it ("do you agree that X is wrong?") would make the second call a rubber
  // stamp rather than a second opinion.
  const items = JSON.parse(readFileSync(join(WORK, 'set.json'), 'utf8'));
  const byKey = new Map(items.map((x) => [x.key, x]));
  const flagged = [];
  for (const f of readdirSync(WORK).filter((f) => /^grade-\d+\.json$/.test(f)).sort()) {
    const r = JSON.parse(readFileSync(join(WORK, f), 'utf8'));
    if (!r.ok) continue;
    for (const g of r.results) {
      const it = byKey.get(g.key);
      if (g.verdict === 'wrong' && it?.corroborated) flagged.push(it);
    }
  }
  console.log(`zh-grade: ${flagged.length} corroborated terms came back wrong — asking again, one at a time`);
  const out = existsSync(join(WORK, 'confirm.json')) ? JSON.parse(readFileSync(join(WORK, 'confirm.json'), 'utf8')) : {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < flagged.length) {
      const it = flagged[cursor++];
      if (out[it.key]) continue;
      const res = await gradeBatch([it], `confirm-${it.key}`, 3);
      out[it.key] = res.ok ? { verdict: res.results[0].verdict, standard: res.results[0].standard, reason: res.results[0].reason } : { verdict: 'call-failed', errors: res.errors };
      writeFileSync(join(WORK, 'confirm.json'), JSON.stringify(out, null, 1));
      console.log(`  ${it.en}: ${out[it.key].verdict}${out[it.key].standard ? ` -> ${out[it.key].standard}` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, Math.max(flagged.length, 1)) }, worker));
  console.log(`zh-grade: ${Object.values(out).filter((v) => v.verdict === 'wrong').length}/${flagged.length} confirmed wrong on the second call`);
}

if (argv.includes('--report')) {
  const items = JSON.parse(readFileSync(join(WORK, 'set.json'), 'utf8'));
  const byKey = new Map(items.map((x) => [x.key, x]));
  const results = []; const failed = [];
  for (const f of readdirSync(WORK).filter((f) => /^grade-\d+\.json$/.test(f)).sort()) {
    const r = JSON.parse(readFileSync(join(WORK, f), 'utf8'));
    if (!r.ok) { failed.push({ file: f, errors: r.errors }); continue; }
    results.push(...r.results);
  }
  const confirmFile = join(WORK, 'confirm.json');
  const confirms = existsSync(confirmFile) ? JSON.parse(readFileSync(confirmFile, 'utf8')) : {};
  const graded = results.map((r) => ({ ...r, ...(confirms[r.key] ? { confirm: confirms[r.key] } : {}) }));
  const seen = new Set(graded.map((g) => g.key));
  const ungraded = items.filter((x) => !seen.has(x.key)).map((x) => ({ key: x.key, en: x.en, zh: x.zh }));

  const tally = (rows) => rows.reduce((a, r) => { a[r.verdict] = (a[r.verdict] || 0) + 1; return a; }, {});
  const bucket = (pred) => tally(graded.filter((g) => pred(byKey.get(g.key))));
  const report = {
    graded: graded.length,
    ungraded: ungraded.length,
    ungraded_terms: ungraded.slice(0, 50),
    failed_batches: failed,
    grader: `claude -p --model ${MODEL}`,
    translator: 'codex:gpt-6-astra (P3)',
    overall: tally(graded),
    by_source: Object.fromEntries(['llm', 'wikidata', 'manual'].map((s) => [s, bucket((it) => it?.source === s)])),
    by_system: Object.fromEntries([...new Set(items.map((x) => x.sys))].map((s) => [s ?? 'none', bucket((it) => it?.sys === s)])),
    corroborated: bucket((it) => !!it?.corroborated),
    review_sample: bucket((it) => it?.in_review_sample),
    collapsed: bucket((it) => it?.in_collapsed),
    wikidata_disagreed: bucket((it) => !!it?.wikidata_differs),
    results: graded,
  };
  writeFileSync(p('scripts', 'zh-grades.json'), JSON.stringify(report, null, 0));
  const pct = (n) => report.graded ? `${(n / report.graded * 100).toFixed(2)}%` : '-';
  console.log(`zh-grade: ${report.graded} graded, ${report.ungraded} ungraded, ${failed.length} failed batches`);
  console.log(`zh-grade: ${JSON.stringify(report.overall)} — wrong ${pct(report.overall.wrong || 0)}`);
  if (failed.length || report.ungraded) process.exitCode = 1;
}

export { buildSet, gradeBatch, parseArray, callModel, HAS_CJK, HAS_LATIN, norm, key };
