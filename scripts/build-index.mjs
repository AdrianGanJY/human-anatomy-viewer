/**
 * build-index.mjs — the machine-readable index the /mcp Function serves from.
 *
 * Reads `public/models/atlas.json` (1.3 MB, the app's own catalogue) and writes
 * `public/api/index.json`. Run from deploy.ps1 BEFORE `vite build`, so the file is
 * copied into `dist/` with the rest of `public/`.
 *
 * The systems table and the nine organ explanations are IMPORTED from
 * `app/anatomy.ts` rather than copied here — Node 23 strips the type annotations,
 * and `anatomy.ts` is erasable-syntax-only. One source of truth: if upstream edits a
 * system description, the index says the same thing the UI does. If that import ever
 * breaks, this script FAILS rather than falling back to a stale local copy.
 *
 * A concept's meshes can span systems (a joint capsule, a nerve running through a
 * muscle), so each concept carries the DOMINANT system plus every system it touches.
 * `list_systems` counts a concept once, under its dominant system, so the per-system
 * counts sum to the concept total — a count that does not sum is a count nobody can
 * check.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = join(ROOT, 'public', 'models', 'atlas.json');
const OUT_DIR = join(ROOT, 'public', 'api');
const OUT = join(OUT_DIR, 'index.json');

const { SYSTEMS, EXPLANATIONS } = await import('../app/anatomy.ts');
if (!Array.isArray(SYSTEMS) || !SYSTEMS.length) throw new Error('app/anatomy.ts gave no SYSTEMS');

// L30 P3 — the Chinese names, so /mcp can be asked in Chinese and can answer in it. Written by
// `scripts/build-zh.mjs`, which deploy.ps1 runs BEFORE this script. Absent dictionaries are not
// an error (an English-only deploy is a valid deploy), but the count is reported either way so
// "0 Chinese names" can never be mistaken for "Chinese is fine".
const zh = {};
for (const lang of ['zh-Hans', 'zh-Hant']) {
  const path = join(ROOT, 'public', 'i18n', `${lang}.json`);
  if (!existsSync(path)) continue;
  const body = JSON.parse(readFileSync(path, 'utf8'));
  if (body && body.concepts && body.parts) zh[lang] = body;
}

const atlas = JSON.parse(readFileSync(ATLAS, 'utf8'));
if (!Array.isArray(atlas.parts) || !Array.isArray(atlas.concepts)) {
  throw new Error(`${ATLAS} is not an atlas (no parts/concepts arrays)`);
}

const partSystem = new Map(atlas.parts.map((p) => [p.id, p.system]));

const concepts = [];
let unresolved = 0;
for (const c of atlas.concepts) {
  const tally = new Map();
  for (const e of c.elements) {
    const s = partSystem.get(e);
    if (!s) { unresolved++; continue; }
    tally.set(s, (tally.get(s) || 0) + 1);
  }
  // Ties broken by the SYSTEMS order, so the same atlas always produces the same index.
  let dominant = null; let best = -1;
  for (const s of SYSTEMS) {
    const n = tally.get(s.id) || 0;
    if (n > best) { best = n; dominant = s.id; }
  }
  if (best <= 0) dominant = null;
  const all = SYSTEMS.map((s) => s.id).filter((id) => tally.has(id));
  const entry = {
    id: c.id,
    name: c.name,
    system: dominant,
    pieces: c.elements.length,
  };
  if (all.length > 1) entry.systems = all;
  const hans = zh['zh-Hans']?.concepts?.[c.id];
  const hant = zh['zh-Hant']?.concepts?.[c.id];
  if (hans) entry.name_zh_hans = hans;
  if (hant) entry.name_zh_hant = hant;
  const ex = EXPLANATIONS[String(c.name).toLowerCase()];
  if (ex) entry.explanation = ex;
  concepts.push(entry);
}

// The individual meshes. They were not in the index before P3, which meant a PART id — a
// perfectly valid `select=` value that the live page has always accepted — came back from
// compose_view as "unknown". Including them closes that gap and carries their Chinese names.
const parts = atlas.parts.map((p) => {
  const entry = { id: p.id, name: p.name, concept: p.conceptId, system: p.system };
  const hans = zh['zh-Hans']?.parts?.[p.id];
  const hant = zh['zh-Hant']?.parts?.[p.id];
  if (hans) entry.name_zh_hans = hans;
  if (hant) entry.name_zh_hant = hant;
  return entry;
});

const conceptsPerSystem = new Map();
const piecesPerSystem = new Map();
for (const c of concepts) {
  if (!c.system) continue;
  conceptsPerSystem.set(c.system, (conceptsPerSystem.get(c.system) || 0) + 1);
  piecesPerSystem.set(c.system, (piecesPerSystem.get(c.system) || 0) + c.pieces);
}

const index = {
  generated_at: new Date().toISOString(),
  atlas_version: atlas.version ?? null,
  source: atlas.source ?? 'BodyParts3D',
  scope: atlas.scope ?? null,
  totals: {
    concepts: concepts.length,
    parts: atlas.parts.length,
    triangles: atlas.triangles ?? null,
    // Concepts whose dominant system could not be established at all. Reported rather
    // than dropped: a nonzero value here means the atlas and this script disagree.
    concepts_without_system: concepts.filter((c) => !c.system).length,
    unresolved_element_refs: unresolved,
  },
  languages: {
    available: ['en', ...Object.keys(zh)],
    concepts_zh_hans: concepts.filter((c) => c.name_zh_hans).length,
    concepts_zh_hant: concepts.filter((c) => c.name_zh_hant).length,
    parts_zh_hans: parts.filter((p) => p.name_zh_hans).length,
  },
  systems: SYSTEMS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    name_zh_hans: zh['zh-Hans']?.systems?.[s.id]?.name,
    name_zh_hant: zh['zh-Hant']?.systems?.[s.id]?.name,
    concepts: conceptsPerSystem.get(s.id) || 0,
    pieces: piecesPerSystem.get(s.id) || 0,
  })),
  concepts,
  parts,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify(index));
const kb = Math.round(Buffer.byteLength(JSON.stringify(index)) / 1024);
console.log(
  `build-index: ${concepts.length} concepts, ${atlas.parts.length} parts, `
  + `${index.systems.filter((s) => s.concepts).length}/${SYSTEMS.length} systems populated, `
  + `${index.totals.concepts_without_system} without a system, `
  + `${unresolved} unresolved element refs -> public/api/index.json (${kb} KB)`,
);
console.log(
  `build-index: languages ${index.languages.available.join(', ')} — `
  + `${index.languages.concepts_zh_hans}/${concepts.length} concepts and `
  + `${index.languages.parts_zh_hans}/${parts.length} parts carry a 简体 name`,
);
