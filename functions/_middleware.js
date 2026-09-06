/**
 * Canonical-host redirect (L30 P2).
 *
 * P1 measured the hole: `adrian-anatomy.pages.dev` served the whole app to anyone,
 * HTTP 200, because the `*.adrian.my` Cloudflare Access wildcard does not cover
 * `*.pages.dev`. Every Pages project has that second hostname, so the new one has it
 * too — this sends it, and any preview deployment URL, to the gated host.
 *
 * `/mcp` and `/api/*` are deliberately EXEMT from the redirect and protected by their
 * own in-function JWT check (`_access.js`) instead:
 *   - a 301 on `/mcp` would turn an MCP POST into a GET at the new host and break the
 *     handshake, and it would hide the 401 + `WWW-Authenticate` that a conformant
 *     client needs in order to start the OAuth flow at all;
 *   - `/api/*` is read by the snapshot renderer and by the MCP function, which already
 *     authenticate.
 * Those two paths therefore fail CLOSED on their own, on every hostname, rather than
 * relying on the edge.
 *
 * Requires `public/_routes.json` to route these paths to Functions; without it Pages
 * answers straight from the CDN and this file never runs.
 */

const CANONICAL_HOST = 'anatomy.adrian.my';

/** Paths that must reach their handler unredirected on ANY hostname. */
const EXEMPT = (pathname) => pathname === '/mcp' || pathname.startsWith('/api/');

export async function onRequest(context) {
  const { request, next } = context;
  const url = new URL(request.url);

  if (url.hostname !== CANONICAL_HOST && !EXEMPT(url.pathname)) {
    // 301: these are GET document requests, the move is permanent, and the criterion
    // this closes is "the pages.dev copy is no longer a way to read the app".
    // Query and path are preserved so a deep link keeps its selection and caption.
    return new Response(null, {
      status: 301,
      headers: {
        Location: `https://${CANONICAL_HOST}${url.pathname}${url.search}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  return next();
}
