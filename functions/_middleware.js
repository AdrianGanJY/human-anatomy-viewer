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

/**
 * ── THE CSP, L31 v2.1b+c S5b — AND WHY IT IS SET HERE AS WELL AS IN `public/_headers` ─────────
 *
 * The reasoning for every directive lives in `public/_headers`; this is the same string, and a unit
 * test (`test/v2-csp.test.mjs`) asserts the two are byte-identical so they cannot drift.
 *
 * `_headers` is documented as applying to STATIC ASSET responses. Every path on this project except
 * the four in `public/_routes.json`'s exclude list is routed to Functions, and this middleware runs
 * on all of them — so whether the asset layer's rules survive `next()` is a question with a real
 * answer that we would otherwise learn by deploying and probing. Setting it here makes the answer
 * irrelevant: the document carries the policy either way, and a duplicate is not possible because
 * this only sets the header when one is not already present.
 *
 * ⚠️ HTML DOCUMENTS ONLY. `/mcp` and `/api/*` answer JSON to non-browser clients; a CSP there is
 * inert at best, and `frame-ancestors` on a JSON body is noise in a log. Scoping on the RESPONSE's
 * content-type rather than on the path also means a future HTML route is covered without anyone
 * remembering to add it.
 */
const CSP = "default-src 'self'; connect-src 'self' https://api.openai.com; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

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

  const res = await next();
  const type = res.headers.get('content-type') || '';
  if (!type.includes('text/html') || res.headers.has('Content-Security-Policy')) return res;
  // A fetched Response's headers are immutable, so the policy goes onto a copy. The body is passed
  // through by reference and is never read here — a middleware that buffered every document would
  // be a latency regression for a diagnostic-grade header.
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', CSP);
  if (!out.headers.has('X-Content-Type-Options')) out.headers.set('X-Content-Type-Options', 'nosniff');
  if (!out.headers.has('Referrer-Policy')) out.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  return out;
}
