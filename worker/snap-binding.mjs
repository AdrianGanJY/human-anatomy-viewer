/**
 * THE SNAP BINDING, WITHOUT A SERVICE — L34.
 *
 * `functions/api/snap.js` and `functions/_renderer.js` both talk to the renderer through
 * `env.SNAP.fetch(request)`. That was a Cloudflare SERVICE binding to a second Worker
 * (`human-anatomy-snap`), and everything those two files know about failure — the 429/424
 * translation, the ONE-promise rule that stopped a timed-out render costing two billed browsers, the
 * 204 cache probe passthrough — is written against that `fetch()` shape and was paid for by measured
 * incidents.
 *
 * So the merge does NOT rewrite them. It presents the in-process renderer behind the SAME shape:
 *
 *     env.SNAP = { fetch: (request) => renderSnap(request, env) }
 *
 * The hop disappears; the contract does not. That is deliberately the smallest possible diff across
 * the two most dangerous files in this project, and it is what makes "behaviour-preserving" a claim
 * the existing unit suites can check rather than a hope.
 *
 * ⚠️ THE SECRET STILL MATCHES BY CONSTRUCTION, and it is worth saying why this is not now a hole.
 * The callers send `X-Snap-Secret: env.SNAP_SHARED_SECRET` and `renderSnap` compares against
 * `env.SNAP_SHARED_SECRET` — one env, both sides, so the internal call authenticates exactly as it
 * did across the service binding. The EXTERNAL gate on `/api/snap` is unchanged and is the one that
 * matters: `functions/api/snap.js` still demands either that shared secret from the caller or a
 * verified Access JWT that resolves to an owner.
 */
import { renderSnap } from './snap/render.mjs';

export const snapBinding = (env) => ({
  fetch: (request) => renderSnap(request instanceof Request ? request : new Request(request), env),
});
