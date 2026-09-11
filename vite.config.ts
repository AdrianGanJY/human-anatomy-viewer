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
const readCommit=()=>{
 try{return execSync('git rev-parse --short HEAD',{cwd:path('./'),stdio:['ignore','pipe','ignore']}).toString().trim()||'dev';}
 catch{return 'dev';}
};
export default defineConfig({root:path('./web'),publicDir:path('./public'),plugins:[react()],resolve:{alias:{'@':path('./')}},css:{postcss:{plugins:[tailwindcss()]}},server:{watch:{usePolling:true}},
 define:{__ATLAS_BUILD__:JSON.stringify(readBuildId()),__ATLAS_COMMIT__:JSON.stringify(readCommit())},// L31 v2 — TWO ENTRIES, ONE BUILD. `web/index.html` stays the default document at `/`; the new
// `web/v2/index.html` lands at `dist/v2/index.html` and is therefore served at `/v2/`.
// It is a DIRECTORY index, not `web/v2.html` as the plan first wrote it, because Cloudflare
// Pages resolves `/v2/` by looking for `/v2/index.html` — a flat `v2.html` answers `/v2.html`
// and `/v2`, but not the trailing-slash form every link in the plan uses.
build:{outDir:path('./dist'),emptyOutDir:true,rollupOptions:{input:{main:path('./web/index.html'),v2:path('./web/v2/index.html')}}}});
