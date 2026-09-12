import {execSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
/**
 * ── THE BUILD IDENTITY, DERIVED (L31 v2.1b+c, S1) ──────────────────────────────────────────────
 *
 * Settings -> About prints "Deployed build {build} · commit {commit}". Both were HAND-WRITTEN
 * literals in `shell.tsx`, and by the time the S1 stand-in review read them they said `l31v21a` /
 * `07e76ee` — two increments stale, on the one panel whose entire job is to tell a reader exactly
 * what they are looking at (S1 L1).
 *
 * A second source of truth for a fact that already has one is the recurring staleness defect in
 * this estate, so the panel now reads the fact rather than repeating it: `SITE_BUILD` comes out of
 * `workers/snap/wrangler.toml` (the file `deploy.ps1`'s tripwire already treats as canonical) and
 * the commit out of git. Both are wrapped: a tree without git, or a checkout without the worker
 * config, still builds — it just says `dev`, which is true.
 */
const readBuildId=()=>{
 try{
  const toml=readFileSync(path('./workers/snap/wrangler.toml'),'utf8');
  return /^SITE_BUILD\s*=\s*"([^"]+)"/m.exec(toml)?.[1]??'dev';
 }catch{return 'dev';}
};
/**
 * ── THE PINYIN PRODUCER, DERIVED TOO (S4) ──────────────────────────────────────────────────────
 *
 * Settings -> About has to name the library AND its exact version, and the version is already
 * written down twice: pinned in `package.json` (`--save-exact`) and stamped into
 * `public/i18n/pinyin.json` by the build step that used it. So About reads the ARTIFACT's own
 * stamp — the string produced by the library that actually generated the readings being shipped —
 * and falls back to the pin only if the map is absent. Typing the version into `copy.ts` would
 * have been a third source, and the S1 review is on record about what happens to those.
 */
const readPinyinLib=():{lib:string;n:number}=>{
 let n=0;
 try{
  // The head of the file only — the map itself is ~214 KB and the stamp is in the first few lines.
  const head=readFileSync(path('./public/i18n/pinyin.json'),'utf8').slice(0,600);
  const counts=/"counts"\s*:\s*\{([^}]*)\}/.exec(head)?.[1]??'';
  for(const key of ['concepts','parts','systems'])n+=Number(new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(counts)?.[1]??0);
  const stamped=/"library"\s*:\s*"([^"]+)"/.exec(head)?.[1];
  if(stamped)return{lib:stamped,n};
 }catch{/* fall through to the pin */}
 try{
  const pkg=JSON.parse(readFileSync(path('./package.json'),'utf8')) as {devDependencies?:Record<string,string>};
  const v=pkg.devDependencies?.['pinyin-pro'];
  return{lib:v?`pinyin-pro@${v}`:'pinyin-pro',n};
 }catch{return{lib:'pinyin-pro',n};}
};
/**
 * ── THE RESOLVED DEPENDENCY SET, FOR REAL (S4) ─────────────────────────────────────────────────
 *
 * S0's About says: "Per-dependency licence notices are generated from the resolved package set at
 * build time." NOTHING GENERATED THEM. The runtime list beside it was a hand-typed sentence
 * ("React 19 · three.js r159 · Vite · meshoptimizer · OpenCC"), so the panel whose job is to say
 * what the reader is looking at was making a claim about its own provenance that was not true —
 * the same defect class as the stale `l31v21a` literal the S1 review caught two lines below it.
 *
 * This makes the claim true instead of softening it. Each package's OWN `package.json` in
 * `node_modules` is the resolved fact (not the range in ours), so name + version + declared licence
 * come from there. A package that cannot be read is reported as `name (not resolved)` rather than
 * omitted: a silently shorter list is how an attribution goes missing.
 *
 * ⚠️ WHAT IT IS NOT: the full notice TEXTS. Those are not bundled, and `about.notices` now says so
 * in those words rather than implying a generation step that produces them.
 */
/**
 * TWO GROUPS, LABELLED, because they are not the same claim. `SHIPPED` is what the browser actually
 * downloads — derived by grepping the real import graph rather than from memory:
 *
 *   grep -rhoE "from '(@?[a-z0-9@/._-]+)'" app/ web/ | grep -v '^\.'
 *   => lucide-react, react, react-dom, three
 *
 * That grep is why `lucide-react` is here. My first list was react / react-dom / three / vite /
 * meshoptimizer / opencc-js / pinyin-pro — hand-written, and it MISSED a package the browser really
 * loads (app/page.tsx:8) while listing three that it does not. An attribution list assembled from
 * memory is the same defect as the hand-typed version this replaced, one layer down.
 *
 * `BUILD` is the toolchain that shaped what is shipped: it never reaches the browser, but it is part
 * of the provenance About is describing (meshoptimizer simplified the geometry, OpenCC produced the
 * 繁體 dictionary, pinyin-pro the readings). Listing them unlabelled would imply they are bundled.
 *
 * ⚠️ `package.json` carries a lot of unused scaffolding (shadcn, recharts, cmdk, embla, …). None of
 * it is imported by `app/` or `web/`, so none of it is listed — and that is a claim the grep above
 * is the evidence for, re-runnable by the next reader.
 */
// ⚠️ `scheduler` IS HERE BECAUSE codex ROUND 10 (M3) FOUND IT MISSING. `/v2/` imports
// `react-dom/client`, and react-dom depends on `scheduler` — so the browser downloads it and an
// attribution list built from the IMPORT GRAPH ALONE cannot see it. The grep finds what the source
// names; it does not walk the tree. That is the honest limit of this list and it is stated as one:
// this is the SELECTED inventory of what ships, widened when a reviewer names an omission, not a
// complete transitive attribution (a real one would walk the lockfile — worth doing if this panel
// ever has to satisfy something stricter than "name the sources").
const SHIPPED=['react','react-dom','scheduler','three','lucide-react'];
const BUILD=['vite','meshoptimizer','opencc-js','pinyin-pro'];
const oneDep=(name:string)=>{
 try{
  const p=JSON.parse(readFileSync(path(`./node_modules/${name}/package.json`),'utf8')) as {version?:string;license?:string};
  return p.version?`${name} ${p.version}${p.license?` (${p.license})`:''}`:`${name} (no version)`;
 }catch{
  // NAMED, not dropped. A silently shorter list is how an attribution goes missing, and a checkout
  // with no `npm install` should say so rather than quietly shrink.
  return `${name} (not resolved)`;
 }
};
const readDeps=()=>`${SHIPPED.map(oneDep).join(' · ')} — build tools: ${BUILD.map(oneDep).join(' · ')}`;
const readCommit=()=>{
 try{return execSync('git rev-parse --short HEAD',{cwd:path('./'),stdio:['ignore','pipe','ignore']}).toString().trim()||'dev';}
 catch{return 'dev';}
};
export default defineConfig({root:path('./web'),publicDir:path('./public'),plugins:[react()],resolve:{alias:{'@':path('./')}},css:{postcss:{plugins:[tailwindcss()]}},server:{watch:{usePolling:true}},
 define:{__ATLAS_BUILD__:JSON.stringify(readBuildId()),__ATLAS_COMMIT__:JSON.stringify(readCommit()),__ATLAS_PINYIN__:JSON.stringify(readPinyinLib().lib),__ATLAS_PINYIN_N__:JSON.stringify(readPinyinLib().n),__ATLAS_DEPS__:JSON.stringify(readDeps())},// L31 v2 — TWO ENTRIES, ONE BUILD. `web/index.html` stays the default document at `/`; the new
// `web/v2/index.html` lands at `dist/v2/index.html` and is therefore served at `/v2/`.
// It is a DIRECTORY index, not `web/v2.html` as the plan first wrote it, because Cloudflare
// Pages resolves `/v2/` by looking for `/v2/index.html` — a flat `v2.html` answers `/v2.html`
// and `/v2`, but not the trailing-slash form every link in the plan uses.
build:{outDir:path('./dist'),emptyOutDir:true,rollupOptions:{input:{main:path('./web/index.html'),v2:path('./web/v2/index.html')}}}});
