/**
 * /v2/ — the redesigned entry, ALONGSIDE v1 (Adrian's ruling 1, README.md:41).
 *
 * v1 (`app/page.tsx`) is untouched and stays the default. This file shares the engine
 * (`app/scene.tsx`), the codec, the selection helpers, the dictionaries and `/mcp`; it does not
 * import v1's page or v1's stylesheet, so nothing here can change what `/` does.
 *
 * WHAT THIS SLICE IS FOR: the loop Adrian actually uses — a `render_anatomy` link opened on a
 * phone, from ChatGPT. Four measured defects shape the whole layout:
 *
 *  1. THE PAGE SAID NOTHING FOR 20 SECONDS. v1 applies the scene only after atlas.json arrives
 *     (page.tsx:203). The scene blob decodes with NO network at all, so the title, the note and
 *     one notch per named structure are painted from the URL in the first frame, and never move
 *     afterwards — the layout is fixed before any model byte, which is what makes CLS 0 a
 *     designable property rather than a hope.
 *  2. THE SUBJECT WAS 1.6% OF A PHONE FRAME (audit-current.md:66). Not a camera bug: v1
 *     measures the open detail sheet and the dock with getBoundingClientRect and hands the fit
 *     224 px of 844. Here the field is a CSS-GRID CELL and the fit gets a static inset, so the
 *     camera frames the space that is actually free.
 *  3. THE SCENE'S OWN CHUNKS ARRIVED LAST. Scene-first order plus a phase barrier; see
 *     `scene.tsx` chunkPhases. `data-atlas-ready` still means all 15 chunks.
 *  4. THE PROGRESS LINE COUNTED TWO DIFFERENT THINGS ('{p}% · Loading 2,234 pieces'). This one
 *     counts BYTES, read from PerformanceResourceTiming, and says MB.
 *
 * Reserved, not built: `window.atlas` (the Realtime voice surface) and `?stage=1` (the L32
 * display client). Surfaces only — no microphone, no camera, no WebSocket.
 */
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import AnatomyScene from '../scene';
import {DEFAULT_VISIBLE,SYSTEMS,explanation,type Atlas,type Concept,type SceneState,type SystemId,type View} from '../anatomy';
import {addPick,dedupe,removePick,resolvePicks,sameIds,unionElements,type Pick} from '../selection';
import {LANGS,LANG_LABELS,isLang,type Lang} from '../i18n/ui';
import {loadZhDicts,makeT,searchKeys,type Dicts} from '../i18n/dict';
import {encodeScene,sceneFocusId,sceneFrameIds,sceneOpacities,sceneSelectIds,type Role,type Scene} from '../scene-model';
import {markError,markReady,markScene,markSceneReady,markSelected,markSettled,readUrlState,setModes,writeUrlState} from '../url-state';
import {v2t} from './copy';
import {emitAtlas,installAtlasTools,type AtlasState} from './tools';
import {mark,postProbe,readProbe,watchLayoutShift} from './probe';

/** THE STATIC SAFE INSET, in CSS pixels. A CONSTANT, never a DOM measurement — the critic's
 *  ruling (build-plan.md:127) and the whole point of item 2 above. Its table collapses to one
 *  uniform pad here because the field genuinely is its own grid cell: the header, the rail and
 *  the margin are SIBLING cells, not overlays, so there is no chrome above the canvas to
 *  subtract. Only the visual breathing room remains. */
const FIELD_INSET = {top: 14, right: 14, bottom: 14, left: 14};
/** Rail overflow. Beyond this the tail collapses into one '+n' notch that opens the set in the
 *  margin — the rail is role-ordered, so the primaries are always the ones that stay visible.
 *  15 x 44 px = 660 px, which still fits the field band on a 390x844 phone. */
const RAIL_MAX = 15;
const ROLE_ORDER: Record<Role, number> = {primary: 0, context: 1, ghost: 2};
const NO_IDS: string[] = [];
const MB = (n: number) => (n / 1048576).toFixed(1);

const baseState: SceneState = {explode: 0, visible: DEFAULT_VISIBLE, selected: [], isolate: false, view: 'three-quarter', rotate: false, reset: 0, insets: FIELD_INSET};

export default function V2() {
 // READ THE URL SYNCHRONOUSLY, BEFORE THE FIRST PAINT. `decodeScene` is pure and needs no
 // network, so everything the link declared — title, note, structures, roles, language — is
 // available in the initial render. This is the single most load-bearing line in the file.
 const [url] = useState(() => readUrlState());
 const [scene, setScene] = useState<Scene | null>(url.scene ?? null);
 const [sceneBlob, setSceneBlob] = useState<string>(url.sceneBlob ?? '');
 const [caption, setCaption] = useState<{title?: string; note?: string}>(() => {
  const sc = url.scene;
  if (sc) return {title: sc.caption.place === 'in' ? sc.caption.title : undefined, note: sc.caption.place === 'in' ? sc.caption.note : undefined};
  return {title: url.title, note: url.note};
 });
 const [lang, setLang] = useState<Lang>(() => {
  if (url.lang) return url.lang;
  let stored: string | null = null;
  try { stored = localStorage.getItem('atlas.lang'); } catch { /* private browsing */ }
  return isLang(stored) ? stored : 'en';
 });
 const [dicts, setDicts] = useState<Dicts>({});
 const t = useMemo(() => makeT(lang, dicts[lang]), [lang, dicts]);
 const tr = useCallback((k: string, v?: Record<string, string | number>) => v2t(lang, k, v), [lang]);

 const [atlas, setAtlas] = useState<Atlas | null>(null);
 const [error, setError] = useState('');
 const [expired, setExpired] = useState(false);
 const [state, setState] = useState<SceneState>(baseState);
 const [picks, setPicks] = useState<string[]>(() => (url.scene ? sceneSelectIds(url.scene) : url.select ?? NO_IDS));
 const [focusId, setFocusId] = useState<string | null>(() => (url.scene ? sceneFocusId(url.scene) : null));
 const [phase, setPhase] = useState<'boot' | 'scene' | 'atlas'>('boot');
 const [bytes, setBytes] = useState({done: 0, total: 0});
 const [detent, setDetent] = useState<'peek' | 'half'>('peek');
 const [panel, setPanel] = useState<'none' | 'search' | 'systems'>('none');
 const [query, setQuery] = useState('');
 const [stage, setStage] = useState(() => {
  const p = new URLSearchParams(location.search.replace(/^\?/, ''));
  return p.get('stage') === '1';
 });
 const probeMode = useMemo(() => new URLSearchParams(location.search.replace(/^\?/, '')).get('probe') === '1', []);
 const [probeOut, setProbeOut] = useState<string>('');

 // THE PRIORITY SET, frozen at mount from the URL and never re-derived. Handing the loader
 // React selection state would race: the scene component mounts as soon as the atlas arrives,
 // which is before any selection effect has run, so the queue would prioritise an empty set
 // (astra-ux-astra.md:206). This is the resolved requirement, passed explicitly.
 const priority = useMemo(() => (url.scene ? sceneSelectIds(url.scene) : url.select ?? NO_IDS), [url]);

 useEffect(() => { watchLayoutShift(); mark('boot'); }, []);
 useEffect(() => {
  document.documentElement.lang = lang;
  document.body.classList.toggle('v2-stage', stage);
  if (lang !== 'en') void loadZhDicts().then(setDicts);
 }, [lang, stage]);

 /** The scene decides the ground; there is no theme toggle. Adrian's ruling 4 makes LIGHT the
  *  default for both the app and the plate, so `background:'dark'` becomes an opt-in a scene
  *  can still ask for rather than the app's identity. */
 const background = scene?.background ?? 'light';
 useEffect(() => { document.body.dataset.ground = background; }, [background]);

 // ─── the atlas ────────────────────────────────────────────────────────────────────────────
 useEffect(() => {
  const abort = new AbortController();
  fetch('/models/atlas.json', {signal: abort.signal}).then((r) => {
   // A mid-load Access expiry is NORMAL at a 24 h session, and it arrives as a REDIRECT to a
   // login page carrying HTTP 200, not as an error — so the status cannot detect it.
   // `r.redirected` is the only signal that actually means "you were sent to the gate".
   // A non-JSON body or a 5xx is a SERVER problem and gets the generic error: the first version
   // routed both to the session-expired surface, which told the reader to log in again for an
   // outage he cannot fix that way (adversarial review, 2026-09-07).
   if (r.redirected) throw new Error('session');
   if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) throw new Error('load');
   return r.json();
  }).then((d) => setAtlas(d as Atlas)).catch((e) => {
   if (e.name === 'AbortError') return;
   markError('atlas');
   if (String(e.message) === 'session') setExpired(true); else setError(tr('error.load'));
  });
  return () => abort.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 const parts = useMemo(() => new Map(atlas?.parts.map((p) => [p.id, p])), [atlas]);
 const conceptsById = useMemo(() => new Map(atlas?.concepts.map((c) => [c.id, c])), [atlas]);
 const counts = useMemo(() => Object.fromEntries(SYSTEMS.map((s) => [s.id, atlas?.parts.filter((p) => p.system === s.id).length ?? 0])), [atlas]);
 const basket = useMemo(() => resolvePicks(conceptsById, parts, picks), [conceptsById, parts, picks]);
 const focused = useMemo(() => basket.find((p) => p.id === focusId) ?? basket[0] ?? null, [basket, focusId]);
 const focusedParts = useMemo(() => (focused ? focused.elements.map((id) => parts.get(id)).filter((p) => !!p) : []), [focused, parts]);
 const systemId = focused?.system ?? focusedParts[0]?.system;
 const system = SYSTEMS.find((s) => s.id === systemId);

 useEffect(() => { if (!atlas) return; const union = unionElements(basket); setState((s) => (sameIds(s.selected, union) ? s : {...s, selected: union})); }, [atlas, basket]);
 useEffect(() => { markSelected(picks); }, [picks]);
 useEffect(() => { if (scene) markScene(sceneBlob || encodeScene(scene)); }, [scene, sceneBlob]);
 useEffect(() => { setModes(false, false); markSettled(false); markError(''); }, []);
 useEffect(() => { if (!atlas) return; const timer = setTimeout(() => writeUrlState(state, picks, caption, lang), 200); return () => clearTimeout(timer); }, [atlas, state, picks, caption, lang]);

 // ─── the roles → what the renderer draws ──────────────────────────────────────────────────
 const plate = useMemo(() => {
  if (!scene) return null;
  const {structures: alpha, rest} = sceneOpacities(scene) as {render: boolean; structures: Record<string, number>; rest: number};
  const roleOf = new Map(scene.structures.map((s) => [s.id, s.role]));
  const wantFocus = new Set(scene.camera.focus);
  const wantFrame = new Set(sceneFrameIds(scene));
  const opacity: Record<string, number> = {}, focus: string[] = [], frame: string[] = [], primary: string[] = [];
  for (const p of basket) {
   const a = alpha[p.id];
   for (const el of p.elements) {
    if (wantFrame.has(p.id)) frame.push(el);
    if (a !== undefined) opacity[el] = Math.max(opacity[el] ?? 0, a);
    if (roleOf.get(p.id) === 'primary' || !roleOf.has(p.id)) primary.push(el);
    if (wantFocus.has(p.id)) focus.push(el);
   }
  }
  return {opacity, focus, frame, primary, focusPadding: scene.camera.padding, restOpacity: rest, render: false, background: scene.background, ss: 0};
 }, [scene, basket]);

 // ─── the rail: role-ordered, capped, and the loading skeleton ─────────────────────────────
 /** One notch per structure the LINK named, available before the atlas because it comes out of
  *  the blob. Role-first so a cap can never hide a primary; id order inside a band, which is
  *  the codec's canonical order and therefore stable across re-encodes. */
 const railAll = useMemo(() => {
  if (scene) return [...scene.structures].sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.id.localeCompare(b.id)).map((s) => ({id: s.id, role: s.role}));
  return picks.map((id) => ({id, role: 'primary' as Role}));
 }, [scene, picks]);
 const rail = railAll.slice(0, RAIL_MAX);
 const railOverflow = railAll.length - rail.length;

 // ─── loading: BYTES, read from the platform, not inferred from a chunk count ──────────────
 const totalBytes = useMemo(() => (atlas ? atlas.chunks.reduce((n, c) => n + (c.gzipBytes ?? c.bytes), 0) : 0), [atlas]);
 /** Model bytes that had FINISHED by `cutoff` (default: now). The cut-off is what makes the
  *  barrier number deterministic — see the `armedAt` note on AnatomyScene's onSceneReady. */
 const modelBytes = (cutoff = Infinity) => {
  let done = 0, requests = 0;
  for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
   if (!e.name.includes('/models/body-')) continue;
   if (e.responseEnd > cutoff) continue;
   done += e.encodedBodySize || e.transferSize || 0; requests += 1;
  }
  return {done, requests};
 };
 const sampleBytes = useCallback(() => { setBytes({done: modelBytes().done, total: totalBytes}); }, [totalBytes]);

 const onProgress = useCallback((n: number) => {
  if (n > 0) mark('firstChunk');
  sampleBytes();
  if (n === 100) {
   mark('atlasReady');
   setError('');
   markReady();
   setPhase('atlas');
   emitAtlas({type: 'ready', ms: Math.round(performance.now())});
  }
 }, [sampleBytes]);

 const onSceneReady = useCallback((armedAt: number) => {
  mark('sceneReady');
  // FREEZE THE BYTE COUNT AT THE BARRIER, in the DOM, before anything can await.
  // The first oracle run read the byte total AFTER waiting for the marker and got 15.7 MB / 7
  // chunks on the wider viewports and 9.05 MB / 4 on the phone — the SAME page, so the spread
  // was the instrument, not the app: background chunks keep arriving during the wait and the
  // evaluate. The number that means anything is the one at the barrier; a reader that has to
  // race for it will quietly report a different figure on a faster machine.
  const b = modelBytes(armedAt);
  document.documentElement.dataset.atlasSceneBytes = String(b.done);
  document.documentElement.dataset.atlasSceneRequests = String(b.requests);
  markSceneReady(true);
  setPhase((p) => (p === 'atlas' ? p : 'scene'));
  sampleBytes();
  emitAtlas({type: 'scene-ready', ms: Math.round(performance.now())});
 }, [sampleBytes]);

 // ─── selection ────────────────────────────────────────────────────────────────────────────
 const known = useCallback((id: string) => conceptsById.has(id) || parts.has(id), [conceptsById, parts]);
 const replacePicks = useCallback((ids: readonly string[], focus?: string | null) => {
  const next = dedupe(ids).filter(known);
  if (!next.length) return false;
  setPicks(next); setFocusId(focus ?? null); setPanel('none'); setDetent('half');
  setState((s) => ({...s, isolate: false, rotate: false, reset: s.reset + 1}));
  emitAtlas({type: 'select', ids: next});
  return true;
 }, [known]);
 const addToPicks = useCallback((id: string) => { if (!known(id)) return; setPicks((p) => addPick(p, id)); setFocusId(id); setDetent('half'); }, [known]);
 const focusPick = useCallback((id: string) => {
  setFocusId(id); setDetent('half'); setPanel('none');
  setState((s) => ({...s, reset: s.reset + 1, rotate: false}));
  emitAtlas({type: 'focus', id});
 }, []);
 const clearPicks = () => { setPicks(NO_IDS); setFocusId(null); setState((s) => ({...s, isolate: false})); };

 const results = useMemo(() => {
  if (!atlas) return [] as Concept[];
  const term = query.toLowerCase().trim();
  if (!term) return [];
  return atlas.concepts.filter((c) => searchKeys(c.id, c.name, dicts).some((k) => k.includes(term)))
   .sort((a, b) => t.name(a.id, a.name).length - t.name(b.id, b.name).length || a.name.length - b.name.length).slice(0, 40);
 }, [atlas, query, dicts, t]);

 const applyLang = (next: Lang) => {
  setLang(next);
  try { localStorage.setItem('atlas.lang', next); } catch { /* ignore */ }
  emitAtlas({type: 'lang', lang: next});
 };

 // ─── the reserved local tool surface ──────────────────────────────────────────────────────
 const live = useRef({scene, sceneBlob, picks, focusId, lang, state, phase, bytes, stage, focused, t, plate});
 live.current = {scene, sceneBlob, picks, focusId, lang, state, phase, bytes, stage, focused, t, plate};
 useEffect(() => installAtlasTools({
  applyScene: (input) => {
   // Accept a bare blob or any URL/query carrying `scene=`. A hash write re-drives the page
   // with no reload, which is the same door the snapshot renderer already uses.
   // Parse properly. The first version split on '?' then on '#', so
   // `https://host/v2/?scene=abc#foo` yielded 'foo' and the blob was silently lost — every URL
   // with BOTH a query and a fragment (review item 5).
   let blob = input;
   if (input.includes('scene=')) {
    try {
     const u = new URL(input, location.href);
     blob = u.searchParams.get('scene') ?? new URLSearchParams(u.hash.replace(/^#/, '')).get('scene') ?? '';
    } catch { blob = new URLSearchParams(input.replace(/^[#?]/, '')).get('scene') ?? ''; }
   }
   if (!blob) return false;
   location.hash = `scene=${blob}`;
   return true;
  },
  focus: (ids) => { const id = ids.find((x) => live.current.picks.includes(x)); if (!id) return false; focusPick(id); return true; },
  plate: () => {
   const blob = live.current.sceneBlob || (live.current.scene ? encodeScene(live.current.scene) : '');
   const ids = live.current.picks;
   return {blob, ids, url: `${location.origin}/api/snap?select=${ids.join(',')}${blob ? `&scene=${blob}` : ''}&snap=1`};
  },
  state: (): AtlasState => {
   const l = live.current;
   return {
    blob: l.sceneBlob, ids: l.picks, focus: l.focusId ?? l.focused?.id ?? null,
    name: l.focused ? l.t.name(l.focused.id, l.focused.name) : null,
    nameEn: l.focused?.name ?? null,
    lang: l.lang, view: l.state.view, stage: l.stage, phase: l.phase, bytes: l.bytes,
    // Introspection the oracles read instead of scraping the DOM for something the DOM does not
    // say: how many MESHES the camera is being asked to look at and to contain. A framing
    // failure is either "the fit is wrong" or "the fit was never given anything", and only this
    // tells them apart.
    framing: {focus: l.plate?.focus.length ?? 0, frame: l.plate?.frame.length ?? 0, isolate: l.state.isolate},
   };
  },
 }), [focusPick]);

 /**
  * THE SCENE'S CAMERA, applied ONCE the atlas exists — and this was a real defect, caught by
  * LOOKING at the 390x844 screenshot rather than by any oracle.
  *
  * The blob carries `camera.view:'side'` and `rest.include:'none'` (⇒ isolate). The first
  * version of this file applied them only on a hashchange re-drive, so a cold chat link — the
  * one loop this whole slice exists for — opened on a THREE-QUARTER view of the whole body
  * instead of a side view of the isolated hamstrings. Every oracle passed: the title named the
  * primary, the framing filled 70% of the field, the bytes were right. Framing is not the same
  * question as ANGLE, and "the subject is big" is not the same claim as "this is the picture the
  * link asked for". Recorded because it is exactly the false green the P0 gate asked about.
  */
 const applySceneState = useCallback((sc: Scene, blob: string, redrive: boolean) => {
  setScene(sc); setSceneBlob(blob);
  setCaption({title: sc.caption.place === 'in' ? sc.caption.title : undefined, note: sc.caption.place === 'in' ? sc.caption.note : undefined});
  if (sc.lang) applyLang(sc.lang);
  const ids = sceneSelectIds(sc), focus = sceneFocusId(sc);
  if (redrive) replacePicks(ids, focus); else { setPicks(ids.filter(known)); setFocusId(focus); }
  setState((s) => ({...s,
   view: sc.camera.view, explode: sc.camera.explode, rotate: sc.camera.rotate,
   // `rest:'none'` is today's isolate exactly — the same mapping v1 makes at page.tsx:149 — so
   // every P1-P3 deep link keeps meaning what it meant.
   isolate: sc.rest.include === 'none',
   visible: sc.rest.include === 'skeletal' ? ['skeletal'] : s.visible,
   reset: s.reset + 1}));
  emitAtlas({type: 'scene', blob, ids, focus});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [known]);

 const sceneApplied = useRef(false);
 useEffect(() => {
  if (!atlas || sceneApplied.current) return;
  sceneApplied.current = true;
  if (scene) applySceneState(scene, sceneBlob || encodeScene(scene), false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [atlas]);

 // ─── re-drive on hashchange (the renderer's door, and window.atlas.applyScene's) ───────────
 useEffect(() => {
  if (!atlas) return;
  const reapply = () => {
   const u = readUrlState();
   markSettled(false); markSceneReady(false);
   if (!u.scene) return;
   applySceneState(u.scene, u.sceneBlob ?? encodeScene(u.scene), true);
   // A RE-DRIVE MAY NAME CHUNKS THAT ARE STILL IN THE BACKGROUND QUEUE. The priority set is
   // frozen at mount, so a second scene gets no barrier of its own — and re-publishing
   // readiness at phase 'scene' would assert that meshes still downloading are on screen
   // (adversarial review item 1, the only High). Only the ATLAS phase can honestly claim it,
   // because then every chunk is in by definition.
   markSceneReady(phase === 'atlas');
  };
  window.addEventListener('hashchange', reapply);
  return () => window.removeEventListener('hashchange', reapply);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [atlas, phase, applySceneState]);

 // ─── the probe ────────────────────────────────────────────────────────────────────────────
 useEffect(() => {
  if (!probeMode || phase === 'boot') return;
  // Read AFTER the barrier so the byte cut-off is real, and once only.
  const timer = setTimeout(async () => {
   const reading = readProbe('l31v2', (sceneBlob || '').slice(0, 16));
   const echo = await postProbe(reading);
   setProbeOut(JSON.stringify({reading, server: echo}, null, 1));
  }, 400);
  return () => clearTimeout(timer);
 }, [probeMode, phase, sceneBlob]);

 const describe = (name: string | undefined, sys: SystemId | undefined) => (name && sys ? explanation(name, sys) : '');
 const nameOf = (id: string) => {
  const p = basket.find((b) => b.id === id);
  if (p) return t.name(p.id, p.name);
  const c = conceptsById.get(id);
  return c ? t.name(c.id, c.name) : id;
 };
 const colorOf = (id: string) => {
  const p = basket.find((b) => b.id === id);
  return SYSTEMS.find((s) => s.id === p?.system)?.color ?? 'var(--v2-notch-idle)';
 };

 const loading = phase === 'boot' || (phase === 'scene' && bytes.total > 0);
 const title = caption.title || (focused ? t.name(focused.id, focused.name) : '');

 return <main className="v2" data-phase={phase} data-detent={detent} data-ground={background}>
  {/* THE HEADER IS PAINTED FROM THE URL, IN THE FIRST FRAME. It never resizes afterwards:
      its height is fixed in CSS, so the title arriving, the name arriving and the model
      arriving all land inside a box that was already there. That is CLS 0 by construction
      rather than by measurement. */}
  <header className="v2-head">
   <div className="v2-head-text">
    <h1 title={title}>{title || v2t(lang, 'app.title')}</h1>
    {caption.note && <p className="v2-note">{caption.note}</p>}
   </div>
   <div className="v2-lang" role="group" aria-label={tr('lang.aria')}>
    {LANGS.map((l) => <button type="button" key={l} lang={l} className={lang === l ? 'is-on' : ''} aria-pressed={lang === l} onClick={() => applyLang(l)}>{LANG_LABELS[l]}</button>)}
   </div>
  </header>

  <div className="v2-field">
   {atlas && <AnatomyScene
    atlas={atlas}
    state={{...state, ...(plate ?? {}), insets: FIELD_INSET}}
    priority={priority}
    onSceneReady={onSceneReady}
    onSelect={(id, add) => { if (add) addToPicks(id); else replacePicks([id], id); }}
    onProgress={onProgress}
    // A REJECTED CHUNK MUST LEAVE THE BOOT STATE. `onSceneReady` never fires on a failed phase,
    // so without this the page kept its loading pill and never painted the error (review item 3).
    // Phase is advanced, NOT the readiness marker: `data-atlas-scene-ready` would be a lie.
    onError={(e) => { markError('load'); setError(e); setPhase((p) => (p === 'boot' ? 'scene' : p)); }}
   />}
   {/* THE ONE ORCHESTRATED MOMENT: the field's paper ground carries a soft wash while the
       scene's own chunks are still arriving, and cross-dissolves away at the barrier. There is
       no poster to dissolve FROM — the `/i/` plate route does not exist and Browser Rendering
       is rate-limited on this account — so the honest version of the transition is this one,
       and the poster hand-off stays specified rather than faked. */}
   <div className="v2-wash" data-on={phase === 'boot' ? '1' : '0'} aria-hidden="true"/>
   {loading && !error && !expired && <div className="v2-progress" role="status">
    <span>{phase === 'boot' ? tr('entry.loading') : tr('entry.sceneReady')}</span>
    {bytes.total > 0 && <b>{tr('entry.bytes', {done: MB(bytes.done), total: MB(bytes.total)})}</b>}
   </div>}
   {expired && <button type="button" className="v2-recover" onClick={() => location.reload()}>{tr('error.session')}</button>}
   {error && !expired && <div className="v2-recover" role="alert">{error} <button type="button" onClick={() => location.reload()}>{tr('error.reload')}</button></div>}
   {stage && <button type="button" className="v2-stage-exit" onClick={() => setStage(false)}>{tr('stage.exit')}</button>}
   {stage && focused && <div className="v2-stage-name"><b>{t.name(focused.id, focused.name)}</b><i>{t.secondary(focused.id, focused.name) || focused.name}</i></div>}
  </div>

  {/* THE RAIL — the set, the focus control, the contents and the loading skeleton, all one
      44 px column. Names arrive with the atlas; the NOTCHES arrive with the URL, so the
      skeleton is the finished component with its labels missing, not a placeholder that gets
      replaced (and therefore not a layout shift). */}
  <nav className="v2-rail" aria-label={tr('rail.aria')} role="listbox" aria-orientation="vertical">
   {rail.map((n) => <button
     type="button" key={n.id} role="option" aria-selected={focused?.id === n.id}
     className={`v2-notch role-${n.role} ${focused?.id === n.id ? 'is-on' : ''} ${atlas ? '' : 'is-skeleton'}`}
     style={{'--notch': colorOf(n.id)} as React.CSSProperties}
     aria-label={tr('rail.focus', {name: atlas ? nameOf(n.id) : n.id})}
     title={atlas ? nameOf(n.id) : n.id}
     onClick={() => focusPick(n.id)}
    ><i/></button>)}
   {railOverflow > 0 && <button type="button" className="v2-notch is-more" onClick={() => { setDetent('half'); setPanel('none'); }} aria-label={tr('rail.more', {n: railOverflow})}>+{railOverflow}</button>}
  </nav>

  {/* THE MARGIN — two detents on a phone. PEEK is what a chat link opens on: the term pair and
      one line, so the figure keeps the screen. Everything else is one drag or one tap away. */}
  <section className="v2-margin" aria-label={tr('margin.aria')}>
   <button type="button" className="v2-handle" onClick={() => setDetent((d) => (d === 'peek' ? 'half' : 'peek'))} aria-expanded={detent === 'half'}>
    <i/><span className="sr-only">{detent === 'peek' ? tr('margin.expand') : tr('margin.collapse')}</span>
   </button>

   <div className="v2-term">
    <span className="v2-dot" style={{background: system?.color ?? 'transparent'}}/>
    <div>
     <b>{focused ? t.name(focused.id, focused.name) : ' '}</b>
     <i>{focused ? (t.secondary(focused.id, focused.name) || focused.name) : ' '}</i>
    </div>
   </div>

   <div className="v2-margin-scroll">
    <div className="v2-actions">
     <button type="button" className={panel === 'search' ? 'is-on' : ''} onClick={() => { setPanel((p) => (p === 'search' ? 'none' : 'search')); setDetent('half'); }}>{tr('search.open')}</button>
     <button type="button" className={panel === 'systems' ? 'is-on' : ''} onClick={() => { setPanel((p) => (p === 'systems' ? 'none' : 'systems')); setDetent('half'); }}>{tr('systems.open')}</button>
     <button type="button" onClick={() => setState((s) => ({...s, view: 'three-quarter', explode: 0, rotate: false, reset: s.reset + 1}))}>{tr('view.reset')}</button>
    </div>

    <div className="v2-views" role="group">
     {(['three-quarter', 'front', 'side', 'back'] as View[]).map((v) => <button
      type="button" key={v} aria-pressed={state.view === v} className={state.view === v ? 'is-on' : ''}
      onClick={() => setState((s) => ({...s, view: v, reset: s.reset + 1, rotate: false}))}>{tr(`view.${v}`)}</button>)}
    </div>

    {/* THE DESCRIPTION SITS BELOW THE CONTROLS, and that ordering is the CLS fix rather than a
        taste call: it only exists once the atlas has resolved the focused structure, so anything
        rendered beneath it is pushed down when it arrives. Measured at 1440x900 — 0.0025, named
        by the observer as div.v2-actions and div.v2-views, i.e. exactly the two rows that used
        to follow it. */}
    {focused && <p className="v2-desc">{describe(focused.name, systemId)}</p>}

    {panel === 'search' && <div className="v2-search">
     <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={tr('search.placeholder')} aria-label={tr('search.open')} autoFocus/>
     <ul>
      {results.map((c) => <li key={c.id}>
       <button type="button" className="v2-result" onClick={() => replacePicks([c.id], c.id)}>
        <span>{t.name(c.id, c.name)}</span>
        {t.secondary(c.id, c.name) && <i>{t.secondary(c.id, c.name)}</i>}
       </button>
       <button type="button" className="v2-plus" aria-label={tr('search.add', {name: t.name(c.id, c.name)})} onClick={() => addToPicks(c.id)}>+</button>
      </li>)}
      {query && !results.length && <li className="v2-empty">{tr('search.empty')}</li>}
     </ul>
    </div>}

    {panel === 'systems' && <div className="v2-systems">
     {SYSTEMS.filter((s) => counts[s.id] > 0).map((s) => <label key={s.id} className={state.visible.includes(s.id) ? 'is-on' : ''}>
      <input type="checkbox" checked={state.visible.includes(s.id)} onChange={() => setState((st) => ({...st, isolate: false, visible: st.visible.includes(s.id) ? st.visible.filter((x) => x !== s.id) : [...st.visible, s.id]}))}/>
      <span className="v2-box" aria-hidden="true"/>
      <span className="v2-dot" style={{background: s.color}}/>
      <span>{t.system(s.id, s.name)}</span>
      <b>{counts[s.id]}</b>
     </label>)}
    </div>}

    {panel === 'none' && basket.length > 0 && <div className="v2-set">
     <h2>{tr('margin.set')}</h2>
     {basket.map((p) => <div key={p.id} className={`v2-row ${focused?.id === p.id ? 'is-on' : ''}`}>
      <button type="button" className="v2-row-name" onClick={() => focusPick(p.id)}>
       <span className="v2-dot" style={{background: SYSTEMS.find((s) => s.id === p.system)?.color ?? '#9aa3ab'}}/>
       <span><b>{t.name(p.id, p.name)}</b>{t.secondary(p.id, p.name) && <i>{t.secondary(p.id, p.name)}</i>}</span>
       <em>{p.elements.length}</em>
      </button>
      <button type="button" className="v2-row-x" aria-label={`${tr('margin.clear')} ${t.name(p.id, p.name)}`} onClick={() => setPicks((ids) => removePick(ids, p.id))}>×</button>
     </div>)}
     <div className="v2-set-foot">
      <label className={state.isolate ? 'is-on' : ''}>
       <input type="checkbox" checked={state.isolate} onChange={() => setState((s) => ({...s, isolate: !s.isolate, explode: 0}))}/>
       <span className="v2-box" aria-hidden="true"/>
       <span>{tr('margin.hideOthers')}</span>
      </label>
      <span className="v2-count">{tr('margin.pieces', {n: state.selected.length.toLocaleString()})}</span>
      <button type="button" onClick={clearPicks}>{tr('margin.clear')}</button>
     </div>
    </div>}

    {focused && <div className="v2-meta">
     <span>{tr('margin.reference')} <b>{focused.conceptId}</b></span>
     <a href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">{tr('margin.source')}</a>
    </div>}

    {probeMode && <pre className="v2-probe" aria-label="timing probe">{probeOut || 'measuring…'}</pre>}
   </div>
  </section>
 </main>;
}
