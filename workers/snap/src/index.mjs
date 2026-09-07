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
// L30 P4: the cache-key surface lives next door so `node --test` can reach it. Nothing in
// THIS file can be imported by a test — the puppeteer import above is module scope.
import { canonical, parseSize, reDriveHash, sha256Hex } from './helpers.mjs';

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
/**
 * Supersample factor for the capture hook (L30 P4a.1). 3, not 2 and not 4, MEASURED:
 * interior holes in the ghosted femur run 6.97% at 1x, 0.66% at 2x, 0.05% at 3x and 0.04%
 * at 4x, while one frame costs 1.8 / 3.2 / 5.5 / 8.0 s on a software rasteriser. 3 is the
 * knee: 4 buys 0.01 points of hole and a further 2.5 s of metered browser time.
 * CHANGING THIS CHANGES WHAT A PLATE LOOKS LIKE — bump SITE_BUILD with it.
 */
const CAPTURE_SCALE = 3;

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
          // L30 P4: ...and a tab that is CARRYING AN ERROR is not reusable either. A page
          // whose WebGL context was lost still reports ready, and re-driving it produces a
          // blank or frozen screenshot that passes every downstream check.
          const isReady = await p.evaluate(() => document.documentElement.dataset.atlasReady === '1'
            && !document.documentElement.dataset.atlasError).catch(() => false);
          if (isReady) { ready = p; break; }
        }
      } catch { /* fall through to a new tab */ }
      return { browser, warm: true, page: ready };
    } catch { /* it was taken or died between the list and the connect */ }
  }
  const browser = await puppeteer.launch(env.BROWSER, { keep_alive: KEEP_ALIVE_MS });
  return { browser, warm: false, page: null };
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
    const size = parseSize(params.get('size'), MAX_W, MAX_H);
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

    // L30 P4: THE CACHE PROBE. `cacheonly=1` answers from R2 or gives up — it must never
    // touch a browser. render_anatomy asks this first with a 3-second budget, so the common
    // case (a view this atlas has drawn before) returns a picture in about a second instead
    // of holding a chat client open on the off-chance the render is warm. It is also the
    // only way to ASK about the cache without spending the metered resource to find out.
    if (params.get('cacheonly') === '1') {
      return new Response(null, {
        status: 204,
        headers: { 'X-Snap-Cache': 'miss', 'X-Snap-Key': key, 'X-Snap-Ms': String(Date.now() - started) },
      });
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
        // L30 P4: the ready wait must ALSO break on an error, or a failed atlas fetch --
        // which sets data-atlas-error and never sets data-atlas-ready -- burns the full
        // two-minute timeout and exits through the generic 502 path, never reaching the
        // 424 that says what actually happened.
        await page.waitForFunction(
          () => document.documentElement.dataset.atlasReady === '1' || !!document.documentElement.dataset.atlasError,
          { timeout: READY_TIMEOUT_MS },
        );
        const early = await page.evaluate(() => document.documentElement.dataset.atlasError || '').catch(() => '');
        if (early) return fail(424, `the page reported an error while rendering: ${String(early).slice(0, 120)}`, { target });
      } else {
        await page.setViewport({ width: size.width, height: size.height, deviceScaleFactor: 1 });
        // L30 P4: INVALIDATE SYNCHRONOUSLY, in the same evaluate that starts the re-drive.
        // The page clears these markers too, but only once its hashchange handler runs --
        // and between the assignment returning and React reacting, the waits below can
        // observe the PREVIOUS request's markers and pass instantly. Two scenes over the
        // same ids differ only in camera or opacity, so nothing downstream would notice.
        await page.evaluate((h) => {
          document.documentElement.removeAttribute('data-atlas-settled');
          document.documentElement.removeAttribute('data-atlas-selected');
          document.documentElement.removeAttribute('data-atlas-error');
          window.location.hash = h;
        }, reDriveHash(params));
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
      // L30 P4: THE SCENE TOKEN. The selection wait cannot tell two scenes apart when they
      // name the SAME structures and differ only in camera, opacity or caption -- which is
      // the normal case for a teaching plate. `data-atlas-scene` carries a prefix of the
      // blob the page actually applied, so this is the one wait that distinguishes them.
      const wantScene = String(params.get('scene') || '').slice(0, 16);
      let sceneAck = 'n/a';
      if (wantScene) {
        sceneAck = 'ok';
        try {
          await page.waitForFunction(
            (w) => document.documentElement.dataset.atlasScene === w,
            { timeout: reused ? 20000 : 30000 }, wantScene,
          );
        } catch {
          // A site build older than P4 does not set it. Reported, never silently skipped:
          // a check that cannot fire must at least say that it did not.
          sceneAck = 'absent';
        }
      }

      // L30 P4: THE SETTLED MARKER, not a sleep. The camera fit is animated (OrbitControls
      // damping), and focus framing makes the flight longer, so the fixed 1.2/1.4 s wait
      // this replaces could screenshot a mid-flight camera — and R2 then caches that
      // half-flown frame for 24 hours under a perfectly valid key. The page sets the marker
      // after three consecutive frames with nothing left to draw, and CLEARS it first thing
      // on every re-drive so a reused tab's previous marker cannot satisfy this instantly.
      let settle = 'marker';
      try {
        await page.waitForFunction(
          () => document.documentElement.dataset.atlasSettled === '1',
          { timeout: reused ? 25000 : 40000 },
        );
      } catch {
        // A site build older than P4 does not set the marker. Fall back to the old sleep
        // rather than failing the render, and SAY SO in a header so a plate rendered
        // against a stale bundle is diagnosable instead of merely suspicious.
        settle = 'sleep';
        await new Promise((r) => setTimeout(r, reused ? 1400 : 1200));
      }
      // A floor under the marker: three still frames means the state settled, not that the
      // compositor has presented it.
      await new Promise((r) => setTimeout(r, 250));

      // L30 P4: MAKE FAILURE LOUD. The page's error card carries `.loading`, which snap mode
      // hides — so a load failure used to render as a silently BLANK plate that this Worker
      // returned at HTTP 200 and cached for 24 hours. 424 survives Cloudflare's edge (a 502
      // is replaced by a branded HTML page), and returning here is what SKIPS the R2 put.
      const pageError = await page.evaluate(() => document.documentElement.dataset.atlasError || '').catch(() => '');
      if (pageError) {
        return fail(424, `the page reported an error while rendering: ${String(pageError).slice(0, 120)}`, { target });
      }

      // L30 P4a.1: THE SUPERSAMPLED CAPTURE. The page renders one frame with the backing
      // store at CAPTURE_SCALE x and area-averages it back down through a 2D canvas, then
      // paints the result over the live canvas — so the screenshot below carries the smooth
      // 3D layer AND everything else the plate is made of. It is deliberately NOT used as
      // the image itself: the hook returns only the WebGL canvas, and `burn_caption`
      // defaults to TRUE, so a plate built from the hook's own PNG would silently lose the
      // caption card that the tool reports as burned in.
      //
      // MEASURED (swiftshader, 960x720, the PRD's forward-bend scene at context 0.40):
      // interior holes in the femur 0.45% -> 0.05%, adjacent-pixel speckle 17.4 -> 8.3.
      // The compositor's own downscale cannot do this: at 4:1 it is still a bilinear tap
      // and throws the extra samples away. Absent (an older bundle) -> plain screenshot.
      let capture = 'screenshot';
      try {
        const ok = await page.evaluate((s) => (typeof window.__atlasCapture === 'function' ? !!window.__atlasCapture({ scale: s }) : false), CAPTURE_SCALE);
        capture = ok ? `hook${CAPTURE_SCALE}` : 'absent';
      } catch (e) {
        capture = 'failed';
      }
      const shot = await page.screenshot({ type: 'png' });
      // The overlay is a PICTURE OF ONE SCENE pinned over a tab that will be re-driven with
      // another. The page drops it on every re-drive too; this is the belt to that braces,
      // because a screenshot taken over a stale overlay is a plausible wrong plate at 200.
      await page.evaluate(() => { if (typeof window.__atlasCaptureRelease === 'function') window.__atlasCaptureRelease(); }).catch(() => {});
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
        'X-Snap-Settle': settle,
        'X-Snap-Scene': sceneAck,
        'X-Snap-Capture': capture,
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
