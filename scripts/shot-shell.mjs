/**
 * SCREENSHOTS OF THE STUDIO SHELL, so a human can LOOK at it.
 * L31 v2.1b+c, S0. usage: node scripts/shot-shell.mjs <baseUrl> <outDir>
 *
 * Not an oracle and never a substitute for one — `verify-ux.mjs` asserts the geometry. This exists
 * because a green suite over a broken picture is the failure mode this project keeps naming, and
 * the only defence against it is a picture somebody actually opened.
 *
 * It also prints the computed grid template and the measured region rects, so the screenshot comes
 * with the numbers that produced it rather than being a claim on its own.
 */
import {chromium} from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {encodeScene, normalizeScene} from '../app/scene-codec.js';

const base = process.argv[2] ?? 'http://127.0.0.1:4173';
const outDir = process.argv[3] ?? 'E:/Agentic/.artifacts/L31/v21bc/s0-shell/shots';
mkdirSync(outDir, {recursive: true});

/** The §9 forward-bend scene — the same fixture every other instrument in this project uses, so a
 *  screenshot is comparable with an oracle row taken on the same picture. */
/** ⚠️ THE SCENE'S OWN `lang` BEATS `?lang=`. The first run of this script asked for `?lang=zh-Hans`
 *  on a blob declaring `lang:'en'` and got six identical English screenshots labelled `-zh` — a
 *  whole language's worth of evidence that was never taken. So the two languages get two blobs,
 *  with the caption authored in each, exactly as a real shared link would carry it. */
const scene = (lang, title, note) => normalizeScene({
  mode: 'explore', lang,
  structures: [
    {id: 'FMA22359', role: 'primary'}, {id: 'FMA22449', role: 'primary'},
    {id: 'FMA16580', role: 'context'}, {id: 'FMA9611', role: 'context'}, {id: 'FMA16203', role: 'ghost'},
  ],
  camera: {view: 'side', focus: ['FMA22359'], padding: 1.5, explode: 0},
  caption: {title, note, place: 'in'},
});
const BLOB = encodeScene(scene('en', 'Hamstrings & pelvis', 'In a forward fold, the hamstrings lengthen as the pelvis tips forward.'));
const BLOB_ZH = encodeScene(scene('zh-Hans', '腘绳肌与骨盆', '前屈时腘绳肌被拉长，骨盆随之前倾。'));

const SHOTS = [
  {name: 'studio-1440x900-en', w: 1440, h: 900, lang: 'en', url: `/v2/?scene=${BLOB}`},
  {name: 'studio-1440x900-zh', w: 1440, h: 900, lang: 'zh-Hans', url: `/v2/?scene=${BLOB_ZH}`},
  {name: 'studio-1920x860-en', w: 1920, h: 860, lang: 'en', url: `/v2/?scene=${BLOB}`},
  {name: 'studio-1920x860-zh', w: 1920, h: 860, lang: 'zh-Hans', url: `/v2/?scene=${BLOB_ZH}`},
  {name: 'studio-1366x1024-en', w: 1366, h: 1024, lang: 'en', url: `/v2/?scene=${BLOB}`, coarse: true},
  {name: 'studio-1366x1024-zh', w: 1366, h: 1024, lang: 'zh-Hans', url: `/v2/?scene=${BLOB_ZH}`, coarse: true},
  {name: 'studio-1440-bare-en', w: 1440, h: 900, lang: 'en', url: '/v2/?select=FMA7485'},
  {name: 'studio-1440-collapsed', w: 1440, h: 900, lang: 'en', url: `/v2/?scene=${BLOB}`, collapse: true},
  {name: 'studio-1440-settings', w: 1440, h: 900, lang: 'en', url: `/v2/?scene=${BLOB}`, open: 'settings'},
  {name: 'studio-1440-about', w: 1440, h: 900, lang: 'en', url: `/v2/?scene=${BLOB}`, open: 'about'},
  {name: 'studio-1440-keys', w: 1440, h: 900, lang: 'en', url: `/v2/?scene=${BLOB}`, open: 'keys'},
  {name: 'phone-390x844-en', w: 390, h: 844, lang: 'en', url: `/v2/?scene=${BLOB}`, coarse: true},
  {name: 'phone-390x844-keys-sheet', w: 390, h: 844, lang: 'en', url: `/v2/?scene=${BLOB}`, coarse: true, open: 'keys'},
  {name: 'tablet-1024x768-en', w: 1024, h: 768, lang: 'en', url: `/v2/?scene=${BLOB}`, coarse: true},
];

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

for (const s of SHOTS) {
  const context = await browser.newContext({
    viewport: {width: s.w, height: s.h}, deviceScaleFactor: 1,
    hasTouch: !!s.coarse, isMobile: false,
    // `pointer:coarse` is what the studio's 44 px rules key on, and Playwright only sets it from
    // `hasTouch` + `isMobile`; forcing the media feature directly is the reliable way.
    ...(s.coarse ? {} : {}),
  });
  const page = await context.newPage();
  if (s.coarse) await page.emulateMedia({forcedColors: null});
  try {
    await page.goto(`${base}${s.url}`, {waitUntil: 'domcontentloaded', timeout: 180000});
    await page.waitForSelector('html[data-atlas-scene-ready="1"]', {timeout: 240000}).catch(() => {});
    await page.waitForTimeout(1600);
    if (s.collapse) {
      const b = await page.$('.v2-side-head .v2-tbtn');
      if (b) { const r = await b.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
      // and close the dock, to reach D10's state
      const x = await page.$('.v2-pane-x');
      if (x) { const r = await x.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
      await page.waitForTimeout(500);
    }
    if (s.open === 'settings' || s.open === 'about') {
      const g = await page.$(`.v2-bar .v2-tbtn[title]`);
      if (g) { const r = await g.boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
      await page.waitForTimeout(400);
      if (s.open === 'about') {
        const tabs = await page.$$('.v2-mtab');
        if (tabs[2]) { const r = await tabs[2].boundingBox(); await page.mouse.click(r.x + r.width / 2, r.y + r.height / 2); }
        await page.waitForTimeout(300);
      }
    }
    if (s.open === 'keys') { await page.keyboard.press('?'); await page.waitForTimeout(450); }

    const geo = await page.evaluate(() => {
      const el = document.querySelector('.v2');
      const r = (sel) => { const n = document.querySelector(sel); if (!n) return null; const b = n.getBoundingClientRect(); return `${Math.round(b.width)}x${Math.round(b.height)}@${Math.round(b.x)},${Math.round(b.y)}`; };
      return {
        areas: getComputedStyle(el).gridTemplateAreas,
        tier: el.dataset.tier,
        bar: r('.v2-bar'), tools: r('.v2-tools'), side: r('.v2-side'), field: r('.v2-field'),
        dock: r('.v2-dock'), status: r('.v2-status'), modal: r('.v2-modal'), handle: r('.v2-sheet-handle'),
      };
    });
    await page.screenshot({path: join(outDir, `${s.name}.png`)});
    console.log(`${s.name}\n   tier=${geo.tier} areas=${geo.areas}\n   bar=${geo.bar} tools=${geo.tools} side=${geo.side} field=${geo.field} dock=${geo.dock} status=${geo.status}${geo.modal ? ` modal=${geo.modal}` : ''}${geo.handle ? ` handle=${geo.handle}` : ''}`);
  } catch (e) {
    console.log(`${s.name}  ERROR ${String(e).slice(0, 160)}`);
  }
  await context.close();
}
await browser.close();
console.log(`\nwrote ${SHOTS.length} shots -> ${outDir}`);
