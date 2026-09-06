---
app: anatomy
name: Human Anatomy Viewer
purpose: health
domains: anatomy.adrian.my
cf_account: adr
repo: human-anatomy-viewer
maturity: live
prod_status: live
prod_value: 3D anatomy atlas (BodyParts3D) with deep links, owner MCP at /mcp and live snapshots, for yoga body understanding
task_ref: L30
deps: []
---

# anatomy.adrian.my — Human Anatomy Viewer

A 3D whole-body anatomy explorer (BodyParts3D, CC BY 4.0) on the **Adrey** Cloudflare
estate, built for understanding the body in yoga practice. Every view is a URL:
`?select=<id[,id…]>&isolate=1&view=front&title=…&note=…` — so an agent can hand Adrian a
link that opens the live 3D scene with exactly those structures highlighted and a caption
printed over them. Registered in the live catalog at infra.adrian.my (L30 P2b); ingested
by the collector (`/ingest/manifests`).

## What is deployed

| Piece | What |
|---|---|
| Pages project `human-anatomy-viewer` | the site + the `/mcp` Function (`functions/mcp.js`) |
| Worker `human-anatomy-snap` | the live PNG renderer, on Cloudflare **Browser Rendering**; `workers_dev = false`, reached only through the Pages `SNAP` service binding |
| R2 bucket `human-anatomy-snaps` | rendered PNGs, keyed by build + size + canonical params |

`deploy.ps1` is the deploy: it loads `E:\Agentic\ws\infra\.env.adrey`, builds
`public/api/index.json` (the `/mcp` Function's only data source, gitignored + generated),
runs `vite build`, then `wrangler pages deploy` **with no directory argument** —
`wrangler.toml` sets `pages_build_output_dir`, and passing the directory as well produces a
stale Functions bundle. `public/_routes.json` must keep `/mcp` in `include` or the SPA
fallback swallows the route.

## `POST anatomy.adrian.my/mcp` — owner-only MCP (L30 P2)

Six read-only tools: `find_anatomy` · `get_structure` · `list_systems` · **`compose_view`**
· `search` · `fetch`. `compose_view` returns the deep link and, best-effort, an inline PNG
plus an Apps-SDK widget (`ui://widget/anatomy-view.html`).

Gated by a **path-scoped** CF Access app on the exact path `anatomy.adrian.my/mcp` with
Managed OAuth, and verified again **in-function**: `functions/_access.js` checks the CF
Access JWT against `ACCESS_AUD` + `OWNER_EMAILS`/`OWNER_TOKEN_IDS`, so a `.pages.dev` host
is closed by the Function itself and not only by the edge. It is a **byte-identical
vendored copy** of `apps/hub/functions/_access.js` (a unit test asserts the SHA-256), so do
not edit it here. Pinning the `*.adrian.my` wildcard aud here would be wrong and was
measured to be wrong: a JWT minted by the wildcard app is 401'd at `/mcp`.

**Kill switch**: set `ACCESS_AUD = ""` in `wrangler.toml` and redeploy — `/mcp` then 401s
everything.

⚠️ `*.adrian.my/api/*` is a **Public Access** app on this estate, so `/api/*` is
anonymous by default here. `/api/snap` therefore carries **its own** gate (shared secret or
a verified owner JWT for the `/mcp` audience) — an ungated renderer would be an open door
onto metered browser minutes.

## Connect it as an MCP connector

| Field | Value |
|---|---|
| Name | `Human Anatomy Viewer` |
| URL | `https://anatomy.adrian.my/mcp` |
| Auth | OAuth (CF Access Managed OAuth → email OTP) |

ChatGPT: Settings → Connectors → Advanced → **Developer mode** → add the URL.
claude.ai: Settings → Connectors → Add custom connector.

## Upstream

Fork of [`ashemag/human-atlas`](https://github.com/ashemag/human-atlas) at
`AdrianGanJY/human-anatomy-viewer`; `upstream` is a second remote. The patch is kept small
and mostly in new files so `git fetch upstream && git rebase upstream/main` stays cheap.
