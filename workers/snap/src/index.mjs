/**
 * human-anatomy-snap — renders a composed anatomy view to a PNG, live (L30 P2 §2.4).
 *
 * `GET /api/snap?select=…&view=…&title=…&note=…&size=WxH` -> image/png
 *
 * It is a WORKER, not a Pages Function, because the `browser` binding is a Workers
 * binding; the Pages project reaches it through a service binding (`SNAP`), so the
 * only caller is `functions/mcp.js` and `functions/api/snap.js` on the same account.
 *
 * How it renders: Cloudflare Browser Rendering opens the REAL site
 * (https://anatomy.adrian.my/?…&snap=1) with a CF Access service token, waits for the
 * page's own `data-atlas-ready` and `data-atlas-selected` markers — not a timeout —
 * and screenshots. `snap=1` hides every panel except the caption, which is why the
 * picture is the picture and not a screenshot of a UI.
 *
 * Two things make it affordable:
 *   - R2 cache, keyed by the canonical parameter string + the site's current build id.
 *     A repeated view costs one R2 GET.
 *   - Session reuse: a warm browser session is picked up by id instead of paying the
 *     cold start again. The 33 MB model load is what makes a cold render expensive.
 *
 * Secrets (wrangler secret put — never in wrangler.toml, never committed):
 *   SNAP_CF_ID / SNAP_CF_SECRET   the adr CF Access service token
 *   SNAP_SHARED_SECRET            optional; when set, callers must present it
 */
import puppeteer from '@cloudflare/puppeteer';

const SITE = 'https://anatomy.adrian.my';
const READY_TIMEOUT_MS = 120000;
/**
 * How long an idle browser session is held open for the next request to reuse.
 *
 * MEASURED 2026-09-06: at the 10-minute maximum, roughly six renders in twenty minutes
 * exhausted this account's Browser Rendering allowance — `puppeteer.launch` then
 * answered `429 Rate limit exceeded` while R2 cache hits carried on serving. Browser
 * TIME is what is metered, and an idle keep-alive is billed the same as a working one,
 * so a 10-minute hold bills ~30x the ~20 seconds of work it protects. Two minutes is
 * long enough to catch the follow-up renders of one conversation and 5x cheaper.
 */
const KEEP_ALIVE_MS = 2 * 60 * 1000;
const MAX_W = 1600;
const MAX_H = 1200;
const CACHE_TTL_S = 86400;

const png = (body, extra) => new Response(body, {
  headers: {
    'Content-Type': 'image/png',
    'Cache-Control': `private, max-age=${CACHE_TTL_S}`,
    ...extra,
  },
});
const fail = (status, message, extra = {}) => new Response(JSON.stringify({ error: message, ...extra }), {
  status, headers: { 'Content-Type': 'application/json' },
});

/**
 * The canonical parameter string: the same view must always produce the same key, and
 * two different views must never share one. Params are sorted and re-encoded, so
 * `?a=1&b=2` and `?b=2&a=1` are one cache entry, while a different note is a different
 * one.
 */
function canonical(params) {
  const keep = ['select', 'view', 'isolate', 'explode', 'title', 'note', 'size', 'system'];
  const p = new URLSearchParams();
  for (const k of keep.sort()) {
    const v = params.get(k);
    if (v !== null && v !== '') p.set(k, v);
  }
  return p.toString();
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** WxH, bounded. A caller cannot ask for a 10000x10000 render. */
function parseSize(raw) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(raw || ''));
  if (!m) return { width: 960, height: 720 };
  return {
    width: Math.min(Math.max(Number(m[1]), 200), MAX_W),
    height: Math.min(Math.max(Number(m[2]), 200), MAX_H),
  };
}

/**
 * A warm session if there is one, otherwise a new browser — and, crucially, a warm
 * TAB if that session still has one with the atlas loaded.
 *
 * MEASURED, 2026-09-06, and the reason this function looks like this:
 *
 *     cold  (new browser, new tab)              67.0 s
 *     warm session, NEW tab                     51.5 s
 *     warm session, REUSED tab (hash re-drive)   see X-Snap-Ms
 *
 * Reusing the session alone buys almost nothing, because the cost is not the browser
 * start — it is loading 33 MB of model geometry into a fresh page. So the tab has to
 * survive too, and it is re-driven through `location.hash`, which the app applies
 * WITHOUT a reload. That hash contract was built in P1 for exactly this.
 */
async function acquire(env) {
  let sessionId = null;
  try {
    const list = await puppeteer.sessions(env.BROWSER);
    const free = list.find((s) => !s.connectionId);
    if (free) sessionId = free.sessionId;
  } catch { /* listing is an optimisation, never a requirement */ }
  if (sessionId) {
    try {
      const browser = await puppeteer.connect(env.BROWSER, sessionId);
      let ready = null;
      try {
        for (const p of await browser.pages()) {
          if (!p.url().startsWith(SITE)) continue;
          // The page's OWN marker decides, not its URL: a tab that is still loading
          // the atlas would produce a blank render.
          const isReady = await p.evaluate(() => document.documentElement.dataset.atlasReady === '1').catch(() => false);
          if (isReady) { ready = p; break; }
        }
      } catch { /* fall through to a new tab */ }
      return { browser, warm: true, page: ready };
    } catch { /* it was taken or died between the list and the connect */ }
  }
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  return { browser, warm: false, page: null };
}

/**
 * The hash that re-drives an already-loaded page.
 *
 * EVERY key is written, including empty ones, because the app only overwrites what the
 * URL mentions: a hash that omitted `title` would leave the PREVIOUS request's caption
 * printed over this request's structures — the picture would be confidently wrong.
 */
function reDriveHash(params) {
  const p = new URLSearchParams();
  p.set('select', params.get('select') || '');
  p.set('view', params.get('view') || 'three-quarter');
  p.set('isolate', params.get('isolate') === '0' ? '0' : '1');
  p.set('explode', params.get('explode') || '0');
  p.set('title', params.get('title') || '');
  p.set('note', params.get('note') || '');
  if (params.get('system')) p.set('system', params.get('system'));
  p.set('snap', '1');
  return `#${p.toString()}`;
}

export default {
  async fetch(request, env) {
    const started = Date.now();
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, service: 'human-anatomy-snap', browser: !!env.BROWSER, r2: !!env.SNAPS }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname !== '/api/snap') return fail(404, 'not found');
    if (request.method !== 'GET') return fail(405, 'GET only');

    if (env.SNAP_SHARED_SECRET && request.headers.get('X-Snap-Secret') !== env.SNAP_SHARED_SECRET) {
      return fail(401, 'unauthorized');
    }
    if (!env.BROWSER) return fail(503, 'no browser binding on this deployment');
    if (!env.SNAP_CF_ID || !env.SNAP_CF_SECRET) {
      return fail(503, 'no CF Access service token configured — the renderer cannot open the gated site');
    }

    const params = url.searchParams;
    if (!params.get('select')) return fail(400, 'select is required');
    const size = parseSize(params.get('size'));
    const canon = canonical(params);
    // The build id is part of the key, so a redeploy of the site cannot serve a picture
    // rendered by the previous build. `SITE_BUILD` is set at deploy time.
    const key = `${await sha256Hex(`${env.SITE_BUILD || 'dev'}|${size.width}x${size.height}|${canon}`)}.png`;

    if (env.SNAPS && params.get('nocache') !== '1') {
      const hit = await env.SNAPS.get(key);
      if (hit) {
        return png(hit.body, { 'X-Snap-Cache': 'hit', 'X-Snap-Key': key, 'X-Snap-Ms': String(Date.now() - started) });
      }
    }

    const target = `${SITE}/?${canon}${canon ? '&' : ''}snap=1`;
    let browser = null; let warm = false; let sessionId = null; let reused = false;
    try {
      let page;
      ({ browser, warm, page } = await acquire(env));
      sessionId = browser.sessionId?.() ?? null;
      reused = !!page;

      if (!page) {
        page = await browser.newPage();
        // Scoped to this origin only: sending Access headers on every request turns
        // Cloudflare's own cross-origin beacon into a failing preflight (P1's lesson).
        await page.setExtraHTTPHeaders({
          'CF-Access-Client-Id': env.SNAP_CF_ID,
          'CF-Access-Client-Secret': env.SNAP_CF_SECRET,
        });
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        const resp = await page.goto(target, { waitUntil: 'domcontentloaded', timeout: READY_TIMEOUT_MS });
        if (!resp || resp.status() !== 200) {
          return fail(502, `the site answered ${resp ? resp.status() : 'nothing'} for the snapshot URL`, { target });
        }
        await page.waitForSelector('html[data-atlas-ready="1"]', { timeout: READY_TIMEOUT_MS });
      } else {
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        await page.evaluate((h) => { window.location.hash = h; }, reDriveHash(params));
      }

      // The SELECTION marker, not a sleep: the render is only meaningful once the
      // requested structures really are the ones highlighted. Waiting for the EXACT
      // requested string (rather than "something is selected") is what makes a reused
      // tab safe — otherwise the previous request's selection satisfies the wait and
      // the picture shows the wrong muscles.
      const want = String(params.get('select') || '');
      try {
        await page.waitForFunction(
          (w) => document.documentElement.dataset.atlasSelected === w,
          { timeout: reused ? 20000 : 30000 }, want,
        );
      } catch {
        // An id the atlas does not carry never becomes the selection. Rather than 502,
        // fall back to "something is selected" and let the caller see the picture — but
        // only after proving the page is not still showing the PREVIOUS request.
        await page.waitForFunction(
          (w) => {
            const got = document.documentElement.dataset.atlasSelected || '';
            return got !== '' && w.split(',').some((id) => got.split(',').includes(id));
          },
          { timeout: 10000 }, want,
        );
      }
      // One frame for the camera fit to settle after the isolate framing.
      await new Promise((r) => setTimeout(r, reused ? 1400 : 1200));

      const shot = await page.screenshot({ type: 'png' });
      // The tab is the cache. Closing it here is what made the "warm" path cost 51 s.
      if (!reused) { /* keep the freshly-loaded tab for the next request */ }

      if (env.SNAPS) {
        await env.SNAPS.put(key, shot, {
          httpMetadata: { contentType: 'image/png', cacheControl: `private, max-age=${CACHE_TTL_S}` },
          customMetadata: { canon: canon.slice(0, 1000), build: String(env.SITE_BUILD || 'dev') },
        });
      }
      return png(shot, {
        'X-Snap-Cache': 'miss',
        'X-Snap-Warm': warm ? '1' : '0',
        'X-Snap-Tab': reused ? 'reused' : 'new',
        'X-Snap-Key': key,
        'X-Snap-Ms': String(Date.now() - started),
        'X-Snap-Session': sessionId || '',
      });
    } catch (err) {
      return fail(502, `render failed: ${String(err && err.message ? err.message : err).slice(0, 300)}`, {
        warm, tab: reused ? 'reused' : 'new', ms: Date.now() - started, target,
      });
    } finally {
      // disconnect(), never close(): closing would destroy the session the NEXT request
      // wants to reuse, which is the whole point of keep_alive.
      try { if (browser) await browser.disconnect(); } catch { /* nothing to do */ }
    }
  },
};
