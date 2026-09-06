/**
 * GET /api/snap — the composed view, rendered live to a PNG (L30 P2 §2.4).
 *
 * A thin, FAIL-CLOSED forwarder to the `human-anatomy-snap` Worker (service binding
 * `SNAP`), which owns the browser binding and the R2 cache.
 *
 * WHY IT HAS ITS OWN GATE, measured 2026-09-06 rather than assumed:
 *
 *     GET https://anatomy.adrian.my/api/index.json      -> 200, anonymously
 *     GET https://anatomy.adrian.my/api/nothing-here    -> 200, anonymously
 *
 * The estate runs a Cloudflare Access app on `*.adrian.my/api/*` with a public policy
 * (aud d4319f60…), so every `/api/*` path on every adrian.my host is OUTSIDE the
 * `*.adrian.my` gate. That app is one of the two this session may never touch. So
 * "it is behind Access" is FALSE for this path, and an ungated renderer here would be
 * an open door onto Cloudflare browser minutes and R2 writes for anyone who guessed
 * the URL.
 *
 * Two accepted credentials, both verified, neither optional:
 *   1. `X-Snap-Secret` matching the SNAP_SHARED_SECRET Pages secret — how the MCP
 *      function and any internal caller authenticate.
 *   2. A CF Access JWT that `_access.js` verifies AND resolves to an owner. Note that
 *      a browser session on anatomy.adrian.my carries the WILDCARD app's audience, not
 *      this one, so it will not pass here: the picture is meant to reach Adrian
 *      through the MCP tool result, not by visiting this URL.
 *
 * With neither, 401 — including when the secret is simply not configured.
 */
import { resolveIdentity } from '../_access.js';

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

/** Constant-time-ish compare, so a wrong secret cannot be found one byte at a time. */
function secretEquals(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') {
    return new Response(null, { status: 405, headers: { Allow: 'GET' } });
  }

  const presented = request.headers.get('X-Snap-Secret');
  const bySecret = !!env.SNAP_SHARED_SECRET && !!presented && secretEquals(presented, env.SNAP_SHARED_SECRET);
  let byIdentity = false;
  if (!bySecret) {
    const identity = await resolveIdentity(request, env);
    byIdentity = !!identity?.owner;
  }
  if (!bySecret && !byIdentity) {
    return json(401, {
      error: 'unauthorized',
      detail: 'present X-Snap-Secret, or a Cloudflare Access JWT for the anatomy.adrian.my/mcp application',
    });
  }

  if (!env.SNAP) return json(503, { error: 'no snapshot renderer is bound to this deployment' });

  const url = new URL(request.url);
  // Forwarded verbatim apart from the credential: the Worker owns every bound and
  // every default, so there is exactly one place where "what does size=… mean" is
  // answered.
  const upstream = new Request(`https://human-anatomy-snap.internal/api/snap${url.search}`, {
    method: 'GET',
    headers: { 'X-Snap-Secret': env.SNAP_SHARED_SECRET || '' },
  });
  const res = await env.SNAP.fetch(upstream);
  // Pass the render telemetry through; it is how a caller tells a cache hit from a
  // cold 60-second render.
  const headers = new Headers(res.headers);
  headers.set('Cache-Control', 'private, max-age=86400');
  return new Response(res.body, { status: res.status, headers });
}
