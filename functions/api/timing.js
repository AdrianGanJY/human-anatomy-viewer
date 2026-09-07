/**
 * POST /api/timing — THE REAL-DEVICE TIMING LANE (L31 v2, P0 item 0).
 *
 * WHY IT EXISTS. Every wall-clock number this project has ever quoted was taken under
 * `--use-gl=swiftshader` on MP-SERVER (audit-current.md:125). Software rasterisation is a
 * slow-CPU upper bound, not a device timing, so "800 ms to first anatomy pixel" was
 * unfalsifiable: no instrument had ever run on a phone. Bytes, DOM rects, camera values and
 * projected subject rects are device-independent and may be quoted today; MILLISECONDS MAY NOT
 * BE, until a real device has opened `/v2/?probe=1` and posted here.
 *
 * WHAT IT DOES. Accepts one small JSON record per page open, normalises it, echoes it back so
 * the caller (and a headless check) can see exactly what was recorded, and logs it. It stores
 * NOTHING: this Pages project has no R2 or KV binding, and inventing one to hold six numbers
 * would be a cloud object created by an agent for a diagnostic. Adrian opens the URL, the
 * response IS the reading, and the page also prints it on screen and copies it. When a lane
 * with history is wanted, bind R2 and append here — the shape below is already the record.
 *
 * THE GATE. On `anatomy.adrian.my` the exact-host Access app (cbd8b852) SHADOWS the estate's
 * `*.adrian.my/api/*` public bypass, so this path is behind Access at the edge — measured,
 * audit-current.md:86. This function adds one defence-in-depth check that is honest about what
 * it can prove: the request must carry a JWT-SHAPED `Cf-Access-Jwt-Assertion`, which only the
 * gate injects. It deliberately does NOT call `resolveIdentity`: that verifies against
 * ACCESS_AUD, which is the /mcp app's audience — a browser session on this host carries the
 * HOST app's audience instead and would be rejected, i.e. the strict check would reject exactly
 * the caller this endpoint is for (the same asymmetry `api/snap.js` documents at its head).
 * So the edge is the gate, this is the tripwire, and nothing here writes or spends anything.
 */
import { extractAccessJwt } from '../_access.js';

const json = (status, body) => new Response(JSON.stringify(body, null, 1), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const MAX_BODY = 4096;

/** A finite, non-negative number under a ceiling, or null. Never NaN, never Infinity. */
const num = (v, max) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v * 100) / 100 : null);
/** A short, single-line string. Truncated, never rejected — a long UA is not an attack. */
const str = (v, max) => (typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim().slice(0, max) : null);

export async function onRequest({ request }) {
  if (request.method === 'GET') {
    // A GET is how you check the lane is alive without recording anything.
    return json(200, { ok: true, lane: 'timing', accepts: 'POST', note: 'open /v2/?probe=1 on the device' });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });

  if (!extractAccessJwt(request)) {
    return json(401, { error: 'no Access assertion on this request' });
  }

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json(413, { error: `body over ${MAX_BODY} bytes` });
    body = JSON.parse(raw);
  } catch {
    return json(400, { error: 'body must be JSON' });
  }
  if (!body || typeof body !== 'object') return json(400, { error: 'body must be a JSON object' });

  const cf = request.cf || {};
  const record = {
    // Server-stamped: the client clock is the one thing a client cannot be trusted about.
    at: new Date().toISOString(),
    build: str(body.build, 32),
    scene: str(body.scene, 24),
    // THE NUMBERS THIS LANE EXISTS FOR. Ceiling 600 s — anything above it is a stuck tab, not
    // a measurement, and admitting it would poison a median.
    ms: {
      firstVisibleModel: num(body.firstVisibleModel, 600000),
      sceneReady: num(body.sceneReady, 600000),
      atlasReady: num(body.atlasReady, 600000),
      firstPaint: num(body.firstPaint, 600000),
    },
    bytes: {
      // `transfer` is what crossed the wire (0 on an HTTP-cache hit — which is itself the
      // reading); `encoded` is what the body claimed. Both, because they answer different
      // questions and the audit's own false finding came from conflating them.
      transferToSceneReady: num(body.transferToSceneReady, 4e9),
      encodedToSceneReady: num(body.encodedToSceneReady, 4e9),
      transferTotal: num(body.transferTotal, 4e9),
      requestsToSceneReady: num(body.requestsToSceneReady, 1000),
    },
    device: {
      dpr: num(body.dpr, 8),
      viewport: str(body.viewport, 24),
      ua: str(body.ua, 300),
      memoryGb: num(body.memoryGb, 1024),
      cores: num(body.cores, 512),
      // From Cloudflare, not from the client: a client-declared country is decoration.
      colo: str(cf.colo, 8),
      country: str(cf.country, 8),
    },
    cls: num(body.cls, 100),
  };

  // The Worker log is the durable half until a binding exists. One line, greppable.
  console.log('L31-TIMING ' + JSON.stringify(record));

  return json(200, { ok: true, recorded: record });
}
