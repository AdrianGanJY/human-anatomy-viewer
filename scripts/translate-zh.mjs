/**
 * translate-zh.mjs — fill `scripts/zh-llm-cache.json` from the codex lane (L30 P3).
 *
 * This is the ONLY part of the Chinese pipeline that talks to a model, and it is deliberately
 * NOT part of `deploy.ps1`: the deploy runs `build-zh.mjs`, which is offline and deterministic
 * and reads the cache this script fills. Run it by hand when `build-zh.mjs` reports missing
 * terms (it writes `scripts/zh-missing.json` naming exactly which).
 *
 *   node scripts/build-zh.mjs        # writes scripts/zh-missing.json
 *   node scripts/translate-zh.mjs    # fills the cache, batch by batch
 *   node scripts/build-zh.mjs        # now complete
 *
 * Lane: `codex exec -m gpt-6-astra` (the ChatGPT subscription), falling back to `gpt-5.6-sol`
 * and then to `claude -p --model sonnet`. Whichever lane answered is recorded per entry, so
 * `scripts/zh-sources.json` can say where every name came from.
 *
 * A batch whose answer does not parse, or comes back with the wrong number of entries, or
 * contains an item with no CJK in it, is RETRIED — never partially accepted. The cache is
 * written after every batch, so an interrupted run resumes where it stopped.
 *
 * Flags: --limit N (only N batches) · --terms-only · --prose-only · --batch N · --jobs N
 */
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const p = (...bits) => join(ROOT, ...bits);
const CACHE = p('scripts', 'zh-llm-cache.json');
const MISSING = p('scripts', 'zh-missing.json');

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] !== undefined ? Number(argv[i + 1]) : dflt;
};
const TERM_BATCH = flag('--batch', 150);
const PROSE_BATCH = 25;
const JOBS = flag('--jobs', 3);
const LIMIT = flag('--limit', Infinity);
const TERMS_ONLY = argv.includes('--terms-only');
const PROSE_ONLY = argv.includes('--prose-only');

/** codex ships as a Rust binary behind a node shim; spawning the shim directly avoids the
 *  Windows `.cmd` shell hop (and the quoting it would drag in). */
const CODEX_JS = process.env.CODEX_JS
  || join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'bin', 'codex.js');

const LANES = [
  { name: 'codex:gpt-6-astra', kind: 'codex', model: 'gpt-6-astra' },
  { name: 'codex:gpt-5.6-sol', kind: 'codex', model: 'gpt-5.6-sol' },
  { name: 'claude:sonnet', kind: 'claude', model: 'sonnet' },
];

const TERM_RULES = `Rules
- "zh" is the TERM ONLY: no explanation, no notes, no pinyin, no English, no parentheses, no trailing punctuation.
- Simplified Chinese characters only.
- Keep laterality: "left ..." -> 左..., "right ..." -> 右... (as a prefix).
- Keep numbering with Arabic numerals in 第N form and keep it consistent: cervical 第1颈椎…第7颈椎, thoracic 第N胸椎, lumbar 第N腰椎, sacral 第N骶椎, ribs 第N肋, teeth and digits likewise.
- "system" is the anatomical system and "parent" (when present) is the named structure this mesh belongs to. Use them to disambiguate only; never put them in the answer.
- If a term has no established Chinese name, give the accepted descriptive anatomical translation, still term-only.`;

const PROSE_RULES = `Rules
- Natural, concise mainland Chinese, written the way a real product writes it. Not literal, not stiff.
- kind "ui" is a button label, heading, placeholder or screen-reader label: keep it SHORT. A button label stays a button label.
- kind "system-name" is the name of an anatomical system. kind "system-description" and "explanation" are one-paragraph educational text: translate faithfully and keep the terminology standard (人体解剖学名词).
- Keep every {n} / {p} / {name} placeholder EXACTLY as written, braces included. Do not translate, add or drop one.
- Keep the numerals (2,234 / 3,432), the middot ·, the ampersand and © exactly as they appear.
- Simplified Chinese characters only. No pinyin, no English gloss, no notes.`;

function termPrompt(items) {
  return `You are translating anatomical TERM NAMES for a 3D human anatomy viewer, into Simplified Chinese using the standard mainland nomenclature (全国科学技术名词审定委员会《人体解剖学名词》).

${TERM_RULES}

INPUT (JSON array of {key, en, system, parent}):
${JSON.stringify(items.map((x) => ({ key: x.key, en: x.en, system: x.system, parent: x.parent })))}

OUTPUT: ONLY a JSON array [{"key":"…","zh":"…"}] with exactly ${items.length} entries, one per input, in the same order, echoing each "key" verbatim. No prose, no markdown fence, nothing else.
`;
}

function prosePrompt(items) {
  return `You are translating the interface copy of a 3D human anatomy viewer into Simplified Chinese.

${PROSE_RULES}

INPUT (JSON array of {key, en, kind, context}):
${JSON.stringify(items.map((x) => ({ key: x.key, en: x.en, kind: x.kind, context: x.context })))}

OUTPUT: ONLY a JSON array [{"key":"…","zh":"…"}] with exactly ${items.length} entries, one per input, in the same order, echoing each "key" verbatim. No prose, no markdown fence, nothing else.
`;
}

// ── running a lane ──────────────────────────────────────────────────────────

function run(cmd, args, stdin, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = ''; let err = ''; let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; child.kill(); resolve({ code: -1, out, err: `${err}\n[timeout after ${timeoutMs} ms]` }); } }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { if (!done) { done = true; clearTimeout(timer); resolve({ code: -1, out, err: String(e) }); } });
    child.on('close', (code) => { if (!done) { done = true; clearTimeout(timer); resolve({ code, out, err }); } });
    child.stdin.end(stdin, 'utf8');
  });
}

async function ask(lane, prompt) {
  const dir = mkdtempSync(join(tmpdir(), 'zh-'));
  const outFile = join(dir, 'out.txt');
  try {
    if (lane.kind === 'codex') {
      if (!existsSync(CODEX_JS)) return { error: `codex shim not found at ${CODEX_JS}` };
      const r = await run(process.execPath, [
        CODEX_JS, 'exec', '--ignore-user-config', '-m', lane.model,
        '-c', 'model_reasoning_effort="medium"', '-s', 'read-only', '--skip-git-repo-check',
        '-C', dir, '-o', outFile,
      ], prompt, 15 * 60 * 1000);
      // `-o` fails SILENTLY when it cannot write; the final message still lands on stdout.
      const text = existsSync(outFile) ? readFileSync(outFile, 'utf8') : r.out;
      if (!text.trim()) return { error: `empty answer (exit ${r.code}) ${r.err.slice(-300)}` };
      return { text };
    }
    const r = await run('claude', ['-p', '--model', lane.model], prompt, 15 * 60 * 1000);
    if (!r.out.trim()) return { error: `empty answer (exit ${r.code}) ${r.err.slice(-300)}` };
    return { text: r.out };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ── parsing ─────────────────────────────────────────────────────────────────

const HAS_CJK = /[㐀-䶿一-鿿豈-﫿]/;

/** The answer, or a REASON it is not usable. A batch is accepted whole or not at all: a
 *  half-parsed batch would silently leave the rest of its terms in English. */
function parseBatch(text, items) {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return { error: 'no JSON array in the answer' };
  let rows;
  try { rows = JSON.parse(text.slice(start, end + 1)); } catch (e) { return { error: `JSON parse failed: ${e.message}` }; }
  if (!Array.isArray(rows)) return { error: 'answer is not an array' };
  if (rows.length !== items.length) return { error: `answer has ${rows.length} entries, expected ${items.length}` };
  const wanted = new Map(items.map((x) => [x.key, x]));
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const k = typeof row?.key === 'string' ? row.key : items[i].key;
    if (!wanted.has(k)) return { error: `answer names a key that was not asked for: ${String(k).slice(0, 60)}` };
    const zh = typeof row?.zh === 'string' ? row.zh.replace(/\s+/g, ' ').trim() : '';
    if (!zh) return { error: `empty translation for ${k}` };
    if (!HAS_CJK.test(zh)) return { error: `no Chinese characters in the translation of ${k}: ${zh.slice(0, 40)}` };
    out.push({ key: k, zh });
  }
  return { rows: out };
}

// ── the run ─────────────────────────────────────────────────────────────────

if (!existsSync(MISSING)) { console.error(`translate-zh: ${MISSING} is missing — run \`node scripts/build-zh.mjs\` first.`); process.exit(1); }
const missing = JSON.parse(readFileSync(MISSING, 'utf8'));
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { terms: {}, prose: {} };
cache.terms ||= {}; cache.prose ||= {};

const chunk = (list, n) => { const out = []; for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n)); return out; };
const jobs = [];
if (!PROSE_ONLY) for (const items of chunk(missing.terms || [], TERM_BATCH)) jobs.push({ kind: 'terms', items });
if (!TERMS_ONLY) for (const items of chunk(missing.prose || [], PROSE_BATCH)) jobs.push({ kind: 'prose', items });
const queue = jobs.slice(0, Number.isFinite(LIMIT) ? LIMIT : jobs.length);

console.log(`translate-zh: ${missing.terms?.length ?? 0} terms + ${missing.prose?.length ?? 0} prose strings -> ${queue.length} batch(es), ${JOBS} at a time`);

let done = 0; let failed = 0; let next = 0;
const failures = [];
const save = () => writeFileSync(CACHE, JSON.stringify(cache, null, 0));

async function worker(id) {
  for (;;) {
    const i = next++;
    if (i >= queue.length) return;
    const job = queue[i];
    const prompt = job.kind === 'terms' ? termPrompt(job.items) : prosePrompt(job.items);
    let accepted = false;
    for (const lane of LANES) {
      for (let attempt = 1; attempt <= 2 && !accepted; attempt++) {
        const a = await ask(lane, prompt);
        if (a.error) { console.log(`  [w${id}] batch ${i + 1}/${queue.length} ${lane.name} attempt ${attempt}: ${a.error.slice(0, 160)}`); continue; }
        const parsed = parseBatch(a.text, job.items);
        if (parsed.error) { console.log(`  [w${id}] batch ${i + 1}/${queue.length} ${lane.name} attempt ${attempt}: ${parsed.error.slice(0, 160)}`); continue; }
        const bucket = job.kind === 'terms' ? cache.terms : cache.prose;
        for (const row of parsed.rows) bucket[row.key] = { zh: row.zh, lane: lane.name };
        save();
        accepted = true;
        done++;
        console.log(`  [w${id}] batch ${i + 1}/${queue.length} OK — ${parsed.rows.length} via ${lane.name} (${done}/${queue.length} done)`);
      }
      if (accepted) break;
    }
    if (!accepted) { failed++; failures.push({ batch: i + 1, kind: job.kind, keys: job.items.map((x) => x.key) }); console.log(`  [w${id}] batch ${i + 1}/${queue.length} FAILED on every lane`); }
  }
}

await Promise.all(Array.from({ length: Math.max(1, JOBS) }, (_, i) => worker(i + 1)));
save();
if (failures.length) writeFileSync(p('scripts', 'zh-failed-batches.json'), JSON.stringify(failures, null, 1));
console.log(`translate-zh: ${done} batch(es) accepted, ${failed} failed. Cache now holds ${Object.keys(cache.terms).length} terms + ${Object.keys(cache.prose).length} prose strings.`);
if (failed) process.exitCode = 1;
