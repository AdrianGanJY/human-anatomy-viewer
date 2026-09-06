/**
 * render_anatomy — the teaching plate (L30 P4a). `node --test test/`.
 *
 * The P0 this phase exists to fix was never "ChatGPT drops image blocks". It was that the
 * PNG WAS NEVER IN THE PAYLOAD: a 20-second budget lost every 21-67 second render, the
 * losing race leg was never abandoned, and a second freshly-built fetch was then fired into
 * waitUntil — two concurrent billed browsers for one picture, on an account that answers
 * 429 after about six renders. So the two tests that matter most here are the one asserting
 * a real image block exists at all, and the one COUNTING renderer calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const url = (...p) => `file://${join(ROOT, ...p).split('\\').join('/')}`;
const { dispatch, __test__ } = await import(url('functions', 'mcp.js'));
const pageCodec = await import(url('app', 'scene-codec.js'));
const { TOOLS, WIDGET_URI, parseRenderArgs, clientFrom, PROBE_PNG_B64, MAX_IMAGE_BLOCK_B64, codec } = __test__;

const INDEX = {
  systems: [
    { id: 'muscular', name: 'Muscles', description: 'Skeletal muscles generate movement.', concepts: 2, pieces: 4 },
    { id: 'skeletal', name: 'Skeleton', description: 'Bones form the framework.', concepts: 1, pieces: 3 },
  ],
  concepts: [
    { id: 'FMA22315', name: 'gluteus medius', system: 'muscular', pieces: 2 },
    { id: 'FMA22314', name: 'gluteus maximus', system: 'muscular', pieces: 2 },
    { id: 'FMA16580', name: 'bony pelvis', system: 'skeletal', pieces: 3 },
  ],
  parts: [{ id: 'FJ0001', name: 'Right gluteus medius', concept: 'FMA22315', system: 'muscular' }],
  totals: { concepts: 3, parts: 4 },
};
const OWNER = { label: 'adrianganjy@gmail.com', kind: 'user', owner: true };
const makeEnv = () => ({
  ASSETS: { fetch: async () => new Response(JSON.stringify(INDEX), { headers: { 'content-type': 'application/json' } }) },
});
// The server's own resolver, exercised through a real dispatch so nothing is stubbed away.
const idx = await (async () => {
  const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_systems' } },
    { env: makeEnv(), origin: 'https://anatomy.adrian.my' }, OWNER);
  assert.equal(r.result.isError, false);
  const built = { ...INDEX };
  built._byId = new Map(INDEX.concepts.map((c) => [c.id, c]));
  built._systemById = new Map(INDEX.systems.map((s) => [s.id, s]));
  built._partById = new Map(INDEX.parts.map((p) => [p.id, p]));
  return built;
})();

/** A fake renderer that COUNTS its calls, so a double render is a failing test, not a bill. */
function fakeSnap({ png = Buffer.from(PROBE_PNG_B64, 'base64'), status = 200, body = null, delayMs = 0, cacheHit = false } = {}) {
  const calls = [];
  return {
    calls,
    binding: {
      fetch: async (req) => {
        calls.push(req.url);
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        const cacheonly = /cacheonly=1/.test(req.url);
        if (cacheonly && !cacheHit) return new Response(null, { status: 204 });
        if (status !== 200) {
          return new Response(JSON.stringify({ error: body || 'boom' }), { status, headers: { 'content-type': 'application/json' } });
        }
        return new Response(png, {
          headers: { 'content-type': 'image/png', 'X-Snap-Cache': cacheonly ? 'hit' : 'miss', 'X-Snap-Ms': '900' },
        });
      },
    },
  };
}

const renderCtx = (env, extra = {}) => ({ env, origin: 'https://anatomy.adrian.my', client: { kind: 'unknown' }, ...extra });
const callTool = async (name, args, env, ctxExtra) => (await dispatch(
  { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
  renderCtx(env, ctxExtra), OWNER,
)).result;
const callRender = (args, env, ctxExtra) => callTool('render_anatomy', args, env, ctxExtra);

const SCENE_ARGS = {
  select: ['FMA22315', 'FMA22314'],
  context: ['FMA16580'],
  focus: { ids: ['FMA22315'], padding: 1.35 },
  contextOpacity: 0.08,
  view: 'side',
  title: 'Hip stabilisers',
  note: 'These hold the pelvis level.',
};

// ── the contract ────────────────────────────────────────────────────────────

test('ANTI-DRIFT: the page and the MCP server import the SAME codec module', () => {
  // Not "equivalent" — identical. One definition, two importers, asserted by identity.
  assert.equal(codec.encodeScene, pageCodec.encodeScene);
  assert.equal(codec.decodeScene, pageCodec.decodeScene);
  assert.equal(codec.SCENE_LIMITS, pageCodec.LIMITS);
});

test('THE P0: a real MCP image block, BARE base64, followed by the link', async () => {
  const snap = fakeSnap();
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.isError, false);
  assert.equal(res.content[0].type, 'image', JSON.stringify(res.content.map((c) => c.type)));
  assert.equal(res.content[0].mimeType, 'image/png');
  assert.equal(res.content[0].data.startsWith('data:'), false, 'ImageContent carries bare base64, not a data URI');
  assert.deepEqual([...Buffer.from(res.content[0].data, 'base64').subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(res.content[1].type, 'text');
  assert.match(res.content[1].text, /https:\/\/anatomy\.adrian\.my\/\?/);
  // ...and the widget copy is still there, because it is the carrier with evidence.
  assert.ok(res.structuredContent.png_data_url.startsWith('data:image/png;base64,'));
  assert.equal(res.structuredContent.png_data_url.slice('data:image/png;base64,'.length), res.content[0].data);
  assert.equal(res._meta['openai/outputTemplate'], WIDGET_URI);
  assert.equal(res.structuredContent.render_state, 'ok');
});

test('THE DOUBLE RENDER: a timed-out render costs ONE browser, not two', async () => {
  const snap = fakeSnap({ delayMs: 300 });
  const held = [];
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding }, { waitUntil: (p) => held.push(p) });
  const live = snap.calls.filter((u) => !/cacheonly=1/.test(u));
  assert.equal(live.length, 1, `live renders: ${JSON.stringify(snap.calls)}`);
  assert.equal(res.isError, false);
  await Promise.all(held);
});

test('the cache probe never touches a browser, and a hit answers without a live render', async () => {
  const snap = fakeSnap({ cacheHit: true });
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(snap.calls.length, 1, 'a cached view costs exactly one probe');
  assert.match(snap.calls[0], /cacheonly=1/);
  assert.equal(res.structuredContent.cache, 'hit');
  assert.equal(res.content[0].type, 'image');
});

test('no picture is NOT a failed answer: the link survives and isError stays false', async () => {
  const res = await callRender(SCENE_ARGS, makeEnv()); // no SNAP binding at all
  assert.equal(res.isError, false, 'isError:true would make clients hide the link too');
  assert.equal(res.content[0].type, 'text', 'no image block when there is no picture');
  assert.match(res.content[0].text, /https:\/\/anatomy\.adrian\.my/);
  assert.equal(res.structuredContent.render_state, 'renderer_down');
  assert.equal('png_data_url' in res.structuredContent, false);
});

test('a rate-limited renderer SAYS so, instead of a truncated 502 string', async () => {
  const snap = fakeSnap({ status: 429, body: 'Unable to create new browser: code: 429: message: Browser time limit exceeded for today' });
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.structuredContent.render_state, 'rate_limited');
  assert.match(res.content[0].text, /rate limit|Browser time limit/i);
  assert.match(res.content[0].text, /https:\/\/anatomy\.adrian\.my/, 'the link still works');
});

test('the page reporting an error is a page_error, never a silently blank plate', async () => {
  const snap = fakeSnap({ status: 424, body: 'the page reported an error while rendering: load' });
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.structuredContent.render_state, 'page_error');
  assert.equal(res.content[0].type, 'text');
});

// ── the size contract ───────────────────────────────────────────────────────

test('SIZE: an oversized plate drops the IMAGE BLOCK and keeps the widget for an unknown caller', async () => {
  // 75,000 bytes -> 100,000 base64 chars: ONE copy fits comfortably, TWO do not. That is
  // the case the yield order exists for, and it is the realistic one.
  const snap = fakeSnap({ png: Buffer.alloc(75000, 0x41) });
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.content[0].type, 'text', 'the block yields first for an unknown or ChatGPT caller');
  assert.equal(res.structuredContent.image_block, false);
  assert.ok(res.structuredContent.png_data_url, 'the widget carrier is kept — it is the one with evidence');
});

test('SIZE: a self-identified Claude caller keeps the block and drops the widget copy', async () => {
  // 75,000 bytes -> 100,000 base64 chars: ONE copy fits comfortably, TWO do not. That is
  // the case the yield order exists for, and it is the realistic one.
  const snap = fakeSnap({ png: Buffer.alloc(75000, 0x41) });
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding }, { client: { kind: 'claude' } });
  assert.equal(res.content[0].type, 'image');
  assert.equal('png_data_url' in res.structuredContent, false);
  assert.ok(JSON.stringify(res).length <= 150000, `assembled result was ${JSON.stringify(res).length} chars`);
  assert.equal(res.structuredContent.client, 'claude');
});

test('SIZE: a plate too big for EITHER carrier says so, and never truncates', async () => {
  const snap = fakeSnap({ png: Buffer.alloc(MAX_IMAGE_BLOCK_B64, 0x41) }); // ~186k base64
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.content[0].type, 'text');
  assert.equal(res.structuredContent.image_block, false);
  assert.equal('png_data_url' in res.structuredContent, false);
  assert.match(res.content[0].text, /too large to carry inline/);
  assert.match(res.content[0].text, /https:\/\/anatomy\.adrian\.my/, 'the link is what survives');
  assert.equal(snap.calls.filter((u) => !/cacheonly=1/.test(u)).length, 1, 'and it must NEVER re-render');
});

// ── the wire ────────────────────────────────────────────────────────────────

test('the select= contract: what the tool sends is exactly what the page will report back', async () => {
  const snap = fakeSnap();
  const res = await callRender(SCENE_ARGS, { ...makeEnv(), SNAP: snap.binding });
  const p = new URL(snap.calls[0]).searchParams;
  const scene = pageCodec.decodeScene(p.get('scene'));
  assert.equal(p.get('select'), pageCodec.sceneSelectIds(scene).join(','),
    'a mismatch makes every render miss the exact-selection wait and screenshot a stale tab');
  assert.deepEqual(res.structuredContent.ids, p.get('select').split(','));
  assert.ok(p.get('select').includes('FMA16580'), 'context ids travel too — the page selects all of them');
});

test('the snapshot URL carries the scene and the size, and nothing else that could vary', async () => {
  const snap = fakeSnap();
  await callRender({ ...SCENE_ARGS, width: 960, height: 720 }, { ...makeEnv(), SNAP: snap.binding });
  const p = new URL(snap.calls[0]).searchParams;
  assert.ok(p.get('scene'));
  assert.equal(p.get('size'), '960x720');
  assert.equal(p.get('snap'), '1');
  assert.equal(p.get('title'), null, 'the caption lives INSIDE the blob, so it hashes with it');
  assert.equal(p.get('lang'), null);
});

test('interactive_only spends no browser time at all', async () => {
  const snap = fakeSnap();
  const res = await callRender({ ...SCENE_ARGS, interactive_only: true }, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(snap.calls.length, 0);
  assert.equal(res.structuredContent.render_state, 'link_only');
  assert.equal(res.content[0].type, 'text');
});

// ── arguments ───────────────────────────────────────────────────────────────

test('argument faults are caller-fixable errors that name the fix', () => {
  const bad = (args) => parseRenderArgs(idx, args)?.error ?? '';
  assert.match(bad({}), /select is required/);
  assert.match(bad({ select: ['nope!'] }), /not an atlas id/);
  assert.match(bad({ select: ['FMA99999'] }), /none of these ids are in this atlas/);
  assert.match(bad({ select: ['FMA22315'], focus: { ids: ['FMA22314'] } }), /focus can only frame structures the scene already carries/);
  assert.match(bad({ select: ['FMA22315'], focus: { padding: 9 } }), /DISTANCE multiplier, not a percentage/);
  assert.match(bad({ select: ['FMA22315'], view: 'sideways' }), /unknown view/);
  assert.match(bad({ select: ['FMA22315'], rest: 'all' }), /33 MB/);
  assert.match(bad({ select: ['FMA22315'], background: 'transparent' }), /not available/);
  assert.match(bad({ select: ['FMA22315'], width: 400 }), /phone layout/);
  assert.match(bad({ select: ['FMA22315'], annotations: [{ type: 'label', target: 'FMA99999', text: 'x' }] }), /not in the scene/);
  assert.equal(parseRenderArgs(idx, SCENE_ARGS).error, undefined);
});

test('colour and axis are accepted, ignored, and REPORTED — not silently swallowed', () => {
  const v = parseRenderArgs(idx, {
    select: ['FMA22315'],
    styles: [{ id: 'FMA22315', color: '#ff0000', emphasis: 'highlight' }],
    annotations: [{ type: 'rotation-arrow', target: 'FMA22315', axis: 'hip', direction: 'anterior', text: 'Hip hinge' }],
  });
  assert.equal(v.error, undefined);
  assert.deepEqual(v.ignored, ['styles[0].color', 'annotations[0].axis']);
  assert.equal(v.scene.styles[0].emphasis, 'highlight');
});

test('roles resolve to the opacities the caller asked for, and select wins a collision', () => {
  const v = parseRenderArgs(idx, { select: ['FMA22315'], context: ['FMA22314'], ghost: ['FMA16580'], contextOpacity: 0.05, supportOpacity: 0.5 });
  assert.deepEqual(codec.structureOpacity(v.scene), { FMA16580: 0.05, FMA22314: 0.5, FMA22315: 1 });
  const dup = parseRenderArgs(idx, { select: ['FMA22315'], ghost: ['FMA22315'] });
  assert.equal(dup.scene.structures[0].role, 'primary');
});

// ── the siblings ────────────────────────────────────────────────────────────

test('compose_sequence is registered and refuses in words the model can act on', async () => {
  const r = await callTool('compose_sequence', { steps: [{ duration: 2, show: ['pelvis'] }] }, makeEnv());
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /not enabled on this deployment yet/);
  assert.match(r.content[0].text, /atlas ids like FMA16580, never names/);
});

test('probe_image is a bare image block with NO widget competing for the result', async () => {
  const r = await callTool('probe_image', {}, makeEnv());
  assert.equal(r.content[0].type, 'image');
  assert.equal(r.content[0].mimeType, 'image/png');
  const bytes = Buffer.from(r.content[0].data, 'base64');
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.ok(bytes.length < 2048, 'the probe must be tiny');
  assert.equal(r._meta, undefined, 'no outputTemplate — that is the entire point of this tool');
});

test('compose_view ALSO emits the image block, so the two tools cannot disagree', async () => {
  const snap = fakeSnap();
  const res = await callTool('compose_view', { select: ['FMA22315'], snapshot: true }, { ...makeEnv(), SNAP: snap.binding });
  assert.equal(res.content[0].type, 'text', 'block 0 stays the JSON text block every P2/P3 test reads');
  assert.equal(res.content[1].type, 'image');
  assert.ok(res.structuredContent.png_data_url.startsWith('data:image/png;base64,'));
});

test('the client guess is reported, never hidden', () => {
  const ua = (s) => ({ headers: { get: () => s } });
  assert.equal(clientFrom(ua('claude-ai/1.0'), {}).kind, 'claude');
  assert.equal(clientFrom(ua('ChatGPT/1.0'), {}).kind, 'chatgpt');
  assert.equal(clientFrom(ua('curl/8'), {}).kind, 'unknown');
  assert.equal(clientFrom(ua('curl/8'), { FORCE_CLIENT: 'claude' }).kind, 'claude');
});

test('the named groups in the tool text are ids that really exist in this atlas', () => {
  const ra = TOOLS.find((t) => t.name === 'render_anatomy');
  for (const id of ['FMA22357', 'FMA22438', 'FMA45887', 'FMA16580', 'FMA9611', 'FMA16203']) {
    assert.ok(ra.description.includes(id), `${id} must be named in the tool description`);
  }
  // The two traps must be named as traps, not offered as answers.
  assert.match(ra.description, /Not FMA45881/);
  assert.match(ra.description, /Not FMA9578/);
  assert.match(ra.description, /no joints in this atlas/i);
});
