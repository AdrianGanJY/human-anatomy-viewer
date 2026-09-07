/**
 * human-anatomy-viewer MCP server — READ-ONLY (L30 P2, 2026-09-06).
 *
 * Endpoint:  POST https://anatomy.adrian.my/mcp
 * Transport: Streamable HTTP (one JSON-RPC request/response per call)
 * Protocol:  MCP 2025-06-18 / JSON-RPC 2.0
 *
 * Sibling of `apps/hub/functions/mcp.js` (A234) and
 * `apps/adrian-research-center/functions/mcp.js` (A235): same wire format, same auth
 * posture, same fail-closed shape, so a client that connects to one connects to all
 * three identically and a lesson learned on any applies to the others.
 *
 * `./_access.js` is a BYTE-IDENTICAL vendored copy of the hub's — `Get-FileHash` on
 * the three files is the drift check (verified equal at commit time). Do not edit it
 * here. It never reads `Cf-Access-Authenticated-User-Email` (Managed OAuth suppresses
 * that header) and fails closed when unconfigured.
 *
 * WHAT THIS SERVES
 * ----------------
 * The site is a static 3D anatomy explorer (a fork of ashemag/human-atlas, BodyParts3D
 * data). Everything machine-readable is generated ahead of time by
 * `scripts/build-index.mjs` into ONE asset:
 *
 *   /api/index.json   3,432 concepts + 2,234 meshes + the 15 systems + explanations
 *
 * Nothing here parses the 1.3 MB atlas at request time, and nothing writes.
 *
 * The point of the server is `compose_view`: an assistant names several structures and
 * its own sentence, and gets back a deep link that opens the live 3D view with all of
 * them highlighted and that sentence printed over the scene. The URL contract it
 * builds is the same one `app/url-state.ts` parses — see URL_CONTRACT below; the two
 * are deliberately duplicated (one is TS in the bundle, this is a Function) and MUST
 * be changed together.
 *
 * Routing: `public/_routes.json` MUST include "/mcp". Without it Pages answers /mcp
 * from the static asset fallback with HTTP 200 and the SPA shell (A234's lesson, and
 * measured live on this project: a missing path here returns index.html at 200).
 */

import { resolveIdentity } from './_access.js';
// L30 P4: the SAME FILE the Vite bundle imports through app/scene-model.ts. Not a copy —
// the URL_CONTRACT below is what a hand-mirrored contract looks like after it drifts once,
// and the scene is far too big a surface to mirror by hand.
import {
  LIMITS as SCENE_LIMITS, VIEWS as SCENE_VIEWS, LANGS as SCENE_LANGS, EMPHASIS, REST_MODES,
  BACKGROUNDS, ANNOTATION_TYPES, DIRECTIONS,
  normalizeScene, validateScene, encodeScene, decodeScene, sceneSelectIds, structureOpacity,
} from '../app/scene-codec.js';
import { callRenderer, toBase64 } from './_renderer.js';

const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const SERVER_INFO = { name: 'human-anatomy-viewer', version: '0.1.0' };
const CAPABILITIES = { tools: {}, resources: {} };

/** Canonical host for deep links and for OAuth discovery. */
const SITE_ORIGIN = 'https://anatomy.adrian.my';

/**
 * The URL contract, re-declared from `app/url-state.ts` (TITLE_MAX / NOTE_MAX /
 * SELECT_MAX there). The page CLIPS an over-long value; this server REFUSES it, so a
 * caller is never told a link carries a note that the page will silently shorten.
 */
const URL_CONTRACT = {
  TITLE_MAX: 80,
  NOTE_MAX: 600,
  SELECT_MAX: 24,
  URL_MAX: 2000,
  VIEWS: ['three-quarter', 'front', 'back', 'side'],
  // P3: the interface language of the page the link opens. `en` is the default and is left
  // out of the URL entirely, so an English link is byte-identical to the ones P2 shipped.
  LANGS: ['en', 'zh-Hans', 'zh-Hant'],
};

const DEFAULT_FIND_LIMIT = 30;
const MAX_FIND_LIMIT = 100;
const DEFAULT_SEARCH_LIMIT = 20;
const MAX_SEARCH_LIMIT = 50;
const MAX_QUERY_CHARS = 256;

// Work bounds for a single HTTP request.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_BATCH = 16;

/** A rendered snapshot embedded as a data: URI must stay well under what a chat client
 *  will carry. 400 KB is the ceiling; a larger render is reported, never truncated. */
const MAX_PNG_DATA_URL_BYTES = 400 * 1024;

/**
 * How long `compose_view({snapshot:true})` will wait for a picture before answering
 * with the link alone. Measured on this account: cache hit < 1 s, warm tab ~21 s,
 * cold ~60 s. 20 s catches every cache hit and most warm renders, and never holds a
 * chat client open for a cold one.
 */
const SNAPSHOT_BUDGET_MS = 20000;

/**
 * render_anatomy's budgets. compose_view's 20 s is deliberately NOT moved: it is the LINK
 * tool and must answer fast. render_anatomy is the PICTURE tool, so it waits.
 *
 * Two numbers because the two clients have different ceilings. Anthropic documents a 300 s
 * tool timeout, so 75 s is comfortable and is the first budget that can catch the measured
 * 67 s cold render. OpenAI staff have stated a HARD one-minute limit on any tool call, so a
 * ChatGPT-shaped caller gets 50 s — long enough for the measured warm-tab band (21-27 s)
 * and the warm-session-new-tab case, and short enough to answer before the client gives up.
 * Unknown clients get the conservative number.
 */
const RENDER_BUDGET_CLAUDE_MS = 75000;
const RENDER_BUDGET_DEFAULT_MS = 50000;
/** Long enough for an R2 GET and its service hop, short enough not to be felt. */
const CACHE_PROBE_BUDGET_MS = 3000;

/**
 * THE SIZE CONTRACT, and it decides what a plate may weigh rather than decorating it.
 *
 * claude.ai and Claude Desktop cap a whole tool result at roughly 150,000 characters. The
 * image block and the widget's data URI are TWO COPIES OF THE SAME BASE64, so on that
 * client both have to fit inside one budget. Yield order when the assembled result is over:
 * drop the WIDGET copy for a caller that identified itself as Claude (where the image block
 * is the carrier with vendor support), otherwise drop the IMAGE BLOCK and keep the widget
 * (the carrier with positive evidence on this account, and the one ChatGPT displays).
 * NEVER truncate, and never re-render — a second render spends the metered resource again.
 */
const MAX_IMAGE_BLOCK_B64 = 140000;
const MAX_RESULT_CHARS = 145000;
/** A plate this big is a bug, not a picture; report it rather than shipping it. */
const MAX_PNG_BYTES = 300 * 1024;

const WIDGET_URI = 'ui://widget/anatomy-view.html';

/**
 * A 96x64 PNG, 371 bytes, obviously synthetic. `probe_image` returns it as a bare MCP image
 * block with NO widget template attached, which makes it the five-minute experiment that
 * settles a question no amount of reading can: does THIS client render an MCP image block
 * at all, and does it still do so when no widget is competing for the same result? Every
 * agent-side claim about that is inference from third-party reports; only Adrian's eyes can
 * measure it, and this is the cheapest thing to put in front of them.
 */
const PROBE_PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAIAAABqVuVZAAABOklEQVR42u3cWxHDQAxD0UApjiIolhANhqBpAbTNPmJ7ZckeIThzv709nq/axbYiKCAjoPfX7echuy4gZaYfQPt5lFED6MJIjekv0DVTAbWNRJjaQOIp9QLJpjQApJnSMJBaSjNAUinNA4mkdAtIISUDIO6UbICIU7IEokzJGIgvJRcgppS8gGhS8gUiSMkdKHtKQUB5U4oDSppSNFC6lBYA5UppGVCWlFYCpUhpPRB4ShBAyCkBAWGmhAUEmBIiEFRKoEA4KUEDIaSEDrQ8pRxAC1NKA7QqpWRA8SnlAwpOKStQWEqJgWJSSg/knRIDkGtKPEBOKVEBeaRECGSbEieQYUrMQCYpkQPdT0kC6E5KKkDTKWkBTaQkBzSakihQf0q6QJ0pqQM1UyqgBlMBNYzqNUX97iigmH0AKHGufKlR/bQAAAAASUVORK5CYII=';

/**
 * NAMED GROUPS. Every one of these was checked against the deployed atlas (2026-09-07);
 * they are in the tool descriptions and the server instructions so the model does not have
 * to rediscover them, and so it cannot land on the traps beside them.
 *
 *   `hamstrings` is not a concept in this atlas at all — a search for it returns nothing.
 *     It is exactly three heads. FMA45890 (short head of biceps femoris) is NOT one of them
 *     for a forward-bend plate: it originates on the femur and crosses only the knee, so it
 *     takes no part in hip-flexion limitation. FMA45881 folds both heads together and is
 *     the id a naive search lands on.
 *   `pelvis` is ambiguous: FMA16580 "bony pelvis" is 3 skeletal meshes; FMA9578 "pelvis" is
 *     8 meshes spanning muscular + integumentary + skeletal and drags body surface into the
 *     frame. Teaching plates mean FMA16580.
 *   `lumbar spine` is named "lumbar vertebral column" here, so an exact-name lookup fails.
 *   `view:"side"` puts the camera at +X, which is the body's LEFT. Every concept above is
 *     BILATERAL, so a side plate superimposes both limbs at a slight offset — under ghost
 *     anatomy that reads as one doubled, blurred muscle. The left-sided siblings are the
 *     clean sagittal set.
 */
const GROUPS = `hamstrings = FMA22357 (semitendinosus) + FMA22438 (semimembranosus) + FMA45887 (long head of biceps femoris). Not FMA45881, which folds in the short head, and not FMA45890, which crosses only the knee.
left hamstrings = FMA22359 + FMA22449 + FMA45889.
pelvis = FMA16580 (bony pelvis). Not FMA9578, which drags in body surface. Left hip bone = FMA16587.
femur = FMA9611. Left femur = FMA24475.
lumbar spine = FMA16203 (this atlas calls it "lumbar vertebral column"). Lumbar discs = FMA13894. Sacrum = FMA16202.
view:"side" looks at the body's LEFT side. These concepts are bilateral, so for a clean sagittal plate pass the left-sided ids above; FMA16203 and FMA16202 are midline and stay whole.`;

const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ── HTTP plumbing ───────────────────────────────────────────────────────────

function corsHeaders(request) {
  const origin = request?.headers?.get('Origin');
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Cf-Access-Jwt-Assertion',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id, WWW-Authenticate',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

const toolOk = (data, extra) => ({
  content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }],
  isError: false,
  ...(extra || {}),
});
const toolError = (m) => ({ content: [{ type: 'text', text: `Error: ${m}` }], isError: true });
/**
 * L30 P4: a result with SEVERAL content blocks. A sibling of toolOk rather than a change to
 * it, because every existing tool and every existing test depends on toolOk's exact shape —
 * one text block — and this is not the phase to renegotiate that.
 *
 * `isError:false` even when no picture was produced, deliberately: a missing picture is not
 * a failed answer, and `isError:true` makes clients hide the text block too, which would
 * take the working interactive link down with it. isError is reserved for caller-fixable
 * input faults.
 */
const toolBlocks = (blocks, extra) => ({ content: blocks, isError: false, ...(extra || {}) });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// ── argument hygiene ────────────────────────────────────────────────────────

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const lower = (v) => str(v).toLowerCase();
function clampInt(v, dflt, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(Math.max(Math.trunc(n), min), max);
}

/**
 * An atlas identifier. Concept ids are FMA ids (`FMA22315`); part ids come from the
 * same source and share the character class. Anything else is refused BEFORE it is
 * put in a URL, so a caller cannot smuggle `&`, a newline or a second query string
 * into a link this server tells them is safe to open.
 */
const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const isId = (v) => typeof v === 'string' && ID_RE.test(v);

/**
 * Caption text. Control characters are stripped and whitespace collapsed — the page
 * does the same, and a caption that renders differently from the string this server
 * reported would make the returned URL a lie.
 */
function captionText(raw, max, field) {
  if (raw === undefined || raw === null) return { value: undefined };
  if (typeof raw !== 'string') return { error: `${field} must be a string` };
  // eslint-disable-next-line no-control-regex
  const clean = Array.from(raw)
    .map((ch) => (ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127 ? ' ' : ch))
    .join('').replace(/\s+/g, ' ').trim();
  if (!clean) return { value: undefined };
  if (clean.length > max) {
    return { error: `${field} is ${clean.length} characters; the maximum is ${max}. Shorten it — it is printed verbatim over the 3D view.` };
  }
  return { value: clean };
}

// ── the index ───────────────────────────────────────────────────────────────

/**
 * `/api/index.json`, parsed once per `env`.
 *
 * Keyed by `env` in a WeakMap rather than a module global: the lifetime then belongs
 * to the deployment that produced it (a new deploy is a new isolate with a new `env`),
 * and a test that swaps fixtures gets the new index instead of the previous test's.
 *
 * The content-type check is load-bearing, not defensive dressing. Measured live on
 * this Pages project: a path that does not exist is answered **HTTP 200 with
 * `index.html`** (`/ATTRIBUTION.md` on a one-file deployment returned the wrong
 * document at 200). `res.ok` is worthless here; only "it is JSON and it has the shape
 * of an index" distinguishes the index from the app's own home page.
 */
const indexByEnv = new WeakMap();
async function getIndex(ctx) {
  const cached = indexByEnv.get(ctx.env);
  if (cached !== undefined) return cached;
  let parsed = null;
  try {
    if (ctx.env.ASSETS) {
      const url = new URL('/api/index.json', ctx.origin);
      const res = await ctx.env.ASSETS.fetch(new Request(url.toString(), { method: 'GET', redirect: 'manual' }));
      const ct = res.headers.get('content-type') || '';
      if (res.ok && /application\/json/i.test(ct)) {
        const body = await res.json();
        if (body && Array.isArray(body.concepts) && Array.isArray(body.systems)) parsed = body;
      }
    }
  } catch {
    parsed = null;
  }
  if (parsed) {
    parsed._byId = new Map(parsed.concepts.map((c) => [c.id, c]));
    parsed._systemById = new Map(parsed.systems.map((s) => [s.id, s]));
    // P3: the individual meshes. A PART id is a legal `select=` value on the live page and
    // always has been, so resolving one here is what stops compose_view reporting a working
    // id as unknown. Older index files have no `parts` — an empty map, not a crash.
    parsed._partById = new Map((parsed.parts || []).map((p) => [p.id, p]));
  }
  indexByEnv.set(ctx.env, parsed);
  return parsed;
}

const noIndex = () => toolError(
  'the anatomy index is not available on this deployment — /api/index.json is missing, '
  + 'unreadable, or was answered with the app shell. Run `node scripts/build-index.mjs` and redeploy.',
);

// ── the URL contract ────────────────────────────────────────────────────────

/**
 * Build the deep link. Every value is percent-encoded by URLSearchParams; ids were
 * already checked against ID_RE, so nothing here can add a parameter.
 */
/**
 * L31 v2: `v` selects WHICH ENTRY the human-facing link opens — 1 (default, `/`) or 2 (`/v2/`).
 *
 * It is a LINK flag and nothing more. The scene blob, the canonical id order, the R2 cache key
 * and every rendered plate are untouched: `/v2/` reads the same `scene=` contract with the same
 * codec, and the RENDER path (line ~695, the snapshot the plate is made from) never passes `v`,
 * so a plate is byte-identical whichever entry the reader is sent to. The default stays 1 until
 * Adrian has opened a real link on his own phone and said so.
 */
function buildUrl({ ids, view, isolate, explode, snap, title, note, size, lang, v }) {
  const p = new URLSearchParams();
  if (ids?.length) p.set('select', ids.join(','));
  if (lang && lang !== 'en') p.set('lang', lang);
  if (isolate) p.set('isolate', '1');
  if (view && view !== 'three-quarter') p.set('view', view);
  if (typeof explode === 'number' && explode > 0) p.set('explode', explode.toFixed(2));
  if (snap) p.set('snap', '1');
  if (title) p.set('title', title);
  if (note) p.set('note', note);
  if (size) p.set('size', size);
  const q = p.toString();
  // `/v2/` with the trailing slash: Cloudflare Pages resolves that to `dist/v2/index.html`.
  const entry = Number(v) === 2 ? '/v2/' : '/';
  return `${SITE_ORIGIN}${entry}${q ? `?${q}` : ''}`;
}
/** The `v` a tool call asked for, or undefined. Anything but the literal 2 means v1 — an
 *  unrecognised value must not silently route a human to an entry nobody has verified. */
const entryVersion = (a) => (a && (a.v === 2 || a.v === '2') ? 2 : undefined);

/**
 * Shared argument parsing for compose_view and the snapshot path, so the link and the
 * picture can never be built from two different readings of the same request.
 */
function parseViewArgs(index, a) {
  const rawSelect = Array.isArray(a.select) ? a.select
    : typeof a.select === 'string' ? a.select.split(',')
      : null;
  if (!rawSelect || !rawSelect.length) {
    return { error: 'select is required: an array of atlas ids, e.g. ["FMA22315","FMA22314"]. Use find_anatomy to get them.' };
  }
  const cleaned = [];
  for (const raw of rawSelect) {
    const v = str(raw);
    if (!v) continue;
    if (!isId(v)) return { error: `not an atlas id: "${String(raw).slice(0, 40)}" — ids look like FMA22315` };
    if (!cleaned.includes(v)) cleaned.push(v);
  }
  if (!cleaned.length) return { error: 'select contained no usable ids' };
  if (cleaned.length > URL_CONTRACT.SELECT_MAX) {
    return { error: `select has ${cleaned.length} ids; the maximum is ${URL_CONTRACT.SELECT_MAX}. The viewer highlights a handful of related structures, not a whole system.` };
  }

  // Resolved against the index, so the caller is TOLD which ids the viewer will
  // ignore rather than being handed a link that quietly shows fewer structures.
  // Concept ids AND part ids resolve, because the page accepts both.
  const resolved = [];
  const unknown = [];
  for (const id of cleaned) (index._byId.has(id) || index._partById.has(id) ? resolved : unknown).push(id);
  if (!resolved.length) {
    return { error: `none of these ids are in this atlas: ${unknown.join(', ')} — call find_anatomy first (ids look like FMA22315)` };
  }

  const view = a.view === undefined ? undefined : lower(a.view);
  if (view !== undefined && !URL_CONTRACT.VIEWS.includes(view)) {
    return { error: `unknown view "${a.view}" — one of ${URL_CONTRACT.VIEWS.join(', ')}` };
  }
  if (a.isolate !== undefined && typeof a.isolate !== 'boolean') return { error: 'isolate must be a boolean' };
  let explode;
  if (a.explode !== undefined) {
    const n = Number(a.explode);
    if (!Number.isFinite(n) || n < 0 || n > 1) return { error: 'explode must be a number between 0 and 1' };
    explode = n;
  }
  const t = captionText(a.title, URL_CONTRACT.TITLE_MAX, 'title');
  if (t.error) return { error: t.error };
  const n = captionText(a.note, URL_CONTRACT.NOTE_MAX, 'note');
  if (n.error) return { error: n.error };

  const lang = a.lang === undefined ? undefined : str(a.lang);
  if (lang !== undefined && !URL_CONTRACT.LANGS.includes(lang)) {
    return { error: `unknown lang "${a.lang}" — one of ${URL_CONTRACT.LANGS.join(', ')}` };
  }

  // `isolate` defaults ON: the whole point of naming structures is to see THEM. A
  // caller that wants them in context passes isolate:false.
  const isolate = a.isolate === undefined ? true : a.isolate;
  return { ids: resolved, unknown, view, isolate, explode, title: t.value, note: n.value, lang };
}

// ── tool registry ───────────────────────────────────────────────────────────

const INSTRUCTIONS = `A 3D human anatomy viewer (anatomy.adrian.my) that you can POINT AT. Adrian is learning yoga and wants a visual anchor for his body: when you talk about a muscle or a bone, give him the picture, not only the words.

The atlas: 3,432 named structures (BodyParts3D), 2,234 individual meshes, grouped into 15 systems. Ids are FMA identifiers and look like FMA22315. Names are stored lowercase.

CHINESE. Every structure also carries a 简体 and a 繁體 name (standard mainland 人体解剖学名词). You can SEARCH in Chinese — find_anatomy({query:"臀中肌"}) works — and you can pass lang:"zh-Hans" or "zh-Hant" to compose_view so the viewer opens in that script, with the English kept as a second line under each name. If Adrian writes to you in Chinese, use it.

The normal flow
1. find_anatomy({query:"gluteus"}) to turn words into ids. Search is case-insensitive over English names, ids, and both Chinese scripts.
2. render_anatomy({select:[...], context:[...], focus:{ids:[...]}, title:"...", note:"..."}) for a PICTURE inside this conversation. This is the tool to reach for whenever a visual would help — which, for a body question, is almost always.
3. compose_view({select:["FMA22315","FMA22314","FMA18060"], view:"back", title:"...", note:"..."}) for a LINK he can open and orbit himself.
4. Give Adrian the URL as well as the picture. Tapping it on his phone opens the real, orbitable 3D body.

Groups worth knowing, all verified against this atlas — pass ids, never names:
${GROUPS}

compose_view is the important one. It takes SEVERAL ids at once, because the useful anatomical answer is usually a group ("these three stabilise the pelvis"), not one muscle. \`note\` is shown to him verbatim as a caption on the image — write it for him, in your own words, not as a label. Pass snapshot:true to also get a rendered PNG of that exact view when the renderer is available.

get_structure({id}) gives the name, system, an explanation and the piece count. list_systems() gives the 15 systems and their sizes. search/fetch are the plain connector contract over the same data.

Nothing here writes; every tool is read-only. Access is owner-only.`;

const TOOLS = [
  {
    name: 'find_anatomy',
    description: 'Find anatomical structures by name or atlas id, IN ENGLISH OR CHINESE. Case-insensitive substring match over the English name, the id, and the Chinese name in both scripts — 臀中肌 and 牙齒 find their structure directly, no need to translate first. Returns id, English name, both Chinese names, system, how many meshes it is built from, and a ready deep link. Filter to one system with system= (see list_systems). START HERE — every other tool takes ids, and ids look like FMA22315.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "gluteus", "psoas", "lumbar vertebra", 臀中肌, or an id.' },
        system: { type: 'string', description: 'Restrict to one system id, e.g. "muscular" or "skeletal".' },
        limit: { type: 'number', description: `Default ${DEFAULT_FIND_LIMIT}, max ${MAX_FIND_LIMIT}.` },
      },
      required: ['query'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_structure',
    description: 'One structure in full: its English and Chinese names (简体 and 繁體), its system and that system\'s description, a specific explanation when the atlas has one, the number of meshes, and a deep link that opens it isolated in the 3D view. Accepts a concept id (FMA22315) or an individual mesh id.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'An atlas id, e.g. "FMA22315".' },
        lang: { type: 'string', enum: URL_CONTRACT.LANGS, description: 'Language the returned link should open in. Default en.' },
      },
      required: ['id'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'list_systems',
    description: 'The 15 anatomical systems in this atlas — id, name, description, and how many named structures and meshes each contains. Use the ids as the system= filter of find_anatomy.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
  },
  {
    name: 'compose_view',
    description: `Build a link that opens the live 3D viewer with SEVERAL structures highlighted together and your own words printed over the scene. This is the tool to reach for whenever the answer is anatomical.

select takes up to ${URL_CONTRACT.SELECT_MAX} ids and highlights the union of their meshes; isolate (default true) hides everything else so only they are visible. view aims the camera (three-quarter, front, back, side). title (<= ${URL_CONTRACT.TITLE_MAX} chars) and note (<= ${URL_CONTRACT.NOTE_MAX} chars) are shown to the user VERBATIM as a caption on the image — write the note as the sentence you would say to him, not as a label. Ids that are not in the atlas come back in ids_unknown instead of being silently dropped.

lang opens the viewer in Chinese — "zh-Hans" (简体) or "zh-Hant" (繁體) — so every structure name, panel and button he sees is in that script, with the English kept underneath. Pass it whenever the conversation is in Chinese.

Pass snapshot:true to also get a rendered PNG of that exact view inline; if the renderer is unavailable the link is still returned and snapshot_error says why.`,
    inputSchema: {
      type: 'object',
      properties: {
        select: { type: 'array', items: { type: 'string' }, description: 'Atlas ids, e.g. ["FMA22315","FMA22314","FMA18060"].' },
        v: { type: 'integer', enum: [1, 2], description: 'Which viewer entry the human-facing LINK opens: 1 = the current viewer (default), 2 = the /v2/ redesign (faster first paint on a phone). Does not change the picture, the scene contract or the rendered plate. Leave unset unless Adrian asks for v2.' },
        lang: { type: 'string', enum: URL_CONTRACT.LANGS, description: 'Interface language of the page the link opens: en, zh-Hans (简体) or zh-Hant (繁體). Default en.' },
        view: { type: 'string', enum: URL_CONTRACT.VIEWS, description: 'Camera angle. Default three-quarter.' },
        isolate: { type: 'boolean', description: 'Show ONLY the selected structures. Default true.' },
        explode: { type: 'number', description: '0-1. Separates the body into its pieces. Default 0.' },
        title: { type: 'string', description: `Caption heading, <= ${URL_CONTRACT.TITLE_MAX} chars.` },
        note: { type: 'string', description: `Caption body, <= ${URL_CONTRACT.NOTE_MAX} chars. Shown verbatim to the user.` },
        snapshot: { type: 'boolean', description: 'Also render this view as a PNG and return it inline. Default false.' },
      },
      required: ['select'],
    },
    annotations: READ_ONLY,
    _meta: { 'openai/outputTemplate': WIDGET_URI },
  },
  {
    name: 'render_anatomy',
    description: `Render a clean educational anatomy image and return the PNG directly to the conversation. Use this tool whenever a visual would make an anatomical, exercise, yoga, posture or movement explanation easier to understand. Prefer this over compose_view when the user does not need to interactively explore the anatomy.

Framing is automatic: pass focus with the ids the explanation is ABOUT and the camera fits itself around them. Pass context ids to keep surrounding anatomy visible as translucent scaffolding, and ghost ids for the faint outline of everything else — contextOpacity 0.05-0.10 reads as a ghost of the body, supportOpacity 0.3-0.5 as supporting structure.

A view this atlas has not drawn before takes about a minute and this call will wait for it; the same view afterwards is instant. If the result says the picture is still rendering, call this tool AGAIN with the SAME arguments — the second call returns it immediately. The interactive link always works, even when the picture does not.

Ids only, never names. Useful groups, all checked against this atlas:
${GROUPS}

There are no joints in this atlas — BodyParts3D ships meshes, so there is no hip-joint structure to point at. Name the structure that moves instead.`,
    inputSchema: {
      type: 'object',
      properties: {
        select: { type: 'array', items: { type: 'string' }, description: 'The structures the explanation is ABOUT — drawn at full opacity and highlighted. e.g. ["FMA22357","FMA22438","FMA45887"] for the hamstrings.' },
        context: { type: 'array', items: { type: 'string' }, description: 'Supporting structures, drawn translucent at supportOpacity. e.g. ["FMA16580","FMA9611"] for pelvis and femur.' },
        ghost: { type: 'array', items: { type: 'string' }, description: 'Structures kept as a faint outline at contextOpacity, for orientation only.' },
        rest: { type: 'string', enum: REST_MODES, description: 'Also show the rest of the body: "none" (default) or "skeletal" at restOpacity. "all" is not available — it costs a full 33 MB load.' },
        restOpacity: { type: 'number', description: 'Opacity for rest:"skeletal". Default 0.08.' },
        view: { type: 'string', enum: SCENE_VIEWS, description: 'Camera angle. Default three-quarter. "side" looks at the body\'s LEFT.' },
        focus: {
          type: 'object',
          description: 'Automatic framing. Pass the ids the picture is about; the camera fits itself around their combined extent.',
          properties: {
            ids: { type: 'array', items: { type: 'string' }, description: 'Ids to frame. They must already be in select, context or ghost.' },
            padding: { type: 'number', description: 'Camera DISTANCE multiplier, 1.0-3.0. Default 1.35; 2.0 pulls back. It is not a percentage.' },
          },
        },
        contextOpacity: { type: 'number', description: 'Opacity of the `ghost` structures, 0-1. Default 0.25. This viewer resolves opacity by COVERAGE rather than blending, so a value reads fainter here than it would elsewhere: below about 0.15 a structure nearly disappears.' },
        supportOpacity: { type: 'number', description: 'Opacity of the `context` structures, 0-1. Default 0.55. Same coverage caveat as contextOpacity — 0.5-0.7 is what reads as translucent supporting anatomy.' },
        supersample: { type: 'boolean', description: 'Draw at 2x and downsample, which is what makes translucent structures look smooth. Default true. Only turn it off if a render is timing out.' },
        styles: {
          type: 'array',
          description: 'Per-structure overrides. Do not pass colours — the viewer owns the palette.',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              emphasis: { type: 'string', enum: EMPHASIS, description: 'Semantic emphasis. Stored now, drawn in a later version.' },
              opacity: { type: 'number', description: 'Overrides the role opacity for this structure.' },
            },
            required: ['id'],
          },
        },
        annotations: {
          type: 'array',
          maxItems: SCENE_LIMITS.MAX_ANNOTATIONS,
          description: 'Labels and arrows anchored to structures. Accepted and carried now; DRAWN in a later version — do not rely on them being visible yet.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ANNOTATION_TYPES },
              target: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' },
              direction: { type: 'string', enum: DIRECTIONS },
              text: { type: 'string', description: `<= ${SCENE_LIMITS.MAX_ANNOTATION_TEXT} chars — two or three words.` },
            },
            required: ['type'],
          },
        },
        title: { type: 'string', description: `Printed on the plate, <= ${SCENE_LIMITS.TITLE_MAX} chars.` },
        note: { type: 'string', description: `Printed on the plate under the title, <= ${SCENE_LIMITS.NOTE_MAX} chars. Write it as the sentence you would say to him.` },
        burn_caption: { type: 'boolean', description: 'Put title and note IN the picture. Default true. false keeps the plate wordless, and makes the same view a cache hit whatever you write.' },
        lang: { type: 'string', enum: SCENE_LANGS, description: 'Language of the interactive link and of any burned-in structure names. Default en.' },
        v: { type: 'integer', enum: [1, 2], description: 'Which viewer entry the INTERACTIVE LINK opens: 1 = the current viewer (default), 2 = the /v2/ redesign. The rendered PNG is identical either way — this only changes where "Open in 3D" goes. Leave unset unless Adrian asks for v2.' },
        width: { type: 'number', description: `Plate width, ${SCENE_LIMITS.W_MIN}-${SCENE_LIMITS.W_MAX}. Default 960. Below ${SCENE_LIMITS.W_MIN} the viewer switches to its phone layout.` },
        height: { type: 'number', description: `Plate height, ${SCENE_LIMITS.H_MIN}-${SCENE_LIMITS.H_MAX}. Default 720.` },
        background: { type: 'string', enum: BACKGROUNDS, description: 'Default light.' },
        interactive_only: { type: 'boolean', description: 'Skip the render and return only the link. Default false.' },
      },
      required: ['select'],
    },
    annotations: READ_ONLY,
    _meta: { 'openai/outputTemplate': WIDGET_URI },
  },
  {
    name: 'compose_sequence',
    description: 'Create a short animated anatomy teaching sequence showing relationships, movement direction, highlights and explanatory steps. Returns a link that plays the sequence plus a still filmstrip of the key moments. This tool never produces video, and it is NOT enabled on this deployment yet — it will refuse. Use render_anatomy for a still plate.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        base: { type: 'object', description: 'The scene every step starts from — same shape as render_anatomy.' },
        loop: { type: 'boolean' },
        steps: {
          type: 'array', minItems: 1, maxItems: 8,
          description: 'Ordered steps. Every id is an atlas id like FMA16580, never a name.',
          items: {
            type: 'object',
            properties: {
              duration: { type: 'number', description: 'Seconds, 0.5-8.' },
              show: { type: 'array', items: { type: 'string' } },
              hide: { type: 'array', items: { type: 'string' } },
              focus: { type: 'array', items: { type: 'string' } },
              highlight: { type: 'array', items: { type: 'string' } },
              contextOpacity: { type: 'number' },
              view: { type: 'string', enum: SCENE_VIEWS },
              caption: { type: 'string' },
            },
          },
        },
      },
      required: ['steps'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'probe_image',
    description: 'Return one tiny test PNG as a plain MCP image content block, with no interactive card attached. It exists to answer a single question that cannot be answered by reading documentation: does THIS chat client display an MCP image block inline? Call it once and describe to the user exactly what appeared.',
    inputSchema: { type: 'object', properties: {} },
    annotations: READ_ONLY,
  },
  {
    name: 'search',
    description: 'Plain connector search over every named structure in the atlas. Returns ids of the form anatomy:<atlas id>, which fetch accepts directly. find_anatomy returns the same matches with more detail and a link.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text.' },
        limit: { type: 'number', description: `Default ${DEFAULT_SEARCH_LIMIT}, max ${MAX_SEARCH_LIMIT}.` },
      },
      required: ['query'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'fetch',
    description: 'Fetch one structure as a document by the id search returns (anatomy:FMA22315). A bare id also works. Returns {id, title, text, url, metadata}; text is a short readable description that embeds the deep link.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'e.g. "anatomy:FMA22315" or "FMA22315".' } },
      required: ['id'],
    },
    annotations: READ_ONLY,
  },
];

/**
 * Owner-only. A verified-but-not-owner identity sees NO tools; calling one anyway is
 * answered -32001 "Owner only" rather than "unknown tool", so a wrong identity is
 * diagnosable from the error even though there is no whoami tool on this server.
 */
const toolsFor = (identity) => (identity?.owner ? TOOLS : []);

const RESOURCES = [{
  uri: WIDGET_URI,
  name: 'Anatomy view',
  description: 'Inline card for a composed 3D anatomy view: the rendered image when there is one, the caption, and a link into the live viewer.',
  mimeType: 'text/html+skybridge',
}];

// ── the widget ──────────────────────────────────────────────────────────────

/**
 * The Apps SDK widget. Self-contained on purpose: the PNG arrives as a data: URI in
 * `toolOutput`, so the sandbox never makes a cross-origin request and Cloudflare
 * Access is irrelevant inside it. Every value is written with textContent / setAttribute
 * — never innerHTML — so a note is displayed, never executed.
 */
const WIDGET_HTML = `<div id="anatomy-card">
  <style>
    #anatomy-card{font:14px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#20303f;
      border:1px solid #25384a1f;border-radius:12px;overflow:hidden;background:#fbfbfa;max-width:760px}
    #anatomy-card .shot{display:block;width:100%;height:auto;background:#f2f3f3}
    #anatomy-card .body{padding:14px 16px}
    #anatomy-card h2{margin:0 0 6px;font-size:15px;font-weight:600;line-height:1.35}
    #anatomy-card p{margin:0 0 10px;color:#4a555f;overflow-wrap:anywhere}
    #anatomy-card .ids{margin:0 0 10px;font-size:12px;color:#78828c}
    #anatomy-card a{display:inline-block;font-size:13px;font-weight:500;color:#0f766e;text-decoration:none;
      border:1px solid #0f766e33;border-radius:6px;padding:7px 12px}
    #anatomy-card a:hover{background:#0f766e0f}
    @media (prefers-color-scheme:dark){
      #anatomy-card{background:#151a1e;color:#e7ebee;border-color:#ffffff1f}
      #anatomy-card p{color:#a8b2ba} #anatomy-card .ids{color:#8c959c}
      #anatomy-card a{color:#5eead4;border-color:#5eead43d}
    }
  </style>
  <img class="shot" alt="" hidden>
  <div class="body">
    <h2></h2>
    <p></p>
    <div class="ids"></div>
    <a target="_blank" rel="noreferrer">Open in 3D</a>
  </div>
  <script>
  (function(){
    var root=document.getElementById('anatomy-card');
    var img=root.querySelector('.shot'),h=root.querySelector('h2'),p=root.querySelector('p'),
        ids=root.querySelector('.ids'),a=root.querySelector('a');
    function paint(){
      var d=(window.openai&&window.openai.toolOutput)||{};
      // Only a data: URI is ever accepted here. The sandbox must not be talked into
      // fetching an arbitrary remote image by a crafted tool result.
      if(typeof d.png_data_url==='string'&&d.png_data_url.indexOf('data:image/')===0){
        img.setAttribute('src',d.png_data_url);
        img.setAttribute('alt',d.title||'Anatomy view');
        img.hidden=false;
      } else { img.hidden=true; }
      h.textContent=d.title||'Anatomy view';
      p.textContent=d.note||'';
      p.hidden=!d.note;
      var n=Array.isArray(d.ids)?d.ids.length:0;
      ids.textContent=n?(n+(n===1?' structure: ':' structures: ')+d.ids.join(', ')):'';
      ids.hidden=!n;
      if(typeof d.url==='string'&&d.url.indexOf('https://anatomy.adrian.my/')===0){
        a.setAttribute('href',d.url); a.hidden=false;
      } else { a.hidden=true; }
    }
    paint();
    window.addEventListener('openai:set_globals',paint);
  })();
  </script>
</div>`;

// ── the snapshot ────────────────────────────────────────────────────────────

/**
 * Render the composed view as a PNG, server-side, and return it as a data: URI.
 *
 * Returns `{ data_url }`, or `{ error }` naming what actually failed — never a silent
 * omission, because "no picture" and "the renderer is down" are different answers and
 * only one of them is worth retrying.
 */
async function renderSnapshot(ctx, view) {
  const { env } = ctx;
  if (!env.SNAP) return { error: 'no snapshot renderer is bound to this deployment' };
  // The caption is deliberately NOT rendered into this PNG: the widget prints it as
  // real, selectable, wrapping text right under the image, and burning it in as well
  // showed it twice. It also buys the thing that matters most under a metered browser
  // allowance — with no title/note in the params, the R2 cache key depends only on the
  // structures and the camera, so the same view with a DIFFERENT sentence is a cache
  // hit instead of another 60-second render.
  // `lang` is dropped along with the caption: snap mode hides every piece of chrome, so the
  // PNG is identical in all three languages — keeping it in would split the R2 cache three
  // ways for the same picture, which matters under a metered browser allowance.
  const target = buildUrl({ ...view, title: undefined, note: undefined, lang: undefined, snap: true, size: '960x720' });
  const query = new URL(target).searchParams.toString();
  // A BUDGET, not a wait. Measured on this account 2026-09-06: a cold render is ~67 s (a
  // new browser plus 33 MB of geometry), a warm tab 21-27 s, an R2 cache hit under 1 s. A
  // chat client abandons the tool call long before 67 s, so the rule for the LINK tool is:
  // answer with the link now, and let the render finish so the same request a moment later
  // is a cache hit. `callRenderer` now hands the SAME promise to the race and to waitUntil,
  // which is what stops a timed-out render costing two concurrent browsers.
  const r = await callRenderer(env, query, SNAPSHOT_BUDGET_MS, ctx);
  if (r.state !== 'ok') return { error: r.error, state: r.state };
  const b64 = toBase64(r.bytes);
  const data_url = `data:image/png;base64,${b64}`;
  if (data_url.length > MAX_PNG_DATA_URL_BYTES) {
    return { error: `rendered PNG is ${Math.round(data_url.length / 1024)} KB as a data URI, over the ${Math.round(MAX_PNG_DATA_URL_BYTES / 1024)} KB ceiling — the link still works` };
  }
  return { data_url, b64, cache: r.cache, ms: r.ms };
}

// ── the client, so a result can be shaped for who asked ─────────────────────

/**
 * Which client is on the other end, best effort, and honestly reported.
 *
 * It matters because the two clients want opposite things from the same result: Claude
 * documents image tool results as supported and caps the whole result at ~150,000
 * characters, while ChatGPT is the client where the widget is the carrier with positive
 * evidence on this account. Shipping both copies of the base64 to Claude can blow its cap;
 * dropping the widget for ChatGPT would blind it.
 *
 * There is no session on this transport (no Mcp-Session-Id is ever issued) and the Function
 * is stateless per request, so `clientInfo` from `initialize` is remembered in a module
 * global that lives as long as the isolate — usually a conversation, sometimes less. The
 * User-Agent is the independent second signal. Whatever it concluded is echoed back in
 * structuredContent.client, so the transcript SHOWS the guess rather than hiding it, and a
 * wrong guess is diagnosable instead of merely puzzling.
 */
let lastClientInfo = null;

export function clientFrom(request, env) {
  const ua = (request && request.headers && request.headers.get('User-Agent')) || '';
  const name = (lastClientInfo && lastClientInfo.name) || '';
  const forced = (env && env.FORCE_CLIENT) || '';
  // THE CURRENT REQUEST WINS. Concatenating the remembered name with this request's
  // User-Agent let one connection decide another's budget and carrier: a Claude
  // `initialize` earlier in the same isolate, then a ChatGPT request, matched "claude"
  // from the stale half of the haystack. The remembered name is consulted only when this
  // request's own User-Agent says nothing.
  const read = (s) => (/claude|anthropic/i.test(s) ? 'claude' : /chatgpt|openai/i.test(s) ? 'chatgpt' : '');
  const kind = forced || read(ua) || read(name) || 'unknown';
  return { kind, name: name || null, ua: ua.slice(0, 80) || null };
}

// ── tool implementations ────────────────────────────────────────────────────

const conceptUrl = (id, lang) => buildUrl({ ids: [id], isolate: true, lang });

/** The Chinese names, when the deployed index carries them. Always both scripts: a caller
 *  asking in 简体 may well be reading in 繁體, and the pair costs a few bytes. */
const zhNames = (row) => ({
  ...(row.name_zh_hans ? { name_zh_hans: row.name_zh_hans } : {}),
  ...(row.name_zh_hant ? { name_zh_hant: row.name_zh_hant } : {}),
});

function shape(index, c, lang) {
  const sys = c.system ? index._systemById.get(c.system) : null;
  return {
    id: c.id,
    name: c.name,
    ...zhNames(c),
    system: c.system,
    system_name: sys?.name ?? null,
    pieces: c.pieces,
    ...(c.systems ? { also_in_systems: c.systems } : {}),
    url: conceptUrl(c.id, lang),
  };
}

/** A concept id or a part id, with which one it was. The page accepts both in `select=`, so
 *  every tool that takes an id has to as well or it contradicts the URL contract. */
function resolve(index, id) {
  const c = index._byId.get(id);
  if (c) return { kind: 'concept', row: c, name: c.name, pieces: c.pieces };
  const p = index._partById.get(id);
  if (p) return { kind: 'part', row: p, name: p.name, pieces: 1 };
  return null;
}

function matches(index, q, systemFilter, limit) {
  const term = q.toLowerCase();
  const hits = [];
  for (const c of index.concepts) {
    if (systemFilter && c.system !== systemFilter) continue;
    // Chinese is matched in BOTH scripts regardless of which one was typed, so 臀中肌 and
    // 牙齒 both find their structure without the caller having to declare a script first.
    if (!c.name.toLowerCase().includes(term)
      && !c.id.toLowerCase().includes(term)
      && !(c.name_zh_hans || '').includes(term)
      && !(c.name_zh_hant || '').includes(term)) continue;
    hits.push(c);
  }
  // Shortest name first: "gluteus medius" should outrank "left gluteus medius tendon".
  hits.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
  return { page: hits.slice(0, limit), total: hits.length };
}

function tFind(index, a) {
  const q = str(a.query);
  if (!q) return toolError('query required');
  if (q.length > MAX_QUERY_CHARS) return toolError(`query too long: ${q.length} characters (max ${MAX_QUERY_CHARS})`);
  const systemFilter = a.system === undefined ? null : lower(a.system);
  if (systemFilter && !index._systemById.has(systemFilter)) {
    return toolError(`unknown system "${a.system}" — one of ${index.systems.map((s) => s.id).join(', ')} (call list_systems)`);
  }
  const limit = clampInt(a.limit, DEFAULT_FIND_LIMIT, 1, MAX_FIND_LIMIT);
  const { page, total } = matches(index, q, systemFilter, limit);
  return toolOk({
    results: page.map((c) => shape(index, c)),
    count: page.length,
    total,
    ...(total > page.length ? { note: `${total} structures match; showing the ${page.length} with the shortest names. Narrow the query or raise limit (max ${MAX_FIND_LIMIT}).` } : {}),
    query: q,
    ...(systemFilter ? { system: systemFilter } : {}),
  });
}

function tGetStructure(index, a) {
  const id = str(a.id);
  if (!id) return toolError('id required');
  if (!isId(id)) return toolError(`not an atlas id: "${id.slice(0, 40)}" — ids look like FMA22315`);
  const hit = resolve(index, id);
  if (!hit) return toolError(`not in this atlas: ${id} — call find_anatomy to get a valid id`);
  if (hit.kind === 'part') {
    const parent = index._byId.get(hit.row.concept);
    const psys = index._systemById.get(hit.row.system);
    return toolOk({
      id: hit.row.id,
      name: hit.row.name,
      ...zhNames(hit.row),
      kind: 'mesh',
      system: hit.row.system,
      system_name: psys?.name ?? null,
      system_description: psys?.description ?? null,
      pieces: 1,
      part_of: parent ? { id: parent.id, name: parent.name, ...zhNames(parent) } : null,
      explanation: null,
      explanation_source: psys ? 'system' : 'none',
      url: conceptUrl(hit.row.id, a.lang),
      source: 'BodyParts3D 4.0, CC BY 4.0 — https://lifesciencedb.jp/bp3d/',
    });
  }
  const c = hit.row;
  const sys = c.system ? index._systemById.get(c.system) : null;
  return toolOk({
    ...shape(index, c),
    system_description: sys?.description ?? null,
    // The atlas carries a specific explanation for only a handful of organs; for
    // everything else the system description is what the app itself shows, and the
    // caller is told which of the two it got rather than being left to guess.
    explanation: c.explanation ?? null,
    explanation_source: c.explanation ? 'structure' : (sys ? 'system' : 'none'),
    source: 'BodyParts3D 4.0, CC BY 4.0 — https://lifesciencedb.jp/bp3d/',
  });
}

function tListSystems(index) {
  return toolOk({
    systems: index.systems.map((s) => ({
      id: s.id, name: s.name, description: s.description, concepts: s.concepts, pieces: s.pieces,
    })),
    totals: index.totals,
    atlas_version: index.atlas_version,
    scope: index.scope,
  });
}

async function tComposeView(ctx, index, a) {
  const v = parseViewArgs(index, a);
  if (v.error) return toolError(v.error);

  const url = buildUrl({ ...v, v: entryVersion(a) });
  if (url.length > URL_CONTRACT.URL_MAX) {
    return toolError(`the composed URL would be ${url.length} characters, over the ${URL_CONTRACT.URL_MAX} limit — shorten the note or select fewer structures`);
  }

  const named = v.ids.map((id) => { const r = resolve(index, id); return { id, name: r.name, ...zhNames(r.row) }; });
  const pieces = v.ids.reduce((n, id) => n + (resolve(index, id).pieces || 0), 0);
  // The names the USER will see when the link opens — the point of passing `lang` at all.
  const shown = (n) => (v.lang === 'zh-Hans' && n.name_zh_hans) || (v.lang === 'zh-Hant' && n.name_zh_hant) || n.name;

  let snapshot = null;
  if (a.snapshot === true) snapshot = await renderSnapshot(ctx, v);

  const structuredContent = {
    // A Chinese list is separated by 、, not by a comma-space.
    title: v.title || named.map(shown).join(v.lang && v.lang !== 'en' ? '、' : ', '),
    note: v.note || '',
    url,
    ids: v.ids,
    names: named.map(shown),
    ...(snapshot?.data_url ? { png_data_url: snapshot.data_url } : {}),
  };

  const payload = {
    url,
    ids_resolved: v.ids,
    ids_unknown: v.unknown,
    names: named,
    pieces_highlighted: pieces,
    isolate: v.isolate,
    view: v.view || 'three-quarter',
    lang: v.lang || 'en',
    names_shown: named.map(shown),
    title: v.title || null,
    note: v.note || null,
    url_chars: url.length,
    ...(v.unknown.length ? { note_on_unknown: `${v.unknown.length} id(s) are not in this atlas and are not in the link: ${v.unknown.join(', ')}` } : {}),
    ...(snapshot?.data_url ? { snapshot: { bytes_data_url: snapshot.data_url.length, cache: snapshot.cache, render_ms: snapshot.ms } } : {}),
    ...(snapshot?.error ? { snapshot_error: snapshot.error } : {}),
  };

  // L30 P4: when compose_view DID render a picture it now also emits it as an image block,
  // through the same helper render_anatomy uses, so the two tools cannot disagree about how
  // a picture is delivered. Everything else about this result is byte-identical to P3 --
  // the first block is still the same JSON text block every existing test reads.
  const okResult = toolOk(payload, {
    structuredContent,
    _meta: { 'openai/outputTemplate': WIDGET_URI },
  });
  // The block is a SECOND copy of the same base64 that structuredContent already carries,
  // so it is added only when the ASSEMBLED result still fits the client cap — measured, not
  // estimated. The widget copy is never given up here: compose_view is the link tool, and
  // its widget is what P2 verified end to end.
  if (snapshot?.b64 && snapshot.b64.length <= MAX_IMAGE_BLOCK_B64) {
    const withImage = { ...okResult, content: [...okResult.content, { type: 'image', data: snapshot.b64, mimeType: 'image/png' }] };
    if (JSON.stringify(withImage).length <= MAX_RESULT_CHARS) return withImage;
  }
  return okResult;
}

// ── render_anatomy — the teaching plate ─────────────────────────────────────

/**
 * Tool arguments into a validated Scene. One reading of the request builds the picture AND
 * the link, so the two can never disagree about what was asked for.
 *
 * Ids are checked against the deployed index, not merely against the id pattern: a caller
 * is TOLD which ids the viewer would ignore rather than handed a link that quietly shows
 * fewer structures.
 */
function parseRenderArgs(index, a) {
  // A hard bound on how much the caller may make this function think about. The scene
  // itself is capped at MAX_STRUCTURES, but that cap only counts ids this atlas HAS, so
  // without this a request of ten thousand absent ids is still fully parsed and reported.
  const MAX_INPUT_IDS = 200;
  const list = (v) => (Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : []).slice(0, MAX_INPUT_IDS);
  const clean = (raw, field) => {
    const out = [];
    for (const x of list(raw)) {
      const v = str(x);
      if (!v) continue;
      if (!isId(v)) return { error: `${field} contains "${String(x).slice(0, 40)}", which is not an atlas id — ids look like FMA22315` };
      if (!out.includes(v)) out.push(v);
    }
    return { ids: out };
  };

  const sel = clean(a.select, 'select'); if (sel.error) return sel;
  if (!sel.ids.length) {
    return { error: 'select is required: an array of atlas ids, e.g. ["FMA22357","FMA22438","FMA45887"]. Use find_anatomy to get them.' };
  }
  const ctx2 = clean(a.context, 'context'); if (ctx2.error) return ctx2;
  const gh = clean(a.ghost, 'ghost'); if (gh.error) return gh;

  const roleFor = new Map();
  for (const id of gh.ids) roleFor.set(id, 'ghost');
  for (const id of ctx2.ids) roleFor.set(id, 'context');
  for (const id of sel.ids) roleFor.set(id, 'primary');   // select wins every collision

  const unknown = [];
  const structures = [];
  for (const [id, role] of roleFor) {
    if (index._byId.has(id) || index._partById.has(id)) structures.push({ id, role });
    else unknown.push(id);
  }
  if (!structures.length) {
    return { error: `none of these ids are in this atlas: ${unknown.join(', ')} — call find_anatomy first (ids look like FMA22315)` };
  }

  const focusRaw = clean((a.focus && a.focus.ids) || a.focus, 'focus.ids'); if (focusRaw.error) return focusRaw;
  const focus = focusRaw.ids.filter((id) => !unknown.includes(id));

  if (a.view !== undefined && !SCENE_VIEWS.includes(lower(a.view))) {
    return { error: `unknown view "${a.view}" — one of ${SCENE_VIEWS.join(', ')}` };
  }
  if (a.background !== undefined && !BACKGROUNDS.includes(lower(a.background))) {
    return { error: `background "${a.background}" is not available — use ${BACKGROUNDS.join(' or ')} (transparent is not enabled on this deployment yet)` };
  }
  if (a.rest !== undefined && !REST_MODES.includes(lower(a.rest))) {
    return {
      error: lower(a.rest) === 'all'
        ? 'rest:"all" is not available — the whole body at low opacity costs a full 33 MB geometry load and a cold render. Use rest:"skeletal" for context.'
        : `rest "${a.rest}" — one of ${REST_MODES.join(', ')}`,
    };
  }
  if (a.lang !== undefined && !SCENE_LANGS.includes(str(a.lang))) {
    return { error: `unknown lang "${a.lang}" — one of ${SCENE_LANGS.join(', ')}` };
  }

  const t = captionText(a.title, SCENE_LIMITS.TITLE_MAX, 'title'); if (t.error) return { error: t.error };
  const n = captionText(a.note, SCENE_LIMITS.NOTE_MAX, 'note'); if (n.error) return { error: n.error };

  // ACCEPTED AND IGNORED, then REPORTED. Rejecting these outright turns a soft mistake by
  // a model copying the PRD into a hard failure with no picture; swallowing them silently
  // teaches it nothing. Report-and-continue does both jobs.
  const ignored = [];
  const styles = [];
  for (const [i, s] of (Array.isArray(a.styles) ? a.styles : []).entries()) {
    if (!s || typeof s !== 'object' || !isId(str(s.id))) return { error: `styles[${i}] needs an atlas id` };
    if (s.color !== undefined) ignored.push(`styles[${i}].color`);
    styles.push({ id: str(s.id), ...(s.emphasis !== undefined ? { emphasis: String(s.emphasis) } : {}), ...(s.opacity !== undefined ? { opacity: Number(s.opacity) } : {}) });
  }
  const annotations = [];
  for (const [i, an] of (Array.isArray(a.annotations) ? a.annotations : []).entries()) {
    if (!an || typeof an !== 'object') return { error: `annotations[${i}] must be an object` };
    // There is no hip joint in this atlas — there are no articulation concepts at all.
    // BodyParts3D ships meshes, not joints, so `axis` can never resolve to geometry.
    if (an.axis !== undefined) ignored.push(`annotations[${i}].axis`);
    annotations.push({ ...an, axis: undefined });
  }

  const num = (v, dflt) => (v === undefined ? dflt : Number(v));
  const scene = normalizeScene({
    mode: 'render',
    lang: a.lang === undefined ? 'en' : str(a.lang),
    structures,
    rest: { include: a.rest === undefined ? 'none' : lower(a.rest), opacity: num(a.restOpacity, 0.08) },
    camera: {
      view: a.view === undefined ? 'three-quarter' : lower(a.view),
      focus,
      padding: num((a.focus && a.focus.padding), 1.35),
    },
    roleOpacity: { primary: 1, context: num(a.supportOpacity, 0.55), ghost: num(a.contextOpacity, 0.25) },
    styles,
    annotations,
    caption: { title: t.value || '', note: n.value || '', place: a.burn_caption === false ? 'out' : 'in' },
    background: a.background === undefined ? 'light' : lower(a.background),
    size: { w: num(a.width, 960), h: num(a.height, 720) },
    ss: a.supersample === false ? 0 : 1,
  });

  const err = validateScene(scene);
  if (err) return { error: err };
  const blob = encodeScene(scene);
  if (blob.length > SCENE_LIMITS.SCENE_MAX_B64) {
    return { error: `the scene encodes to ${blob.length} characters, over the ${SCENE_LIMITS.SCENE_MAX_B64} limit — send fewer annotations or shorten the note` };
  }
  return { scene, blob, unknown, ignored };
}

/**
 * PRD section 19's P0 through P3, in one tool: an image inside the conversation, a clean
 * teaching plate rather than a screenshot of software, automatic framing, and ghosted
 * context anatomy.
 *
 * The result carries the picture THREE WAYS on purpose, because no agent-side evidence
 * settles which one a given client will display:
 *   1. an MCP `{type:'image'}` block — what the spec says and what Anthropic documents;
 *   2. the widget's `png_data_url` — the carrier with positive evidence on this account;
 *   3. the interactive link in the text block — which works in every client, always.
 * The picture degrades; the answer never does.
 */
async function tRenderAnatomy(ctx, index, a) {
  const v = parseRenderArgs(index, a);
  if (v.error) return toolError(v.error);
  const { scene, blob, unknown, ignored } = v;

  const ids = sceneSelectIds(scene);
  const named = ids.map((id) => { const r = resolve(index, id); return { id, name: r.name, ...zhNames(r.row) }; });
  const shown = (n) => (scene.lang === 'zh-Hans' && n.name_zh_hans) || (scene.lang === 'zh-Hant' && n.name_zh_hant) || n.name;

  // THE LINK A HUMAN OPENS, and it must not be the plate. A render-mode blob puts the page
  // into its chrome-less teaching mode, so following "Interactive 3D" would have handed
  // Adrian a picture he could not orbit, search or explore — which is exactly the criterion
  // the PRD's success test ends on. The link therefore carries an EXPLORE variant of the
  // same scene: same structures, same roles and opacities, same camera, chrome restored.
  const exploreBlob = encodeScene({ ...scene, mode: 'explore' });
  const url = buildUrl({ ids, lang: scene.lang, v: entryVersion(a) }) + `&scene=${exploreBlob}`;
  if (url.length > URL_CONTRACT.URL_MAX) {
    return toolError(`the composed URL would be ${url.length} characters, over the ${URL_CONTRACT.URL_MAX} limit — shorten the note or select fewer structures`);
  }

  const client = ctx.client || { kind: 'unknown' };
  const query = new URLSearchParams({
    select: ids.join(','),
    scene: blob,
    snap: '1',
    size: `${scene.size.w}x${scene.size.h}`,
  }).toString();

  let render = { state: 'skipped' };
  if (a.interactive_only !== true) {
    // PROBE FIRST. A view this atlas has drawn before comes back in about a second; asking
    // costs one R2 GET and never touches a browser. Only on a miss do we spend the metered
    // resource and hold the tool call open.
    render = await callRenderer(ctx.env, `${query}&cacheonly=1`, CACHE_PROBE_BUDGET_MS, ctx);
    if (render.state === 'not_cached' || render.state === 'pending') {
      const budget = client.kind === 'claude' ? RENDER_BUDGET_CLAUDE_MS : RENDER_BUDGET_DEFAULT_MS;
      render = await callRenderer(ctx.env, query, budget, ctx);
    }
  }

  // BOUNDED. `unknown` is whatever the caller sent that this atlas does not carry, and a
  // 256 KB request body can hold thousands of well-formed-but-absent ids — reporting them
  // all would push the result past the client cap with no picture involved at all.
  const unknownReport = unknown.slice(0, 10);

  let b64 = null;
  let stateNote = '';
  if (render.state === 'ok') {
    if (render.bytes.length > MAX_PNG_BYTES) {
      render = { state: 'image_too_large', error: `the rendered plate is ${Math.round(render.bytes.length / 1024)} KB, over the ${Math.round(MAX_PNG_BYTES / 1024)} KB ceiling — the link still works` };
    } else {
      b64 = toBase64(render.bytes);
    }
  }
  if (render.state !== 'ok' && render.state !== 'skipped') stateNote = `\n\n(${render.error})`;

  const title = scene.caption.title || named.map(shown).join(scene.lang !== 'en' ? '、' : ', ');
  const note = scene.caption.note || '';

  /**
   * MEASURE THE RESULT, do not estimate it. An estimate can both ship something over the
   * client's cap and throw away the one carrier that would have fitted. This assembles a
   * candidate, serialises it, and only then decides — so the number the decision is made on
   * is the number that goes on the wire.
   */
  const assemble = (withImage, withWidget, extraNote) => {
    const body = [title, note, '', `Interactive 3D: ${url}`].filter((x, i) => x !== '' || i === 2).join('\n');
    return toolBlocks([
      // BARE base64, no data: prefix — that is what the MCP spec's ImageContent carries.
      ...(withImage ? [{ type: 'image', data: b64, mimeType: 'image/png' }] : []),
      { type: 'text', text: body + stateNote + (extraNote || '') },
    ], {
      structuredContent: {
        title, note, url, ids,
        names: named.map(shown),
        names_shown: named.map(shown),
        lang: scene.lang,
        view: scene.camera.view,
        focus: scene.camera.focus,
        width: scene.size.w,
        height: scene.size.h,
        render_state: render.state === 'skipped' ? 'link_only' : render.state,
        ...(render.cache ? { cache: render.cache } : {}),
        ...(render.ms ? { render_ms: Number(render.ms) } : {}),
        ...(render.settle ? { settle: render.settle } : {}),
        // Always reported: the size contract is the thing most likely to decide silently
        // whether this client sees anything at all.
        ...(b64 ? { image_b64_chars: b64.length, image_bytes: render.bytes ? render.bytes.length : null } : {}),
        image_block: withImage,
        client: client.kind,
        ...(withWidget ? { png_data_url: `data:image/png;base64,${b64}` } : {}),
        ...(unknownReport.length ? { ids_unknown: unknownReport } : {}),
        ...(unknown.length > unknownReport.length ? { ids_unknown_more: unknown.length - unknownReport.length } : {}),
        ...(ignored.length ? { ignored_fields: ignored } : {}),
      },
      _meta: { 'openai/outputTemplate': WIDGET_URI },
    });
  };

  const fits = (r) => JSON.stringify(r).length <= MAX_RESULT_CHARS;
  if (!b64) return assemble(false, false);

  // Yield order, measured. A caller that IDENTIFIED itself as Claude keeps the image block
  // (Anthropic documents image tool results) and loses the widget copy; everyone else —
  // including every unknown caller — keeps the widget, the carrier with positive evidence
  // on this account, and loses the block. NEVER truncate, and NEVER re-render.
  const wantImage = b64.length <= MAX_IMAGE_BLOCK_B64;
  const both = assemble(wantImage, true);
  if (fits(both)) return both;
  const preferred = client.kind === 'claude'
    ? [[wantImage, false], [false, true]]
    : [[false, true], [wantImage, false]];
  for (const [img, wid] of preferred) {
    if (!img && !wid) continue;
    const candidate = assemble(img, wid);
    if (fits(candidate)) return candidate;
  }
  return assemble(false, false, '\n\n(the rendered plate is too large to carry inline in this client; the link opens it)');
}

/**
 * Registered from day one, refusing until it is built. That teaches the model the surface
 * exists AND that no GIF or MP4 is coming, which is better than letting it discover the
 * generic "Tool not implemented" — and better than leaving it to guess that an eight-step
 * sequence rendered frame by frame would be 200+ metered browser renders against an
 * allowance that answers 429 after about six.
 */
function tComposeSequence() {
  return toolError('compose_sequence is not enabled on this deployment yet — use render_anatomy for a still plate, or compose_view for a link the user can open and explore. Steps take atlas ids like FMA16580, never names; call find_anatomy first.');
}

/** The five-minute experiment. A bare image block, no widget attached. */
function tProbeImage() {
  return toolBlocks([
    { type: 'image', data: PROBE_PNG_B64, mimeType: 'image/png' },
    { type: 'text', text: 'That was a 371-byte test PNG returned as an MCP image content block, with no widget attached. If you can see a small teal rectangle with a white diagonal, this client renders MCP image blocks inline. If you see nothing, a placeholder, or a wall of base64, it does not — and render_anatomy should lean on its other carriers in this client.' },
  ]);
}

function tSearch(index, a) {
  const q = str(a.query);
  if (!q) return toolError('query required');
  if (q.length > MAX_QUERY_CHARS) return toolError(`query too long: ${q.length} characters (max ${MAX_QUERY_CHARS})`);
  const limit = clampInt(a.limit, DEFAULT_SEARCH_LIMIT, 1, MAX_SEARCH_LIMIT);
  const { page, total } = matches(index, q, null, limit);
  return toolOk({
    results: page.map((c) => ({
      id: `anatomy:${c.id}`,
      title: c.name_zh_hans ? `${c.name} · ${c.name_zh_hans}` : c.name,
      url: conceptUrl(c.id),
      snippet: `${c.name}${c.name_zh_hans ? ` (${c.name_zh_hans} / ${c.name_zh_hant ?? c.name_zh_hans})` : ''} — ${index._systemById.get(c.system)?.name ?? 'anatomy'}, ${c.pieces} mesh${c.pieces === 1 ? '' : 'es'}`,
    })),
    count: page.length,
    total,
    ...(total > page.length ? { note: `${total} match; showing ${page.length}.` } : {}),
  });
}

function tFetch(index, a) {
  const raw = str(a.id);
  if (!raw) return toolError('id required');
  const id = raw.startsWith('anatomy:') ? raw.slice('anatomy:'.length) : raw;
  if (!isId(id)) return toolError(`not an atlas id: "${raw.slice(0, 40)}" — expected anatomy:FMA22315 or FMA22315`);
  const hit = resolve(index, id);
  if (!hit) return toolError(`not in this atlas: ${id}`);
  const c = hit.row;
  const sys = c.system ? index._systemById.get(c.system) : null;
  const url = conceptUrl(c.id);
  const text = [
    `# ${c.name}`,
    ...(c.name_zh_hans ? ['', `简体: ${c.name_zh_hans}`, `繁體: ${c.name_zh_hant ?? c.name_zh_hans}`] : []),
    '',
    `Atlas id: ${c.id}`,
    `System: ${sys?.name ?? 'unknown'}${c.systems ? ` (also in ${c.systems.join(', ')})` : ''}`,
    hit.kind === 'part'
      ? `One individual mesh${index._byId.get(c.concept) ? `, part of ${index._byId.get(c.concept).name}` : ''}.`
      : `Modelled from ${c.pieces} mesh${c.pieces === 1 ? '' : 'es'}.`,
    '',
    c.explanation ?? sys?.description ?? '',
    '',
    `Open it in the live 3D viewer: ${url}`,
    `In Chinese: ${conceptUrl(c.id, 'zh-Hans')}`,
    '',
    'Source: BodyParts3D 4.0, © The Database Center for Life Science, CC BY 4.0.',
  ].join('\n');
  return toolOk({
    id: raw,
    title: c.name,
    ...zhNames(c),
    text,
    url,
    metadata: { kind: hit.kind === 'part' ? 'mesh' : 'structure', atlas_id: c.id, system: c.system, pieces: hit.pieces },
  });
}

async function callTool(name, args, ctx, identity) {
  const a = args || {};
  try {
    const index = await getIndex(ctx);
    if (!index) return noIndex();
    switch (name) {
      case 'find_anatomy': return tFind(index, a);
      case 'get_structure': return tGetStructure(index, a);
      case 'list_systems': return tListSystems(index);
      case 'compose_view': return await tComposeView(ctx, index, a);
      case 'render_anatomy': return await tRenderAnatomy(ctx, index, a);
      case 'compose_sequence': return tComposeSequence();
      case 'probe_image': return tProbeImage();
      case 'search': return tSearch(index, a);
      case 'fetch': return tFetch(index, a);
      default: return toolError(`Tool not implemented: ${name}`);
    }
  } catch (err) {
    // Never reflect internal detail (stack, binding names) back to the caller.
    console.error('tool error:', name, err, identity?.label);
    return toolError('tool failed (internal error — reported)');
  }
}

// ── JSON-RPC dispatch ───────────────────────────────────────────────────────

/**
 * MCP is stricter than plain JSON-RPC: a REQUEST id must be a string or a number and
 * MUST NOT be null (null is reserved for error responses to unparseable input).
 */
const validId = (v) => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

export async function dispatch(req, ctx, identity) {
  // Reject primitives and arrays BEFORE `'id' in req` — `in` throws on a primitive.
  if (typeof req !== 'object' || req === null || Array.isArray(req)) return rpcError(null, -32600, 'Invalid request');

  const method = req.method;
  const hasId = 'id' in req;
  if (req.jsonrpc !== '2.0') return rpcError(hasId && validId(req.id) ? req.id : null, -32600, 'Invalid request: jsonrpc must be "2.0"');
  // A RESPONSE (no method, exactly one of result/error, a valid id) is a legal thing
  // for a client to send on this transport; the spec's answer is to accept it with no
  // body, not to call it malformed.
  if (!('method' in req)) {
    const hasResult = 'result' in req;
    const hasError = 'error' in req;
    if (hasResult !== hasError && validId(req.id)) return null;
  }
  if (typeof method !== 'string' || !method) return rpcError(hasId && validId(req.id) ? req.id : null, -32600, 'Invalid request: method must be a string');
  if (hasId && !validId(req.id)) return rpcError(null, -32600, 'Invalid request: id must be a string or a number');
  if (hasId && method.startsWith('notifications/')) {
    return rpcError(req.id, -32600, `Invalid request: ${method} is a notification and must not carry an id`);
  }
  if (req.params !== undefined && (typeof req.params !== 'object' || req.params === null || Array.isArray(req.params))) {
    return rpcError(hasId ? req.id : null, -32602, 'Invalid params: must be an object');
  }

  const id = hasId ? req.id : null;
  const params = req.params || {};
  const isNotification = !hasId;
  // A notification NEVER gets a response — not even for ping or tools/list.
  if (isNotification && !method.startsWith('notifications/')) return null;

  try {
    switch (method) {
      case 'initialize': {
        const want = params?.protocolVersion;
        // L30 P4: remember WHO connected. There is no session on this transport, so this is
        // a best-effort module global with the User-Agent as a second signal; whatever it
        // concludes is echoed back in every render result so a wrong guess is visible in
        // the transcript rather than silently reshaping the payload.
        if (params?.clientInfo && typeof params.clientInfo === 'object') {
          lastClientInfo = { name: str(params.clientInfo.name), version: str(params.clientInfo.version) };
        }
        const negotiated = SUPPORTED_VERSIONS.includes(want) ? want : PROTOCOL_VERSION;
        return rpcResult(id, {
          protocolVersion: negotiated,
          capabilities: CAPABILITIES,
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return null;
      case 'ping':
        return rpcResult(id, {});
      case 'tools/list':
        return rpcResult(id, { tools: toolsFor(identity) });
      case 'resources/list':
        return rpcResult(id, { resources: identity?.owner ? RESOURCES : [] });
      case 'resources/read': {
        const uri = str(params?.uri);
        if (!identity?.owner) return rpcError(id, -32001, 'Owner only');
        if (uri !== WIDGET_URI) return rpcError(id, -32602, `Unknown resource: ${uri || '(none)'}`);
        return rpcResult(id, {
          contents: [{ uri: WIDGET_URI, mimeType: 'text/html+skybridge', text: WIDGET_HTML }],
        });
      }
      case 'tools/call': {
        const visible = toolsFor(identity);
        const requested = params?.name;
        if (!TOOLS.some((t) => t.name === requested)) return rpcError(id, -32602, `Unknown tool: ${requested}`);
        if (!visible.some((t) => t.name === requested)) return rpcError(id, -32001, 'Owner only');
        const args = params?.arguments;
        if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
          return rpcError(id, -32602, 'Invalid params: arguments must be an object');
        }
        return rpcResult(id, await callTool(requested, args || {}, ctx, identity));
      }
      default:
        return isNotification ? null : rpcError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err) {
    console.error('rpc error:', method, err);
    return isNotification ? null : rpcError(id, -32603, 'Internal error');
  }
}

// ── HTTP entry point ────────────────────────────────────────────────────────

/**
 * The request body as text, or null if it exceeds `max` BYTES. Counts bytes off the
 * stream and cancels as soon as the cap is passed — a JS string length counts UTF-16
 * units, so a byte cap checked against `.length` would let multi-byte payloads through.
 */
export async function readBounded(request, max) {
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) { await reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  const buf = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { buf.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(buf);
}

export async function onRequest({ request, env, waitUntil }) {
  const cors = corsHeaders(request);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  // POST-only server: GET (SSE stream) and DELETE (session teardown) must be a real
  // 405 with Allow, not a JSON-RPC error inside a 200 — claude.ai web probes GET
  // before initialize and aborts the handshake otherwise.
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { ...cors, Allow: 'POST, OPTIONS' } });
  }

  // ── auth, before anything is parsed or dispatched ──
  const identity = await resolveIdentity(request, env);
  if (!identity) {
    return new Response(JSON.stringify(rpcError(null, -32001, 'Unauthorized')), {
      status: 401,
      headers: {
        ...cors,
        // Cloudflare Access answers discovery at its OWN
        // `/.well-known/cloudflare-access-protected-resource/` prefix, not the RFC 9728
        // name (A234, measured — the RFC path 302s). This header is the function's own
        // fallback for hosts the edge app does not cover; with Managed OAuth on, Access
        // replaces it with its own before the client sees it.
        'WWW-Authenticate': `Bearer realm="mcp", resource_metadata="${SITE_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
      },
    });
  }

  const rawBody = await readBounded(request, MAX_BODY_BYTES);
  if (rawBody === null) {
    return new Response(JSON.stringify(rpcError(null, -32600, `Request too large (max ${MAX_BODY_BYTES} bytes)`)), { status: 413, headers: cors });
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify(rpcError(null, -32700, 'Parse error')), { headers: cors });
  }

  // `initialize` is exempt from the version check on purpose: that request is where
  // the version is negotiated, so 400ing it would make the server unconnectable to any
  // client whose preferred version we do not list.
  const isInitialize = !Array.isArray(body) && body?.method === 'initialize';
  if (request.headers.has('Mcp-Protocol-Version') && !isInitialize) {
    const declaredVersion = (request.headers.get('Mcp-Protocol-Version') || '').trim();
    if (!SUPPORTED_VERSIONS.includes(declaredVersion)) {
      return new Response(JSON.stringify(rpcError(null, -32600, `Unsupported MCP-Protocol-Version: "${declaredVersion}". Supported: ${SUPPORTED_VERSIONS.join(', ')}`)), { status: 400, headers: cors });
    }
  }

  const ctx = { env, origin: new URL(request.url).origin, waitUntil, client: clientFrom(request, env) };

  if (Array.isArray(body)) {
    if (body.length === 0) {
      return new Response(JSON.stringify(rpcError(null, -32600, 'Invalid request: empty batch')), { headers: cors });
    }
    if (body.length > MAX_BATCH) {
      return new Response(JSON.stringify(rpcError(null, -32600, `Batch too large: ${body.length} (max ${MAX_BATCH})`)), { status: 413, headers: cors });
    }
    const out = (await Promise.all(body.map((r) => dispatch(r, ctx, identity)))).filter((r) => r !== null);
    if (out.length === 0) return new Response(null, { status: 202, headers: cors });
    return new Response(JSON.stringify(out), { headers: cors });
  }

  const result = await dispatch(body, ctx, identity);
  if (result === null) return new Response(null, { status: 202, headers: cors });
  return new Response(JSON.stringify(result), { headers: cors });
}

// Exported for the test suite only — not part of the MCP surface.
export const __test__ = {
  TOOLS, toolsFor, RESOURCES, WIDGET_HTML, WIDGET_URI, URL_CONTRACT,
  buildUrl, parseViewArgs, captionText, isId, clampInt, matches, shape, resolve, zhNames,
  SITE_ORIGIN, MAX_BATCH, MAX_PNG_DATA_URL_BYTES,
  // L30 P4. The codec functions are re-exported so a test can assert that THIS module and
  // the page's module are the SAME module — the anti-drift check that makes "one definition,
  // two importers" a fact rather than an intention.
  parseRenderArgs, clientFrom, PROBE_PNG_B64, GROUPS,
  MAX_IMAGE_BLOCK_B64, MAX_RESULT_CHARS, MAX_PNG_BYTES,
  RENDER_BUDGET_CLAUDE_MS, RENDER_BUDGET_DEFAULT_MS, CACHE_PROBE_BUDGET_MS,
  codec: { normalizeScene, validateScene, encodeScene, decodeScene, sceneSelectIds, structureOpacity, SCENE_LIMITS },
};
