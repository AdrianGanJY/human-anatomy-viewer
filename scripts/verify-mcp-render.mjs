// L30 P4 — the WIRE test for render_anatomy, against the deployed /mcp.
// usage: node scripts/verify-mcp-render.mjs [baseUrl]
// Credentials come from ~/.mipos/access/tokens.json (the `adr` service token). Nothing is
// written to disk but the artifacts, and no secret is ever printed.
//
// This is the only check that spends METERED browser time, so it renders exactly one new
// view and then proves the second call is a cache hit. Everything else is free.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'https://anatomy.adrian.my';
const outDir = process.argv[3] ?? 'E:/Agentic/.artifacts/L30/p4';
mkdirSync(outDir, { recursive: true });

const tok = JSON.parse(readFileSync(join(homedir(), '.mipos', 'access', 'tokens.json'), 'utf8')).tokens.adr;
const auth = { 'CF-Access-Client-Id': tok.client_id, 'CF-Access-Client-Secret': tok.client_secret };

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

let id = 0;
async function rpc(method, params, { anon = false, ua = 'claude-ai/verify' } = {}) {
  const started = Date.now();
  const res = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      ...(anon ? {} : auth),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, ct: res.headers.get('content-type') || '', body, text, ms: Date.now() - started };
}

const FIXTURE = {
  select: ['FMA22359', 'FMA22449', 'FMA45889'],           // LEFT hamstrings
  context: ['FMA16587', 'FMA24475'],                      // left hip bone + left femur
  ghost: ['FMA16203'],                                    // lumbar vertebral column
  focus: { ids: ['FMA16587', 'FMA22359', 'FMA24475'] },
  view: 'side',
  title: 'Why hamstring tightness limits a forward bend',
  note: 'The pelvis should rotate over the femur first. When the hamstrings cannot lengthen, the pelvis stops rotating and the lumbar spine takes up the rest.',
};

try {
  // ── auth posture, before anything expensive ────────────────────────────────
  const anon = await rpc('tools/list', {}, { anon: true });
  check('W1 an anonymous POST is 401, unchanged', anon.status === 401, `${anon.status}`);

  const init = await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'claude-ai', version: 'verify' }, capabilities: {} });
  check('W2 initialize negotiates and returns instructions',
    init.status === 200 && init.body?.result?.protocolVersion === '2025-06-18' && /render_anatomy/.test(init.body.result.instructions || ''),
    init.body?.result?.serverInfo?.name);

  const list = await rpc('tools/list', {});
  const names = (list.body?.result?.tools || []).map((t) => t.name).sort();
  check('W3 tools/list carries the P4 surface',
    ['compose_sequence', 'compose_view', 'fetch', 'find_anatomy', 'get_structure', 'list_systems', 'probe_image', 'render_anatomy', 'search']
      .every((n) => names.includes(n)), names.join(', '));

  // ── argument refusal costs nothing, so it goes before the render ───────────
  const badId = await rpc('tools/call', { name: 'render_anatomy', arguments: { select: ['FMA99999'] } });
  check('W4 an unknown id is a caller-fixable error that names the fix',
    badId.body?.result?.isError === true && /none of these ids are in this atlas/.test(badId.body.result.content[0].text),
    badId.body?.result?.content?.[0]?.text?.slice(0, 90));

  const seq = await rpc('tools/call', { name: 'compose_sequence', arguments: { steps: [{ duration: 2 }] } });
  check('W5 compose_sequence is registered and refuses in actionable words',
    seq.body?.result?.isError === true && /not enabled on this deployment yet/.test(seq.body.result.content[0].text));

  const probe = await rpc('tools/call', { name: 'probe_image', arguments: {} });
  const pb = probe.body?.result;
  check('W6 probe_image is a bare image block with NO widget attached',
    pb?.content?.[0]?.type === 'image' && pb.content[0].mimeType === 'image/png' && pb._meta === undefined,
    `${Buffer.from(pb?.content?.[0]?.data ?? '', 'base64').length} bytes`);

  // ── THE P0. One metered render. ───────────────────────────────────────────
  console.log('\n  rendering (this is the only metered call; a new view costs about a minute)...');
  const r1 = await rpc('tools/call', { name: 'render_anatomy', arguments: FIXTURE });
  const res1 = r1.body?.result;
  const sc = res1?.structuredContent ?? {};
  console.log(`  -> ${r1.ms} ms · state ${sc.render_state} · cache ${sc.cache ?? '-'} · settle ${sc.settle ?? '-'} · client ${sc.client}`);

  check('W7 the call succeeded and is NOT an error', res1?.isError === false, sc.render_state);
  const img = res1?.content?.find((c) => c.type === 'image');
  check('W8 THE P0: content carries a real MCP image block',
    !!img && img.mimeType === 'image/png' && !img.data.startsWith('data:'),
    img ? `${img.data.length} base64 chars` : 'NO IMAGE BLOCK');
  if (img) {
    const bytes = Buffer.from(img.data, 'base64');
    writeFileSync(join(outDir, 'wire-render_anatomy.png'), bytes);
    check('W9 the block decodes to real PNG bytes',
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47,
      `${bytes.length} bytes -> ${join(outDir, 'wire-render_anatomy.png')}`);
    check('W10 the image block is within the client cap', img.data.length <= 140000, `${img.data.length} <= 140000`);
  }
  const textBlock = res1?.content?.find((c) => c.type === 'text');
  check('W11 a text block carries the interactive link',
    !!textBlock && /https:\/\/anatomy\.adrian\.my\/\?/.test(textBlock.text),
    textBlock?.text?.split('\n').find((l) => l.startsWith('Interactive'))?.slice(0, 80));
  check('W12 the whole result fits one client tool-result budget',
    JSON.stringify(res1).length <= 150000, `${JSON.stringify(res1).length} chars`);
  check('W13 the widget template is still attached',
    res1?._meta?.['openai/outputTemplate'] === 'ui://widget/anatomy-view.html');
  check('W14 the client was identified and REPORTED', sc.client === 'claude', String(sc.client));
  check('W15 structuredContent names what was drawn', Array.isArray(sc.ids) && sc.ids.length === 6 && Array.isArray(sc.names),
    (sc.names || []).join(', ').slice(0, 90));

  // The link must open the EXPLORER, not the plate.
  const link = sc.url ? new URL(sc.url) : null;
  check('W16 the interactive link opens the explorer, not the chrome-less plate',
    !!link && link.searchParams.get('snap') === null && !!link.searchParams.get('scene'),
    link?.searchParams.get('select'));

  // ── the second call must be a cache hit ───────────────────────────────────
  const r2 = await rpc('tools/call', { name: 'render_anatomy', arguments: FIXTURE });
  const sc2 = r2.body?.result?.structuredContent ?? {};
  check('W17 the SAME view a second time is a cache hit and is fast',
    sc2.cache === 'hit' && r2.ms < 5000, `${r2.ms} ms · cache ${sc2.cache}`);
  const img2 = r2.body?.result?.content?.find((c) => c.type === 'image');
  check('W18 the cached picture is byte-identical to the rendered one',
    !!img && !!img2 && img.data === img2.data);

  // A ChatGPT-shaped caller gets the widget carrier, and the picture is the same one.
  const r3 = await rpc('tools/call', { name: 'render_anatomy', arguments: FIXTURE }, { ua: 'ChatGPT/1.0' });
  const sc3 = r3.body?.result?.structuredContent ?? {};
  check('W19 a ChatGPT-shaped caller keeps the WIDGET carrier',
    typeof sc3.png_data_url === 'string' && sc3.png_data_url.startsWith('data:image/png;base64,') && sc3.client === 'chatgpt',
    `client ${sc3.client} · image_block ${sc3.image_block} · ${sc3.image_b64_chars} b64 chars`);

  check('W20 interactive_only returns a link and spends nothing',
    await (async () => {
      const r = await rpc('tools/call', { name: 'render_anatomy', arguments: { ...FIXTURE, interactive_only: true } });
      return r.body?.result?.structuredContent?.render_state === 'link_only' && r.ms < 4000;
    })());
} catch (err) {
  check('FATAL', false, String(err && err.message ? err.message : err).slice(0, 300));
}

const passed = results.filter((r) => r.pass).length;
writeFileSync(join(outDir, 'verify-mcp-render.json'), JSON.stringify({ base, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed  ->  ${outDir}`);
process.exitCode = passed === results.length ? 0 : 1;
