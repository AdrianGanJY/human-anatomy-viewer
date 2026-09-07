/**
 * The client half of the real-device timing lane. `/v2/?probe=1`.
 *
 * Adrian opens that URL ONCE on his phone (and once on the iPad) and the numbers this project
 * has never had exist. Until then the honest unit is BYTES: every millisecond in the L31
 * proposal came from headless Chromium under swiftshader on a desktop and is a slow-CPU upper
 * bound, not a device timing (audit-current.md:125).
 *
 * Everything here is read from the platform's own instruments, never from a stopwatch we keep:
 *   - PerformanceResourceTiming for bytes and request counts, split into transfer (wire) and
 *     encoded (body). A warm visit reports transfer 0 for 15 of 16 model requests — that is a
 *     real reading, not a bug, and it is why both are sent.
 *   - PerformancePaintTiming for first-contentful-paint.
 *   - A LayoutShift observer for CLS, which is the number the entry sequence is designed
 *     around: the title, the note and the rail are painted from the URL before any model byte,
 *     so the frame must never move once it is up.
 *
 * The marks themselves are set by the page (`mark()` below) at the two moments that matter:
 * the first chunk drawn, and the phase barrier.
 */
export interface ProbeReading {
 build: string;
 scene: string;
 firstPaint: number | null;
 firstVisibleModel: number | null;
 sceneReady: number | null;
 atlasReady: number | null;
 transferToSceneReady: number | null;
 encodedToSceneReady: number | null;
 transferTotal: number | null;
 requestsToSceneReady: number | null;
 dpr: number;
 viewport: string;
 ua: string;
 memoryGb: number | null;
 cores: number | null;
 cls: number;
}

const marks: Record<string, number> = {};
let cls = 0;
let clsWatching = false;

/** Start the CLS observer. Safe to call more than once; safe where the API is absent. */
export function watchLayoutShift() {
 if (clsWatching || typeof PerformanceObserver === 'undefined') return;
 clsWatching = true;
 try {
  const po = new PerformanceObserver((list) => {
   for (const entry of list.getEntries() as unknown as {value: number; hadRecentInput: boolean}[]) {
    // A shift the user caused by tapping is not a layout defect.
    if (!entry.hadRecentInput) cls += entry.value;
   }
  });
  po.observe({type: 'layout-shift', buffered: true} as PerformanceObserverInit);
 } catch { /* Safari <15.4 has no layout-shift entries; the reading is then simply absent */ }
}

/** Stamp a named moment, once. Later calls for the same name are ignored — a re-drive must not
 *  overwrite the cold-open reading, which is the one being measured. */
export function mark(name: string) {
 if (marks[name] === undefined) marks[name] = performance.now();
 // Also visible in the browser's own timeline, so a devtools trace and this record agree.
 try { performance.mark(`atlas:${name}`); } catch { /* ignore */ }
}

export const markAt = (name: string): number | null => marks[name] ?? null;

const MODEL = /\/models\//;

/** Bytes and requests for model resources that finished before `cutoff` ms. */
function modelBytes(cutoff: number | null) {
 let transfer = 0, encoded = 0, requests = 0, transferAll = 0;
 const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
 for (const e of entries) {
  if (!MODEL.test(e.name)) continue;
  transferAll += e.transferSize || 0;
  if (cutoff !== null && e.responseEnd > cutoff) continue;
  transfer += e.transferSize || 0;
  encoded += e.encodedBodySize || 0;
  requests += 1;
 }
 return {transfer, encoded, requests, transferAll};
}

export function readProbe(build: string, scene: string): ProbeReading {
 const paint = performance.getEntriesByName('first-contentful-paint')[0];
 const sceneReady = markAt('sceneReady');
 const b = modelBytes(sceneReady);
 const nav = navigator as Navigator & {deviceMemory?: number; hardwareConcurrency?: number};
 return {
  build, scene,
  firstPaint: paint ? Math.round(paint.startTime) : null,
  firstVisibleModel: markAt('firstChunk'),
  sceneReady,
  atlasReady: markAt('atlasReady'),
  transferToSceneReady: sceneReady === null ? null : b.transfer,
  encodedToSceneReady: sceneReady === null ? null : b.encoded,
  transferTotal: b.transferAll,
  requestsToSceneReady: sceneReady === null ? null : b.requests,
  dpr: devicePixelRatio,
  viewport: `${innerWidth}x${innerHeight}`,
  ua: navigator.userAgent,
  memoryGb: nav.deviceMemory ?? null,
  cores: nav.hardwareConcurrency ?? null,
  cls: Math.round(cls * 10000) / 10000,
 };
}

/** POST the reading. Returns what the server echoed, or an error shape — never throws, because
 *  a failed diagnostic must not be the reason the viewer looks broken on the device under test. */
export async function postProbe(reading: ProbeReading): Promise<unknown> {
 try {
  const res = await fetch('/api/timing', {
   method: 'POST',
   headers: {'Content-Type': 'application/json'},
   body: JSON.stringify(reading),
  });
  const text = await res.text();
  // A 200 whose body is the SPA shell is the estate's known trap: assert the shape, do not
  // trust the status. (`feedback-an-spa-fallback-makes-200-meaningless`.)
  try { return {status: res.status, body: JSON.parse(text)}; }
  catch { return {status: res.status, error: 'response was not JSON', head: text.slice(0, 120)}; }
 } catch (e) {
  return {error: String(e)};
 }
}
