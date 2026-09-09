/**
 * The renderer's pure helpers, extracted so they can be TESTED. L30 P4a.
 *
 * `src/index.mjs` imports `@cloudflare/puppeteer` at module scope, so nothing in it could
 * ever be loaded by `node --test`. These four functions are the whole cache-correctness
 * surface of the renderer — the two lists below decide which requests SHARE an R2 entry
 * and what a warm tab is re-driven with — and until now they had zero coverage while
 * being the exact functions each new feature has to edit.
 *
 * Both failure modes here are silent: a key missing from `canonical()` makes two different
 * pictures collide on one cache entry, and a key missing from `reDriveHash()` makes a
 * reused tab render the PREVIOUS request's value. Neither returns an error. Both return
 * HTTP 200 and a plausible picture.
 */

/**
 * The canonical parameter string: the same view must always produce the same key, and two
 * different views must never share one. Params are sorted and re-encoded, so `?a=1&b=2`
 * and `?b=2&a=1` are one cache entry while a different note is a different one.
 *
 * TWO BRANCHES. When `scene=` is present it carries mode, language, roles, opacities,
 * camera, caption, styles and annotations INSIDE one canonical blob, so hashing the blob
 * hashes all of them — which is the entire reason the scene is one key instead of eight.
 * The legacy branch is the P1–P3 contract, plus the three aliases the PRD writes literally.
 */
export const SCENE_KEYS = ['scene', 'select', 'size'];
export const LEGACY_KEYS = [
  'select', 'view', 'isolate', 'explode', 'title', 'note', 'size', 'system',
  // L30 P4 aliases. Absent from every URL the server builds, so adding them changes no
  // existing cache entry — but a hand-written `?mode=render&focus=…&contextOpacity=…`
  // would otherwise collide with the same view without them.
  'mode', 'focus', 'contextOpacity', 'lang',
];

export function canonical(params) {
  const keep = (params.get('scene') ? SCENE_KEYS : LEGACY_KEYS).slice().sort();
  const p = new URLSearchParams();
  for (const k of keep) {
    const v = params.get(k);
    if (v !== null && v !== '') p.set(k, v);
  }
  return p.toString();
}

export async function sha256Hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** WxH, bounded. A caller cannot ask for a 10000x10000 render. */
export function parseSize(raw, maxW = 1600, maxH = 1200) {
  const m = /^(\d{2,4})x(\d{2,4})$/.exec(String(raw || ''));
  if (!m) return { width: 960, height: 720 };
  return {
    width: Math.min(Math.max(Number(m[1]), 200), maxW),
    height: Math.min(Math.max(Number(m[2]), 200), maxH),
  };
}

/**
 * THE DEFAULT VISIBLE SYSTEMS, as an EXPLICIT list, because "reset to the default" has no
 * shorter spelling in the legacy contract.
 *
 * `system=''` does not reset anything: app/url-state.ts:59-63 splits on comma, filters to known
 * ids, and only assigns `out.visible` `if(ids.length)` — so an empty value leaves the warm tab's
 * previous systems in place, and `system=none` means the OPPOSITE of a reset (it means hide
 * everything). The only value that restores the default is the default itself, written out.
 *
 * ⚠️ THIS IS A SECOND COPY of `DEFAULT_VISIBLE` (app/anatomy.ts:57) and it exists because this
 * module is a Worker module with ZERO imports by design — the same constraint that keeps
 * app/scene-codec.js importable from both the bundle and a Pages Function. The drift is guarded
 * rather than tolerated: test/redrive-hash.test.mjs reads app/anatomy.ts and fails if the two
 * lists stop matching, so adding a system in one place breaks the build instead of quietly
 * changing what a warm re-drive resets to.
 */
export const DEFAULT_SYSTEMS = [
  'cardiac', 'sensory', 'skeletal', 'muscular', 'arterial', 'venous', 'nervous', 'respiratory',
  'digestive', 'urinary', 'lymphatic', 'endocrine', 'reproductive', 'connective',
];

/**
 * The hash that re-drives an already-loaded page.
 *
 * EVERY key is written, including the empty ones, because the app only overwrites what the
 * URL mentions: a hash that omitted `title` would leave the PREVIOUS request's caption
 * printed over this request's structures.
 *
 * BUT THE EMPTY-VALUE RESET ONLY WORKS FOR title AND note. Measured in app/url-state.ts:
 * `select` is guarded by `if(ids.length)`, `system`/`view`/`explode` by truthiness,
 * `isolate` by a flag parse that returns undefined for '', and `lang` by `if(lang && …)`.
 * So writing `select=''` does NOT reset a warm tab. What makes the scene branch safe is
 * not this function — it is that a valid `scene=` makes the page's apply AUTHORITATIVE
 * over every field the scene owns. The three P4 aliases are new, so their empty value is
 * defined as a reset and that half does work.
 *
 * ══ L31 v2.1a — THE LANGUAGE AND SYSTEM LEAK (codex-app-review.md §2 row 10, R:34) ═════════════
 * Two keys were still missing from the legacy branch, and both failed as a plausible picture at
 * HTTP 200 — the exact failure mode the file header warns about:
 *
 *   `lang`   was NEVER written, in either direction. So a Hant request made on a tab that had
 *            rendered Hans kept Hans, and — measured, not deduced — a request that DID carry
 *            `lang=zh-Hant` did not apply it either, because the hash never mentioned it.
 *   `system` was written only when the request had one, so a plain request after a
 *            `system=skeletal` one rendered a skeleton it never asked for.
 *
 * The cache key describes the new request; the page renders the old one. Because the empty-value
 * reset does not work for either key (see above), both are now written with an EXPLICIT DEFAULT —
 * `lang=en` and the full default system list — which is the only spelling the legacy parser reads
 * as "go back to the default".
 *
 * `canonical()` is deliberately NOT touched: cache identity for every existing URL is unchanged,
 * and that is asserted in test/redrive-hash.test.mjs against a frozen string. What DOES change is
 * what a warm tab draws, so `SITE_BUILD` is bumped with this repair — every PNG cached from a warm
 * tab before it may carry the previous request's language.
 */
export function reDriveHash(params) {
  const p = new URLSearchParams();
  const scene = params.get('scene');
  if (scene) {
    p.set('scene', scene);
    p.set('select', params.get('select') || '');
    p.set('title', '');
    p.set('note', '');
    p.set('snap', '1');
    return `#${p.toString()}`;
  }
  // THE OTHER DIRECTION OF THE SAME HAZARD (Astra, high). A legacy re-drive on a tab that
  // previously rendered a SCENE could not clear it: the blob survives in the tab's query
  // string, merge() finds it there, and the page takes its authoritative scene branch and
  // ignores every legacy key in this hash. The selection still matched, so the wait passed
  // and the PREVIOUS picture was cached under the new request's key. An explicit empty
  // `scene` is defined as a CLEAR, and it is written on every legacy re-drive.
  p.set('scene', '');
  p.set('select', params.get('select') || '');
  p.set('view', params.get('view') || 'three-quarter');
  p.set('isolate', params.get('isolate') === '0' ? '0' : '1');
  p.set('explode', params.get('explode') || '0');
  p.set('title', params.get('title') || '');
  p.set('note', params.get('note') || '');
  p.set('mode', params.get('mode') || '');
  p.set('focus', params.get('focus') || '');
  p.set('contextOpacity', params.get('contextOpacity') || '');
  // EXPLICIT DEFAULTS, both directions. `|| 'en'` and `|| DEFAULT_SYSTEMS` are what make this a
  // RESET rather than a no-op — an empty value for either key is silently ignored by the page.
  p.set('lang', params.get('lang') || 'en');
  p.set('system', params.get('system') || DEFAULT_SYSTEMS.join(','));
  p.set('snap', '1');
  return `#${p.toString()}`;
}
