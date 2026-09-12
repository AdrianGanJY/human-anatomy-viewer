/**
 * THE PINYIN MAP — loaded ONLY when the reader turns it on.
 * L31 v2.1b+c, S4. `spec.md` A6/D7.
 *
 * ── THE REQUEST BUDGET IS THE POINT ─────────────────────────────────────────────────────────────
 *
 * `public/i18n/pinyin.json` is ~214 KB. RC10 gives S4 two ledger rows: with the toggle OFF a fresh
 * English visit must start ZERO requests for it, and with the toggle ON exactly one. So there is no
 * "load it on mount and keep it warm" path in this module, deliberately — the same discipline
 * `dict.ts` follows for the Chinese dictionaries, and for the same reason: a teaching link opened
 * from a chat should download the body, not a romanisation nobody asked for.
 *
 * ── THE HTTP-200 TRAP, AGAIN ────────────────────────────────────────────────────────────────────
 *
 * Cloudflare Pages answers a MISSING static asset with the SPA shell at HTTP **200** (measured on
 * this very project in P2, documented in `dict.ts`). So `res.ok` proves nothing: the content type
 * and the shape are what distinguish the map from the app's own home page. Without that guard a
 * deploy that forgot the build step would give every reader a toggle that turns on, fetches 36 KB of
 * HTML, and shows no pinyin — with no error anywhere.
 *
 * ── ONE FAILED LOAD IS RETRIED ON THE NEXT TOGGLE ───────────────────────────────────────────────
 *
 * The same per-lane rule RC9 imposed on `loadZhDicts`: a lane that FAILED drops its memo, so
 * turning the toggle off and on again retries rather than replaying a cached failure for the life of
 * the page. There is one lane here, which makes the rule a two-line version of the same idea.
 */

export interface PinyinMap {
 version: number;
 source: string;
 /** `pinyin-pro@3.29.4` — the exact producer, shown in Settings → About. */
 library: string;
 py: Record<string, string>;
}

let loaded: PinyinMap | null = null;
let inflight: Promise<PinyinMap | null> | null = null;

/** True when the map is already in memory — read by the UI so it can show nothing rather than a
 *  flicker of missing lines while the fetch is in the air. Starts no request. */
export const pinyinReady = (): boolean => !!loaded;
/** The producer string, for About. Null until the map has loaded — About says so rather than
 *  hardcoding a version that could drift from the file actually shipped. */
export const pinyinLibrary = (): string | null => loaded?.library ?? null;

export function loadPinyin(): Promise<PinyinMap | null> {
 if (loaded) return Promise.resolve(loaded);
 if (inflight) return inflight;
 inflight = (async () => {
  try {
   const res = await fetch('/i18n/pinyin.json', {headers: {Accept: 'application/json'}});
   if (!res.ok) return null;
   if (!/application\/json/i.test(res.headers.get('content-type') ?? '')) return null;
   const body = await res.json() as PinyinMap;
   /**
    * ⚠️ VALIDATED BEFORE IT IS CACHED — codex round 10, M4, which executed three counterexamples
    * through the old guard: `{py: []}` became `ready:true` with no readings (an array IS an object,
    * and `typeof [] === 'object'`); an object-valued reading escaped `pinyinOf` despite its
    * `string | null` return type, so a row would have rendered `[object Object]` under a name; and
    * wrong `version`/`source` metadata was accepted, which is the same class as a stale map.
    *
    * None of those is reachable from `build-pinyin.mjs`, which validates what it writes — so this
    * is a guard against a CORRUPTED or MISMATCHED response (a partial CDN body, a hand-edited file,
    * a future build whose shape moved), not against our own generator. That is exactly the kind of
    * input a fetch boundary is for, and "the generator is fine" was never the question.
    *
    * The version check is deliberately EXACT rather than a floor: an unknown shape is a thing to
    * refuse, not to read optimistically (the same reasoning `store.ts` uses for `v`).
    */
   if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
   if (body.version !== 1 || body.source !== 'zh-Hans') return null;
   if (typeof body.library !== 'string' || !body.library) return null;
   if (!body.py || typeof body.py !== 'object' || Array.isArray(body.py)) return null;
   const entries = Object.entries(body.py as Record<string, unknown>);
   if (!entries.length) return null;
   // EVERY VALUE IS A STRING, or the whole map is refused. Filtering the bad ones out would leave a
   // silently incomplete map, which is the failure mode the completeness test exists to prevent.
   for (const [, v] of entries) if (typeof v !== 'string' || !v) return null;
   loaded = body;
   return body;
  } catch { return null; }
  finally {
   // Cleared on BOTH paths. On success `loaded` short-circuits the next call; on failure the memo
   // must not survive, or the retry the toggle offers would replay the same rejection.
   inflight = null;
  }
 })();
 return inflight;
}

/**
 * THE READING FOR ONE id, or null.
 *
 * ⚠️ IT TAKES THE DISPLAYED TEXT AND CHECKS IT FOR HAN. A reading is a claim about a Chinese
 * spelling, and the four surfaces that draw pinyin each draw a DIFFERENT string: in a Chinese
 * interface the primary name, in an English one the paired Chinese line the palette matched on. So
 * the caller passes what it is actually about to draw, and a Latin string gets no reading — which
 * is what stops "Body of sternum" acquiring a line reading `xiōng gǔ tǐ` underneath it.
 *
 * The map is keyed by id and derived from the 简体 spelling; 繁體 shares the reading, because the two
 * dictionaries are conversions of one another and pinyin is the Mandarin READING, not a transcript
 * of the glyphs. `about.pinyin` states that, so the claim is visible to the reader too.
 */
const HAN = /[㐀-䶿一-鿿豈-﫿]/;
export function pinyinOf(id: string, shown: string): string | null {
 if (!loaded || !id || !shown || !HAN.test(shown)) return null;
 return loaded.py[id] ?? null;
}
