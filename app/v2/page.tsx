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
import {dedupe,resolvePicks,sameIds,unionElements} from '../selection';
import {LANGS,LANG_LABELS,isLang,type Lang} from '../i18n/ui';
import {loadZhDicts,makeT,searchKeys,type Dicts} from '../i18n/dict';
import {encodeScene,sceneFocusId,sceneFrameIds,sceneOpacities,sceneSelectIds,type Role,type Scene} from '../scene-model';
import {markError,markReady,markScene,markSceneReady,markSelected,markSettled,readUrlState,setModes,writeUrlState} from '../url-state';
import {v2t} from './copy';
import {initialState, reduce, type Command, type V2State} from './controller';
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
/** The four named views, as a runtime list — `window.atlas.setView` takes an arbitrary string from
 *  a caller this page does not control, so it needs a value check the TYPE cannot give it. */
const VIEW_NAMES: View[] = ['three-quarter', 'front', 'side', 'back'];
const MB = (n: number) => (n / 1048576).toFixed(1);

const baseState: SceneState = {explode: 0, visible: DEFAULT_VISIBLE, selected: [], isolate: false, view: 'three-quarter', rotate: false, reset: 0, insets: FIELD_INSET};

export default function V2() {
 // READ THE URL SYNCHRONOUSLY, BEFORE THE FIRST PAINT. `decodeScene` is pure and needs no
 // network, so everything the link declared — title, note, structures, roles, language — is
 // available in the initial render. This is the single most load-bearing line in the file.
 const [url] = useState(() => readUrlState());
 /**
  * ONE OWNER. `scene`, `blob`, `picks`, `focusId` and the render state used to be five independent
  * `useState`s that drifted apart the moment anything was edited (codex-app-review.md §1). They are
  * now one value produced by one pure reducer — `app/v2/controller.ts` — and everything below is a
  * DERIVED VIEW of it: the rail, the basket, the renderer's props, the URL and `atlas.plate()`.
  */
 // SEEDED THROUGH THE CONTROLLER, not around it. Building this inline was the one committing path
 // that never met a gate — see `initialState` for the partial application codex executed.
 const [seed] = useState(() => initialState(url, baseState));
 const [ctl, setCtl] = useState<V2State>(seed.state);
 const {scene, blob: sceneBlob, picks, focusId, render: state} = ctl;
 /** The caption a NON-scene page shows. In scene mode the caption lives in the scene and is derived
  *  below, so there is no second copy to fall out of step with an edit. */
 const [legacyCaption, setLegacyCaption] = useState<{title?: string; note?: string}>(() => ({title: url.title, note: url.note}));
 const caption = useMemo(() => {
  if (!scene) return legacyCaption;
  return scene.caption.place === 'in' ? {title: scene.caption.title, note: scene.caption.note} : {};
 }, [scene, legacyCaption]);
 /** An edit the controller REFUSED, in words, for the human. Never a silent truncation. Seeded
  *  from the cold arrival, so a link carrying an unusable scene says so instead of half-applying it. */
 const [refused, setRefused] = useState(seed.rejected ?? '');
 const [lang, setLang] = useState<Lang>(() => {
  if (url.lang) return url.lang;
  let stored: string | null = null;
  try { stored = localStorage.getItem('atlas.lang'); } catch { /* private browsing */ }
  return isLang(stored) ? stored : 'en';
 });
 const [dicts, setDicts] = useState<Dicts>({});
 // The FULL dictionary map goes in, so `t.alt(id, script)` can read a name in a script the
 // interface is not currently in — the accessor v2.1b's cross-script palette needs (G10).
 const t = useMemo(() => makeT(lang, dicts[lang], dicts), [lang, dicts]);
 const tr = useCallback((k: string, v?: Record<string, string | number>) => v2t(lang, k, v), [lang]);

 const [atlas, setAtlas] = useState<Atlas | null>(null);
 const [error, setError] = useState('');
 const [expired, setExpired] = useState(false);
 const [phase, setPhase] = useState<'boot' | 'scene' | 'atlas'>('boot');
 /** THE SCENE GENERATION. Bumped on every re-drive, read by the renderer's re-armable barrier —
  *  see the `sceneEpoch` prop in app/scene.tsx for why one number is the whole contract (R:29). */
 const [epoch, setEpoch] = useState(0);
 const [bytes, setBytes] = useState({done: 0, total: 0});
 // A REFUSED ARRIVAL OPENS THE MARGIN. The alert renders inside `.v2-margin-scroll`, which is
 // hidden at the phone's peek detent — so a link whose view was refused would have opened looking
 // merely wrong, with the explanation present in the DOM and invisible. Same treatment a later
 // refusal gets (see `dispatch`).
 const [detent, setDetent] = useState<'peek' | 'half'>(seed.rejected ? 'half' : 'peek');
 const [panel, setPanel] = useState<'none' | 'search' | 'systems'>('none');
 const [query, setQuery] = useState('');
 const [stage, setStage] = useState(() => {
  const p = new URLSearchParams(location.search.replace(/^\?/, ''));
  return p.get('stage') === '1';
 });
 const probeMode = useMemo(() => new URLSearchParams(location.search.replace(/^\?/, '')).get('probe') === '1', []);
 const [probeOut, setProbeOut] = useState<string>('');
 /** Dismissing the PANEL, not the LANE. `probe=1` stays in the URL and the reading is still taken
  *  and still posted — the panel is a fixed overlay now, so a reader who wants to see the figure
  *  behind it needs a way to move it out of the way without losing the measurement. */
 const [probeOpen, setProbeOpen] = useState(true);

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

 // `render.selected` is DERIVED (picks -> resolved basket -> mesh union), not a user intent, so it
 // is written straight onto the controller state rather than through a command. Reference equality
 // matters: the frame loop's change guard compares `selected` by identity (app/scene.tsx:336).
 useEffect(() => {
  if (!atlas) return;
  const union = unionElements(basket);
  setCtl((c) => (sameIds(c.render.selected, union) ? c : {...c, render: {...c.render, selected: union}}));
 }, [atlas, basket]);
 useEffect(() => { markSelected(picks); }, [picks]);
 // UNCONDITIONAL, and the `if (scene)` it replaces was a shipped defect. `markScene` writes the
 // module-level `lastBlob` that `writeUrlState` puts back into the query verbatim — so skipping the
 // call when the scene became NULL left the abandoned blob cached, and the next debounced write
 // restored `scene=` to the URL. Reload then brought the cleared scene back. codex executed it
 // (review 2, High 1): controller blob "", stale DOM marker, both structures restored on reload.
 // `#scene=` looked fine only because `clearSceneState` calls `markScene('')` by hand — i.e. one
 // path was patched and the Clear button and `atlas.clear()` were not. One writer, every path.
 useEffect(() => { markScene(scene ? (sceneBlob || encodeScene(scene)) : ''); }, [scene, sceneBlob]);
 useEffect(() => { setModes(false, false); markSettled(false); markError(''); }, []);
 // `stage` and `probeMode` are passed EXPLICITLY, which is what makes them survive the debounced
 // rewrite (R:31) while still being droppable: leaving stage sets it false, and the next write
 // therefore omits the key instead of preserving whatever the URL happened to say.
 useEffect(() => { if (!atlas) return; const timer = setTimeout(() => writeUrlState(state, picks, caption, lang, {stage, probe: probeMode, clearHash: true}), 200); return () => clearTimeout(timer); }, [atlas, state, picks, caption, lang, stage, probeMode]);

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

 // ─── the one door into the controller ─────────────────────────────────────────────────────
 const known = useCallback((id: string) => conceptsById.has(id) || parts.has(id), [conceptsById, parts]);
 /**
  * DISPATCH. `reduce` is pure, so the side effects live here and only here: publish the outcome,
  * surface a refusal, open a renderer generation when the scene identity changed, and emit on the
  * tool-surface event stream.
  *
  * It reads through `ctlRef` and writes it back synchronously rather than using `setCtl`'s
  * functional form, because a handler sometimes dispatches twice in one tick (apply a scene, then
  * focus) and the second command has to see the first one's result — React has not re-rendered yet.
  */
 const ctlRef = useRef(ctl);
 ctlRef.current = ctl;
 const dispatch = useCallback((cmd: Command): boolean => {
  const out = reduce(ctlRef.current, cmd);
  // AN ARRIVAL DOES NOT CLEAR A REFUSAL. A rejected seed has `scene:null`, so mount dispatches
  // `apply-legacy` — which SUCCEEDS, and used to wipe the message explaining why the link's view is
  // missing before the reader could ever see it (codex review 4, Medium 1: refusal populated at
  // seed, empty after mount, detent still peek). Only a user action clears it, because only a user
  // action means "I have moved on".
  const arrival = cmd.type === 'apply-scene' || cmd.type === 'apply-legacy' || cmd.type === 'clear-scene';
  if (out.rejected) {
   setRefused(out.rejected);
   // AND MAKE IT VISIBLE. The alert renders inside `.v2-margin-scroll`, which is `display:none` at
   // the phone's peek detent (v2.css) — so a refusal triggered by `window.atlas` or by a control
   // reachable at peek would have been written to a hidden container and the promised "visible
   // message" would not exist (codex review 2, Medium 9). Opening the margin is the cheapest thing
   // that makes the promise true on every tier.
   setDetent('half');
   return false;
  }
  if (!arrival) setRefused('');
  ctlRef.current = out.state;
  setCtl(out.state);
  if (out.epoch) { markSceneReady(false); markSettled(false); setEpoch((n) => n + 1); }
  return true;
 }, []);

 const replacePicks = useCallback((ids: readonly string[], focus?: string | null) => {
  const next = dedupe(ids).filter(known);
  if (!next.length) return false;
  const ok = dispatch({type: 'replace', ids: next, focus});
  if (!ok) return false;
  setPanel('none'); setDetent('half');
  emitAtlas({type: 'select', ids: next});
  return true;
 }, [known, dispatch]);
 const addToPicks = useCallback((id: string) => {
  if (!known(id)) return;
  if (dispatch({type: 'add', id})) setDetent('half');
 }, [known, dispatch]);
 const focusPick = useCallback((id: string) => {
  if (!dispatch({type: 'focus', id})) return;
  setDetent('half'); setPanel('none');
  emitAtlas({type: 'focus', id});
 }, [dispatch]);
 const clearPicks = useCallback(() => { dispatch({type: 'clear-all'}); emitAtlas({type: 'select', ids: []}); }, [dispatch]);

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
  // THE SAME COMMANDS THE ON-SCREEN CONTROLS SEND. Not a parallel implementation — that is the
  // whole reason the controller exists (codex-app-review.md §1).
  add: (id) => { if (!known(id)) return false; return dispatch({type: 'add', id}); },
  remove: (id) => dispatch({type: 'remove', id}),
  clear: () => dispatch({type: 'clear-all'}),
  setView: (view) => (VIEW_NAMES.includes(view as View) ? dispatch({type: 'set-view', view: view as View}) : false),
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
 }), [focusPick, known, dispatch]);

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
 const applySceneState = useCallback((sc: Scene, blob: string) => {
  if (sc.lang) applyLang(sc.lang);
  if (!dispatch({type: 'apply-scene', scene: sc, blob})) return;
  emitAtlas({type: 'scene', blob, ids: sceneSelectIds(sc), focus: sceneFocusId(sc)});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [dispatch]);

 /**
  * LEAVING A SCENE, on purpose. `#scene=` with an empty value is how the snapshot renderer gets a
  * warm tab OUT of a scene, and `readUrlState` already models it as `clearScene:true`
  * (app/url-state.ts:84) — v2's handler threw that away and returned early, so the previous scene
  * kept drawing while the URL said otherwise and every legacy key in the new hash was ignored
  * (codex-app-review.md §2 row 6, R:30 + §1, R:7).
  *
  * `markScene('')` is load-bearing twice: it drops the DOM marker the renderer reads AND clears
  * `lastBlob`, which is what `writeUrlState` writes back verbatim — without it the next debounced
  * write would put the cleared scene straight back into the address bar.
  */
 const clearSceneState = useCallback((u: ReturnType<typeof readUrlState>) => {
  markScene('');
  setLegacyCaption({title: u.title, note: u.note});
  if (u.lang) applyLang(u.lang);
  dispatch({type: 'clear-scene', url: {...u, select: u.select?.filter(known)}});
  emitAtlas({type: 'scene', blob: '', ids: u.select ?? [], focus: null});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [known, dispatch]);

 const sceneApplied = useRef(false);
 useEffect(() => {
  if (!atlas || sceneApplied.current) return;
  sceneApplied.current = true;
  if (scene) applySceneState(scene, sceneBlob || encodeScene(scene));
  // A COLD LEGACY LINK. Without this the picks were the only thing a `?select=…&view=…&isolate=…`
  // link achieved on /v2/ — see app/v2/legacy-url.ts for the measurement.
  else dispatch({type: 'apply-legacy', url: {...url, select: url.select?.filter(known)}});
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [atlas]);

 // ─── re-drive on hashchange (the renderer's door, and window.atlas.applyScene's) ───────────
 useEffect(() => {
  if (!atlas) return;
  const reapply = () => {
   const u = readUrlState();
   markSettled(false); markSceneReady(false);
   // WITHDRAW READINESS AND OPEN A NEW GENERATION. The renderer re-arms its barrier against the
   // ids below and publishes only once their chunks are merged AND drawn, which is what replaced
   // `markSceneReady(phase === 'atlas')` — a line with two opposite failure modes (R:29): between
   // the barrier and full load it published `false` and nothing ever restored it, and before the
   // first barrier the pending barrier belonged to the scene being superseded.
   setEpoch((n) => n + 1);
   if (u.scene) { applySceneState(u.scene, u.sceneBlob ?? encodeScene(u.scene)); return; }
   if (u.clearScene) { clearSceneState(u); return; }
   // Neither a scene nor an explicit clear: a legacy re-drive. `apply-legacy` carries BOTH the
   // picks and the camera/visibility keys, so it is one transaction rather than two.
   if (u.select?.length) {
    setLegacyCaption({title: u.title, note: u.note});
    if (u.lang) applyLang(u.lang);
    dispatch({type: 'apply-legacy', url: {...u, select: u.select.filter(known)}});
   }
  };
  window.addEventListener('hashchange', reapply);
  return () => window.removeEventListener('hashchange', reapply);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [atlas, applySceneState, clearSceneState, replacePicks]);

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
    // THE GENERATION AND ITS REQUIREMENT. Both are read through refs assigned during RENDER
    // (app/scene.tsx), never in an effect — so when a re-drive bumps the epoch and replaces the
    // picks in the same batched update, the frame loop sees the new epoch and the new requirement
    // in the same commit. Bumping the epoch against a stale requirement is precisely failure mode
    // (b) of R:29: readiness published for the scene that was just superseded.
    sceneEpoch={epoch}
    requiredIds={picks}
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
    {/* A REFUSED EDIT, IN WORDS. The controller enforces both scene bounds atomically and returns
        the state unchanged with a sentence when an edit cannot be committed — never a silent
        truncation (codex-plan-review.md §A.4). Without this the refusal would be invisible and the
        control would read as broken. */}
    {refused && <p className="v2-refused" role="alert">{refused}</p>}
    <div className="v2-actions">
     <button type="button" className={panel === 'search' ? 'is-on' : ''} onClick={() => { setPanel((p) => (p === 'search' ? 'none' : 'search')); setDetent('half'); }}>{tr('search.open')}</button>
     <button type="button" className={panel === 'systems' ? 'is-on' : ''} onClick={() => { setPanel((p) => (p === 'systems' ? 'none' : 'systems')); setDetent('half'); }}>{tr('systems.open')}</button>
     <button type="button" onClick={() => dispatch({type: 'reset-view'})}>{tr('view.reset')}</button>
    </div>

    <div className="v2-views" role="group">
     {(['three-quarter', 'front', 'side', 'back'] as View[]).map((v) => <button
      type="button" key={v} aria-pressed={state.view === v} className={state.view === v ? 'is-on' : ''}
      onClick={() => dispatch({type: 'set-view', view: v})}>{tr(`view.${v}`)}</button>)}
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
      <input type="checkbox" checked={state.visible.includes(s.id)} onChange={() => dispatch({type: 'set-visible', visible: state.visible.includes(s.id) ? state.visible.filter((x) => x !== s.id) : [...state.visible, s.id]})}/>
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
      <button type="button" className="v2-row-x" aria-label={`${tr('margin.clear')} ${t.name(p.id, p.name)}`} onClick={() => dispatch({type: 'remove', id: p.id})}>×</button>
     </div>)}
     <div className="v2-set-foot">
      <label className={state.isolate ? 'is-on' : ''}>
       <input type="checkbox" checked={state.isolate} onChange={() => dispatch({type: 'set-isolate', on: !state.isolate})}/>
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

   </div>
  </section>

  {/* THE CHROME LAYER — a fixed pass-through overlay, and today the probe panel is its only
      tenant. The probe used to be the last child of `.v2-margin-scroll`, which put the ONLY
      real-device timing lane this project has inside the container that is hidden at the phone's
      peek detent and that v2.1b's shell deletes at >=768 (v21-design.md:900, critic gap 5) —
      while P2c's own gate requires running `?probe=1` on the iPad. It is `position:fixed` at
      every width now, so the lane survives the shell rewrite by construction, and `?stage=1`
      hides `.v2-chrome` as a whole so a future panel added here is fenced without anyone having
      to remember a list. */}
  {probeMode && probeOpen && !stage && <div className="v2-chrome">
   <pre className="v2-probe" aria-label={tr('probe.aria')}>
    {probeOut || 'measuring…'}
    <button type="button" className="v2-probe-close" aria-label={tr('probe.close')} onClick={() => setProbeOpen(false)}>×</button>
   </pre>
  </div>}
 </main>;
}
