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
 /** S5b prelude — see `recordFailure`. Empty on every healthy visit. */
 failures: RequestFailure[];
}

/**
 * ── WHICH REQUEST FAILED — S5b prelude ─────────────────────────────────────────────────────────
 *
 * The planner's first live sweep after the S5a deploy measured, at 1366×1024 only, "The anatomy
 * could not be loaded" with 0 systems and 0 structures; the rerun was clean 590/0/7. A transient
 * fetch failure moments after a deploy is the obvious reading — and it is a READING, not a
 * measurement, because the app recorded NOTHING about what actually failed. `markError('atlas')`
 * says a load failed; it does not say which URL, with what status, or whether the body was the
 * Access login page arriving as HTTP 200.
 *
 * The cost of that silence is exactly the one this project keeps paying: a transient and a real
 * regression produce the same evidence, so the only way to tell them apart is to run it again and
 * believe the second answer. So the failure now names itself in three places a human or an oracle
 * can read without a debugger:
 *   · `document.documentElement.dataset.atlasFailed` — one line, for the sweep and for a glance;
 *   · `console.error` — for the browser's own log, which the sweep already collects;
 *   · the probe panel (`?probe=1`), through `ProbeReading.failures`.
 *
 * ⚠️ IT DOES NOT GO IN THE VISIBLE ERROR CARD. A URL and an HTTP status in the reader's face is
 * developer output; the card keeps saying `error.load` in the reader's language, with its Reload
 * button. Diagnostics go where diagnostics are read.
 *
 * ⚠️ AND IT IS NOT IN `url-state.ts`. That file is inside `deploy.ps1`'s render-path guard, so a
 * line there would force a `SITE_BUILD` bump and a Worker deploy to retire every cached plate —
 * for a diagnostic that cannot change a single pixel of one. This module is v2-only.
 */
export interface RequestFailure {url: string; status: number | null; detail: string; at: number}
const failures: RequestFailure[] = [];

/**
 * ⚠️ `surfaced` — "THE READER CAN ALREADY SEE THE CAUSE", and it decides ONE thing: the console.
 *
 * Measured, not predicted. The renderer's `onError` already puts its own sentence on screen in the
 * reader's language ("The 3D session was paused by your device. Reload to continue."), so a console
 * line adds nothing a human needs — and the first version emitted one anyway. Under a full sweep
 * (twelve browser contexts, SwiftShader, a live WebGL canvas) a context loss is a LOAD condition
 * that happens sometimes, and the new line turned it into a red `no console errors` row: a
 * diagnostic making a pre-existing, unrelated oracle flakier. Measured in the S5b smoke sweep.
 *
 * The ATLAS fetch is the opposite case and the one this whole record exists for: its card says "The
 * anatomy could not be loaded" and the CAUSE — which URL, what status, what content-type — is
 * nowhere on screen by design. That is what the console line is for.
 *
 * Both cases still write the attribute and the probe entry, so nothing is hidden from an oracle or
 * from `?probe=1` either way; `surfaced` only decides whether the CONSOLE is told something the
 * screen has already said.
 */
export function recordFailure(f: {url: string; status?: number | null; detail?: string; surfaced?: boolean}): void {
 const rec: RequestFailure = {
  url: f.url,
  status: typeof f.status === 'number' ? f.status : null,
  // BOUNDED. An error message can carry a whole HTML body — the SPA-fallback trap this estate
  // already knows — and an unbounded one in a DOM attribute is its own denial of service.
  detail: String(f.detail ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
  at: Math.round(performance.now()),
 };
 // Bounded the same way: a retry loop must not grow this without limit.
 failures.push(rec);
 if (failures.length > 8) failures.shift();
 try {
  document.documentElement.dataset.atlasFailed =
   `${rec.url} :: ${rec.status === null ? 'no-status' : rec.status} :: ${rec.detail}`.slice(0, 300);
 } catch { /* no document (SSR, a test) — the console line below still lands */ }
 // ⚠️ `surfaced` NOW CHOOSES THE LEVEL, NOT WHETHER TO SPEAK — codex round 22, Medium 6.
 //
 // The first version returned here, on the ground that the renderer's cause is already on screen.
 // codex's objection is the right one: "showing the cause on screen does not replace a
 // machine-checked failure signal" -- a silent record is one an oracle can only find if somebody
 // remembers to look for it. But the reason for the silence was real too: under a full sweep a
 // WebGL context loss is a LOAD condition, and an `error` line turned it into a red `no console
 // errors` row for something no product change caused.
 //
 // `warn` answers both. It is in the browser's log, machine-readable, and greppable; and the
 // sweep's console gate collects `error` only, so a load-induced context loss does not manufacture
 // a product failure. The general assertion codex asked for is a new oracle row: `data-atlas-failed`
 // must be ABSENT at the end of every viewport unless a retry was announced for it.
 // eslint-disable-next-line no-console
 const say = f.surfaced ? console.warn : console.error;
 say(`[atlas] request failed: ${rec.url} status=${rec.status ?? 'none'} ${rec.detail}`);
}

export const readFailures = (): RequestFailure[] => failures.slice();

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
  failures: readFailures(),
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
