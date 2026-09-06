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

Upstream moves fast, so the local changes are deliberately small and rebase-able:

```bash
git fetch upstream
git rebase upstream/main
npm run check && npm run build
pwsh -File ./deploy.ps1
```

## What this fork adds

1. **`app/url-state.ts` + a small patch in `app/page.tsx`** — deep links. Any scene is a URL:

   | Param | Values | Effect |
   |---|---|---|
   | `select` | a concept id (`FMA22315`) or a part id | selects it and opens the detail sheet |
   | `system` | comma list of system ids, or `none` | sets which systems are visible |
   | `isolate` | `1` / `0` | hide everything except the selection |
   | `view` | `front` `back` `side` `three-quarter` | camera |
   | `explode` | `0`–`1` | explode amount |
   | `snap` | `1` | chrome-less canvas (for batch rendering) |

   Read merges `location.search` then `location.hash`, so **the hash wins** — setting
   `location.hash` on an already-loaded page re-selects without a reload. The live scene is mirrored
   back into the query string with `history.replaceState` (never a history entry).

   Example: <https://anatomy.adrian.my/?select=FMA22315&isolate=1&view=front> (gluteus medius).

2. **Machine-readable markers** — `<html data-atlas-ready="1">` once the model finishes loading, and
   `data-atlas-selected="<id>"` for the current selection. Headless verification and the planned
   snapshot renderer key off these instead of guessing at timings.

3. **`body.snap-mode`** — one CSS block at the end of `app/globals.css` that hides every panel,
   sheet, caption and dock, for `?snap=1`.

4. **`deploy.ps1`** — pinned to the Adrey Cloudflare account, credentials loaded from
   `E:\Agentic\ws\infra\.env.adrey` and nulled afterwards.

The upstream WebMCP tools (`app/agent-tools.ts` — `find_anatomy`, `inspect_anatomical_structure`)
are untouched and still register; they work inside browsers that expose `document.modelContext`.

## Hosting

Cloudflare Pages project **`human-anatomy-viewer`** (Adrey account), custom domain `anatomy.adrian.my`,
gated by the estate-wide `*.adrian.my` Cloudflare Access application. Static build only — nothing
runs at request time; Node is the build toolchain.

## Licence

Unchanged from upstream: MIT for the code (`LICENSE`), CC BY 4.0 for the anatomy data
(`public/ATTRIBUTION.md`, served at `/ATTRIBUTION.md`), and the in-app source links stay in place.
