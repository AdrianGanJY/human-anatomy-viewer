/**
 * DID A SCENE BLOB **DECLARE** A LANGUAGE, OR DID THE CODEC SUPPLY THE DEFAULT?
 * L31 v2.1b+c, S3b.
 *
 * ══ THE DEFECT THIS EXISTS FOR ═════════════════════════════════════════════════════════════════
 * `app/v2/page.tsx applySceneState` did `if (sc.lang) applyLang(sc.lang)`. Every normalised scene
 * HAS a `lang` — `scene-codec.js normalizeScene` defaults it to `'en'` — so the guard was always
 * true and a scene that said nothing about language asserted English over the reader's explicit
 * `?lang=`. Measured on the LIVE S2 deploy: `?scene=<valid>&lang=zh-Hans` was Chinese at 400 ms,
 * English at 3 s, and `lang=` was then dropped from the address bar by the debounced serializer, so
 * the link could not even be re-read by hand. A teaching link in Chinese silently turned English.
 *
 * The distinction the page needs — DECLARED vs DEFAULTED — survives only in the RAW wire object.
 *
 * ══ WHY IT LIVES HERE AND NOT IN THE CODEC ═════════════════════════════════════════════════════
 * `app/scene-codec.js` is the natural home: it owns the wire format. It is also listed in
 * `deploy.ps1`'s `renderPaths` tripwire, which refuses any deploy after a commit touching it unless
 * `workers/snap/wrangler.toml` is newer — because a change there can move a cached PLATE, and a
 * stale plate serves a plausible-but-old picture at HTTP 200 for 24 hours. That guard is right, and
 * the honest way to satisfy it is to bump `SITE_BUILD` and redeploy the Worker.
 *
 * This function cannot move a plate: it is READ-ONLY, it is called by nothing the renderer or
 * `functions/mcp.js` imports, and it adds no field and changes no serialisation. Paying a Worker
 * redeploy and a golden re-baseline for it would be spending real risk on a function that provably
 * has none — so it lives in `app/v2/`, where only the v2 page consumes it, and the render path stays
 * BYTE-IDENTICAL. Recorded rather than quietly done, because the trade-off is the interesting part:
 * the cost is that "the wire object's language key is `lang`" is now stated in two files (here and
 * `canonicalScene`). Every primitive it needs — `LANGS`, `LIMITS`, `b64urlDecode` — is imported from
 * the codec, so that one sentence is the entire duplication.
 *
 * If this ever needs to grow into a general "what did the wire object declare?" reader, it belongs
 * in the codec, and that commit should take the `SITE_BUILD` bump with it.
 */
import {LANGS, LIMITS, b64urlDecode, decodeScene} from '../scene-model.ts';

/**
 * True only when the blob's own JSON carries a `lang` the codec would accept.
 *
 * ⚠️ FALSE FOR ANYTHING UNDECODABLE, deliberately. "We cannot tell" resolves to "not declared",
 * which is the side that leaves the reader's explicit `?lang=` alone — the failure that cannot
 * surprise anybody. Never throws: a hostile `scene=` must degrade, not break the page.
 *
 * ⚠️ A SCENE THAT DECLARED `'en'` READS AS NOT DECLARED, and that is a property of the format, not
 * a bug here: `canonicalScene` omits `lang` when it equals the default, so the two are the same
 * bytes. In that tie the explicit `?lang=` wins.
 */
export function sceneDeclaresLang(blob: string | null | undefined): boolean {
 if (typeof blob !== 'string' || !blob || blob.length > LIMITS.SCENE_MAX_B64) return false;
 if (!/^[A-Za-z0-9_-]+$/.test(blob)) return false;
 /**
  * ⚠️ AGREEMENT WITH THE CODEC IS NOW *DELEGATED*, NOT RE-TYPED — codex round 5, the Low. The first
  * version checked the encoding and the language and skipped the codec's VERSION and
  * nonempty-structure gates, so `{lang:'zh-Hans'}`, `{v:2,…}` and `{v:1,s:[],…}` all returned true
  * while `decodeScene` returned null for every one of them. The doc claimed the two agreed; they
  * did not. Asking `decodeScene` is the only way that claim can stay true as the codec's gates
  * change, and it costs one extra parse on a path that runs once per arrival.
  */
 if (!decodeScene(blob)) return false;
 try {
  const parsed = JSON.parse(b64urlDecode(blob)) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  return (LANGS as readonly string[]).includes((parsed as {lang?: unknown}).lang as string);
 } catch {
  return false;
 }
}
