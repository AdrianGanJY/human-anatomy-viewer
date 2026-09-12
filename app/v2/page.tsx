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
import {loadZhDicts,makeT,type Dicts} from '../i18n/dict';
import {encodeScene,sceneFocusId,sceneFrameIds,sceneOpacities,sceneSelectIds,type Role,type Scene} from '../scene-model';
import {markError,markReady,markScene,markSceneReady,markSelected,markSettled,readUrlState,setModes,writeUrlState} from '../url-state';
import {v2t} from './copy';
import {initialState, reduce, type Command, type V2State} from './controller';
import {emitAtlas,installAtlasTools,type AtlasState} from './tools';
import {conceptAlpha,partAlphas,sceneAlphaMap,withSessionHidden} from './visibility.ts';
import {sceneDeclaresLang} from './scene-lang.ts';
import {mark,postProbe,readProbe,watchLayoutShift} from './probe';
import Shell,{StudioField,StudioOverlays} from './shell/shell.tsx';
import Tree from './shell/tree.tsx';
import FindPalette from './shell/find.tsx';
import {useShell} from './shell/use-shell.ts';

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
 /** THE HUMAN'S SYSTEM SET, as distinct from what is currently DRAWN (`state.visible`), which a
  *  scene's skeletal ghost may legitimately override. Every control that represents the human's
  *  choice reads this; anything describing the picture on screen reads `state.visible`. Optional in
  *  the controller for backward compatibility, so the fallback is stated once, here, rather than at
  *  each call site. See `V2State.visibleIntent`. */
 const visibleIntent = ctl.visibleIntent ?? state.visible;
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
 // `'search'` remains a legal value so `setPanel('none')` keeps its meaning, but nothing sets it any
 // more: the phone's Find is the A4 sheet as of S2, and the sheet is not a margin panel. The query
 // state that fed the old in-margin list is deleted with it — the palette owns its own.
 const [panel, setPanel] = useState<'none' | 'search' | 'systems'>('none');
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

 /**
  * ── S3. THE SESSION-ONLY HIDDEN SET — the tree's NON-MEMBER eye ────────────────────────────────
  *
  * The third of RC8's three eyes, and the only one that is NOT a controller command: there is no
  * codec field for "this concept is hidden", so it is not put in one. It lives here, in React, it
  * is merged into the renderer's opacity map below, and it is never serialised — which is exactly
  * what its tooltip says (`tree.eyeSession`).
  *
  * ⚠️ CLEARED WHENEVER A SCENE ARRIVES. `spec.md`: "Opening a saved scene/tab resets these session
  * overrides (to avoid an apparently missing saved structure)". A reader who opens a teaching link
  * and finds one of its structures invisible for a reason nothing on screen explains is the worse
  * failure by a distance — so the override loses to the link, deliberately.
  *
  * NOT PERSISTED, for the same reason S2's recents are not: RC12 froze the localStorage schema at
  * S0 and `atlas.hidden` is not in it. A hidden set that survived a reload would also survive the
  * reader's memory of having hidden anything.
  */
 const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
 const hide = useCallback((id: string, on: boolean) => {
  setHidden((cur) => {
   // `'*'` is the sidebar foot's Reset — one call rather than a loop, so the render-only set can
   // never be half-cleared.
   if (id === '*') return cur.size ? new Set<string>() : cur;
   const next = new Set(cur);
   if (on) next.add(id); else next.delete(id);
   return next;
  });
 }, []);
 const [treeQuery, setTreeQuery] = useState('');

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
  const {rest} = sceneOpacities(scene) as {render: boolean; structures: Record<string, number>; rest: number};
  const roleOf = new Map(scene.structures.map((s) => [s.id, s.role]));
  const wantFocus = new Set(scene.camera.focus);
  const wantFrame = new Set(sceneFrameIds(scene));
  // ⚠️ S3b. THE ALPHA MAP MOVED TO `visibility.ts` AND NOTHING ELSE ABOUT IT CHANGED — it is the
  // identical `max` over `sceneOpacities`, lifted so the CONTROLS read the same implementation the
  // renderer does. codex r4's four Highs are all "a control read one link of this chain".
  const opacity = sceneAlphaMap(scene, basket);
  const focus: string[] = [], frame: string[] = [], primary: string[] = [];
  for (const p of basket) {
   for (const el of p.elements) {
    if (wantFrame.has(p.id)) frame.push(el);
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
 /** Whether the mount arrival has run. See `seedArrival` in `dispatch`. */
 const mounted = useRef(false);
 const dispatch = useCallback((cmd: Command): boolean => {
  const out = reduce(ctlRef.current, cmd);
  // AN ARRIVAL DOES NOT CLEAR A REFUSAL. A rejected seed has `scene:null`, so mount dispatches
  // `apply-legacy` — which SUCCEEDS, and used to wipe the message explaining why the link's view is
  // missing before the reader could ever see it (codex review 4, Medium 1: refusal populated at
  // seed, empty after mount, detent still peek). Only a user action clears it, because only a user
  // action means "I have moved on".
  const arrival = cmd.type === 'apply-scene' || cmd.type === 'apply-legacy' || cmd.type === 'clear-scene';
  // The MOUNT arrival is the one that installs the seed's own fallback, so it must not wipe the
  // message explaining that fallback. Every arrival AFTER it is a new link or a re-drive, and a
  // stale "this link's view could not be applied" printed beside a scene that applied perfectly is
  // its own defect (codex review 5, Medium 1).
  const seedArrival = arrival && !mounted.current;
  if (arrival) mounted.current = true;
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
  if (!seedArrival) setRefused('');
  /**
   * ⚠️ S3. AN ARRIVING VIEW CLEARS THE SESSION-ONLY HIDDEN SET, and it is cleared HERE rather than
   * at each call site so no future arrival path can forget.
   *
   * `spec.md`: "Opening a saved scene/tab resets these session overrides (to avoid an apparently
   * missing saved structure)". The failure it prevents is a link that opens with one of its own
   * declared structures invisible, for a reason nothing on screen explains and no control the
   * reader can see is currently in the state that caused it. The override is worth less than the
   * link is, so the link wins.
   *
   * Guarded on `size` so an ordinary arrival with nothing hidden does not publish a new Set and
   * re-run the renderer's opacity merge for nothing.
   */
  if (arrival) setHidden((cur) => (cur.size ? new Set<string>() : cur));
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
 /** Returns the CONTROLLER'S VERDICT as of S2 — it was `void`, and the palette needs to know. An
  *  add can be refused (the 24-structure / 1,400-character atomic bounds), and a palette that closed
  *  or cleared its query on a refused add would report an edit that did not happen. Existing callers
  *  ignore the value, so this widens the contract without changing any of them. */
 const addToPicks = useCallback((id: string): boolean => {
  if (!known(id)) return false;
  const ok = dispatch({type: 'add', id});
  if (ok) setDetent('half');
  return ok;
 }, [known, dispatch]);
 const focusPick = useCallback((id: string) => {
  if (!dispatch({type: 'focus', id})) return;
  setDetent('half'); setPanel('none');
  emitAtlas({type: 'focus', id});
 }, [dispatch]);
 const clearPicks = useCallback(() => { dispatch({type: 'clear-all'}); emitAtlas({type: 'select', ids: []}); }, [dispatch]);

 /**
  * ⚠️ THE OLD ONE-LANE MATCHER IS DELETED, NOT LEFT BEHIND (S2).
  *
  * It ranked by NAME LENGTH — "the shortest name containing your query wins" — which has no
  * relationship to relevance and is not stable across scripts, since the Chinese name's length
  * decides the order in a Chinese interface and the English name's in an English one. The SAME
  * query returned a different first row depending on the interface language.
  *
  * `app/v2/find.ts` replaces it for every v2 surface (the palette is now the only search on the
  * phone as well as the studio). `searchKeys` itself SURVIVES in `app/i18n/dict.ts` because v1
  * (`app/page.tsx:86`) still calls it and v1 is untouched this increment — which is also why the
  * palette got `searchEntries` as a new function rather than a changed signature.
  */

 const applyLang = (next: Lang) => {
  setLang(next);
  try { localStorage.setItem('atlas.lang', next); } catch { /* ignore */ }
  emitAtlas({type: 'lang', lang: next});
 };

 // ─── the reserved local tool surface ──────────────────────────────────────────────────────
 // ⚠️ `live` IS RENDER-FRESH, NOT DISPATCH-FRESH — and the controller facts are read from `ctlRef`
 // instead (codex r9 Medium 5). `dispatch` writes `ctlRef.current` SYNCHRONOUSLY and then calls
 // `setCtl`, so between the two, `live.current` still holds the PREVIOUS render's scene / blob /
 // picks / focus. A caller doing `await atlas.add(id); atlas.state()` — the natural shape, and the
 // one `/mcp` and the oracles use — therefore read the set as it was BEFORE their own edit.
 // So: anything the controller owns comes from `ctlRef.current`; only the things the controller does
 // NOT own (language, phase, bytes, stage, the hovered concept, the translator, the renderer's
 // projected plate) stay here, because for those a React render IS the moment they become true.
 // `conceptsById`/`parts` are here so `state()` can RE-DERIVE the focused concept the same way the
 // render does — `resolvePicks(conceptsById, parts, picks)` — from dispatch-fresh picks. Carrying the
 // rendered `focused` object instead is what made `state().name` describe the previous selection.
 const live = useRef({lang, phase, bytes, stage, t, plate, conceptsById, parts});
 live.current = {lang, phase, bytes, stage, t, plate, conceptsById, parts};
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
  focus: (ids) => { const id = ids.find((x) => ctlRef.current.picks.includes(x)); if (!id) return false; focusPick(id); return true; },
  // THE SAME COMMANDS THE ON-SCREEN CONTROLS SEND. Not a parallel implementation — that is the
  // whole reason the controller exists (codex-app-review.md §1).
  add: (id) => { if (!known(id)) return false; return dispatch({type: 'add', id}); },
  remove: (id) => dispatch({type: 'remove', id}),
  clear: () => dispatch({type: 'clear-all'}),
  setView: (view) => (VIEW_NAMES.includes(view as View) ? dispatch({type: 'set-view', view: view as View}) : false),
  plate: () => {
   const c = ctlRef.current;
   const blob = c.blob || (c.scene ? encodeScene(c.scene) : '');
   const ids = c.picks;
   return {blob, ids, url: `${location.origin}/api/snap?select=${ids.join(',')}${blob ? `&scene=${blob}` : ''}&snap=1`};
  },
  state: (): AtlasState => {
   const l = live.current, c = ctlRef.current;
   // The same derivation the render makes (page.tsx `basket`/`focused`), off controller-fresh picks.
   const basketNow = resolvePicks(l.conceptsById, l.parts, c.picks);
   const focusedNow = basketNow.find((p) => p.id === c.focusId) ?? basketNow[0] ?? null;
   return {
    blob: c.blob, ids: c.picks, focus: c.focusId ?? focusedNow?.id ?? null,
    name: focusedNow ? l.t.name(focusedNow.id, focusedNow.name) : null,
    nameEn: focusedNow?.name ?? null,
    lang: l.lang, view: c.render.view, stage: l.stage, phase: l.phase, bytes: l.bytes,
    // Introspection the oracles read instead of scraping the DOM for something the DOM does not
    // say: how many MESHES the camera is being asked to look at and to contain. A framing
    // failure is either "the fit is wrong" or "the fit was never given anything", and only this
    // tells them apart.
    // `plate` is the RENDERER's projection — render-fresh is the only thing it can be, and saying so
    // is honest: it describes the last painted frame, not the pending edit. `isolate` is controller
    // state, so it comes from the controller.
    framing: {focus: l.plate?.focus.length ?? 0, frame: l.plate?.frame.length ?? 0, isolate: c.render.isolate},
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
 /**
  * ⚠️ S3b — A SCENE THAT DID NOT DECLARE A LANGUAGE NO LONGER OVERRIDES THE LINK'S `?lang=`.
  *
  * The line below used to be `if (sc.lang) applyLang(sc.lang)`, and `sc.lang` is ALWAYS set:
  * `scene-codec.js:73` defaults it to `'en'` in `normalizeScene`. So the guard was always true and
  * every scene without a declared language asserted English over the reader's explicit choice
  * ~900 ms after entry — then the debounced serializer dropped `lang=` from the address bar, so the
  * link could not even be re-read. Measured on the LIVE S2 deploy, four cases:
  *   `?lang=zh-Hans` ✅ · `?select=…&lang=` ✅ · `?scene=<garbage>&lang=` ✅ · `?scene=<valid>&lang=` ❌
  *
  * ⚠️ THIS CHANGES WHAT EXISTING LINKS DO, and that is the point: a `?scene=…&lang=zh-Hans` link
  * that has been reverting to English now stays Chinese. A scene that DOES declare a language still
  * wins — a teaching plate authored in Chinese is a statement about the plate, not a default.
  *
  * "Declared" is read off the WIRE object (`app/v2/scene-lang.ts`), not off the normalised scene,
  * because the normalised one cannot tell the two apart. `canonicalScene` omits `lang` when it is
  * `'en'`, so a scene that declared English is indistinguishable from one that said nothing — and in
  * that tie the reader's explicit `?lang=` wins, which is the side that cannot surprise anybody.
  */
 const applySceneState = useCallback((sc: Scene, blob: string, urlLang?: Lang | null) => {
  const declared = sceneDeclaresLang(blob);
  if (sc.lang && !(urlLang && !declared)) applyLang(sc.lang);
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
  if (scene) applySceneState(scene, sceneBlob || encodeScene(scene), url.lang);
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
   if (u.scene) { applySceneState(u.scene, u.sceneBlob ?? encodeScene(u.scene), u.lang); return; }
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

 /**
  * THE DESCRIPTION IS TRANSLATED — and it takes TWO accessors, not one.
  *
  * ⚠️ THE FIRST FIX WAS INCOMPLETE, and only LOOKING at a 简体 screenshot showed it. `explanation()`
  * (app/anatomy.ts) has two branches: a PER-STRUCTURE sentence for a handful of named organs, and
  * otherwise the SYSTEM's own description. The Chinese dictionaries mirror both — but in different
  * places: `explanations[name]` carries 9 per-structure entries and `systems[id].description`
  * carries the system prose. So routing everything through `t.explanation` translated the 9 and
  * left every other structure — which is nearly all of them — printing an English paragraph under
  * a Chinese heading, exactly the defect the prelude set out to end.
  *
  * WHICH BRANCH FIRED IS DETECTABLE WITHOUT EXPORTING THE TABLE: `EXPLANATIONS` is module-private,
  * but `explanation()` returns the system's own description verbatim when it misses, so comparing
  * against that description identifies the fallback exactly. No new export, no second copy of the
  * lookup, and if the table ever gains an entry equal to its system's description the two readings
  * are identical anyway.
  */
 const describe = (name: string | undefined, sys: SystemId | undefined) => {
  if (!name || !sys) return '';
  const s = SYSTEMS.find((x) => x.id === sys);
  const en = explanation(name, sys);
  return s && en === s.description ? t.systemDesc(s.id, s.description) : t.explanation(name, en);
 };
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

 /**
  * ══ THE STUDIO SHELL, >=1180 ONLY (L31 v2.1b+c, S0) ═══════════════════════════════════════════
  *
  * `useShell` is called UNCONDITIONALLY, at every width — hooks may not be conditional, and its
  * cost below 1180 is two matchMedia listeners and one localStorage read. What is conditional is
  * the RENDER: at >=1180 the head / rail / margin are replaced by bar / tools / side / dock /
  * status, and below it not one rule changes. That is why "the phone tier is preserved" is a
  * structural claim here rather than a promise — `shell` is false and every branch below is the
  * code that was already shipping.
  *
  * ⚠️ `.v2-field` IS RENDERED IN THE SAME TREE POSITION IN BOTH BRANCHES, deliberately. Moving it
  * would make React unmount and remount `AnatomyScene` when the window crosses 1180 — a full
  * WebGL teardown and a re-download of every chunk, in the middle of a resize. The regions around
  * it change; the field never does.
  */
 /**
  * SNAPSHOT — the field as a PNG, on this device, with no server in it.
  *
  * It deliberately does NOT go through `/api/snap`: that route is behind Access, rate-limited on
  * this account, and would turn a local action into a network dependency for no gain.
  *
  * ⚠️ IT READS `__atlasCapture`'s RETURN VALUE AND THEN RELEASES THE OVERLAY. Both halves are
  * corrections from the S1 stand-in review's H2, and each was its own defect:
  *
  *  1. `installCapture` (app/capture.ts:90-110) renders one supersampled frame, copies it into a
  *     2D canvas, RETURNS that canvas as a data URL — and then appends it over the field as a
  *     `.atlas-shot` overlay. The overlay is removed only by `releaseCaptureOverlay`, whose single
  *     caller was v1's re-drive path (`app/page.tsx:125`). In `/v2/` nothing released it, so one
  *     Shift+P froze the viewport permanently: the WebGL canvas kept redrawing underneath a static
  *     bitmap, `pointer-events:none` let every gesture through, and the app was live while the
  *     picture was dead.
  *  2. The first version read `.v2-field canvas` — the WEBGL canvas — with `toBlob`. The renderer
  *     is built without `preserveDrawingBuffer` (app/capture.ts:104-107 says so), so that buffer is
  *     only valid inside the frame that drew it: the download would have been blank or stale. The
  *     capture hook exists precisely because it does the read in the same task as the render.
  *
  * `scale: 2` is the real supersample. The first version passed `1`, which clamps to `MIN_SCALE`
  * and supersamples nothing, under a comment that claimed it did.
  */
 // The command handler is installed ONCE (the dispatcher's extension seam), so it cannot close over
 // `stage` — it reads the live value through a ref, the same discipline `useShell` uses.
 const stageRef = useRef(stage);
 stageRef.current = stage;
 const snapshot = useCallback(() => {
  const w = window as unknown as {__atlasCapture?: (o: {scale: number}) => string; __atlasCaptureRelease?: () => void};
  if (!w.__atlasCapture) return false;
  /**
   * ⚠️ THE RELEASE IS IN A `finally`, and that is not belt-and-braces. `installCapture` appends the
   * overlay (capture.ts:109) and only THEN enters its own `finally`, which restores the pixel ratio
   * and re-renders — the part most likely to throw on a lost context. A `release()` on the happy
   * path alone would re-create H2 (a permanently frozen viewport) in exactly the case where the
   * reader has no idea what went wrong. Round 2, Medium.
   */
  let url = '';
  try {
   url = w.__atlasCapture({scale: 2});
  } finally {
   w.__atlasCaptureRelease?.();
  }
  if (!url) return false;
  const a = document.createElement('a');
  a.href = url;
  a.download = `anatomy-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.png`;
  a.click();
  return true;
 }, []);

 /**
  * THE KEYBOARD'S SCENE COMMANDS. The camera ones (`home`, `fit`, the drag mode) are answered
  * inside `useShell`, because the renderer's navigation surface is a global; the ones that change
  * the SCENE go through the controller here, so a named view pressed on the keyboard and one
  * clicked on the pill are literally the same dispatch and cannot drift apart.
  */
 const shell = useShell(useCallback((cmd: string) => {
  const view = ({'view-three-quarter': 'three-quarter', 'view-front': 'front', 'view-side': 'side', 'view-back': 'back'} as Record<string, View>)[cmd];
  if (view) return dispatch({type: 'set-view', view});
  if (cmd === 'reset') return dispatch({type: 'reset-view'});
  if (cmd === 'stage') { setStage((s) => !s); return true; }
  if (cmd === 'snapshot') { snapshot(); return true; }
  // ESCAPE LEAVES THE STAGE. `useShell` handles the overlays and hands the key on when none is
  // open; this is the only other thing on `/v2/` that Escape can sensibly mean, and without it
  // Shift+S was a one-way door with a single small button back (stand-in review S1 M6).
  if (cmd === 'escape') { if (!stageRef.current) return false; setStage(false); return true; }
  return false;
 }, [dispatch, snapshot]));

 /**
  * ── S1 / RC3: A STUDIO `?select=` LINK OPENS FRAMED ON ITS STRUCTURE ──────────────────────────
  *
  * A bare legacy link carries no scene, so `plate` is null and the renderer falls back to its
  * DEFAULT fit — which is how a shared `?select=FMA…` link opened with the named structure at
  * 0.15%–0.34% of the field. That is the picture Adrian rejected, and `verify-ux.mjs`'s row
  * "a bare legacy visit is framed by the DEFAULT fit" was asserting it as correct behaviour; RC3
  * inverts that row in the studio tier and this is what makes it true.
  *
  * ⚠️ THE CONDITION IS "NO EFFECTIVE FOCUS", NOT "NO SCENE" (round 2, Medium). A scene's own
  * `camera.focus` stays authoritative when it has one — but `scene-codec.js` defaults that field to
  * `[]` and only serialises it when non-empty, so a blob naming five structures and no focus is
  * legal and round-trips. For one of those, `plate.focus` is empty, the frame loop's `focusActive`
  * is false, and pressing F fell through to Home: the key map promises "fit the selection" and the
  * camera went to the whole body instead. Deriving the focus here closes it in the layer that
  * already owns the rule, rather than teaching the renderer a second way to be focused.
  *
  * Only in the studio, so the phone and the tablet keep the framing every one of their oracles
  * measured.
  *
  * WHY IT TRACKS THE CURRENT PICKS rather than freezing the entry set: the renderer refuses to
  * re-frame once a human has posed the camera (`manual`, app/scene.tsx), so this reads as "fit to
  * the selection until you take the camera, then leave it alone" — which is the behaviour
  * codex-plan-review.md §A.7 asks for, reached through the state the oracle can see rather than
  * through a second command channel it cannot.
  */
 const studioFrame = useMemo(() => {
  if (!shell.studio || !basket.length) return null;
  // A scene that DECLARES a focus keeps it; one that does not gets the selection.
  if (plate && plate.focus.length) return null;
  const ids = basket.flatMap((p) => p.elements);
  if (!ids.length) return null;
  /**
   * ⚠️ IT SUPPLIES `frame` ONLY WHEN THERE IS NO PLATE. The first version returned both and was
   * spread over the plate, which **clobbered `plate.frame`** — and the comment at the call site
   * swore it could not. `plate.frame` comes from `sceneFrameIds()`, which excludes GHOSTS by
   * measured design (L31 D04: a ghost is context to look through, not something the frustum must
   * contain); `basket` is `sceneSelectIds()`, which includes them. So on a focus-less scene the
   * ghost was pulled into the containment set — and because this also sets `focus`, `focusActive`
   * flipped true and the clobbered set was actually consumed. Round 3, High 2, executed against
   * the real codec.
   *
   * When there is no plate at all (a bare `?select=` visit) there is no declared frame to protect
   * and no roles to respect, so the selection is both.
   */
  return plate ? {focus: ids} : {focus: ids, frame: ids};
 }, [shell.studio, plate, basket]);

 /**
  * ── THE ONE STATE THE RENDERER SEES ────────────────────────────────────────────────────────────
  *
  * MERGED, not `plate ?? studioFrame`. The plate carries opacity, roles, padding and background and
  * must always win on those; `studioFrame` only ever supplies `focus`/`frame`, and only when the
  * plate has no focus of its own — so spreading it last adds the framing without touching anything
  * else. With `??` the fallback was unreachable the moment a scene existed, which is precisely the
  * focus-less-scene case it was extended to cover (S1 round 2, Medium).
  *
  * S3 adds the session-hidden layer, and it is the LAST word on `opacity` by construction: a fresh
  * object is built from whatever the plate produced and `0` is written for every element of every
  * hidden concept. `app/scene.tsx:765` reads `alpha > 0` into the visibility lane, so alpha 0 is
  * NOT DRAWN rather than drawn transparent — the same mechanism a scene's own `styles` uses, which
  * is why the member eye and the session eye look identical on screen and differ only in what the
  * link reproduces.
  *
  * ⚠️ A FRESH OBJECT IDENTITY EVERY TIME THE SET CHANGES. `app/scene.tsx`'s change guard compares
  * `s.opacity` by REFERENCE (scene.tsx:738), so a map mutated in place never reaches the GPU and
  * the failure mode is a correct-looking render of the PREVIOUS state.
  */
 /**
  * ⚠️ A REFUSAL OPENS THE PANEL IT IS WRITTEN INTO — the studio's twin of the phone's
  * `setDetent('half')`, and for the identical reason.
  *
  * The controller refuses atomically and hands back a sentence; `spec.md` D11 puts that sentence at
  * the top of the Selection dock. A dock the reader has closed is `display:none`, so without this
  * the promised "visible message" would be written somewhere nobody can see — which is exactly the
  * defect the phone side already fixed once (codex review 2, Medium 9) and which the studio
  * reproduced because its copy of `refused` was never rendered at all until S3.
  *
  * Guarded on `!includes`, so a refusal with the dock already open does not re-publish the dock set.
  */
 useEffect(() => {
  if (!refused || !shell.studio) return;
  if (!shell.docks.includes('selection')) shell.toggleDock('selection');
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [refused, shell.studio]);

 const elementsOf = useCallback((id: string): readonly string[] => conceptsById.get(id)?.elements ?? [id], [conceptsById]);
 const renderState = useMemo(() => {
  const base = {...state, ...(plate ?? {}), ...(studioFrame ?? {}), insets: FIELD_INSET};
  const opacity = withSessionHidden(base.opacity, hidden, elementsOf);
  return opacity === base.opacity ? base : {...base, opacity};
 }, [state, plate, studioFrame, hidden, elementsOf]);

 /**
  * ⚠️ S3b — THE ONE READING EVERY VISIBILITY CONTROL USES, and it is taken off `renderState`, the
  * EXACT object handed to `AnatomyScene`. codex r4: four Highs, one cause — the tree's eye and the
  * Selection slider each reported their own declaration while the renderer computed something else
  * off `roleOpacity` → `styles` → a MAX across shared meshes → this session override → the
  * visibility lane. A control that reads the finished map cannot disagree with the picture.
  *
  * Memoised on `renderState` so it recomputes exactly when the picture does; the per-concept max is
  * a handful of map lookups and runs only for the rows a control actually draws.
  */
 const partSystem = useMemo(() => new Map((atlas?.parts ?? []).map((p) => [p.id, p.system])), [atlas]);
 const meshAlpha = useMemo(() => partAlphas(renderState, partSystem), [renderState, partSystem]);
 const effectiveAlpha = useCallback((id: string) => conceptAlpha(meshAlpha, elementsOf(id)), [meshAlpha, elementsOf]);

 return <main
  className={`v2 ${shell.studio ? 'v2-studio' : ''}`}
  data-phase={phase} data-detent={detent} data-ground={background} data-tier={shell.tier}
  style={shell.studio ? {'--v2-side-w': `${shell.sideW}px`, '--v2-dock-w': `${shell.dockW}px`} as React.CSSProperties : undefined}
 >
  {/* ⚠️ `!stage` IS LOAD-BEARING. `?stage=1` is the L32 display client's whole contract: the figure
      and NOTHING else. v2.css's fence lists the phone's surfaces by name (`.v2-head`, `.v2-rail`,
      `.v2-margin`, `.v2-chrome`) and knew nothing about the studio's five, so the first build
      rendered the whole studio in stage and squeezed the field to 362x138 — caught by the
      `stage-probe` regression case, which asserts the field gets the whole viewport. Not rendering
      is the primary fence; shell.css adds the display:none belt behind it. */}
  {shell.studio && !stage && <Shell
   t={t} tr={tr} lang={lang} applyLang={applyLang}
   atlas={atlas} basket={basket} focused={focused} focusPick={focusPick} clearPicks={clearPicks}
   systemId={systemId} describe={describe}
   state={state} dispatch={dispatch} scene={scene} sceneBlob={sceneBlob} picks={picks}
   caption={caption} phase={phase} bytes={bytes} background={background} refused={refused}
   docks={shell.docks} sideStub={shell.sideStub} autoCollapsed={shell.autoCollapsed}
   onToggleDock={shell.toggleDock} onToggleSide={shell.toggleSide}
   keysOpen={shell.keysOpen} onKeys={shell.setKeysOpen}
   settingsOpen={shell.settingsOpen} onSettings={shell.setSettingsOpen}
   findOpen={shell.findOpen} onFind={shell.setFindOpen}
   sheet={shell.sheet} coarse={shell.coarse}
   dicts={dicts} visibleIntent={visibleIntent} hidden={hidden} onHide={hide} effectiveAlpha={effectiveAlpha}
   treeQuery={treeQuery} onTreeQuery={setTreeQuery}
  />}
  {/* ── THE FIND PALETTE (S2) — HOSTED AT EVERY WIDTH, for the same reason the key map is ────────
      In the studio it is Ctrl+K's centred modal; below 768 it is `spec.md`'s A4 bottom sheet,
      opened by the margin's Find button. ONE component, one matcher, one set of denominators —
      `Overlay` already branches on `sheet`, so the palette does not have to.

      It is rendered OUTSIDE the `!stage` fence deliberately: `?stage=1` strips the chrome, and a
      reader in presentation mode who presses Ctrl+K has asked for the palette explicitly. Nothing
      is painted until `findOpen`, so stage stays chrome-free until it is. */}
  <FindPalette
   open={shell.findOpen} onClose={() => shell.setFindOpen(false)} sheet={shell.sheet}
   atlas={atlas} dicts={dicts} onDicts={setDicts} t={t} tr={tr}
   replace={(ids, focus) => replacePicks(ids, focus)} add={(id) => addToPicks(id)}
   picks={picks} refused={refused}
  />
  {/* HOSTED AT EVERY WIDTH. `?` is a keyboard explanation, not a studio control, so the map has to
      open on a narrow window too — and that is what gives `Overlay`'s SHEET presentation a
      reachable invoker at S0 rather than an untested branch waiting for S4. */}
  <StudioOverlays
   t={t} tr={tr} lang={lang} applyLang={applyLang} background={background} sheet={shell.sheet}
   keysOpen={shell.keysOpen} onKeys={shell.setKeysOpen}
   settingsOpen={shell.settingsOpen} onSettings={shell.setSettingsOpen}
   studio={shell.studio}
  />
  {/* THE HEADER IS PAINTED FROM THE URL, IN THE FIRST FRAME. It never resizes afterwards:
      its height is fixed in CSS, so the title arriving, the name arriving and the model
      arriving all land inside a box that was already there. That is CLS 0 by construction
      rather than by measurement. */}
  {!shell.studio && <header className="v2-head">
   <div className="v2-head-text">
    <h1 title={title}>{title || v2t(lang, 'app.title')}</h1>
    {caption.note && <p className="v2-note">{caption.note}</p>}
   </div>
   <div className="v2-lang" role="group" aria-label={tr('lang.aria')}>
    {LANGS.map((l) => <button type="button" key={l} lang={l} className={lang === l ? 'is-on' : ''} aria-pressed={lang === l} onClick={() => applyLang(l)}>{LANG_LABELS[l]}</button>)}
   </div>
  </header>}

  <div className="v2-field" id="v2-field">
   {atlas && <AnatomyScene
    atlas={atlas}
    // MERGED, not `plate ?? studioFrame`. The plate carries opacity, roles, padding and background
    // and must always win on those; `studioFrame` only ever supplies `focus`/`frame`, and only when
    // the plate has no focus of its own — so spreading it last adds the framing without touching
    // anything else. With `??` the fallback was unreachable the moment a scene existed, which is
    // precisely the focus-less-scene case it was extended to cover (round 2, Medium).
    // S3 appends `sessionHidden` LAST, and it is a MERGE into `opacity` rather than a replacement:
    // the plate's own per-structure alphas must survive a session override of a different structure.
    state={renderState}
    // THE STUDIO-ONLY FRAMING OPTION (app/scene.tsx `studio`). A separate prop, never part of
    // `SceneState` and never `insets`: the phone supplies insets too, and SceneState is what the
    // codec serialises into a teaching blob.
    //
    // ⚠️ `shell.studio` ALONE — deliberately NOT `shell.studio && !stage`, which is what this line
    // said first. `stage` strips the CHROME; it does not change the TIER, and this prop is about
    // the tier. With `!stage` in it, pressing Shift+S at 1440 handed the renderer back to v1's
    // `distance = 4` and the subject visibly shrank at the exact moment the reader had asked for
    // the biggest possible picture — a presentation mode that frames worse than the app it was
    // launched from. `?stage=1` on a phone still gets the phone's framing, because `shell.studio`
    // is false there.
    studio={shell.studio}
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
   {/* ONE PROGRESS INSTRUMENT PER TIER. In the studio the app bar's status chip says the same thing
       in a place that does not float over the key pad — two of them on one screen is how the first
       build said "Loading this view" and "This view is ready" at the same time. */}
   {loading && !shell.studio && !error && !expired && <div className="v2-progress" role="status">
    <span>{phase === 'boot' ? tr('entry.loading') : tr('entry.sceneReady')}</span>
    {bytes.total > 0 && <b>{tr('entry.bytes', {done: MB(bytes.done), total: MB(bytes.total)})}</b>}
   </div>}
   {expired && <button type="button" className="v2-recover" onClick={() => location.reload()}>{tr('error.session')}</button>}
   {error && !expired && <div className="v2-recover" role="alert">{error} <button type="button" onClick={() => location.reload()}>{tr('error.reload')}</button></div>}
   {stage && <button type="button" className="v2-stage-exit" onClick={() => setStage(false)}>{tr('stage.exit')}</button>}
   {stage && focused && <div className="v2-stage-name"><b>{t.name(focused.id, focused.name)}</b><i>{t.secondary(focused.id, focused.name) || focused.name}</i></div>}
   {/* THE FIELD OVERLAYS — caption, navigation pill, key pad, legend. Inside the field because
       that is what they float over, and rendered only in the studio because the phone has the
       margin instead. `?stage=1` strips them with the rest of the chrome. */}
   {shell.studio && !stage && <StudioField
    tr={tr} caption={caption} state={state} dispatch={dispatch}
    structures={basket.length} pieces={state.selected.length} onKeys={shell.setKeysOpen}
    navMode={shell.navMode} onNavMode={shell.setNavMode}
    held={shell.held} press={shell.press} release={shell.release}
    onFit={() => { (window as unknown as {__atlasNav?: {fit(): string}}).__atlasNav?.fit(); }}
    onHome={() => { (window as unknown as {__atlasNav?: {home(): void}}).__atlasNav?.home(); }}
    onSnapshot={snapshot}
   />}
  </div>

  {/* THE RAIL — the set, the focus control, the contents and the loading skeleton, all one
      44 px column. Names arrive with the atlas; the NOTCHES arrive with the URL, so the
      skeleton is the finished component with its labels missing, not a placeholder that gets
      replaced (and therefore not a layout shift). */}
  {!shell.studio && <nav className="v2-rail" aria-label={tr('rail.aria')} role="listbox" aria-orientation="vertical">
   {rail.map((n) => <button
     type="button" key={n.id} role="option" aria-selected={focused?.id === n.id}
     className={`v2-notch role-${n.role} ${focused?.id === n.id ? 'is-on' : ''} ${atlas ? '' : 'is-skeleton'}`}
     style={{'--notch': colorOf(n.id)} as React.CSSProperties}
     aria-label={tr('rail.focus', {name: atlas ? nameOf(n.id) : n.id})}
     title={atlas ? nameOf(n.id) : n.id}
     onClick={() => focusPick(n.id)}
    ><i/></button>)}
   {railOverflow > 0 && <button type="button" className="v2-notch is-more" onClick={() => { setDetent('half'); setPanel('none'); }} aria-label={tr('rail.more', {n: railOverflow})}>+{railOverflow}</button>}
  </nav>}

  {/* THE MARGIN — two detents on a phone. PEEK is what a chat link opens on: the term pair and
      one line, so the figure keeps the screen. Everything else is one drag or one tap away.
      Replaced by the studio's docks at >=1180; unchanged below it. */}
  {!shell.studio && <section className="v2-margin" aria-label={tr('margin.aria')}>
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
     {/* ── THE PHONE'S FIND NOW OPENS THE A4 SHEET (S2) ───────────────────────────────────────
         It used to toggle `panel === 'search'`, an in-margin list. `spec.md` A4 draws Find as a
         724 px bottom sheet with a scrim, which the margin cannot host at all: its own high detent
         is min(48dvh, 420). So the button opens the shared palette — the same component, the same
         matcher and the same denominators the studio gets, in `Overlay`'s sheet presentation.

         RC5 is satisfied by construction rather than by luck: the header, the rail and both detents
         are untouched (the sheet is a scrim above them), and the results container inside the
         palette keeps the `.v2-search` class, so verify-regress's "Find opens a search field"
         (verify-regress.mjs:1140) still matches the element it was written about. */}
     <button type="button" aria-haspopup="dialog" aria-expanded={shell.findOpen}
      onClick={() => shell.setFindOpen(true)}>{tr('search.open')}</button>
     <button type="button" className={panel === 'systems' ? 'is-on' : ''} onClick={() => { setPanel((p) => (p === 'systems' ? 'none' : 'systems')); setDetent('half'); }}>{tr('systems.open')}</button>
     <button type="button" onClick={() => dispatch({type: 'reset-view'})}>{tr('view.reset')}</button>
    </div>

    {/* ⚠️ S3: THE VIEWS ROW AND THE DESCRIPTION STAND DOWN WHILE THE LAYERS PANEL IS OPEN, and that
        is a MEASURED fix rather than a tidy-up. With both of them in the scroller the tree's first
        row started at y ≈ 790 on a 390×844 phone — inside a margin whose high detent is 405 px, so
        the reader had to scroll past two control rows and a paragraph to reach the list they asked
        for. `spec.md` A3 draws the tree directly beneath the name pair for exactly this reason.
        It follows the pattern the margin already uses (`.v2-set` is hidden whenever a panel is
        open): a panel is a MODE, and the controls it is not about step aside. Both come straight
        back when the panel closes; nothing is unreachable. */}
    {!(panel === 'systems' && shell.sheet) && <div className="v2-views" role="group">
     {(['three-quarter', 'front', 'side', 'back'] as View[]).map((v) => <button
      type="button" key={v} aria-pressed={state.view === v} className={state.view === v ? 'is-on' : ''}
      onClick={() => dispatch({type: 'set-view', view: v})}>{tr(`view.${v}`)}</button>)}
    </div>}

    {/* THE DESCRIPTION SITS BELOW THE CONTROLS, and that ordering is the CLS fix rather than a
        taste call: it only exists once the atlas has resolved the focused structure, so anything
        rendered beneath it is pushed down when it arrives. Measured at 1440x900 — 0.0025, named
        by the observer as div.v2-actions and div.v2-views, i.e. exactly the two rows that used
        to follow it. */}
    {focused && !(panel === 'systems' && shell.sheet) && <p className="v2-desc">{describe(focused.name, systemId)}</p>}

    {/* THE IN-MARGIN SEARCH LIST IS GONE — it is the A4 sheet now (the Find button above). What
        replaced it is strictly more: three lanes instead of one, per-lane denominators, the matched
        Chinese spelling shown in an English interface, and a ranking that is stable. The `search`
        member of `panel` is retained because `setPanel('none')` on a successful replace is still
        how the systems panel closes. */}

    {/* ⚠️ THIS CONTROL IS THE HUMAN'S SYSTEM SET, SO IT READS AND WRITES THE INTENT — never
        `render.visible`, which a scene's skeletal ghost legitimately overwrites.
        The controller-side fix alone did not close the door, and recording it as "fixed, both
        halves" was wrong of me: this checkbox both DISPLAYED `render.visible` (so after a ghost
        link the human's own choice read as OFF) and RECOMPUTED the next set from it (so one click
        wrote `['skeletal', …]` straight into the intent, and the very next scene inherited the
        ghost). The one-way door still closed — it just cost a click. Found by the S0 stand-in
        review, H3, with an executed five-step counterexample. */}
    {/* ── S3: THE PHONE'S LAYERS TREE, IN THE HIGH DETENT (`spec.md` A3) ──────────────────────
        It replaces the flat fifteen-system checkbox list. A3 draws the tree HERE — "margin tree
        header + filter + 48/60 px rows scroll beneath the selected name" — not in a sheet, and the
        margin is where it fits: the high detent is min(48dvh, 420), and the tree is the one new
        surface that wants exactly a scrolling column rather than a 724 px overlay.

        RC5 is satisfied by construction rather than by luck. The header (56), the rail (45) and
        both detents (108 / min(48dvh,420)) are untouched; this changes only what the ALREADY
        EXISTING `panel === 'systems'` branch renders INSIDE the margin's scroller, which is a
        container that already scrolled. The oracle rows measure it rather than taking my word.

        ⚠️ THE SAME COMPONENT AS THE STUDIO'S, deliberately. `spec.md` amends the kickoff to put the
        tree on the phone too, and two implementations of a tri-state membership tick is how the two
        would come to disagree about what a tick means. The system checkbox the reader had here is
        not lost — it is the system row's EYE, which reads and writes the same `visibleIntent`. */}
    {/* ── THE TABLET'S FLAT SYSTEM LIST, UNCHANGED (768–1179 until S6) ────────────────────────
        ⚠️ THIS CONTROL IS THE HUMAN'S SYSTEM SET, SO IT READS AND WRITES THE INTENT — never
        `render.visible`, which a scene's skeletal ghost legitimately overwrites. (S0 stand-in
        review, H3: it both DISPLAYED `render.visible`, so after a ghost link the human's own choice
        read as OFF, and RECOMPUTED the next set from it, so one click wrote `['skeletal', …]`
        straight into the intent.) Kept verbatim; the phone's replacement is the tree below. */}
    {panel === 'systems' && !shell.sheet && <div className="v2-systems">
     {SYSTEMS.filter((s) => counts[s.id] > 0).map((s) => <label key={s.id} className={visibleIntent.includes(s.id) ? 'is-on' : ''}>
      <input type="checkbox" checked={visibleIntent.includes(s.id)} onChange={() => dispatch({type: 'set-visible', visible: visibleIntent.includes(s.id) ? visibleIntent.filter((x) => x !== s.id) : [...visibleIntent, s.id]})}/>
      <span className="v2-box" aria-hidden="true"/>
      <span className="v2-dot" style={{background: s.color}}/>
      <span>{t.system(s.id, s.name)}</span>
      <b>{counts[s.id]}</b>
     </label>)}
    </div>}

    {/* ⚠️ THE TREE IS A **PHONE** SURFACE (<768), AND THE TABLET KEEPS ITS FLAT SYSTEM LIST.
        The first build rendered the tree for every non-studio tier and `verify-regress`'s
        `plain-entry-widths` caught it immediately: at 1100 px and 1179 px "Systems opens the system
        list" measured **0 system rows**, because `.v2-systems` had been replaced by the tree. That
        is the kickoff's binding constraint doing its job — "768–1179 keeps today's behaviour until
        S6" — and `spec.md` agrees for a different reason: T2 puts the tablet's Layers in the shared
        RIGHT SHEET, not in the margin, so the margin tree would have been the wrong surface there
        even if the tier had been open for changes. `shell.sheet` is exactly `width < 768`. */}
    {panel === 'systems' && shell.sheet && <div className="v2-tree-phone">
     {/* FILTER FIRST, per A3: "margin tree header + filter + 48/60 px rows scroll beneath the
         selected name". The rows scroll; the filter does not scroll away from them. */}
     <div className="v2-side-filter">
      <label>
       <input type="search" value={treeQuery} onChange={(e) => setTreeQuery(e.target.value)}
        placeholder={tr('panel.filter')} aria-label={tr('panel.filter')}/>
      </label>
     </div>
     <Tree
      t={t} tr={tr} atlas={atlas} dicts={dicts} picks={picks} scene={scene}
      visible={state.visible} visibleIntent={visibleIntent} isolate={state.isolate} dispatch={dispatch}
      hidden={hidden} onHide={hide} effectiveAlpha={effectiveAlpha}
      focusedId={focused?.id ?? null} onFocus={focusPick}
      query={treeQuery} phone coarse={shell.coarse}
     />
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
  </section>}

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
