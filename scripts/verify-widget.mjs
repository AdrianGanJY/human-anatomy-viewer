// L30 P4 — the WIDGET carrier, against the HTML the deployed server actually serves.
// usage: node scripts/verify-widget.mjs [baseUrl] [platePng]
//
// The widget is the carrier with positive evidence on Adrian's account: his "Open in 3D"
// report is the anchor text of this exact HTML, which proves it rendered for him. This
// drives the REAL resource (fetched over the live /mcp, not a local copy) with a REAL plate
// payload and asserts what he would see.
//
// P2's lesson, still load-bearing: `addInitScript` does NOT fire for `setContent`, so the
// sandbox globals must be written into the document the way the sandbox provides them or
// every assertion passes VACUOUSLY against a widget that never ran.
import { chromium } from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'https://anatomy.adrian.my';
const plate = process.argv[3] ?? 'E:/Agentic/.artifacts/L30/p4/plate-forward-bend-960x720.png';
const outDir = process.argv[4] ?? 'E:/Agentic/.artifacts/L30/p4';
mkdirSync(outDir, { recursive: true });

const tok = JSON.parse(readFileSync(join(homedir(), '.mipos', 'access', 'tokens.json'), 'utf8')).tokens.adr;
const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

// The widget HTML as the server serves it — never a local copy, or this tests nothing.
const res = await fetch(`${base}/mcp`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'CF-Access-Client-Id': tok.client_id,
    'CF-Access-Client-Secret': tok.client_secret,
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'ui://widget/anatomy-view.html' } }),
});
const body = await res.json();
const html = body?.result?.contents?.[0]?.text ?? '';
check('X1 the widget resource is served by the deployed server', html.includes('Open in 3D') && html.length > 500, `${html.length} chars`);

const png = readFileSync(plate);
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;

const browser = await chromium.launch({
  executablePath: 'C:/Users/adrian/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const ctx = await browser.newContext({ viewport: { width: 820, height: 900 } });
const page = await ctx.newPage();
const blocked = [];
page.on('request', (r) => { if (!r.url().startsWith('data:') && !r.url().startsWith('about:')) blocked.push(r.url()); });

async function paint(toolOutput) {
  // The globals are written INTO the document, the way the sandbox provides them —
  // addInitScript does not fire for setContent, and a widget that never ran passes
  // every assertion vacuously.
  await page.setContent(
    `<body><script>window.openai={toolOutput:${JSON.stringify(toolOutput)}};</script>${html}</body>`,
    { waitUntil: 'load' },
  );
  return page.evaluate(() => {
    const img = document.querySelector('#anatomy-card .shot');
    const a = document.querySelector('#anatomy-card a');
    return {
      imgHidden: img.hidden,
      src: (img.getAttribute('src') || '').slice(0, 24),
      srcLen: (img.getAttribute('src') || '').length,
      alt: img.getAttribute('alt'),
      title: document.querySelector('#anatomy-card h2').textContent,
      note: document.querySelector('#anatomy-card p').textContent,
      href: a.getAttribute('href'),
      linkHidden: a.hidden,
    };
  });
}

const good = await paint({
  title: 'Why hamstring tightness limits a forward bend',
  note: 'The pelvis should rotate over the femur first.',
  url: 'https://anatomy.adrian.my/?select=FMA22359',
  ids: ['FMA22359', 'FMA22449', 'FMA45889'],
  png_data_url: dataUrl,
});
check('X2 THE CHATGPT CARRIER: the widget SHOWS the plate', good.imgHidden === false && good.src.startsWith('data:image/png'),
  `${good.srcLen} chars of data URI`);
check('X3 the caption is real selectable text under the picture',
  good.title.startsWith('Why hamstring') && good.note.startsWith('The pelvis'), good.title.slice(0, 40));
check('X4 the interactive link is bound', good.href === 'https://anatomy.adrian.my/?select=FMA22359' && !good.linkHidden);
writeFileSync(join(outDir, 'widget-with-plate.png'), await page.screenshot({ type: 'png' }));

// The no-image branch — the exact state Adrian reported seeing: a card with the button
// and no picture. It must still be a useful answer, not a broken card.
const noImage = await paint({ title: 'No picture yet', note: 'still rendering', url: 'https://anatomy.adrian.my/?select=FMA22359', ids: ['FMA22359'] });
check('X5 the no-image branch is a useful card, not a broken one',
  noImage.imgHidden === true && noImage.linkHidden === false, 'image hidden, link still bound');

// The guard: a crafted result must not talk the sandbox into fetching a remote image.
const hostile = await paint({ title: 'x', url: 'https://anatomy.adrian.my/?select=FMA22359', png_data_url: 'https://evil.example/x.png' });
check('X6 a remote image URL is REFUSED by the data:-only allowlist', hostile.imgHidden === true, hostile.src || '(no src)');
const badLink = await paint({ title: 'x', url: 'javascript:alert(1)' });
check('X7 a non-canonical link is refused', badLink.linkHidden === true);

check('X8 the widget made NO network request of its own', blocked.length === 0, blocked.slice(0, 2).join(', ') || 'none');

await browser.close();
const passed = results.filter((r) => r.pass).length;
writeFileSync(join(outDir, 'verify-widget.json'), JSON.stringify({ base, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed  ->  ${outDir}`);
process.exitCode = passed === results.length ? 0 : 1;
