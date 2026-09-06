/**
 * Unit tests for functions/mcp.js (L30 P2). `node --test test/`.
 *
 * These exercise the pure contract — URL building, argument refusal, the owner gate,
 * the JSON-RPC envelope, the widget — against a fake `env.ASSETS`. The live HTTP
 * ladder (401 / 405 / real JWT) is verified separately against the deployed host by
 * scripts/verify-live.mjs; neither substitutes for the other.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { dispatch, onRequest, __test__ } = await import(`file://${join(ROOT, 'functions', 'mcp.js').replace(/\\/g, '/')}`);
const { buildUrl, parseViewArgs, captionText, isId, toolsFor, TOOLS, WIDGET_HTML, WIDGET_URI, URL_CONTRACT } = __test__;

// A small index with the real ids the plan names, plus one multi-system concept.
const INDEX = {
  generated_at: '2026-09-06T00:00:00.000Z',
  atlas_version: 'BodyParts3D 4.0',
  totals: { concepts: 4, parts: 9 },
  systems: [
    { id: 'muscular', name: 'Muscles', description: 'Skeletal muscles generate movement.', concepts: 3, pieces: 6 },
    { id: 'skeletal', name: 'Skeleton', description: 'Bones form the framework.', concepts: 1, pieces: 3 },
  ],
  concepts: [
    { id: 'FMA22315', name: 'gluteus medius', system: 'muscular', pieces: 2, name_zh_hans: '臀中肌', name_zh_hant: '臀中肌' },
    { id: 'FMA22314', name: 'gluteus maximus', system: 'muscular', pieces: 2, name_zh_hans: '臀大肌', name_zh_hant: '臀大肌' },
    { id: 'FMA18060', name: 'psoas major', system: 'muscular', pieces: 2, systems: ['muscular', 'skeletal'], name_zh_hans: '腰大肌', name_zh_hant: '腰大肌' },
    { id: 'FMA16580', name: 'heart', system: 'skeletal', pieces: 3, explanation: 'A muscular pump in the chest.', name_zh_hans: '心脏', name_zh_hant: '心臟' },
    // Deliberately no Chinese: the tools must degrade to English per-row, not per-deployment.
    { id: 'FMA00001', name: 'unnamed structure', system: 'muscular', pieces: 1 },
  ],
  // P3: individual meshes. A part id is a legal `select=` value on the live page.
  parts: [
    { id: 'FJ0001', name: 'Right gluteus medius', concept: 'FMA22315', system: 'muscular', name_zh_hans: '右臀中肌', name_zh_hant: '右臀中肌' },
    { id: 'FJ0002', name: 'Left gluteus medius', concept: 'FMA22315', system: 'muscular', name_zh_hans: '左臀中肌', name_zh_hant: '左臀中肌' },
  ],
};

const OWNER = { label: 'adrianganjy@gmail.com', kind: 'user', owner: true };
const STRANGER = { label: 'someone@example.com', kind: 'user', owner: false };

function makeEnv({ index = INDEX, ct = 'application/json', ok = true } = {}) {
  return {
    ASSETS: {
      fetch: async () => new Response(ok ? JSON.stringify(index) : 'nope', {
        status: ok ? 200 : 404,
        headers: { 'content-type': ct },
      }),
    },
  };
}
const ctxFor = (env) => ({ env, origin: 'https://anatomy.adrian.my' });

const call = async (name, args, { identity = OWNER, env = makeEnv() } = {}) => {
  const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctxFor(env), identity);
  return r.result ?? r;
};
const parsed = (res) => JSON.parse(res.content[0].text);

// ── the URL contract ────────────────────────────────────────────────────────

test('buildUrl round-trips the multi-select contract url-state.ts parses', () => {
  const u = buildUrl({ ids: ['FMA22315', 'FMA22314', 'FMA18060'], view: 'back', isolate: true, title: 'Hip stabilisers', note: 'These hold the pelvis level.' });
  const q = new URL(u).searchParams;
  assert.equal(new URL(u).origin, 'https://anatomy.adrian.my');
  assert.equal(q.get('select'), 'FMA22315,FMA22314,FMA18060');
  assert.equal(q.get('isolate'), '1');
  assert.equal(q.get('view'), 'back');
  assert.equal(q.get('title'), 'Hip stabilisers');
  assert.equal(q.get('note'), 'These hold the pelvis level.');
});

test('buildUrl omits defaults so a plain link stays short', () => {
  assert.equal(buildUrl({ ids: ['FMA22315'], view: 'three-quarter', isolate: false }), 'https://anatomy.adrian.my/?select=FMA22315');
});

test('a note cannot smuggle a second parameter into the link', () => {
  const u = buildUrl({ ids: ['FMA22315'], note: 'x&isolate=0&select=EVIL' });
  const q = new URL(u).searchParams;
  assert.equal(q.get('select'), 'FMA22315');
  assert.equal(q.get('isolate'), null);
  assert.equal(q.getAll('select').length, 1);
});

test('isId refuses anything that is not an atlas identifier', () => {
  assert.ok(isId('FMA22315'));
  for (const bad of ['FMA 22315', 'a&b', '../x', 'a'.repeat(65), '', 'x\ny']) assert.equal(isId(bad), false, bad);
});

// ── argument hygiene ────────────────────────────────────────────────────────

// Built exactly the way getIndex() builds it, so a fixture cannot pass a shape the server
// would never see.
const idx = {
  ...INDEX,
  _byId: new Map(INDEX.concepts.map((c) => [c.id, c])),
  _systemById: new Map(INDEX.systems.map((s) => [s.id, s])),
  _partById: new Map(INDEX.parts.map((p) => [p.id, p])),
};

test('parseViewArgs isolates by default — naming structures means wanting to see them', () => {
  assert.equal(parseViewArgs(idx, { select: ['FMA22315'] }).isolate, true);
  assert.equal(parseViewArgs(idx, { select: ['FMA22315'], isolate: false }).isolate, false);
});

test('unknown ids are REPORTED, not silently dropped', () => {
  const v = parseViewArgs(idx, { select: ['FMA22315', 'FMA99999'] });
  assert.deepEqual(v.ids, ['FMA22315']);
  assert.deepEqual(v.unknown, ['FMA99999']);
});

test('all-unknown is an error, never an empty view', () => {
  assert.match(parseViewArgs(idx, { select: ['FMA99999'] }).error, /none of these ids/);
});

test('duplicate ids collapse so the reported count is the real one', () => {
  assert.deepEqual(parseViewArgs(idx, { select: ['FMA22315', 'FMA22315'] }).ids, ['FMA22315']);
});

test('an over-long caption is REFUSED, not clipped — the page would clip it and the reply would be a lie', () => {
  const long = 'x'.repeat(URL_CONTRACT.NOTE_MAX + 1);
  assert.match(parseViewArgs(idx, { select: ['FMA22315'], note: long }).error, new RegExp(`${URL_CONTRACT.NOTE_MAX}`));
  assert.match(parseViewArgs(idx, { select: ['FMA22315'], title: 'y'.repeat(81) }).error, /title is 81/);
});

test('captionText collapses control characters and whitespace', () => {
  assert.equal(captionText('a\u0000b\n\n  c\t', 80, 'note').value, 'a b c');
  assert.equal(captionText('   ', 80, 'note').value, undefined);
  assert.match(captionText(42, 80, 'note').error, /must be a string/);
});

test('too many ids is refused with the limit named', () => {
  const many = Array.from({ length: URL_CONTRACT.SELECT_MAX + 1 }, (_, i) => `FMA${1000 + i}`);
  assert.match(parseViewArgs(idx, { select: many }).error, new RegExp(`maximum is ${URL_CONTRACT.SELECT_MAX}`));
});

test('an unknown view is refused rather than silently ignored', () => {
  assert.match(parseViewArgs(idx, { select: ['FMA22315'], view: 'above' }).error, /unknown view/);
});

// ── tools ───────────────────────────────────────────────────────────────────

test('find_anatomy is case-insensitive and shortest-name-first', async () => {
  const r = parsed(await call('find_anatomy', { query: 'GLUTEUS' }));
  assert.deepEqual(r.results.map((x) => x.id), ['FMA22315', 'FMA22314']);
  assert.equal(r.results[0].url, 'https://anatomy.adrian.my/?select=FMA22315&isolate=1');
});

test('find_anatomy names the systems when given an unknown one', async () => {
  const r = await call('find_anatomy', { query: 'gluteus', system: 'nope' });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /unknown system "nope".*muscular, skeletal/s);
});

test('get_structure says WHERE its explanation came from', async () => {
  const specific = parsed(await call('get_structure', { id: 'FMA16580' }));
  assert.equal(specific.explanation_source, 'structure');
  const fallback = parsed(await call('get_structure', { id: 'FMA22315' }));
  assert.equal(fallback.explanation_source, 'system');
  assert.equal(fallback.explanation, null);
  assert.match(fallback.system_description, /Skeletal muscles/);
});

test('compose_view returns the link, the resolved ids and the unknown ones', async () => {
  const r = await call('compose_view', { select: ['FMA22315', 'FMA22314', 'FMA18060', 'FMA00000'], view: 'back', title: 'Hip stabilisers', note: 'These stabilise the pelvis in tree pose.' });
  const p = parsed(r);
  assert.deepEqual(p.ids_resolved, ['FMA22315', 'FMA22314', 'FMA18060']);
  assert.deepEqual(p.ids_unknown, ['FMA00000']);
  assert.equal(p.pieces_highlighted, 6);
  assert.ok(p.url_chars <= URL_CONTRACT.URL_MAX);
  assert.match(p.snapshot_error ?? '', /^$/); // snapshot not requested -> no error field
});

test('compose_view carries the widget template and validating structuredContent', async () => {
  const r = await call('compose_view', { select: ['FMA22315'], title: 'T', note: 'N' });
  assert.equal(r._meta['openai/outputTemplate'], WIDGET_URI);
  const sc = r.structuredContent;
  assert.equal(typeof sc.title, 'string');
  assert.equal(typeof sc.note, 'string');
  assert.deepEqual(sc.ids, ['FMA22315']);
  assert.ok(sc.url.startsWith('https://anatomy.adrian.my/'));
  assert.equal('png_data_url' in sc, false); // absent, not null, when nothing rendered
});

test('compose_view with snapshot:true and no renderer still returns the link and SAYS why', async () => {
  const p = parsed(await call('compose_view', { select: ['FMA22315'], snapshot: true }));
  assert.ok(p.url);
  assert.match(p.snapshot_error, /no snapshot renderer/);
});

test('search/fetch round-trip the connector contract', async () => {
  const s = parsed(await call('search', { query: 'psoas' }));
  assert.equal(s.results[0].id, 'anatomy:FMA18060');
  const f = parsed(await call('fetch', { id: s.results[0].id }));
  assert.equal(f.title, 'psoas major');
  assert.match(f.text, /https:\/\/anatomy\.adrian\.my\/\?select=FMA18060/);
  assert.equal(parsed(await call('fetch', { id: 'FMA18060' })).title, 'psoas major');
});

test('list_systems totals are the index totals, not a recount', async () => {
  const r = parsed(await call('list_systems', {}));
  assert.equal(r.systems.length, 2);
  assert.equal(r.totals.concepts, 4);
});

// ── the SPA-fallback trap ───────────────────────────────────────────────────

test('an index answered as HTML at 200 is NOT accepted as an index', async () => {
  const env = makeEnv({ ct: 'text/html', index: INDEX });
  const r = await call('find_anatomy', { query: 'gluteus' }, { env });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /build-index/);
});

test('a JSON body without the index shape is refused', async () => {
  const env = makeEnv({ index: { hello: 'world' } });
  assert.equal((await call('list_systems', {}, { env })).isError, true);
});

// ── the owner gate ──────────────────────────────────────────────────────────

test('the owner sees exactly the six tools; a stranger sees none', () => {
  assert.equal(toolsFor(OWNER).length, 6);
  assert.deepEqual(toolsFor(OWNER).map((t) => t.name).sort(),
    ['compose_view', 'fetch', 'find_anatomy', 'get_structure', 'list_systems', 'search']);
  assert.deepEqual(toolsFor(STRANGER), []);
  assert.deepEqual(toolsFor(null), []);
  assert.ok(TOOLS.every((t) => t.annotations.readOnlyHint === true));
});

test('a stranger calling a real tool gets Owner only, not Unknown tool', async () => {
  const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'find_anatomy', arguments: { query: 'x' } } }, ctxFor(makeEnv()), STRANGER);
  assert.equal(r.error.code, -32001);
  assert.match(r.error.message, /Owner only/);
});

test('resources are owner-gated too', async () => {
  const mine = await dispatch({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: WIDGET_URI } }, ctxFor(makeEnv()), OWNER);
  assert.equal(mine.result.contents[0].mimeType, 'text/html+skybridge');
  assert.ok(mine.result.contents[0].text.includes('anatomy-card'));
  const theirs = await dispatch({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: WIDGET_URI } }, ctxFor(makeEnv()), STRANGER);
  assert.equal(theirs.error.code, -32001);
});

test('the widget never writes untrusted values through innerHTML', () => {
  assert.equal(/innerHTML/.test(WIDGET_HTML), false);
  assert.ok(WIDGET_HTML.includes('textContent'));
  assert.ok(WIDGET_HTML.includes("indexOf('data:image/')===0"));
  assert.ok(WIDGET_HTML.includes("indexOf('https://anatomy.adrian.my/')===0"));
});

// ── JSON-RPC envelope ───────────────────────────────────────────────────────

test('envelope rules', async () => {
  const ctx = ctxFor(makeEnv());
  assert.equal(await dispatch('nope', ctx, OWNER) !== null, true);
  assert.equal((await dispatch({ jsonrpc: '1.0', id: 1, method: 'ping' }, ctx, OWNER)).error.code, -32600);
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'ping' }, ctx, OWNER), null); // notification: no reply
  assert.equal(await dispatch({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx, OWNER), null);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 1, method: 'nope' }, ctx, OWNER)).error.code, -32601);
  assert.equal((await dispatch({ jsonrpc: '2.0', id: {}, method: 'ping' }, ctx, OWNER)).error.code, -32600);
  assert.equal(await dispatch({ jsonrpc: '2.0', id: 7, result: {} }, ctx, OWNER), null); // a response is accepted silently
  assert.equal((await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, ctx, OWNER)).result.serverInfo.name, 'human-anatomy-viewer');
  assert.deepEqual((await dispatch({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, ctx, OWNER)).result.protocolVersion, '2024-11-05');
});

// ── HTTP entry ──────────────────────────────────────────────────────────────

test('unconfigured env fails CLOSED with a Bearer challenge, never a 302', async () => {
  const req = new Request('https://anatomy.adrian.my/mcp', { method: 'POST', body: '{"jsonrpc":"2.0","id":1,"method":"initialize"}' });
  const res = await onRequest({ request: req, env: makeEnv() }); // no ACCESS_AUD / ACCESS_TEAM_DOMAIN
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /^Bearer /);
  assert.match(res.headers.get('content-type'), /application\/json/);
});

test('GET is a real 405 with Allow, not a JSON-RPC error inside a 200', async () => {
  const res = await onRequest({ request: new Request('https://anatomy.adrian.my/mcp'), env: makeEnv() });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('allow'), 'POST, OPTIONS');
});

test('OPTIONS preflight is answered before auth', async () => {
  const res = await onRequest({ request: new Request('https://anatomy.adrian.my/mcp', { method: 'OPTIONS', headers: { Origin: 'https://chatgpt.com' } }), env: makeEnv() });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://chatgpt.com');
});

// ── the vendored verifier ───────────────────────────────────────────────────

test('_access.js is byte-identical to the hub copy it was vendored from', () => {
  const mine = readFileSync(join(ROOT, 'functions', '_access.js'));
  const hub = readFileSync('E:/Agentic/apps/hub/functions/_access.js');
  assert.equal(Buffer.compare(mine, hub), 0, 'functions/_access.js has drifted from apps/hub/functions/_access.js');
});

// ── P3: Chinese names, the lang pass-through, and part ids ──────────────────

const callP3 = async (name, args, env) => parsed(await call(name, args, env ? { env } : {}));
const rawP3 = async (name, args) => (await call(name, args)).content[0].text;

test('search matches a SIMPLIFIED query, not only English', async () => {
  const out = await callP3('find_anatomy', { query: '臀中肌' });
  assert.equal(out.results[0].id, 'FMA22315', JSON.stringify(out.results));
  assert.equal(out.results[0].name_zh_hans, '臀中肌');
});

test('search matches a TRADITIONAL query too — the caller need not declare a script', async () => {
  // 心臟 exists only in name_zh_hant; 心脏 only in name_zh_hans. Both must find the heart,
  // which is the whole point of matching across every script rather than the current one.
  assert.equal((await callP3('find_anatomy', { query: '心臟' })).results[0]?.id, 'FMA16580');
  assert.equal((await callP3('find_anatomy', { query: '心脏' })).results[0]?.id, 'FMA16580');
});

test('a row WITHOUT Chinese degrades to English alone, and does not invent a key', () => {
  const withZh = __test__.shape(idx, idx._byId.get('FMA22315'));
  const without = __test__.shape(idx, idx._byId.get('FMA00001'));
  assert.equal(withZh.name_zh_hans, '臀中肌');
  assert.equal('name_zh_hans' in without, false);
  assert.equal(without.name, 'unnamed structure');
});

test('compose_view puts lang in the URL, and leaves it out for English', async () => {
  const zh = await callP3('compose_view', { select: ['FMA22315', 'FMA22314'], lang: 'zh-Hans' });
  assert.match(zh.url, /lang=zh-Hans/);
  assert.equal(zh.lang, 'zh-Hans');
  // The names it reports are the ones the user will actually SEE when the link opens.
  assert.deepEqual(zh.names_shown, ['臀中肌', '臀大肌']);
  const en = await callP3('compose_view', { select: ['FMA22315'] });
  assert.equal(/lang=/.test(en.url), false, en.url);
  assert.deepEqual(en.names_shown, ['gluteus medius']);
});

test('compose_view refuses an unknown lang instead of silently opening in English', async () => {
  const res = await call('compose_view', { select: ['FMA22315'], lang: 'zh-Hong' });
  assert.equal(res.isError, true);
  assert.match(await rawP3('compose_view', { select: ['FMA22315'], lang: 'zh-Hong' }), /unknown lang/i);
});

test('a PART id resolves — it is a legal select= value on the live page', async () => {
  const v = parseViewArgs(idx, { select: ['FJ0001'] });
  assert.deepEqual(v.ids, ['FJ0001']);
  assert.deepEqual(v.unknown, []);
  const out = await callP3('get_structure', { id: 'FJ0001' });
  assert.equal(out.kind, 'mesh');
  assert.equal(out.name_zh_hans, '右臀中肌');
  assert.equal(out.part_of.id, 'FMA22315');
});

test('the snapshot URL drops lang and the caption, so one picture is one cache entry', async () => {
  const seen = [];
  const env = { ...makeEnv(), SNAP: { fetch: async (req) => { seen.push(req.url); return new Response('nope', { status: 500 }); } } };
  await callP3('compose_view', { select: ['FMA22315'], lang: 'zh-Hant', title: 'A', note: 'B', snapshot: true }, env);
  assert.equal(seen.length, 1, JSON.stringify(seen));
  assert.equal(/lang=/.test(seen[0]), false, seen[0]);
  assert.equal(/title=|note=/.test(seen[0]), false, seen[0]);
  assert.match(seen[0], /select=FMA22315/);
});
