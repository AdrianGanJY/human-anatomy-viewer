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
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS = join(ROOT, 'public', 'models', 'atlas.json');
const OUT_DIR = join(ROOT, 'public', 'api');
const OUT = join(OUT_DIR, 'index.json');

const { SYSTEMS, EXPLANATIONS } = await import('../app/anatomy.ts');
if (!Array.isArray(SYSTEMS) || !SYSTEMS.length) throw new Error('app/anatomy.ts gave no SYSTEMS');

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
  const ex = EXPLANATIONS[String(c.name).toLowerCase()];
  if (ex) entry.explanation = ex;
  concepts.push(entry);
}

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
  systems: SYSTEMS.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    concepts: conceptsPerSystem.get(s.id) || 0,
    pieces: piecesPerSystem.get(s.id) || 0,
  })),
  concepts,
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
