// L30 P4 verification — the teaching plate, headless, against a live host.
// usage: node scripts/verify-render.mjs <baseUrl> <outDir>
// CF Access headers come from env (CF_ID / CF_SECRET) so no secret is ever written to disk.
//
// WHAT THIS CHECKS THAT PIXEL STATISTICS CANNOT. "A picture appeared" passes equally for
// the wrong muscles, the wrong side of the body, the previous request's scene served from
// a warm tab, or a stale R2 entry. So the framing and ordering assertions read the page's
// OWN projected screen rectangles (`window.__atlasTargets()`), which are computed from the
// same camera that drew the frame. A render of the wrong structures cannot pass those.
//
// TWO INSTRUMENT RULES, both learned the hard way on this project:
//   - NEVER page.click. The software-rendered WebGL main thread blocks Playwright's
//     actionability handshake (measured: two animation frames at 3.1 s under swiftshader,
//     confirmed on an untouched upstream button). Drive the mouse at coordinates instead.
//     Nothing here needs a click at all.
//   - SCOPE the CF Access headers to the target origin with context.route. Sending them on
//     every request turns Cloudflare's own beacon into a failing preflight and manufactures
//     a console-error failure that is the instrument's fault, not the site's.
import { chromium } from 'file:///E:/Dev/Mipos/Tools/mipos-bank-fetch/node_modules/playwright-core/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { normalizeScene, encodeScene, sceneSelectIds } = await import(
  `file://${join(ROOT, 'app', 'scene-codec.js').split('\\').join('/')}`
);

const base = process.argv[2] ?? 'https://anatomy.adrian.my';
const outDir = process.argv[3] ?? 'E:/Agentic/.artifacts/L30/p4';
mkdirSync(outDir, { recursive: true });

// The PRD section 9 forward-bend scene, in its LEFT-lateral form. `view:"side"` puts the
// camera at +X, which is the body's left, and every bilateral concept would otherwise
// superimpose both limbs at a slight offset — under ghost anatomy that reads as one
// doubled, blurred muscle, and its projected centroid lands in the midline between them.
const L = {
  semitendinosus: 'FMA22359', semimembranosus: 'FMA22449', bicepsFemoris: 'FMA45889',
  femur: 'FMA24475', hipBone: 'FMA16587', lumbar: 'FMA16203',
};
const forwardBend = (over = {}) => normalizeScene({
  mode: 'render',
  structures: [
    { id: L.semitendinosus, role: 'primary' }, { id: L.semimembranosus, role: 'primary' },
    { id: L.bicepsFemoris, role: 'primary' },
    { id: L.hipBone, role: 'context' }, { id: L.femur, role: 'context' },
    { id: L.lumbar, role: 'ghost' },
  ],
  camera: { view: 'side', focus: [L.hipBone, L.semitendinosus], padding: 1.35 },
  roleOpacity: { primary: 1, context: 0.4, ghost: 0.08 },
  caption: { title: 'Forward bend: hip motion vs lumbar compensation', note: 'The pelvis should rotate over the femur first. If hip motion is limited, the lumbar spine often contributes more flexion.' },
  size: { w: 960, h: 720 },
  ...over,
});

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
};

const headers = (process.env.CF_ID && process.env.CF_SECRET)
  ? { 'CF-Access-Client-Id': process.env.CF_ID, 'CF-Access-Client-Secret': process.env.CF_SECRET }
  : {};

const browser = await chromium.launch({
  executablePath: 'C:\\Users\\adrian\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win64\\chrome.exe',
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});

async function makeContext(width, height) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  if (Object.keys(headers).length) {
    const origin = new URL(base).origin;
    await context.route('**/*', (route) => {
      const r = route.request();
      if (r.url().startsWith(origin)) return route.continue({ headers: { ...r.headers(), ...headers } });
      return route.continue();
    });
  }
  return context;
}

const urlFor = (scene) => {
  const blob = encodeScene(scene);
  return `${base}/?select=${sceneSelectIds(scene).join(',')}&scene=${blob}&snap=1`;
};

/** Load a plate and wait for the page's OWN markers, never a sleep. */
async function drive(page, scene, { viaHash = false } = {}) {
  const target = urlFor(scene);
  const t0 = Date.now();
  if (viaHash) {
    const q = new URL(target).searchParams.toString();
    await page.evaluate((h) => { window.location.hash = h; }, `#${q}`);
  } else {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.waitForSelector('html[data-atlas-ready="1"]', { timeout: 180000 });
  }
  const want = sceneSelectIds(scene).join(',');
  await page.waitForFunction((w) => document.documentElement.dataset.atlasSelected === w, want, { timeout: 60000 });
  await page.waitForFunction(() => document.documentElement.dataset.atlasSettled === '1', null, { timeout: 60000 });
  return Date.now() - t0;
}

/** Decode a PNG in the browser rather than shipping a decoder: fewer moving parts. */
async function pixels(analyser, buf) {
  return analyser.evaluate(async (b64) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    // The plate background is a flat light grey; count what is NOT it, and describe it.
    let off = 0; let sum = 0; let sumSq = 0;
    const colours = new Set();
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]; const g = d[i + 1]; const bl = d[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
      sum += lum; sumSq += lum * lum;
      if (Math.abs(r - 242) > 6 || Math.abs(g - 243) > 6 || Math.abs(bl - 243) > 6) off++;
      if (colours.size < 4000) colours.add((r >> 2) * 4096 + (g >> 2) * 64 + (bl >> 2));
    }
    const n = d.length / 4;
    const mean = sum / n;
    return { w: bmp.width, h: bmp.height, offBackground: off / n, colours: colours.size, variance: sumSq / n - mean * mean, mean };
  }, buf.toString('base64'));
}

/** Mean luminance of a rectangle, for comparing a ghosted region against a solid one. */
async function regionLuminance(analyser, buf, rect) {
  return analyser.evaluate(async ({ b64, r }) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const x = Math.max(0, Math.round(r.x)); const y = Math.max(0, Math.round(r.y));
    const w = Math.min(bmp.width - x, Math.round(r.w)); const h = Math.min(bmp.height - y, Math.round(r.h));
    if (w <= 0 || h <= 0) return { lum: null, off: null };
    const d = ctx.getImageData(x, y, w, h).data;
    let sum = 0; let off = 0;
    for (let i = 0; i < d.length; i += 4) {
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (Math.abs(d[i] - 242) > 6 || Math.abs(d[i + 1] - 243) > 6 || Math.abs(d[i + 2] - 243) > 6) off++;
    }
    return { lum: sum / (d.length / 4), off: off / (d.length / 4) };
  }, { b64: buf.toString('base64'), r: rect });
}

// A NAMED concept resolves through the page, not through part.conceptId: FMA16203 "lumbar
// vertebral column" is a grouping of ten meshes whose own concepts are the five vertebrae
// and the five discs, so matching on conceptId finds nothing and the check degrades to
// "structure absent" — which is exactly how an instrument bug reads as a product bug.
const ALL_IDS = [...Object.values(L), 'FMA22315'];
const targetsFor = (page) => page.evaluate((ids) => (window.__atlasTargets ? window.__atlasTargets(ids) : null), ALL_IDS);
const unionRect = (t, ids) => {
  const boxes = ids.map((id) => t.groups[id]).filter(Boolean);
  if (!boxes.length) return null;
  return {
    left: Math.min(...boxes.map((b) => b.left)), right: Math.max(...boxes.map((b) => b.right)),
    top: Math.min(...boxes.map((b) => b.top)), bottom: Math.max(...boxes.map((b) => b.bottom)),
    n: boxes.reduce((a, b) => a + b.n, 0),
  };
};
/** Unit camera direction from target to eye — the thing `view` is supposed to control. */
const camDir = (t) => {
  const d = [t.camera.x - t.camera.tx, t.camera.y - t.camera.ty, t.camera.z - t.camera.tz];
  const n = Math.hypot(...d) || 1;
  return d.map((v) => v / n);
};

const analyserCtx = await browser.newContext();
const analyser = await analyserCtx.newPage();
await analyser.goto('about:blank');

try {
  // ── A. the plate, at the size the renderer uses ────────────────────────────
  const ctx960 = await makeContext(960, 720);
  const page = await ctx960.newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + String(e).slice(0, 200)));

  const scene = forwardBend();
  const ms = await drive(page, scene);
  check('A1 the plate loads, selects and SETTLES on its own markers', true, `${ms} ms`);

  // No explorer chrome. Measured as client rects, not as a CSS assertion.
  const chrome = await page.evaluate(() => {
    const sel = ['.identity', '.top-actions', '.layers-panel', '.search-panel', '.view-controls',
      '.bottom-dock', '.studio-footer', '.scene-caption', '.lang-switch', '.vignette', '.part-hover',
      '.basket-panel', '[data-slot=sheet-content]'];
    const visible = [];
    for (const s of sel) {
      for (const el of document.querySelectorAll(s)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && getComputedStyle(el).display !== 'none') visible.push(s);
      }
    }
    return visible;
  });
  check('A2 NO explorer chrome in the frame', chrome.length === 0, chrome.join(', ') || 'clean');

  const capVisible = await page.evaluate(() => {
    const el = document.querySelector('.atlas-caption');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), text: (el.textContent || '').slice(0, 40) };
  });
  check('A3 the caption card IS in the picture', !!capVisible && capVisible.w > 100, JSON.stringify(capVisible));

  const shot = await page.screenshot({ type: 'png' });
  writeFileSync(join(outDir, 'plate-forward-bend-960x720.png'), shot);
  const px = await pixels(analyser, shot);
  check('A4 the plate is a real picture, not a blank frame',
    px.offBackground > 0.05 && px.colours > 100 && px.variance > 50,
    `off-bg ${(px.offBackground * 100).toFixed(1)}% · ${px.colours} colours · var ${px.variance.toFixed(0)}`);

  // ── B. FRAMING, from the page's own projection ─────────────────────────────
  const t = await targetsFor(page);
  check('B0 the page exposes its projected rects', !!t && t.parts.length > 0, t ? `${t.parts.length} drawn parts` : 'MISSING');

  const everyId = sceneSelectIds(scene);
  const missing = everyId.filter((id) => !unionRect(t, [id]));
  check('B1 every structure the scene names is actually drawn', missing.length === 0, missing.join(',') || 'all 6 present');

  const focusRect = unionRect(t, scene.camera.focus);
  const minDim = Math.min(t.w, t.h);
  const focusFrac = focusRect ? Math.max((focusRect.right - focusRect.left), (focusRect.bottom - focusRect.top)) / minDim : 0;
  check('B2 the focus set FILLS the frame (>= 55% of the shorter side)', focusFrac >= 0.55,
    `${(focusFrac * 100).toFixed(1)}% of ${minDim}px`);

  const inFrame = everyId.every((id) => {
    const r = unionRect(t, [id]);
    return r && r.right > 0 && r.left < t.w && r.bottom > 0 && r.top < t.h;
  });
  check('B3 every context structure is still inside the frame', inFrame);

  // The oracle no wrong-structure or wrong-camera render can pass: on a left-lateral
  // forward-bend plate the lumbar column is above the hip bone, which is above the
  // hamstring. Screen y grows downward.
  const yOf = (id) => { const r = unionRect(t, [id]); return r ? (r.top + r.bottom) / 2 : NaN; };
  const yLumbar = yOf(L.lumbar); const yHip = yOf(L.hipBone); const yHam = yOf(L.semitendinosus);
  check('B4 the anatomy is in the right ORDER on screen (lumbar > pelvis > hamstring)',
    yLumbar < yHip && yHip < yHam, `y: lumbar ${yLumbar.toFixed(0)} · hip ${yHip.toFixed(0)} · hamstring ${yHam.toFixed(0)}`);

  // padding is a DISTANCE multiplier: bigger means further away means less ink.
  const wide = await (async () => {
    await drive(page, forwardBend({ camera: { ...scene.camera, padding: 2.4 } }), { viaHash: true });
    const s2 = await page.screenshot({ type: 'png' });
    writeFileSync(join(outDir, 'plate-padding-2.4.png'), s2);
    return pixels(analyser, s2);
  })();
  check('B5 padding pulls the camera BACK, not in (the percentage-vs-multiplier trap)',
    wide.offBackground < px.offBackground,
    `padding 1.35 -> ${(px.offBackground * 100).toFixed(1)}% ink, padding 2.4 -> ${(wide.offBackground * 100).toFixed(1)}%`);

  // `view` really is honoured now. Read the CAMERA, do not infer it from how wide something
  // looks: `view` was silently ignored whenever isolate was on (the direction at that line
  // was a hard-coded vector), and a width ratio can sit near 1.0 for a shape that happens to
  // be similar from two angles. The direction is the claim, so measure the direction.
  const dirFor = (v) => (v === 'front' ? [0, 0.02, 1] : v === 'back' ? [0, 0.02, -1] : v === 'side' ? [1, 0.02, 0] : [0.35, 0.06, 1]);
  const unit = (d) => { const n = Math.hypot(...d); return d.map((x) => x / n); };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const seen = {};
  for (const v of ['side', 'front', 'back']) {
    await drive(page, forwardBend({ camera: { ...scene.camera, view: v } }), { viaHash: true });
    seen[v] = camDir(await targetsFor(page));
  }
  const aligned = ['side', 'front', 'back'].map((v) => ({ v, d: dot(seen[v], unit(dirFor(v))) }));
  check('B6 the camera really points where `view` says (dot > 0.9 for each)',
    aligned.every((a) => a.d > 0.9), aligned.map((a) => `${a.v} ${a.d.toFixed(3)}`).join(' · '));
  check('B7 side, front and back are three DIFFERENT cameras',
    dot(seen.side, seen.front) < 0.9 && dot(seen.front, seen.back) < 0.9,
    `side.front ${dot(seen.side, seen.front).toFixed(2)} · front.back ${dot(seen.front, seen.back).toFixed(2)}`);

  // ── C. GHOST ANATOMY ───────────────────────────────────────────────────────
  const ghostSamples = [];
  for (const alpha of [1.0, 0.4, 0.08]) {
    await drive(page, forwardBend({ roleOpacity: { primary: 1, context: 0.4, ghost: alpha } }), { viaHash: true });
    const tt = await targetsFor(page);
    const gr = unionRect(tt, [L.lumbar]);
    const s2 = await page.screenshot({ type: 'png' });
    writeFileSync(join(outDir, `plate-ghost-${alpha}.png`), s2);
    const region = await regionLuminance(analyser, s2, { x: gr.left, y: gr.top, w: gr.right - gr.left, h: gr.bottom - gr.top });
    ghostSamples.push({ alpha, ...region });
  }
  const [full, mid, faint] = ghostSamples;
  check('C1 the ghost really does fade as contextOpacity falls',
    full.off > mid.off && mid.off > faint.off,
    ghostSamples.map((g) => `${g.alpha}: ${(g.off * 100).toFixed(1)}% ink`).join(' · '));

  // THE STALENESS TEST. Change ONLY the opacity, in the SAME warm tab. If the map were
  // mutated in place or left out of the animate loop's reference-equality guard, this is
  // the only check that goes red — everything else would render a correct-looking picture
  // of the PREVIOUS scene, which R2 would then cache for 24 hours.
  check('C2 changing ONLY contextOpacity in a warm tab really reaches the GPU',
    Math.abs(full.off - faint.off) > 0.01,
    `${(full.off * 100).toFixed(2)}% vs ${(faint.off * 100).toFixed(2)}%`);

  // ── D. WARM-TAB POISONING ──────────────────────────────────────────────────
  // A: a captioned Chinese scene. B: a different, English, uncaptioned scene. B must carry
  // nothing of A. An empty value resets no key except title/note, so only the scene apply
  // being AUTHORITATIVE can make this pass.
  await drive(page, forwardBend({ lang: 'zh-Hans', caption: { title: '骨盆前倾', note: '髋先动。', place: 'in' } }), { viaHash: true });
  const sceneB = normalizeScene({
    mode: 'render',
    structures: [{ id: 'FMA22315', role: 'primary' }],
    camera: { view: 'front', focus: ['FMA22315'] },
    caption: { title: '', note: '', place: 'in' },
    size: { w: 960, h: 720 },
  });
  await drive(page, sceneB, { viaHash: true });
  const bleed = await page.evaluate(() => ({
    selected: document.documentElement.dataset.atlasSelected,
    caption: document.querySelector('.atlas-caption')?.textContent ?? '',
    lang: document.documentElement.lang,
  }));
  check('D1 a warm tab carries NOTHING of the previous scene',
    bleed.selected === 'FMA22315' && !bleed.caption.includes('骨盆') && bleed.lang === 'en',
    JSON.stringify(bleed));

  // ...and the same over a LEGACY select=-only render, proving the scene apply beats stale
  // legacy keys rather than merely beating another scene.
  await page.goto(`${base}/?select=FMA22315,FMA22314&isolate=1&view=back&title=Legacy&note=Old&snap=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('html[data-atlas-ready="1"]', { timeout: 180000 });
  await drive(page, forwardBend(), { viaHash: true });
  const bleed2 = await page.evaluate(() => ({
    selected: document.documentElement.dataset.atlasSelected,
    caption: document.querySelector('.atlas-caption')?.textContent ?? '',
    render: document.body.classList.contains('render-mode'),
  }));
  check('D2 a scene overwrites a stale LEGACY render completely',
    bleed2.render && !bleed2.caption.includes('Legacy') && bleed2.selected === sceneSelectIds(forwardBend()).join(','),
    JSON.stringify({ ...bleed2, caption: bleed2.caption.slice(0, 30) }));

  // ── E. DETERMINISM ─────────────────────────────────────────────────────────
  const digests = [];
  for (let i = 0; i < 3; i++) {
    await page.goto('about:blank');
    await drive(page, forwardBend());
    const s2 = await page.screenshot({ type: 'png' });
    const p2 = await pixels(analyser, s2);
    digests.push(`${p2.offBackground.toFixed(4)}/${p2.mean.toFixed(2)}`);
  }
  check('E1 three loads of the identical URL produce the same picture',
    new Set(digests).size === 1, digests.join(' | '));

  check('E2 no console errors while rendering plates', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'clean');
  await ctx960.close();

  // ── F. the PHONE viewport, where the caption reservation guard lives ────────
  const ctxPhone = await makeContext(390, 844);
  const phone = await ctxPhone.newPage();
  await drive(phone, forwardBend({ size: { w: 960, h: 720 } }));
  const phoneT = await targetsFor(phone);
  const phoneFocus = unionRect(phoneT, forwardBend().camera.focus);
  const phoneFrac = phoneFocus
    ? Math.max(phoneFocus.right - phoneFocus.left, phoneFocus.bottom - phoneFocus.top) / Math.min(phoneT.w, phoneT.h)
    : 0;
  writeFileSync(join(outDir, 'plate-phone-390x844.png'), await phone.screenshot({ type: 'png' }));
  check('F1 the plate still frames its subject on a 390x844 viewport', phoneFrac >= 0.45,
    `${(phoneFrac * 100).toFixed(1)}% of ${Math.min(phoneT.w, phoneT.h)}px`);
  await ctxPhone.close();

  // ── G. CJK: does a Chinese caption render, or is it tofu? ──────────────────
  const ctxZh = await makeContext(960, 720);
  const zh = await ctxZh.newPage();
  await drive(zh, forwardBend({ lang: 'zh-Hans', caption: { title: '骨盆前倾', note: '髋关节先动,腰椎才不用代偿。', place: 'in' } }));
  const zhShot = await zh.screenshot({ type: 'png' });
  writeFileSync(join(outDir, 'plate-zh-caption.png'), zhShot);
  const zhBox = await zh.evaluate(() => {
    const h = document.querySelector('.atlas-caption h2');
    if (!h) return null;
    const r = h.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, text: h.textContent };
  });
  // Tofu is a run of identical rectangles: near-zero horizontal variance across the glyph
  // band. Real CJK has strokes, so the column ink varies a lot.
  const zhVar = zhBox ? await zh.evaluate(async ({ b64, r }) => {
    const bin = atob(b64); const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height); const ctx = c.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h));
    const cols = [];
    for (let x = 0; x < d.width; x++) {
      let ink = 0;
      for (let y = 0; y < d.height; y++) { const i = (y * d.width + x) * 4; if (d.data[i] < 140) ink++; }
      cols.push(ink / d.height);
    }
    const mean = cols.reduce((a, b) => a + b, 0) / cols.length;
    return { variance: cols.reduce((a, b) => a + (b - mean) ** 2, 0) / cols.length, mean, width: d.width };
  }, { b64: zhShot.toString('base64'), r: zhBox }) : null;
  check('G1 a Chinese caption renders as GLYPHS, not tofu boxes',
    !!zhVar && zhVar.mean > 0.02 && zhVar.variance > 0.004,
    zhVar ? `column-ink mean ${zhVar.mean.toFixed(3)} variance ${zhVar.variance.toFixed(4)} over ${zhVar.width}px` : 'no caption');
  await ctxZh.close();
} catch (err) {
  check('FATAL', false, String(err && err.message ? err.message : err).slice(0, 300));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
writeFileSync(join(outDir, 'verify-render.json'), JSON.stringify({ base, passed, total: results.length, results }, null, 2));
console.log(`\n${passed}/${results.length} passed  ->  ${outDir}`);
process.exitCode = passed === results.length ? 0 : 1;
