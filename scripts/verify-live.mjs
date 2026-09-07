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
// The tool OBJECTS are kept too, so the P3 block can actually call add_to_selection /
// list_selection rather than only checking that they registered. A tool that registers and
// does nothing would pass a name check.
await context.addInitScript(() => {
  window.__tools = [];
  window.__toolMap = {};
  document.modelContext = {registerTool(t) { window.__tools.push(t.name); window.__toolMap[t.name] = t; }};
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
  // L31 D01 CHANGED THIS CONTRACT, deliberately. This used to assert that the list covered
  // ALL THREE concepts — the union of the whole basket — under a heading that reads "Included
  // structures" beneath the title of ONE of them. That only looked right because `focused` was
  // always basket[0]; seeding focusId from a scene's roles broke the coincidence and the audit's
  // own link rendered a hamstring with five lumbar vertebrae listed as its parts. The list is
  // the drill-down from the FOCUSED concept to its own meshes (see app/selection.ts:11-13), so
  // it must carry that concept's parts and NOT its neighbours'. The basket panel is what lists
  // the other two, and tapping a basket row re-points this list.
  const own = memberNames.filter((m) => m.toLowerCase().includes(A_NAME.split(' ').pop()));
  const foreign = memberNames.filter((m) => [C_NAME, B_NAME].some((n) => m.toLowerCase().includes(n.split(' ').pop())));
  check('the included-structures list is the FOCUSED concept\'s own meshes, not the basket union',
    own.length === 2 && foreign.length === 0, JSON.stringify(memberNames.slice(0, 8)));

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

  // ================= P3: the selection basket =================
  // Every assertion below reads the app's OWN rendering of the basket (rows, switch state,
  // its own visible-piece counter) rather than my model of it.
  //
  // `page.click` CANNOT be used on this app, and that is the instrument's limit, not the
  // page's: the software-rendered WebGL scene keeps the main thread busy (two animation
  // frames measured at ~3.1 s under swiftshader), so Playwright's actionability + hit-target
  // handshake never completes. Measured on an UPSTREAM button this fork never touched, which
  // is how we know it is not the basket. Driving the mouse at coordinates goes through the
  // same browser input pipeline without that handshake, and works (~0.8 s).
  const tapBox = async (box) => { await page.mouse.click(box.x, box.y); await page.waitForTimeout(300); };
  const boxOf = (selector, index = 0) => page.evaluate(([sel, i]) => {
    const el = document.querySelectorAll(sel)[i];
    if (!el) return null;
    el.scrollIntoView({block: 'center'});
    const r = el.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height};
  }, [selector, index]);
  const tap = async (selector, index = 0) => {
    const box = await boxOf(selector, index);
    if (!box || box.w < 1) throw new Error(`tap: no box for ${selector}[${index}]`);
    await tapBox(box);
  };
  const rowNames = () => page.evaluate(() => [...document.querySelectorAll('.basket-row .basket-label')].map((e) => (e.textContent || '').trim()));
  const layersVisible = () => page.evaluate(() => {
    const el = [...document.querySelectorAll('.layers-panel .panel-foot span')].find((s) => /pieces visible/i.test(s.textContent || ''));
    return el ? (el.textContent || '').trim() : null;
  });

  await page.goto(`${base}/?select=${A},${C}&isolate=1`, {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  await page.waitForFunction(() => (document.documentElement.dataset.atlasSelected || '').split(',').length === 2, null, {timeout: 30000});
  await tap('.basket-button');
  await page.waitForSelector('.basket-panel .basket-row', {timeout: 15000});

  const rows1 = await rowNames();
  check('basket lists both picks, in the order the link named them', JSON.stringify(rows1) === JSON.stringify([A_NAME, C_NAME]), JSON.stringify(rows1));
  const hideOn = await page.evaluate(() => {
    const s = document.querySelector('.basket-hide [data-slot=switch]');
    return s ? (s.getAttribute('aria-checked') ?? s.getAttribute('data-state')) : null;
  });
  check('"Hide others" reflects isolate=1 from the URL', hideOn === 'true' || hideOn === 'checked', String(hideOn));
  check('isolate over the basket shows exactly the 4 meshes', /^4 pieces visible$/.test((await layersVisible()) || ''), String(await layersVisible()));
  await page.screenshot({path: join(outDir, `${label}-basket-2rows.png`)});

  // --- remove ---
  await tap('.basket-row .basket-remove', 0);
  await page.waitForFunction(() => document.querySelectorAll('.basket-row').length === 1, null, {timeout: 15000});
  const rows2 = await rowNames();
  check('removing the first row leaves exactly the second', JSON.stringify(rows2) === JSON.stringify([C_NAME]), JSON.stringify(rows2));
  await page.waitForFunction(id => location.search.includes(`select=${id}`), C, {timeout: 10000}).catch(() => {});
  const afterRemove = await page.evaluate(() => ({search: location.search, sel: document.documentElement.dataset.atlasSelected}));
  check('the URL mirrors the removal', afterRemove.search.includes(`select=${C}`) && !afterRemove.search.includes(A), afterRemove.search);
  check('data-atlas-selected mirrors the removal', afterRemove.sel === C, String(afterRemove.sel));
  check('the scene drops the removed meshes (2 pieces visible)', /^2 pieces visible$/.test((await layersVisible()) || ''), String(await layersVisible()));

  // --- add from a search result, without closing the panel or replacing the set ---
  await tap('.top-actions button[aria-label="Search anatomy"]');
  await page.waitForSelector('.search-panel input', {timeout: 10000});
  await tap('.search-panel input');
  await page.keyboard.type(B_NAME, {delay: 20});
  await page.waitForFunction(name => [...document.querySelectorAll('.anatomy-search-results .search-result-name')].some(e => (e.textContent || '').trim() === name), B_NAME, {timeout: 20000});
  // A REAL click on the row's `+`. If it did not stop propagation, the combobox would commit
  // the row and REPLACE the basket -- which is exactly what the next two checks separate.
  const addBox = await page.evaluate((name) => {
    const item = [...document.querySelectorAll('.anatomy-search-results [data-slot=combobox-item]')]
      .find(el => ((el.querySelector('.search-result-name') || {}).textContent || '').trim() === name);
    const b = item && item.querySelector('.result-add');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width};
  }, B_NAME);
  check('the search row offers a + control', !!addBox && addBox.w > 1, JSON.stringify(addBox));
  if (addBox) await tapBox(addBox);
  await page.waitForFunction(want => document.documentElement.dataset.atlasSelected === want, `${C},${B}`, {timeout: 15000}).catch(() => {});
  const afterAdd = await page.evaluate(() => ({
    sel: document.documentElement.dataset.atlasSelected,
    searchOpen: !!document.querySelector('.search-panel:not(.basket-panel)'),
    basketOpen: !!document.querySelector('.basket-panel'),
  }));
  check('the + on a search row ADDS instead of replacing', afterAdd.sel === `${C},${B}`, String(afterAdd.sel));
  check('the + leaves the search panel open (it did not commit the row)', afterAdd.searchOpen && !afterAdd.basketOpen, JSON.stringify(afterAdd));

  // --- the in-page (WebMCP) add/list tools do the same thing ---
  const toolNames = await page.evaluate(() => window.__tools ?? []);
  check('WebMCP registered add_to_selection', toolNames.includes('add_to_selection'), JSON.stringify(toolNames));
  check('WebMCP registered list_selection', toolNames.includes('list_selection'), JSON.stringify(toolNames));
  const added = await page.evaluate(id => window.__toolMap.add_to_selection.execute({id}), A);
  await page.waitForFunction(want => document.documentElement.dataset.atlasSelected === want, `${C},${B},${A}`, {timeout: 15000}).catch(() => {});
  const listed = await page.evaluate(() => window.__toolMap.list_selection.execute({}));
  check('add_to_selection appended a third structure', (await page.getAttribute('html', 'data-atlas-selected')) === `${C},${B},${A}`, JSON.stringify(added));
  check('list_selection reports the live basket', listed?.count === 3 && listed.selection.map(r => r.id).join(',') === `${C},${B},${A}`, JSON.stringify(listed));

  // --- three rows, both viewports ---
  await tap('.basket-button');
  await page.waitForSelector('.basket-panel .basket-row', {timeout: 15000});
  const rows3 = await rowNames();
  check('the basket lists all three, in add order', JSON.stringify(rows3) === JSON.stringify([C_NAME, B_NAME, A_NAME]), JSON.stringify(rows3));
  await page.screenshot({path: join(outDir, `${label}-basket-3rows-desktop-1280x900.png`)});
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(1400);
  const basketBox = await page.evaluate(() => {
    const el = document.querySelector('.basket-panel');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const rows = [...document.querySelectorAll('.basket-row')].map(x => Math.round(x.getBoundingClientRect().height));
    return {left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), rows,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth};
  });
  check('basket fits the 390px viewport with no horizontal overflow', !!basketBox && basketBox.overflow <= 0 && basketBox.left >= 0 && basketBox.right <= 391, JSON.stringify(basketBox));
  check('every basket row is at least 44px tall on a phone', !!basketBox && basketBox.rows.length === 3 && basketBox.rows.every(h => h >= 44), JSON.stringify(basketBox?.rows));
  check('the basket stays inside the viewport height on a phone', !!basketBox && basketBox.bottom <= 845, JSON.stringify(basketBox));
  await page.screenshot({path: join(outDir, `${label}-basket-3rows-mobile-390x844.png`)});
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(800);

  // --- clear ---
  const clearBox = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.basket-foot button')].find(x => /clear all/i.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width};
  });
  check('the basket offers a Clear all control', !!clearBox && clearBox.w > 1, JSON.stringify(clearBox));
  if (clearBox) await tapBox(clearBox);
  await page.waitForFunction(() => !document.documentElement.dataset.atlasSelected, null, {timeout: 15000}).catch(() => {});
  const cleared = await page.evaluate(() => ({
    rows: document.querySelectorAll('.basket-row').length,
    sel: document.documentElement.dataset.atlasSelected ?? null,
    search: location.search,
    isolated: !!document.querySelector('.detail-sheet.is-isolated'),
  }));
  check('Clear all empties the basket', cleared.rows === 0 && cleared.sel === null, JSON.stringify(cleared));
  check('Clear all drops select= and isolate= from the URL', !cleared.search.includes('select=') && !cleared.search.includes('isolate='), cleared.search);
  check('Clear all turns hide-others off', !cleared.isolated, JSON.stringify(cleared));

  // ================= P3: the Chinese language switch =================
  const A_ZH = '臀中肌';           // gluteus medius, identical in both scripts

  await page.goto(`${base}/?lang=zh-Hans&select=${A}&isolate=1`, {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  await page.waitForFunction(want => (document.querySelector('.detail-sheet .structure-title')?.textContent || '').trim() === want, A_ZH, {timeout: 30000}).catch(() => {});
  const zhSheet = await page.evaluate(() => ({
    title: (document.querySelector('.detail-sheet .structure-title')?.textContent || '').trim(),
    en: (document.querySelector('.detail-sheet .structure-en')?.textContent || '').trim(),
    htmlLang: document.documentElement.lang,
    isolateBtn: (document.querySelector('.detail-actions .primary-action')?.textContent || '').trim(),
    basketBtn: (document.querySelector('.basket-button span')?.textContent || '').trim(),
  }));
  check('lang=zh-Hans renders the structure name in Chinese', zhSheet.title === A_ZH, JSON.stringify(zhSheet));
  check('the English is kept underneath it (he is learning the vocabulary)', zhSheet.en === A_NAME, JSON.stringify(zhSheet));
  check('<html lang> follows the switch', zhSheet.htmlLang === 'zh-Hans', zhSheet.htmlLang);
  check('the interface chrome is translated too, not just the names', /[一-鿿]/.test(zhSheet.isolateBtn) && /[一-鿿]/.test(zhSheet.basketBtn), JSON.stringify(zhSheet));
  await page.screenshot({path: join(outDir, `${label}-zh-hans-desktop-1280x900.png`)});

  // Traditional must differ from Simplified where the script differs — otherwise the second
  // dictionary is decorative. 牙 is the same in both; the SYSTEM copy is where it shows.
  await page.evaluate(() => { location.hash = '#lang=zh-Hant'; });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-Hant', null, {timeout: 20000}).catch(() => {});
  const hantSample = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    systems: [...document.querySelectorAll('.layers-panel .system-name')].map(e => (e.textContent || '').replace(/\d+$/, '').trim()).slice(0, 6),
    foot: (document.querySelector('.layers-panel .panel-foot span')?.textContent || '').trim(),
  }));
  await page.evaluate(() => { location.hash = '#lang=zh-Hans'; });
  await page.waitForFunction(() => document.documentElement.lang === 'zh-Hans', null, {timeout: 20000}).catch(() => {});
  const hansSample = await page.evaluate(() => ({
    systems: [...document.querySelectorAll('.layers-panel .system-name')].map(e => (e.textContent || '').replace(/\d+$/, '').trim()).slice(0, 6),
    foot: (document.querySelector('.layers-panel .panel-foot span')?.textContent || '').trim(),
  }));
  check('zh-Hant is a real second dictionary, not a copy of zh-Hans',
    hantSample.lang === 'zh-Hant' && JSON.stringify(hantSample.systems) !== JSON.stringify(hansSample.systems),
    `hant=${JSON.stringify(hantSample.systems)} hans=${JSON.stringify(hansSample.systems)}`);
  check('the systems list is in Chinese', hansSample.systems.every(s => /[一-鿿]/.test(s)), JSON.stringify(hansSample.systems));

  // --- search in Chinese ---
  // Selected by POSITION, not by aria-label — the label is translated, which is the thing
  // under test, so keying on it would make the test pass only while the translation is absent.
  await tap('.top-actions > button', 1);
  await page.waitForSelector('.search-panel input', {timeout: 15000});
  // Do NOT click the input. It autofocuses when the panel opens, and a second click on an
  // already-open combobox toggles the popup shut — which fires onOpenChange(false) and
  // unmounts the whole panel. Measured: the first version of this step reported an empty
  // result list because there was no longer an input to type into (`typed: null`).
  await page.evaluate(() => document.querySelector('.search-panel input')?.focus());
  // Wait for the popup to be showing its DEFAULTS before typing, so a slow first render
  // cannot be mistaken for "Chinese search found nothing".
  await page.waitForFunction(() => document.querySelectorAll('.anatomy-search-results [data-slot=combobox-item]').length > 0, null, {timeout: 25000}).catch(() => {});
  await page.keyboard.insertText(A_ZH);   // insertText, not per-key typing: CJK has no keycodes
  await page.waitForFunction(want => [...document.querySelectorAll('.anatomy-search-results .search-result-name')].some(e => (e.textContent || '').trim() === want), A_ZH, {timeout: 25000}).catch(() => {});
  const zhSearch = await page.evaluate(() => ({
    typed: document.querySelector('.search-panel input')?.value ?? null,
    names: [...document.querySelectorAll('.anatomy-search-results .search-result-name')].map(e => (e.textContent || '').trim()).slice(0, 5),
  }));
  check('typing 臀中肌 finds it — search matches Chinese, not only English', zhSearch.names[0] === A_ZH, JSON.stringify(zhSearch));
  await page.screenshot({path: join(outDir, `${label}-zh-search.png`)});

  // --- the switch writes lang= and survives a reload via localStorage ---
  const langBox = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.lang-switch button')].find(x => (x.textContent || '').trim() === '繁體');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width};
  });
  check('the language switch is on the page', !!langBox && langBox.w > 1, JSON.stringify(langBox));
  if (langBox) await tapBox(langBox);
  await page.waitForFunction(() => location.search.includes('lang=zh-Hant'), null, {timeout: 15000}).catch(() => {});
  const afterSwitch = await page.evaluate(() => ({search: location.search, lang: document.documentElement.lang, stored: localStorage.getItem('atlas.lang')}));
  check('pressing 繁體 writes lang= into the URL', afterSwitch.search.includes('lang=zh-Hant'), afterSwitch.search);
  check('the choice is remembered in localStorage', afterSwitch.stored === 'zh-Hant', String(afterSwitch.stored));

  // Reload with NO lang in the URL: the remembered choice must still apply.
  await page.goto(`${base}/`, {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  await page.waitForFunction(() => document.documentElement.lang === 'zh-Hant', null, {timeout: 20000}).catch(() => {});
  const remembered = await page.evaluate(() => ({lang: document.documentElement.lang, heading: (document.querySelector('.layers-panel .panel-heading span')?.textContent || '').trim()}));
  check('the language survives a reload with no lang= in the URL', remembered.lang === 'zh-Hant' && /[一-鿿]/.test(remembered.heading), JSON.stringify(remembered));

  // --- 390px with CJK ---
  await page.goto(`${base}/?lang=zh-Hans&select=${A},${C},${B}&isolate=1`, {waitUntil: 'domcontentloaded', timeout: 120000});
  await page.waitForSelector('html[data-atlas-ready="1"]', {timeout: 120000});
  await page.waitForFunction(() => (document.documentElement.dataset.atlasSelected || '').split(',').length === 3, null, {timeout: 30000});
  await page.setViewportSize({width: 390, height: 844});
  await page.waitForTimeout(1500);
  await tap('.basket-button');
  await page.waitForSelector('.basket-panel .basket-row', {timeout: 15000});
  const zhMobile = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.basket-row')];
    const sw = document.querySelector('.lang-switch');
    const swr = sw ? sw.getBoundingClientRect() : null;
    return {
      names: rows.map(r => (r.querySelector('.basket-label') || {}).textContent?.trim()),
      heights: rows.map(r => Math.round(r.getBoundingClientRect().height)),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      switchBox: swr ? {left: Math.round(swr.left), right: Math.round(swr.right), top: Math.round(swr.top), bottom: Math.round(swr.bottom)} : null,
    };
  });
  check('the basket lists Chinese names at 390px', zhMobile.names.every(n => /[一-鿿]/.test(n || '')), JSON.stringify(zhMobile.names));
  check('CJK does not break the 390px layout', zhMobile.overflow <= 0 && zhMobile.heights.every(h => h >= 44), JSON.stringify(zhMobile));
  check('the language switch stays inside the phone viewport', !!zhMobile.switchBox && zhMobile.switchBox.left >= 0 && zhMobile.switchBox.right <= 391 && zhMobile.switchBox.bottom <= 845, JSON.stringify(zhMobile.switchBox));
  await page.screenshot({path: join(outDir, `${label}-zh-hans-mobile-390x844.png`)});
  await page.setViewportSize({width: 1280, height: 900});
  await page.waitForTimeout(600);

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
