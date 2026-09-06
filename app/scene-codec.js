/**
 * THE SCENE — one model, three consumers (Explorer, Render, and later Sequence). L30 P4a.
 *
 * This file is PLAIN ESM JavaScript with ZERO imports, on purpose: it is imported by
 * BOTH the Vite bundle (through `app/scene-model.ts`) and the Pages Function
 * (`functions/mcp.js`). One definition, two importers — which is the deliberate fix for
 * the drift class this fork already carries once (URL_CONTRACT in functions/mcp.js
 * hand-mirrors app/url-state.ts and the two must be edited together by hand).
 *
 * WHY ONE URL KEY. Everything a teaching plate needs — mode, language, roles, opacities,
 * camera, caption, styles, annotations, and one day the animation steps — lives inside
 * ONE base64url blob carried as `scene=`. The fork's highest-rated hazard is a new URL
 * key that someone forgets to add to the renderer's cache key (workers/snap canonical())
 * or to its warm-tab re-drive (reDriveHash()); both fail as a PLAUSIBLE PICTURE at HTTP
 * 200, never as an error. One key is one chance to get that wrong, paid once, instead of
 * one chance per feature forever.
 *
 * base64url, not raw JSON: every character of the alphabet (A-Za-z0-9-_) is URL-safe, so
 * URLSearchParams adds zero percent-encoding. Raw JSON roughly doubles against URL_MAX.
 *
 * CANONICALISATION is what makes the blob a correct cache key. Structures and styles are
 * sorted by id, keys are emitted in a fixed declared order, every value equal to its
 * default is DROPPED, and floats are rounded to 3 decimals. Two semantically identical
 * scenes therefore produce the SAME blob and share one R2 entry; two different scenes
 * cannot collide. `encodeScene(decodeScene(b)) === b` is a test, not an aspiration.
 */

export const SCENE_V = 1;

export const VIEWS = ['three-quarter', 'front', 'back', 'side'];
export const LANGS = ['en', 'zh-Hans', 'zh-Hant'];
export const MODES = ['explore', 'render'];
export const ROLES = ['primary', 'context', 'ghost'];
/** `all` is deliberately absent in P4a: the whole body at low opacity forces every one of
 *  the 15 geometry chunks to load (33 MB) and puts the render back on the ~67 s cold path.
 *  The tool rejects it by name and says to use `skeletal`. */
export const REST_MODES = ['none', 'skeletal'];
export const BACKGROUNDS = ['light', 'dark'];
/** Closed enum. `normal` is accepted as an alias for `neutral` because the PRD writes it
 *  that way. Emphasis is stored and round-tripped in P4a; it is DRAWN in P4c. */
export const EMPHASIS = ['neutral', 'highlight', 'secondary', 'ghost', 'warning'];
export const EMPHASIS_ALIAS = { normal: 'neutral' };
/** The PRD names this primitive twice, once per section. Both spellings resolve. */
export const ANNOTATION_TYPES = ['label', 'arrow', 'rotation-arrow', 'stretch', 'point'];
export const ANNOTATION_ALIAS = { 'curved-arrow': 'rotation-arrow' };
export const DIRECTIONS = ['anterior', 'posterior', 'superior', 'inferior', 'medial', 'lateral'];

export const LIMITS = {
  /** Matches SELECT_MAX in app/url-state.ts:18 — which SILENTLY slices `select=` to 24.
   *  A scene with more structures would lose its tail on the page with no error and
   *  render a confidently wrong picture, so the two bounds are pinned to each other. */
  MAX_STRUCTURES: 24,
  MAX_STYLES: 24,
  MAX_ANNOTATIONS: 8,
  MAX_ANNOTATION_TEXT: 64,
  TITLE_MAX: 80,
  NOTE_MAX: 600,
  /** Sized so `https://anatomy.adrian.my/?select=…&scene=…&snap=1&size=960x720` stays
   *  under the 2000-character URL_MAX the server already enforces. */
  SCENE_MAX_B64: 1400,
  PAD_MIN: 1, PAD_MAX: 3,
  /** The plate is the page's VIEWPORT, so its size picks the responsive breakpoint.
   *  Below 768 wide the page switches to its phone layout and below 601 tall to its
   *  landscape-phone layout — both of which reserve chrome bands for panels that render
   *  mode has already hidden, and both of which would frame the subject badly. These
   *  floors are that breakpoint, not a taste. */
  W_MIN: 768, W_MAX: 1400, H_MIN: 608, H_MAX: 1050,
};

export const DEFAULTS = {
  v: SCENE_V,
  mode: 'render',
  lang: 'en',
  rest: { include: 'none', opacity: 0.08 },
  camera: { view: 'three-quarter', focus: [], padding: 1.35, explode: 0, rotate: false },
  /**
   * OPACITY IS RESOLVED BY COVERAGE, NOT BY BLENDING, so these are not the PRD's numbers.
   *
   * The renderer keeps a structure's fragments with probability = opacity and discards the
   * rest (see the alphaHash hook in app/scene.tsx and the reason blending is unavailable
   * here). LOOKED AT, 2026-09-07: the PRD's 0.40 for supporting structure and 0.08 for the
   * rest of the body read as grainy noise and as nearly nothing — a coverage of 0.08 is one
   * pixel in twelve, which is speckle rather than a ghost. 0.55 and 0.25 carry the PRD's
   * intent ("supporting structure" and "a ghost of the body") under this renderer.
   * The caller can still pass the PRD's literal numbers; they are simply fainter here.
   */
  roleOpacity: { primary: 1, context: 0.55, ghost: 0.25 },
  caption: { title: '', note: '', place: 'in' },
  background: 'light',
  size: { w: 960, h: 720 },
  /**
   * Supersample: draw the WebGL backing store at 2x the plate and let the browser
   * downsample it on composite. Four samples averaged per output pixel is what turns the
   * coverage dither from speckle into a wash, at ZERO extra draw calls and zero extra
   * vertices — the only cure available without a second render pass. On by default for
   * plates (app/scene.tsx applies it only in render mode, never in the interactive
   * explorer). Inside the blob, so it is part of the render cache key.
   */
  ss: 1,
};

const ID_RE = /^[A-Za-z0-9._:-]{1,64}$/;
export const isId = (v) => typeof v === 'string' && ID_RE.test(v);

const round3 = (n) => Math.round(n * 1000) / 1000;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// ── base64url, UTF-8 safe ───────────────────────────────────────────────────
// btoa/atob are Latin-1 only, and a Chinese caption is not Latin-1. Encode through
// TextEncoder in 8 KB slices — String.fromCharCode(...wholeArray) blows the stack.

export function b64urlEncode(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64urlDecode(blob) {
  const pad = blob.length % 4 ? '='.repeat(4 - (blob.length % 4)) : '';
  const bin = atob(blob.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ── normalize ───────────────────────────────────────────────────────────────

/** Collapse whitespace and strip control characters — the page does the same, so a
 *  caption that rendered differently from the string we reported would make the URL a lie. */
function cleanText(raw) {
  if (typeof raw !== 'string') return '';
  return Array.from(raw)
    .map((ch) => (ch.codePointAt(0) < 32 || ch.codePointAt(0) === 127 ? ' ' : ch))
    .join('').replace(/\s+/g, ' ').trim();
}

const pick = (value, allowed, dflt) => (allowed.includes(value) ? value : dflt);

/**
 * Fill every default, coerce every type, sort what canonicalisation sorts. TOTAL: it
 * never throws and always returns a complete scene. Whether the result is ACCEPTABLE is
 * validateScene's job — normalize is what makes validation able to assume a shape.
 */
export function normalizeScene(input) {
  const raw = (input && typeof input === 'object') ? input : {};
  const d = DEFAULTS;

  const seen = new Set();
  const structures = [];
  for (const s of (Array.isArray(raw.structures) ? raw.structures : [])) {
    const id = typeof s === 'string' ? s : (s && typeof s.id === 'string' ? s.id : '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    structures.push({ id, role: pick(s && s.role, ROLES, 'primary') });
  }
  structures.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const styleSeen = new Set();
  const styles = [];
  for (const s of (Array.isArray(raw.styles) ? raw.styles : [])) {
    if (!s || typeof s !== 'object' || typeof s.id !== 'string' || styleSeen.has(s.id)) continue;
    styleSeen.add(s.id);
    const out = { id: s.id };
    const em = typeof s.emphasis === 'string' ? (EMPHASIS_ALIAS[s.emphasis] || s.emphasis) : undefined;
    if (em !== undefined) out.emphasis = em;
    if (s.opacity !== undefined) out.opacity = isNum(s.opacity) ? round3(clamp(s.opacity, 0, 1)) : s.opacity;
    styles.push(out);
  }
  styles.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Caller order is PRESERVED for annotations: it is the placement tie-break, so
  // sorting them would silently change where labels land.
  const annotations = [];
  for (const a of (Array.isArray(raw.annotations) ? raw.annotations : [])) {
    if (!a || typeof a !== 'object') continue;
    const type = typeof a.type === 'string' ? (ANNOTATION_ALIAS[a.type] || a.type) : '';
    const out = { type };
    if (typeof a.target === 'string') out.target = a.target;
    if (typeof a.from === 'string') out.from = a.from;
    if (typeof a.to === 'string') out.to = a.to;
    if (typeof a.direction === 'string') out.direction = a.direction;
    const text = cleanText(a.text);
    if (text) out.text = text;
    annotations.push(out);
  }

  const rawRest = (raw.rest && typeof raw.rest === 'object') ? raw.rest : {};
  const rawCam = (raw.camera && typeof raw.camera === 'object') ? raw.camera : {};
  const rawRole = (raw.roleOpacity && typeof raw.roleOpacity === 'object') ? raw.roleOpacity : {};
  const rawCap = (raw.caption && typeof raw.caption === 'object') ? raw.caption : {};
  const rawSize = (raw.size && typeof raw.size === 'object') ? raw.size : {};

  // Framing treats focus as a SET — the camera unions their bounds — so two calls that
  // name the same ids in a different order must produce the same blob and share one
  // cached picture. Deduped and sorted.
  const focusSeen = new Set();
  const focus = [];
  for (const id of (Array.isArray(rawCam.focus) ? rawCam.focus : [])) {
    if (typeof id !== 'string' || focusSeen.has(id)) continue;
    focusSeen.add(id);
    focus.push(id);
  }
  focus.sort();

  const opacity = (v, dflt) => (isNum(v) ? round3(clamp(v, 0, 1)) : dflt);

  return {
    v: isNum(raw.v) ? raw.v : d.v,
    mode: pick(raw.mode, MODES, d.mode),
    lang: pick(raw.lang, LANGS, d.lang),
    structures,
    rest: {
      include: pick(rawRest.include, REST_MODES, d.rest.include),
      opacity: opacity(rawRest.opacity, d.rest.opacity),
    },
    camera: {
      view: pick(rawCam.view, VIEWS, d.camera.view),
      focus,
      padding: isNum(rawCam.padding) ? round3(rawCam.padding) : d.camera.padding,
      explode: opacity(rawCam.explode, d.camera.explode),
      rotate: rawCam.rotate === true,
    },
    roleOpacity: {
      primary: opacity(rawRole.primary, d.roleOpacity.primary),
      context: opacity(rawRole.context, d.roleOpacity.context),
      ghost: opacity(rawRole.ghost, d.roleOpacity.ghost),
    },
    styles,
    annotations,
    caption: {
      title: cleanText(rawCap.title).slice(0, LIMITS.TITLE_MAX),
      note: cleanText(rawCap.note).slice(0, LIMITS.NOTE_MAX),
      place: pick(rawCap.place, ['in', 'out'], d.caption.place),
    },
    background: pick(raw.background, BACKGROUNDS, d.background),
    size: {
      w: isNum(rawSize.w) ? Math.round(rawSize.w) : d.size.w,
      h: isNum(rawSize.h) ? Math.round(rawSize.h) : d.size.h,
    },
    // ABSENT means "the default", not "off". Reading it as off is how a default flips to 0
    // for every caller that simply did not mention the field.
    ss: raw.ss === undefined || raw.ss === null ? d.ss : (raw.ss === 1 || raw.ss === true ? 1 : 0),
  };
}

// ── validate ────────────────────────────────────────────────────────────────

/**
 * Returns an error STRING naming the fix, or null. Every message follows the house style
 * already set in functions/mcp.js: say what is wrong AND what to do instead, because the
 * reader is a language model that will try again immediately.
 */
export function validateScene(scene) {
  const L = LIMITS;
  if (scene.v !== SCENE_V) return `scene version ${scene.v} is not supported by this deployment (expected ${SCENE_V})`;
  if (!scene.structures.length) return 'the scene has no structures — pass at least one atlas id in select';
  if (scene.structures.length > L.MAX_STRUCTURES) {
    return `the scene names ${scene.structures.length} structures; the maximum is ${L.MAX_STRUCTURES}. The viewer highlights a handful of related structures, not a whole system.`;
  }
  for (const s of scene.structures) {
    if (!isId(s.id)) return `not an atlas id: "${String(s.id).slice(0, 40)}" — ids look like FMA22315`;
  }
  const known = new Set(scene.structures.map((s) => s.id));
  for (const id of scene.camera.focus) {
    if (!known.has(id)) {
      return `focus.ids contains "${id}", which is not in select, context or ghost — focus can only frame structures the scene already carries`;
    }
  }
  if (scene.camera.padding < L.PAD_MIN || scene.camera.padding > L.PAD_MAX) {
    return `padding must be between ${L.PAD_MIN.toFixed(1)} and ${L.PAD_MAX.toFixed(1)} — it is a camera DISTANCE multiplier, not a percentage`;
  }
  if (scene.styles.length > L.MAX_STYLES) return `styles has ${scene.styles.length} entries; the maximum is ${L.MAX_STYLES}`;
  for (const s of scene.styles) {
    if (!known.has(s.id)) return `styles targets "${s.id}", which is not in the scene — add it to select, context or ghost first`;
    if (s.emphasis !== undefined && !EMPHASIS.includes(s.emphasis)) {
      return `unknown emphasis "${s.emphasis}" — one of ${EMPHASIS.join(', ')} (normal is accepted as an alias for neutral)`;
    }
    if (s.opacity !== undefined && !isNum(s.opacity)) return `styles["${s.id}"].opacity must be a number between 0 and 1`;
  }
  if (scene.annotations.length > L.MAX_ANNOTATIONS) {
    return `annotations has ${scene.annotations.length} entries; the maximum is ${L.MAX_ANNOTATIONS}`;
  }
  for (let i = 0; i < scene.annotations.length; i++) {
    const a = scene.annotations[i];
    if (!ANNOTATION_TYPES.includes(a.type)) {
      return `annotation ${i} has type "${a.type}" — one of ${ANNOTATION_TYPES.join(', ')} (curved-arrow is an alias for rotation-arrow)`;
    }
    const targets = a.type === 'arrow' ? [a.from, a.to] : [a.target];
    for (const t of targets) {
      if (!t) return `annotation ${i} (${a.type}) is missing its target id`;
      if (!known.has(t)) return `annotation ${i} targets ${t}, which is not in the scene — add it to select or context first`;
    }
    if (a.direction !== undefined && !DIRECTIONS.includes(a.direction)) {
      return `annotation ${i} has direction "${a.direction}" — one of ${DIRECTIONS.join(', ')}`;
    }
    if (a.text && a.text.length > L.MAX_ANNOTATION_TEXT) {
      return `annotation ${i}'s text is ${a.text.length} characters; the maximum is ${L.MAX_ANNOTATION_TEXT} — a label is two or three words`;
    }
  }
  if (scene.size.w < L.W_MIN || scene.size.w > L.W_MAX || scene.size.h < L.H_MIN || scene.size.h > L.H_MAX) {
    return `size ${scene.size.w}x${scene.size.h} is outside ${L.W_MIN}..${L.W_MAX} by ${L.H_MIN}..${L.H_MAX} — the plate IS the page's viewport, and below ${L.W_MIN}x${L.H_MIN} the page switches to its phone layout and frames the subject badly`;
  }
  return null;
}

// ── canonical encode / decode ───────────────────────────────────────────────

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The canonical JSON: keys in a fixed declared order, every default dropped. Two
 * semantically identical scenes therefore serialise byte-identically and share one R2
 * cache entry — which is the only thing that makes a per-request teaching plate
 * affordable on a metered browser allowance.
 */
export function canonicalScene(scene) {
  const d = DEFAULTS;
  const out = {};
  out.v = scene.v;
  if (scene.mode !== d.mode) out.mode = scene.mode;
  if (scene.lang !== d.lang) out.lang = scene.lang;
  // A structure with the default role is emitted as a bare string, which is both shorter
  // and unambiguous — normalizeScene reads either shape.
  out.s = scene.structures.map((s) => (s.role === 'primary' ? s.id : [s.id, s.role]));
  if (!same(scene.rest, d.rest)) out.rest = scene.rest;
  const cam = {};
  if (scene.camera.view !== d.camera.view) cam.view = scene.camera.view;
  if (scene.camera.focus.length) cam.focus = scene.camera.focus;
  if (scene.camera.padding !== d.camera.padding) cam.padding = scene.camera.padding;
  if (scene.camera.explode !== d.camera.explode) cam.explode = scene.camera.explode;
  if (scene.camera.rotate !== d.camera.rotate) cam.rotate = scene.camera.rotate;
  if (Object.keys(cam).length) out.camera = cam;
  if (!same(scene.roleOpacity, d.roleOpacity)) out.roleOpacity = scene.roleOpacity;
  if (scene.styles.length) out.styles = scene.styles;
  if (scene.annotations.length) out.annotations = scene.annotations;
  // CAPTION TEXT ONLY COUNTS WHEN IT IS IN THE PICTURE. `place:'out'` means the words are
  // shown by the chat client, not drawn on the plate — so two calls that differ only in
  // their sentence render the SAME pixels and must share one cached picture. Keeping the
  // text in the key there would silently make every new sentence a fresh metered render,
  // which is precisely what burn_caption:false promises to avoid.
  const cap = {};
  if (scene.caption.place !== d.caption.place) cap.place = scene.caption.place;
  if (scene.caption.place === 'in') {
    if (scene.caption.title) cap.title = scene.caption.title;
    if (scene.caption.note) cap.note = scene.caption.note;
  }
  if (Object.keys(cap).length) out.caption = cap;
  if (scene.background !== d.background) out.background = scene.background;
  if (!same(scene.size, d.size)) out.size = scene.size;
  if (scene.ss !== d.ss) out.ss = scene.ss;
  return JSON.stringify(out);
}

/**
 * normalize -> canonicalise -> base64url. Feed it anything; it returns a stable blob.
 * It normalizes UNCONDITIONALLY: the previous version skipped that step whenever the input
 * carried a `v`, so a versioned-but-otherwise-raw object bypassed sorting and defaulting and
 * threw on the first missing sub-object. normalizeScene is idempotent, so re-running it on
 * an already-normalized scene costs one pass and cannot change the result.
 */
export function encodeScene(scene) {
  return b64urlEncode(canonicalScene(normalizeScene(scene)));
}

/**
 * A blob back into a full scene, or NULL for anything that is not one. Never throws:
 * a corrupt or hostile `scene=` in a URL must degrade to "no scene", not to a broken page.
 */
export function decodeScene(blob) {
  if (typeof blob !== 'string' || !blob || blob.length > LIMITS.SCENE_MAX_B64) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(blob)) return null;
  let parsed;
  try {
    parsed = JSON.parse(b64urlDecode(blob));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (parsed.v !== SCENE_V) return null;
  // `s` is the wire spelling of `structures`; accept both so a hand-written scene works.
  const structures = Array.isArray(parsed.s)
    ? parsed.s.map((e) => (Array.isArray(e) ? { id: e[0], role: e[1] } : { id: e, role: 'primary' }))
    : parsed.structures;
  const scene = normalizeScene({ ...parsed, structures });
  return scene.structures.length ? scene : null;
}

// ── resolution: role + styles -> what the GPU is told ───────────────────────

/**
 * The opacity each named structure is drawn at. Resolution order is
 * `styles[id].opacity` then the role's opacity — the AI never sends RGB or per-part
 * numbers, it sends ROLES, and the frontend owns the design system (PRD section 6).
 * 0 means NOT DRAWN and is routed through the visibility lane, never through alpha 0.
 */
export function structureOpacity(scene) {
  const byStyle = new Map(scene.styles.map((s) => [s.id, s]));
  const out = {};
  for (const s of scene.structures) {
    const st = byStyle.get(s.id);
    out[s.id] = (st && typeof st.opacity === 'number') ? st.opacity : scene.roleOpacity[s.role];
  }
  return out;
}

/**
 * THE `select=` CONTRACT, and it is load-bearing in a way that is easy to miss.
 *
 * The renderer waits for `document.documentElement.dataset.atlasSelected` to equal the
 * `select=` parameter EXACTLY (workers/snap/src/index.mjs). The page sets that marker
 * from `picks`, which is what it parsed out of `select=`, deduped in order. So this
 * function must return every structure the scene names, in the SAME order the canonical
 * blob names them — canonical order, which is sorted by id. Any disagreement in
 * membership or order makes every render miss the exact wait, fall through to the loose
 * "some id overlaps" check, and screenshot a tab that may still be showing the previous
 * request — the precise failure the exact wait was written to prevent.
 */
export function sceneSelectIds(scene) {
  return scene.structures.map((s) => s.id);
}

export const sceneFits = (blob) => blob.length <= LIMITS.SCENE_MAX_B64;
