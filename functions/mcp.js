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

const WIDGET_URI = 'ui://widget/anatomy-view.html';

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
function buildUrl({ ids, view, isolate, explode, snap, title, note, size }) {
  const p = new URLSearchParams();
  if (ids?.length) p.set('select', ids.join(','));
  if (isolate) p.set('isolate', '1');
  if (view && view !== 'three-quarter') p.set('view', view);
  if (typeof explode === 'number' && explode > 0) p.set('explode', explode.toFixed(2));
  if (snap) p.set('snap', '1');
  if (title) p.set('title', title);
  if (note) p.set('note', note);
  if (size) p.set('size', size);
  const q = p.toString();
  return `${SITE_ORIGIN}/${q ? `?${q}` : ''}`;
}

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
  const resolved = [];
  const unknown = [];
  for (const id of cleaned) (index._byId.has(id) ? resolved : unknown).push(id);
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

  // `isolate` defaults ON: the whole point of naming structures is to see THEM. A
  // caller that wants them in context passes isolate:false.
  const isolate = a.isolate === undefined ? true : a.isolate;
  return { ids: resolved, unknown, view, isolate, explode, title: t.value, note: n.value };
}

// ── tool registry ───────────────────────────────────────────────────────────

const INSTRUCTIONS = `A 3D human anatomy viewer (anatomy.adrian.my) that you can POINT AT. Adrian is learning yoga and wants a visual anchor for his body: when you talk about a muscle or a bone, give him the picture, not only the words.

The atlas: 3,432 named structures (BodyParts3D), 2,234 individual meshes, grouped into 15 systems. Ids are FMA identifiers and look like FMA22315. Names are stored lowercase.

The normal flow
1. find_anatomy({query:"gluteus"}) to turn words into ids. Search is case-insensitive over names and ids.
2. compose_view({select:["FMA22315","FMA22314","FMA18060"], view:"back", title:"...", note:"..."}) to build a link that opens the live 3D view with ALL of those structures highlighted together and your own sentence printed over the scene.
3. Give Adrian the URL. Tapping it on his phone opens the real, orbitable 3D body.

compose_view is the important one. It takes SEVERAL ids at once, because the useful anatomical answer is usually a group ("these three stabilise the pelvis"), not one muscle. \`note\` is shown to him verbatim as a caption on the image — write it for him, in your own words, not as a label. Pass snapshot:true to also get a rendered PNG of that exact view when the renderer is available.

get_structure({id}) gives the name, system, an explanation and the piece count. list_systems() gives the 15 systems and their sizes. search/fetch are the plain connector contract over the same data.

Nothing here writes; every tool is read-only. Access is owner-only.`;

const TOOLS = [
  {
    name: 'find_anatomy',
    description: 'Find anatomical structures by name or atlas id. Case-insensitive substring match over both (names are stored lowercase, so "Gluteus" and "gluteus" behave the same). Returns id, name, system, how many meshes it is built from, and a ready deep link. Filter to one system with system= (see list_systems). START HERE — every other tool takes ids, and ids look like FMA22315.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "gluteus", "psoas", "lumbar vertebra", or an id.' },
        system: { type: 'string', description: 'Restrict to one system id, e.g. "muscular" or "skeletal".' },
        limit: { type: 'number', description: `Default ${DEFAULT_FIND_LIMIT}, max ${MAX_FIND_LIMIT}.` },
      },
      required: ['query'],
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_structure',
    description: 'One structure in full: name, its system and that system\'s description, a specific explanation when the atlas has one, the number of meshes, and a deep link that opens it isolated in the 3D view.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'An atlas id, e.g. "FMA22315".' } },
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

Pass snapshot:true to also get a rendered PNG of that exact view inline; if the renderer is unavailable the link is still returned and snapshot_error says why.`,
    inputSchema: {
      type: 'object',
      properties: {
        select: { type: 'array', items: { type: 'string' }, description: 'Atlas ids, e.g. ["FMA22315","FMA22314","FMA18060"].' },
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
  const target = buildUrl({ ...view, snap: true, size: '960x720' });
  try {
    const res = await env.SNAP.fetch(new Request(`${SITE_ORIGIN}/api/snap?${new URL(target).searchParams.toString()}`, {
      method: 'GET',
      headers: { 'X-Snap-Internal': '1' },
    }));
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || !/image\/png/i.test(ct)) {
      const detail = /json|text/i.test(ct) ? (await res.text()).slice(0, 200) : '';
      return { error: `renderer answered ${res.status} ${ct || 'no content-type'}${detail ? `: ${detail}` : ''}` };
    }
    const buf = new Uint8Array(await res.arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 8192) bin += String.fromCharCode(...buf.subarray(i, i + 8192));
    const data_url = `data:image/png;base64,${btoa(bin)}`;
    if (data_url.length > MAX_PNG_DATA_URL_BYTES) {
      return { error: `rendered PNG is ${Math.round(data_url.length / 1024)} KB as a data URI, over the ${Math.round(MAX_PNG_DATA_URL_BYTES / 1024)} KB ceiling — the link still works` };
    }
    return { data_url, cache: res.headers.get('X-Snap-Cache') || null, ms: res.headers.get('X-Snap-Ms') || null };
  } catch (err) {
    console.error('snapshot failed:', err);
    return { error: 'the snapshot renderer could not be reached' };
  }
}

// ── tool implementations ────────────────────────────────────────────────────

const conceptUrl = (id) => buildUrl({ ids: [id], isolate: true });

function shape(index, c) {
  const sys = c.system ? index._systemById.get(c.system) : null;
  return {
    id: c.id,
    name: c.name,
    system: c.system,
    system_name: sys?.name ?? null,
    pieces: c.pieces,
    ...(c.systems ? { also_in_systems: c.systems } : {}),
    url: conceptUrl(c.id),
  };
}

function matches(index, q, systemFilter, limit) {
  const term = q.toLowerCase();
  const hits = [];
  for (const c of index.concepts) {
    if (systemFilter && c.system !== systemFilter) continue;
    if (!c.name.toLowerCase().includes(term) && !c.id.toLowerCase().includes(term)) continue;
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
  const c = index._byId.get(id);
  if (!c) return toolError(`not in this atlas: ${id} — call find_anatomy to get a valid id`);
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

  const url = buildUrl(v);
  if (url.length > URL_CONTRACT.URL_MAX) {
    return toolError(`the composed URL would be ${url.length} characters, over the ${URL_CONTRACT.URL_MAX} limit — shorten the note or select fewer structures`);
  }

  const named = v.ids.map((id) => ({ id, name: index._byId.get(id).name }));
  const pieces = v.ids.reduce((n, id) => n + (index._byId.get(id).pieces || 0), 0);

  let snapshot = null;
  if (a.snapshot === true) snapshot = await renderSnapshot(ctx, v);

  const structuredContent = {
    title: v.title || named.map((n) => n.name).join(', '),
    note: v.note || '',
    url,
    ids: v.ids,
    names: named.map((n) => n.name),
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
    title: v.title || null,
    note: v.note || null,
    url_chars: url.length,
    ...(v.unknown.length ? { note_on_unknown: `${v.unknown.length} id(s) are not in this atlas and are not in the link: ${v.unknown.join(', ')}` } : {}),
    ...(snapshot?.data_url ? { snapshot: { bytes_data_url: snapshot.data_url.length, cache: snapshot.cache, render_ms: snapshot.ms } } : {}),
    ...(snapshot?.error ? { snapshot_error: snapshot.error } : {}),
  };

  return toolOk(payload, {
    structuredContent,
    _meta: { 'openai/outputTemplate': WIDGET_URI },
  });
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
      title: c.name,
      url: conceptUrl(c.id),
      snippet: `${c.name} — ${index._systemById.get(c.system)?.name ?? 'anatomy'}, ${c.pieces} mesh${c.pieces === 1 ? '' : 'es'}`,
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
  const c = index._byId.get(id);
  if (!c) return toolError(`not in this atlas: ${id}`);
  const sys = c.system ? index._systemById.get(c.system) : null;
  const url = conceptUrl(c.id);
  const text = [
    `# ${c.name}`,
    '',
    `Atlas id: ${c.id}`,
    `System: ${sys?.name ?? 'unknown'}${c.systems ? ` (also in ${c.systems.join(', ')})` : ''}`,
    `Modelled from ${c.pieces} mesh${c.pieces === 1 ? '' : 'es'}.`,
    '',
    c.explanation ?? sys?.description ?? '',
    '',
    `Open it in the live 3D viewer: ${url}`,
    '',
    'Source: BodyParts3D 4.0, © The Database Center for Life Science, CC BY 4.0.',
  ].join('\n');
  return toolOk({
    id: raw,
    title: c.name,
    text,
    url,
    metadata: { kind: 'structure', atlas_id: c.id, system: c.system, pieces: c.pieces },
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

export async function onRequest({ request, env }) {
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

  const ctx = { env, origin: new URL(request.url).origin };

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
  buildUrl, parseViewArgs, captionText, isId, clampInt, matches, shape,
  SITE_ORIGIN, MAX_BATCH, MAX_PNG_DATA_URL_BYTES,
};
