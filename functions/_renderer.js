/**
 * The one door to the snapshot renderer. L30 P4a.
 *
 * Two callers reach the `human-anatomy-snap` Worker: `functions/api/snap.js` over HTTP and
 * `functions/mcp.js` over the service binding. Until now only the HTTP one translated the
 * renderer's failures into something legible, so the MCP path — the path a chat client
 * actually uses — reported a rate limit as
 * `renderer answered 502 application/json: {…}` truncated at 200 characters.
 *
 * Everything about talking to the renderer now lives here: the budget, the classification,
 * and the ONE fix that matters most on a metered account.
 *
 * THE DOUBLE RENDER. The previous code raced `env.SNAP.fetch(request())` against a timer
 * and then, on timeout, called `env.SNAP.fetch(request())` AGAIN inside ctx.waitUntil — a
 * second, freshly-constructed request. The race loser was never aborted, and the second
 * call could not reuse the first's browser session (that session now holds a connectionId),
 * so it launched another browser: two concurrent billed browsers for one picture, on an
 * account that answers 429 after roughly six renders. Since EVERY uncached render exceeded
 * the old budget, that was not an edge case — it was the normal path. Raising the budget
 * would have made it fire more often, not less.
 *
 * The fix is one line of discipline: create the promise ONCE and hand the SAME promise to
 * both the race and to waitUntil. A timed-out render then costs one browser and keeps
 * running, so the retry a moment later is an R2 cache hit instead of a second cold render.
 */

const SITE_ORIGIN = 'https://anatomy.adrian.my';

/** What a caller gets back. `state` is the vocabulary the tools report to the model. */
export const RENDER_STATES = ['ok', 'pending', 'rate_limited', 'renderer_down', 'page_error', 'not_cached'];

/**
 * 429 stays 429; anything else becomes 424 Failed Dependency. Both are 4xx, and that is
 * the load-bearing part: measured 2026-09-06, a Pages Function answering 5xx is REPLACED by
 * Cloudflare's branded HTML error page, so the renderer's own words never reach the caller.
 * A rate-limited renderer is a well-defined, expected, retryable condition — not a fault.
 */
export function classifyRendererFailure(status, text) {
  const rateLimited = /rate limit|429|browser time limit/i.test(text || '') || status === 429;
  return {
    status: rateLimited ? 429 : 424,
    state: rateLimited ? 'rate_limited' : 'renderer_down',
    error: rateLimited ? 'renderer_rate_limited' : 'renderer_failed',
    detail: text || `the renderer answered ${status}`,
    ...(rateLimited ? { hint: 'Cloudflare Browser Rendering time is metered on this account. Cached views still serve; the deep link always works.' } : {}),
  };
}

const snapRequest = (env, query) => new Request(`${SITE_ORIGIN}/api/snap?${query}`, {
  method: 'GET',
  headers: { 'X-Snap-Secret': env.SNAP_SHARED_SECRET || '' },
});

/**
 * Ask the renderer for `query`, waiting at most `budgetMs`.
 *
 * Returns one of:
 *   { state:'ok', bytes, cache, ms, settle }   a PNG
 *   { state:'not_cached' }                     a cacheonly probe that missed (204)
 *   { state:'pending', error }                 still rendering; the SAME promise was handed
 *                                              to waitUntil, so the retry is a cache hit
 *   { state:'rate_limited' | 'renderer_down' | 'page_error', error }
 *
 * `env.SNAP_FALLBACK_ORIGIN` is a declared seam, not a feature: when it is set as a Pages
 * secret this retries a 429 or a 5xx against that origin with the same shared secret. It is
 * empty today, costs nothing, and means a second renderer can later be pointed at with one
 * `wrangler pages secret put` and no code change.
 */
export async function callRenderer(env, query, budgetMs, ctx) {
  if (!env.SNAP) return { state: 'renderer_down', error: 'no snapshot renderer is bound to this deployment' };

  // ONE promise. Both the race and the background backfill below use THIS object.
  const inflight = env.SNAP.fetch(snapRequest(env, query));
  let timer;
  const budget = new Promise((resolve) => { timer = setTimeout(() => resolve(null), budgetMs); });

  let res;
  try {
    res = await Promise.race([inflight.catch((e) => ({ __err: e })), budget]);
  } finally {
    clearTimeout(timer);
  }

  if (res === null) {
    // Keep the SAME render alive past this response — that is what turns the retry into an
    // instant cache hit rather than a second metered render.
    if (ctx && ctx.waitUntil) ctx.waitUntil(inflight.then(() => {}).catch(() => {}));
    // Deliberately NOT "call again and it will be instant". There is no cross-request lock
    // here — no KV, no D1 — so an immediate retry finds no R2 object yet, cannot join the
    // running render (its session already holds a connectionId), and launches a SECOND
    // browser for the same picture. Telling the model to wait first is the only mitigation
    // this deployment can honestly offer.
    return {
      state: 'pending',
      error: `not rendered within ${Math.round(budgetMs / 1000)} s — a view this atlas has not drawn before costs about a minute on this account, and it is still rendering. WAIT about a minute before calling this tool again with the SAME arguments; calling it again immediately starts a second render instead of finding the first. The link works now.`,
    };
  }
  if (res && res.__err) {
    console.error('renderer unreachable:', res.__err);
    return { state: 'renderer_down', error: 'the snapshot renderer could not be reached' };
  }

  // A cacheonly probe that missed. Not an error — it is the answer to the question asked.
  if (res.status === 204) return { state: 'not_cached' };

  const ct = res.headers.get('content-type') || '';
  if (!res.ok || !/image\/png/i.test(ct)) {
    const text = /json|text/i.test(ct) ? (await res.text()).slice(0, 400) : '';
    const c = classifyRendererFailure(res.status, text);
    // The Worker returns 424 with this shape when the PAGE itself reported an error, which
    // is a different thing from the renderer being down and must not be retried blindly.
    const isPageError = /reported an error while rendering/i.test(text);
    if (!isPageError && env.SNAP_FALLBACK_ORIGIN && (c.status === 429 || res.status >= 500)) {
      const alt = await fetch(`${env.SNAP_FALLBACK_ORIGIN}/api/snap?${query}`, {
        headers: { 'X-Snap-Secret': env.SNAP_SHARED_SECRET || '' },
      }).catch(() => null);
      if (alt && alt.ok && /image\/png/i.test(alt.headers.get('content-type') || '')) {
        return { state: 'ok', bytes: new Uint8Array(await alt.arrayBuffer()), cache: 'fallback', ms: null, settle: null };
      }
    }
    return {
      state: isPageError ? 'page_error' : c.state,
      error: isPageError
        ? 'the viewer could not load the anatomy for this scene, so no picture was produced (the link still works)'
        : `${c.detail}`,
    };
  }

  // The budget covered the HEADERS; the body is a separate stream that can still fail. An
  // exception here would escape to callTool's generic handler and replace a result that
  // carries a working link with "tool failed (internal error)" — losing the answer over a
  // missing picture, which is the trade this whole design refuses to make.
  try {
    return {
      state: 'ok',
      bytes: new Uint8Array(await res.arrayBuffer()),
      cache: res.headers.get('X-Snap-Cache') || null,
      ms: res.headers.get('X-Snap-Ms') || null,
      settle: res.headers.get('X-Snap-Settle') || null,
    };
  } catch (err) {
    console.error('renderer body failed:', err);
    return { state: 'renderer_down', error: 'the renderer started sending a picture and the transfer failed' };
  }
}

/**
 * Bytes to bare base64. Chunked at 8 KB because `String.fromCharCode(...wholeArray)` blows
 * the call stack on anything the size of a real PNG.
 */
export function toBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(bin);
}
