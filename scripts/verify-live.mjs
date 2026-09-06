// L30 verification — headless Chromium against a live human-anatomy-viewer host.
// usage: node scripts/verify-live.mjs <baseUrl> <outDir> [label]
// CF Access headers come from env (CF_ID / CF_SECRET) so no secret is ever written to disk.
//
// P1 shipped assertions 1-13 (deep link, ready marker, single select, isolate, WebMCP,
// URL mirroring, phone layout, hash re-select without reload, snap mode, no console
// errors). P2 adds the v2 contract: several ids at once, the caption, and the fact that
// isolate really shows the UNION and nothing else.
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const base = process.argv[2];
const outDir = process.argv[3];
const label = process.argv[4] ?? 'run';
const A = 'FMA22315', A_NAME = 'gluteus medius';   // muscular, 2 pieces
const B = 'FMA18060', B_NAME = 'psoas major';      // muscular, 2 pieces
const C = 'FMA22314', C_NAME = 'gluteus maximus';  // muscular, 2 pieces
const TITLE = 'Hip stabilisers';
const NOTE = 'These stabilise the pelvis in tree pose.';
mkdirSync(outDir, {recursive: true});

const results = [];
const check = (name, pass, detail) => { results.push({name, pass: !!pass, detail}); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`); };

const headers = (process.env.CF_ID && process.env.CF_SECRET)
  ? {'CF-Access-Client-Id': process.env.CF_ID, 'CF-Access-Client-Secret': process.env.CF_SECRET}
  : {};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({viewport: {width: 1280, height: 900}, deviceScaleFactor: 1});
// Scope the Access headers to the target origin ONLY. Sending them on every request turns
// cross-origin subresource loads (e.g. Cloudflare's own analytics beacon) into preflighted CORS
// requests that then fail -- an error manufactured by the instrument, not by the site.
if (Object.keys(headers).length) {
  const origin = new URL(base).origin;
  await context.route('**/*', route => {
    const r = route.request();
    if (r.url().startsWith(origin)) return route.continue({headers: {...r.headers(), ...headers}});
    return route.continue();
  });
}

// WebMCP stub — must be installed BEFORE any page script runs.
await context.addInitScript(() => {
  window.__tools = [];
  document.modelContext = {registerTool(t) { window.__tools.push(t.name); }};
});

const page = await context.newPage();
const consoleErrors = [];
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
page.on('pageerror', e => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

try {
  const url = `${base}/?select=${A}&isolate=1&view=front`;
  const resp = await page.goto(url, {waitUntil: 'domcontentloaded', timeout: 120000});
  check('HTTP status 200 on deep link', resp.status() === 200, `status=${resp.status()} url=${url}`);

  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  check('model loaded (data-atlas-ready=1)', true);

  const title = await page.textContent('.detail-sheet .structure-title', {timeout: 20000});
  check('detail sheet title == concept name', (title || '').trim() === A_NAME, `got "${title}" want "${A_NAME}"`);

  const sel1 = await page.getAttribute('html', 'data-atlas-selected');
  check('data-atlas-selected == requested id', sel1 === A, `got ${sel1}`);

  const isolated = await page.evaluate(() => !!document.querySelector('.detail-sheet.is-isolated'));
  check('isolate=1 applied (sheet has is-isolated)', isolated);

  const tools = await page.evaluate(() => window.__tools ?? []);
  check('WebMCP registered find_anatomy', tools.includes('find_anatomy'), JSON.stringify(tools));
  check('WebMCP registered inspect_anatomical_structure', tools.includes('inspect_anatomical_structure'), JSON.stringify(tools));

  const mirrored = await page.evaluate(() => location.search);
  check('state mirrored back into the query string', mirrored.includes(`select=${A}`) && mirrored.includes('isolate=1') && mirrored.includes('view=front'), mirrored);

  await page.screenshot({path: join(outDir, `${label}-desktop-1280x900.png`)});

  // --- 390x844 (phone) ---
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(1500);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow at 390px', overflow <= 0, `scrollWidth-clientWidth=${overflow}`);
  await page.screenshot({path: join(outDir, `${label}-mobile-390x844.png`)});
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(800);

  // --- hash-driven re-select, no reload ---
  await page.evaluate(() => { window.__noReload = true; });
  await page.evaluate(id => { location.hash = `#select=${id}`; }, B);
  await page.waitForFunction(id => document.documentElement.dataset.atlasSelected === id, B, {timeout: 20000});
  const survived = await page.evaluate(() => window.__noReload === true);
  check('hash re-select did NOT reload the page', survived);
  const title2 = await page.textContent('.detail-sheet .structure-title');
  check('title flipped to the second concept', (title2 || '').trim() === B_NAME, `got "${title2}" want "${B_NAME}"`);
  await page.screenshot({path: join(outDir, `${label}-hash-reselect.png`)});

  // --- snap mode ---
  await page.evaluate(id => { location.hash = `#select=${id}&snap=1&isolate=1`; }, A);
  await page.waitForFunction(() => document.body.classList.contains('snap-mode'), null, {timeout: 20000});
  const chromeHidden = await page.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display !== 'none' : false; };
    return ['.identity', '.bottom-dock', '.view-controls', '[data-slot=sheet-content]'].filter(vis);
  });
  check('snap=1 hides all chrome', chromeHidden.length === 0, `still visible: ${JSON.stringify(chromeHidden)}`);
  await page.screenshot({path: join(outDir, `${label}-snap.png`)});

  // ================= P2: URL contract v2 =================
  // A full navigation, not a hash change, so this is the link an assistant would hand over.
  const q = new URLSearchParams({select: `${A},${C},${B}`, isolate: '1', view: 'back', title: TITLE, note: NOTE});
  const multiUrl = `${base}/?${q}`;
  const resp2 = await page.goto(multiUrl, {waitUntil: 'domcontentloaded', timeout: 120000});
  check('v2 multi-select link returns 200', resp2.status() === 200, `status=${resp2.status()}`);
  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  await page.waitForFunction(() => (document.documentElement.dataset.atlasSelected || '').split(',').length === 3, null, {timeout: 30000});

  const sel3 = await page.getAttribute('html', 'data-atlas-selected');
  check('data-atlas-selected carries all three ids in order', sel3 === `${A},${C},${B}`, `got ${sel3}`);

  // "Selected pieces" is the app's own count of the union; three 2-piece concepts = 6.
  const pieces = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.structure-meta span')].find(s => /Selected pieces/i.test(s.textContent || ''));
    return el ? (el.querySelector('strong')?.textContent || '').trim() : null;
  });
  check('the union of all three is selected (6 pieces)', pieces === '6', `got ${pieces}`);

  const memberNames = await page.evaluate(() => [...document.querySelectorAll('.member-list button .search-result-name, .member-list button span')].map(s => (s.textContent || '').trim()).filter(Boolean));
  const covers = [A_NAME, C_NAME, B_NAME].every(n => memberNames.some(m => m.toLowerCase().includes(n.split(' ').pop())));
  check('the included-structures list covers all three concepts', covers, JSON.stringify(memberNames.slice(0, 8)));

  const sheetTitle = await page.textContent('.detail-sheet .structure-title');
  check('the sheet names the FIRST requested concept', (sheetTitle || '').trim() === A_NAME, `got "${sheetTitle}"`);

  const cap = await page.evaluate(() => {
    const el = document.querySelector('.atlas-caption');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {h: (el.querySelector('h2')?.textContent || ''), p: (el.querySelector('p')?.textContent || ''),
            display: cs.display, w: Math.round(r.width), ht: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left)};
  });
  check('caption card is present and rendered', !!cap && cap.display !== 'none' && cap.w > 40 && cap.ht > 10, JSON.stringify(cap));
  check('caption shows the title verbatim', cap?.h === TITLE, `got "${cap?.h}"`);
  check('caption shows the note verbatim', cap?.p === NOTE, `got "${cap?.p}"`);

  // Only the union is drawn: the app's own visible-piece counter, read with the
  // systems panel open, is the app's answer rather than mine.
  const visibleCount = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.panel-foot span')].find(s => /pieces visible/i.test(s.textContent || ''));
    return el ? (el.textContent || '').trim() : null;
  });
  check('isolate shows ONLY the union (6 pieces visible)', /^6 pieces visible$/.test(visibleCount || ''), `got "${visibleCount}"`);

  await page.screenshot({path: join(outDir, `${label}-v2-multi-desktop-1280x900.png`)});

  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(1800);
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('v2 caption: no horizontal overflow at 390px', overflow2 <= 0, `scrollWidth-clientWidth=${overflow2}`);
  const capMobile = await page.evaluate(() => {
    const el = document.querySelector('.atlas-caption');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {visible: getComputedStyle(el).display !== 'none', right: Math.round(r.right), bottom: Math.round(r.bottom), top: Math.round(r.top)};
  });
  check('v2 caption visible and inside the viewport at 390px', !!capMobile && capMobile.visible && capMobile.right <= 391 && capMobile.top >= 0, JSON.stringify(capMobile));
  await page.screenshot({path: join(outDir, `${label}-v2-multi-mobile-390x844.png`)});
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(800);

  // snap=1 must KEEP the caption (it is part of the picture) while hiding everything else.
  await page.evaluate(() => { location.hash = '#snap=1'; });
  await page.waitForFunction(() => document.body.classList.contains('snap-mode'), null, {timeout: 20000});
  await page.waitForTimeout(600);
  const snapState = await page.evaluate(() => {
    const vis = s => { const e = document.querySelector(s); return e ? getComputedStyle(e).display !== 'none' : false; };
    const capEl = document.querySelector('.atlas-caption');
    return {
      chrome: ['.identity', '.bottom-dock', '.view-controls', '.layers-panel', '.studio-footer', '[data-slot=sheet-content]'].filter(vis),
      caption: capEl ? getComputedStyle(capEl).display !== 'none' : false,
      captionText: capEl ? (capEl.textContent || '').trim() : '',
      selected: document.documentElement.dataset.atlasSelected,
    };
  });
  check('snap=1 still hides all chrome with a caption present', snapState.chrome.length === 0, JSON.stringify(snapState.chrome));
  check('snap=1 KEEPS the caption', snapState.caption && snapState.captionText.includes(NOTE), snapState.captionText.slice(0, 80));
  check('snap=1 kept the 3-id selection', snapState.selected === `${A},${C},${B}`, snapState.selected);
  await page.screenshot({path: join(outDir, `${label}-v2-snap-1280x900.png`)});

  // A caption of pure markup must be TEXT on the page, never nodes.
  await page.evaluate(() => { location.hash = '#title=' + encodeURIComponent('<img src=x onerror=alert(1)>') + '&note=' + encodeURIComponent('<b>bold?</b>'); });
  await page.waitForTimeout(700);
  const escaped = await page.evaluate(() => {
    const el = document.querySelector('.atlas-caption');
    return el ? {html: el.innerHTML, text: el.textContent, imgs: el.querySelectorAll('img,b').length} : null;
  });
  check('caption renders markup as TEXT, not as nodes', escaped && escaped.imgs === 0 && escaped.text.includes('<b>bold?</b>'), JSON.stringify(escaped).slice(0, 200));

  check('no console/page errors', consoleErrors.length === 0, consoleErrors.join(' | '));
} catch (e) {
  check('script completed without throwing', false, String(e).slice(0, 400));
  try { await page.screenshot({path: join(outDir, `${label}-FAILURE.png`)}); } catch {}
} finally {
  await context.close();
  await browser.close();
}

const failed = results.filter(r => !r.pass);
writeFileSync(join(outDir, `${label}-results.json`), JSON.stringify({base, label, at: new Date().toISOString(), results}, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
process.exit(failed.length ? 1 : 0);
