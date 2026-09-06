# human-anatomy-viewer — the fork behind anatomy.adrian.my

A fork of [`ashemag/human-atlas`](https://github.com/ashemag/human-atlas) (MIT code, CC BY 4.0
anatomy from BodyParts3D 4.0), hosted at **https://anatomy.adrian.my** so an AI assistant can point
at a structure in a real 3D body — the visual anchor that a chat about a muscle or a bone otherwise
lacks. Task **L30** in the Life workspace.

Built from upstream **`7a383d3ee2759e3ddf157c704fb8814fd0c50bcb`** ("Improve phone layouts and
anatomy inspection", 2026-09-06).

## Remotes

| Remote | Repo |
|---|---|
| `origin` | `AdrianGanJY/human-anatomy-viewer` (this fork — push here) |
| `upstream` | `ashemag/human-atlas` (read-only) |

Upstream moves fast, so the changes to ITS files are deliberately small and rebase-able — only
`app/url-state.ts` (new), a handful of lines in `app/page.tsx`, one line in `app/scene.tsx` and one
CSS block at the end of `app/globals.css`. Everything else this fork adds lives in `functions/`,
`scripts/`, `workers/`, `test/` and `public/_routes.json`, which upstream will never touch.

```bash
git fetch upstream
git rebase upstream/main
npm run check && node --test test/mcp.test.mjs && pwsh -File ./deploy.ps1
```

## What this fork adds

### 1. Deep links — every scene is a URL

| Param | Values | Effect |
|---|---|---|
| `select` | **a comma list** of concept ids (`FMA22315`) and/or part ids | selects the UNION of their meshes and opens the detail sheet on the first |
| `system` | comma list of system ids, or `none` | which systems are visible |
| `isolate` | `1` / `0` | hide everything except the selection |
| `view` | `front` `back` `side` `three-quarter` | camera |
| `explode` | `0`–`1` | explode amount |
| `title` | ≤ 80 chars | caption heading, drawn over the scene |
| `note` | ≤ 600 chars | caption body, drawn over the scene |
| `snap` | `1` | chrome-less canvas — everything hidden EXCEPT the caption |
| `size` | `WxH` | honoured by the renderer only; the live page ignores it |
| `lang` | `en` `zh-Hans` `zh-Hant` | interface + name language. Beats the remembered choice; omitted from the URL when `en` |

Read merges `location.search` then `location.hash`, so **the hash wins** — setting `location.hash`
on an already-loaded page re-selects **without a reload**. That is not a convenience: it is what
lets the snapshot renderer reuse a loaded tab, which is the difference between a 60-second render
and a 21-second one.

`title`/`note` are rendered as React text nodes. A caption of `<img src=x onerror=…>` appears as
those characters and creates zero nodes — asserted live, not assumed.

Example: <https://anatomy.adrian.my/?select=FMA22315,FMA22314,FMA18060&isolate=1&view=back&title=Hip%20stabilisers&note=These%20stabilise%20the%20pelvis%20in%20tree%20pose.>

### 1b. The selection basket, and Chinese (L30 P3)

**The basket.** `picks` — an ordered list of the ids the caller asked for — is the source of
truth; `state.selected` (what the scene highlights) is *derived* from it as the union of their
meshes, by one effect, so the list, the URL and the 3D view cannot disagree. `app/selection.ts`
holds the pure helpers. Tapping the 3D view, a search result or opening a link **replaces** the
set (upstream's ergonomics); the **`+`** on a search row, the `+` on a member row, **Shift-click**
in the 3D view, and the WebMCP tool `add_to_selection` all **add**. "Hide others" in the basket
is the same `isolate` flag the detail sheet's "Isolate structure" toggles. A pick may be a concept
id *or* a part id — the URL contract round-trips exactly what the caller named, and rewriting part
ids to their concept would make a single mesh unreachable.

**Chinese.** Upstream has no i18n; `atlas.json` is English only. So the names are built:

- `scripts/zh-wikidata.json` — 3,420 FMA→Wikidata items, 656 with a Chinese label (measured).
- `scripts/translate-zh.mjs` — the codex lane (`gpt-6-astra`), batched, retried, cached into
  `scripts/zh-llm-cache.json`. **Run by hand, never by the deploy.**
- `scripts/build-zh.mjs` — offline and deterministic. Writes `public/i18n/zh-Hans.json` +
  `zh-Hant.json` (繁體 derived from 简体 with `opencc-js`, never translated twice),
  `scripts/zh-sources.json` (provenance per id) and `scripts/zh-review-sample.md` (60 terms for
  Adrian). `deploy.ps1` runs it **before** `build-index.mjs`, which copies both names into
  `/api/index.json` so `/mcp` can be asked in Chinese.

**Precedence, decided by measurement, not by the plan.** Exact agreement between Wikidata and the
model over the 656 anchored concepts is **60.2%**, and the disagreements are systematic: Wikidata
carries encyclopedia article titles, Taiwan usage, and some outright wrong concepts
(`vertebra` → 椎骨切迹, `nasolacrimal duct` → 泪器). So the model's mainland-standard term ships,
Wikidata corroborates where they agree and fills in where the model has nothing, and every
disagreement is listed in `scripts/zh-review-sample.md` for Adrian to overrule.

**To fix a term**: one line in `scripts/zh-llm-cache.json` —
`terms["<lowercase english>"] = {"zh":"…","lane":"manual"}` — then `node scripts/build-zh.mjs`
and redeploy. Manual beats everything.

### 2. `POST /mcp` — a read-only MCP server

Six owner-only tools: `find_anatomy`, `get_structure`, `list_systems`, **`compose_view`**, and the
ChatGPT connector pair `search` / `fetch`. `compose_view` is the point — an assistant names several
structures and its own sentence, and gets back a link that opens the live view with all of them
highlighted and that sentence printed over the scene, plus (best-effort) a rendered PNG inline.

- `functions/_access.js` is a **byte-identical vendored copy** of `E:/Agentic/apps/hub/functions/_access.js`
  (A234). `test/mcp.test.mjs` asserts that, so drift is a failing test rather than a discovery.
  Fail-closed: no `ACCESS_AUD`, no access.
- Auth is a dedicated **path-scoped** Cloudflare Access app on `anatomy.adrian.my/mcp`
  (aud `49062b68…`, policies `adr-adrian` + `adr-adrian-agent`) with Managed OAuth. The
  `*.adrian.my` wildcard app is never touched. A JWT minted for the wildcard is *rejected* here —
  measured, both via `Authorization: Bearer` and `Cf-Access-Jwt-Assertion`.
- **Kill switch**: set `ACCESS_AUD = ""` in `wrangler.toml` and redeploy; the function then 401s
  everything.
- `scripts/build-index.mjs` writes `public/api/index.json` (3,432 concepts, ~300 KB) at deploy time
  and *imports* the systems table and explanations from `app/anatomy.ts`, so the index cannot
  disagree with the UI. The file is gitignored — it is derived from `public/models/atlas.json`.

### 3. `GET /api/snap` — live PNG rendering

`workers/snap/` is a separate Worker holding the Cloudflare Browser Rendering binding (Pages
Functions cannot take one) and an R2 cache; the Pages project reaches it through the `SNAP` service
binding. Measured on this account, 2026-09-06:

| path | time |
|---|---|
| cold (new browser, new tab) | **67 s** |
| warm session, new tab | 51 s |
| warm session, **reused tab** (hash re-drive) | **21–27 s** |
| R2 cache hit | **0.2–1.1 s** |

⚠️ **Browser time is metered and this account has a limit.** After roughly six renders in twenty
minutes, `puppeteer.launch` answered `429 Rate limit exceeded` while cache hits kept serving. An
idle keep-alive bills like a working one, so `KEEP_ALIVE_MS` is 2 minutes, not the 10-minute
maximum. `compose_view` therefore treats the picture as best-effort: a 20-second budget, then it
answers with the link and finishes the render in `waitUntil` so the same request a minute later is
instant. **The link always works.**

> `/api/snap` carries its own gate and must: measured, `GET /api/index.json` and `/api/nothing-here`
> on this host both answer **200 anonymously**, because the estate runs a public
> `*.adrian.my/api/*` Access app. "It is behind Access" is false for `/api/*` here. Only the
> `X-Snap-Secret` shared secret or a verified owner JWT for the `/mcp` audience passes.

### 4. The Apps SDK widget

`resources/read ui://widget/anatomy-view.html` returns a self-contained `text/html+skybridge` card
that reads `window.openai.toolOutput` and shows the PNG (as a `data:` URI — no cross-origin fetch,
so Access is irrelevant inside the sandbox), the caption as real text, the ids, and an
"Open in 3D" link. It writes every value with `textContent`/`setAttribute`, accepts an image only
if it is a `data:` URI and a link only if it points at `anatomy.adrian.my`.

## Secrets

`SNAP_CF_ID`, `SNAP_CF_SECRET` (the `adr` CF Access service token) and `SNAP_SHARED_SECRET` are
**wrangler secrets** — `wrangler secret put` on the Worker, `wrangler pages secret put` on the Pages
project. None of them are in `wrangler.toml` and none are committed. `ACCESS_AUD`, `OWNER_EMAILS`
and `OWNER_TOKEN_IDS` are public identifiers and are committed on purpose.

## Deploy

```powershell
pwsh -File ./deploy.ps1                       # site + Functions  (Pages: human-anatomy-viewer)
cd workers/snap; npx wrangler deploy          # the renderer      (Worker: human-anatomy-snap)
```

`deploy.ps1` loads `E:\Agentic\ws\infra\.env.adrey` itself (the wrangler OAuth session on this box
is gone and dies with a native crash and no error text), builds the index, builds the site, asserts
that `dist/api/index.json` and `dist/_routes.json` exist, deploys, and nulls the credentials in a
`finally`.

## Verify

```powershell
node --test test/mcp.test.mjs                                   # 31 unit tests
$env:CF_ID=…; $env:CF_SECRET=…                                  # the adr service token
node scripts/verify-live.mjs https://anatomy.adrian.my <outDir> live   # 28 live assertions
```

## Hosting

Cloudflare Pages project **`human-anatomy-viewer`** (Adrey account), custom domain
`anatomy.adrian.my`, the site itself gated by the estate-wide `*.adrian.my` Access application.
`functions/_middleware.js` 301s every other hostname (including `*.pages.dev`) to the custom domain;
`/mcp` and `/api/*` are exempt and fail closed on their own instead.

The retired predecessor project `adrian-anatomy` serves only `scripts/retired-page/index.html`.

## Licence

Unchanged from upstream: MIT for the code (`LICENSE`), CC BY 4.0 for the anatomy data
(`public/ATTRIBUTION.md`, served at `/ATTRIBUTION.md`), and the in-app source links stay in place.
