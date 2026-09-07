import {fileURLToPath} from 'node:url';
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
const path=(relative:string)=>fileURLToPath(new URL(relative,import.meta.url));
export default defineConfig({root:path('./web'),publicDir:path('./public'),plugins:[react()],resolve:{alias:{'@':path('./')}},css:{postcss:{plugins:[tailwindcss()]}},server:{watch:{usePolling:true}},// L31 v2 — TWO ENTRIES, ONE BUILD. `web/index.html` stays the default document at `/`; the new
// `web/v2/index.html` lands at `dist/v2/index.html` and is therefore served at `/v2/`.
// It is a DIRECTORY index, not `web/v2.html` as the plan first wrote it, because Cloudflare
// Pages resolves `/v2/` by looking for `/v2/index.html` — a flat `v2.html` answers `/v2.html`
// and `/v2`, but not the trailing-slash form every link in the plan uses.
build:{outDir:path('./dist'),emptyOutDir:true,rollupOptions:{input:{main:path('./web/index.html'),v2:path('./web/v2/index.html')}}}});
