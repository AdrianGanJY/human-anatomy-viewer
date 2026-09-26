/**
 * human-anatomy — ONE Worker: the site, `/mcp`, `/api/snap`, `/api/timing`, and the renderer (L34).
 *
 * ══ WHAT THIS REPLACES ═════════════════════════════════════════════════════════════════════════
 *
 * Until L34 `anatomy.adrian.my` was TWO Cloudflare projects: the Pages project
 * `human-anatomy-viewer` (the site + `functions/`) and the Worker `human-anatomy-snap` (the
 * renderer), joined by a service binding. The split was forced, not chosen: the Browser Rendering
 * binding is a WORKERS binding and Pages Functions cannot hold one. Workers with static assets can
 * hold everything, so the two become one — one deploy, one dashboard entry, one artefact, and a
 * build id that travels WITH the bundle it describes instead of in a second project's config.
 *
 * ⚠️ NEITHER OLD PROJECT IS TOUCHED BY THIS FILE. Both remain deployed and serving until the route
 * moves, which is what makes the cutover reversible: remove `anatomy.adrian.my/*` from
 * `worker/wrangler.toml`, deploy, and Pages is underneath exactly as it was. Adrian deletes the two
 * old projects by hand once he is satisfied.
 *
 * ══ THE ROUTING, AND WHERE THE CSP COMES FROM ══════════════════════════════════════════════════
 *
 * `assets.run_worker_first = ["/mcp", "/api/*"]` — those paths reach THIS Worker; everything else is
 * answered by the Asset Worker directly, which is both cheaper (33 MB of model chunks never invoke a
 * Worker) and the reason the document's security headers come from `dist/_headers` rather than from
 * code. Workers static assets honour `_headers` and `_redirects` the way Pages did; that is asserted
 * against `wrangler dev` BEFORE the edge (`scripts/verify-ux.mjs`, the CSP prelude row) and against
 * the live host after the deploy (`scripts/verify-live.mjs`).
 *
 * The belt below still applies the policy to any `text/html` this Worker itself returns — today
 * that is nothing, because `/mcp` and `/api/*` answer JSON. It is kept because `_headers` covering
 * the document is a fact about the asset layer, and the previous incarnation of this project learned
 * the hard way (`functions/_middleware.js`, S5b) that "the other layer sets it" is a claim worth
 * making unnecessary.
 *
 * ══ AUTH: UNCHANGED, AND DELIBERATELY NOT REIMPLEMENTED HERE ═══════════════════════════════════
 *
 * Cloudflare Access sits in front of the hostname at the edge and is evaluated before a Worker route,
 * exactly as it was before a Worker route existed. Nothing in this increment touches an Access
 * application. The in-function gates are the ones that were already here, called as they were:
 *   · `/mcp`        — `resolveIdentity()` (fail-closed; a verified owner or 401 + WWW-Authenticate)
 *   · `/api/snap`   — the shared secret or a verified owner (`functions/api/snap.js`)
 *   · `/api/timing` — the Access-assertion tripwire (`functions/api/timing.js`)
 *
 * ⚠️ AND THE RENDERER STILL AUTHENTICATES LIKE A STRANGER, on purpose. `renderSnap` drives a real
 * browser to `https://anatomy.adrian.my/?…&snap=1` over the public internet with the adr CF Access
 * SERVICE TOKEN in two request headers. It is tempting, now that the site's bytes are one binding
 * away, to render from `env.ASSETS` instead — but Browser Rendering is a browser: it fetches the
 * document, the JS bundle and 33 MB of geometry over HTTP, and there is no way to hand a binding to
 * it. So the loopback is not merely unproven here, it is unavailable, and the token path is left
 * exactly as it was measured to work. No auth is weakened, widened or bypassed for the merge.
 */
import { onRequest as mcpOnRequest } from '../functions/mcp.js';
import { onRequest as snapOnRequest } from '../functions/api/snap.js';
import { onRequest as timingOnRequest } from '../functions/api/timing.js';
import { snapBinding } from './snap-binding.mjs';
import { SITE_BUILD } from './build-id.mjs';

/** What `/api/timing` reports, so a reader can SEE which of the two deployments answered. */
const WORKER_NAME = 'human-anatomy';

const CANONICAL_HOST = 'anatomy.adrian.my';

/**
 * The policy, byte-identical to `public/_headers` and `functions/_middleware.js`.
 * `test/v2-csp.test.mjs` asserts all three agree, so they cannot drift.
 */
const CSP = "default-src 'self'; connect-src 'self' https://api.openai.com; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

/** Paths that must reach their handler unredirected on ANY hostname (see `_middleware.js`). */
const EXEMPT = (pathname) => pathname === '/mcp' || pathname.startsWith('/api/');

/**
 * A hostname that is NOT a public copy of the app. `wrangler dev` serves on loopback, and a 301 to
 * the canonical host there would make a local gate impossible to run — which is precisely why
 * `wrangler pages dev` could never serve this project (verify-ux.mjs, the CSP block's note).
 */
const isLocal = (h) => h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost');

/**
 * ONE env for every handler, with the renderer presented as the `SNAP` binding the two porting-free
 * files already speak to, and the build identity the timing lane reports.
 *
 * Spread, not mutated: the real `env` is shared across every request in the isolate, and writing the
 * binding onto it would be a cross-request side effect for no gain.
 *
 * ⚠️ BUT THE SPREAD IS MEMOISED, and that is a correctness fix rather than a micro-optimisation —
 * codex round 1, LOW 6. `functions/mcp.js`'s `getIndex` caches the parsed 900 KB index in a WeakMap
 * keyed by `ctx.env` IDENTITY, on the reasoning that a new deploy is a new isolate with a new `env`.
 * A fresh object per request made that key unique every time, so codex measured TWO index fetches and
 * two map rebuilds where a stable env does one. Keyed on the real `env`, the derived object has
 * exactly the lifetime the cache was designed around.
 */
const derivedEnvs = new WeakMap();
function derivedEnv(env) {
  let e = derivedEnvs.get(env);
  if (!e) {
    e = { ...env, SNAP: snapBinding(env), WORKER_NAME, BUILD_ID: SITE_BUILD };
    derivedEnvs.set(env, e);
  }
  return e;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    /**
     * ⚠️ P1's HOLE, AND WHAT ACTUALLY CLOSES IT NOW.
     *
     * Under Pages, `adrian-anatomy.pages.dev` served the whole app to anyone — the `*.adrian.my`
     * Access wildcard does not cover `*.pages.dev` — and `functions/_middleware.js` 301'd every
     * non-canonical host to fix it. This Worker keeps that redirect for the paths it sees, but the
     * honest statement is that the redirect is NOT what protects the site here: with
     * `run_worker_first` scoped to `/mcp` and `/api/*`, a document request never reaches this code.
     * `workers_dev = false` in `worker/wrangler.toml` is what means there is no second hostname to
     * protect, and `test/worker-config.test.mjs` asserts it rather than trusting a reader to notice.
     */
    if (!isLocal(url.hostname) && url.hostname !== CANONICAL_HOST && !EXEMPT(url.pathname)) {
      return new Response(null, {
        status: 301,
        headers: {
          Location: `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const e = derivedEnv(env);

    const ctxLike = { request, env: e, waitUntil: (p) => ctx.waitUntil(p) };

    let res;
    if (url.pathname === '/mcp') {
      res = await mcpOnRequest(ctxLike);
    } else if (url.pathname === '/api/snap') {
      res = await snapOnRequest(ctxLike);
    } else if (url.pathname === '/api/timing') {
      res = await timingOnRequest(ctxLike);
    } else {
      // Everything else this Worker is handed (today: the rest of `/api/*`, e.g. the generated
      // `/api/index.json`) is an ASSET. The binding answers it, `_headers` decorates it.
      return env.ASSETS.fetch(request);
    }

    // The belt described at the head of the file: an HTML answer from THIS Worker carries the policy.
    const type = res.headers.get('content-type') || '';
    if (!type.includes('text/html') || res.headers.has('Content-Security-Policy')) return res;
    const out = new Response(res.body, res);
    out.headers.set('Content-Security-Policy', CSP);
    if (!out.headers.has('X-Content-Type-Options')) out.headers.set('X-Content-Type-Options', 'nosniff');
    if (!out.headers.has('Referrer-Policy')) out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    return out;
  },
};
