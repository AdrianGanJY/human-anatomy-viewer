/** Deep links: the explorer's scene state, readable and writable in the URL.
 * Read merges `location.search` then `location.hash`, so the hash wins -- an agent
 * (or the snapshot renderer) can re-drive an already-loaded page by setting
 * `location.hash` alone, with no reload. Writes use replaceState only, so browsing
 * the atlas never fills the back button.
 * Fork-local addition (L30); kept in its own file so an upstream rebase stays trivial.
 *
 * v2 (L30 P2) -- `select` takes a LIST so several related structures highlight
 * together, and `title`/`note` carry the assistant's own words as an on-canvas
 * caption. Both are rendered as React text nodes, never as HTML.
 * The same contract is re-declared (not imported -- one is TS in the bundle, the
 * other a Pages Function) in `functions/mcp.js` URL_CONTRACT; change both together.
 *
 * v3 (L30 P4) -- `scene` carries the WHOLE teaching scene as one base64url blob:
 * mode, language, per-structure roles and opacities, camera and focus, caption,
 * styles and annotations. It is ONE new key, and it is the last one this contract
 * needs, because every future field rides inside the blob and is therefore part of
 * the renderer's cache key and its warm-tab re-drive automatically. See
 * `app/scene-codec.js` for why that matters.
 *
 * `mode`, `focus` and `contextOpacity` are ALIASES the PRD writes literally
 * (`/?select=...&view=side&mode=render&focus=...&contextOpacity=.08`). They are folded
 * into a synthesized scene on read rather than living beside it, so there is still only
 * one thing for the renderer to hash. UNLIKE the legacy keys, an EMPTY value on these
 * three means "reset to the default" -- they are new, so their semantics are ours to
 * define, and a warm tab that could not clear them would render the previous request's
 * framing under this request's structures.
 */
import {DEFAULT_VISIBLE,SYSTEMS,type SceneState,type SystemId,type View} from './anatomy';
import {isLang,type Lang} from './i18n/ui';
import {decodeScene,normalizeScene,type Scene} from './scene-model';
export interface UrlState {select?:string[];visible?:SystemId[];isolate?:boolean;view?:View;explode?:number;snap?:boolean;title?:string;note?:string;lang?:Lang;
 /** The decoded scene, when the URL carried one (or enough aliases to synthesize one). */
 scene?:Scene;sceneBlob?:string;
 /** An explicit `scene=` with an empty value: leave the scene, do not merely fail to find one. */
 clearScene?:boolean;
 /** Raw alias values, kept separate so readUrlState can synthesize AFTER both sources merge. */
 mode?:'render'|'explore';focus?:string[];contextOpacity?:number}
/** Bounds. A caption is a caption, not a document; a selection of everything is not a selection. */
export const TITLE_MAX=80,NOTE_MAX=600,SELECT_MAX=24;
const VIEWS:string[]=['three-quarter','front','back','side'];
const SYSTEM_IDS=new Set<string>(SYSTEMS.map(s=>s.id));
const TRUTHY=new Set(['1','true','yes','on']),FALSY=new Set(['0','false','no','off']);
let snapOn=false,renderOn=false,lastBlob='';
const flag=(value:string|null)=>value===null?undefined:TRUTHY.has(value.toLowerCase())?true:FALSY.has(value.toLowerCase())?false:undefined;
const sorted=(ids:readonly string[])=>[...ids].sort().join(',');
/** Collapse whitespace and clip -- a pasted paragraph of newlines must not become a wall. */
const text=(v:string|null,max:number)=>{if(v===null)return undefined;const t=v.replace(/\s+/g,' ').trim();return t?t.slice(0,max):'';};
const idList=(v:string)=>[...new Set(v.split(',').map(s=>s.trim()).filter(Boolean))].slice(0,SELECT_MAX);
/** Later sources overwrite earlier ones; an unparseable value is ignored, never guessed. */
function merge(source:string,out:UrlState){
 const p=new URLSearchParams(source.replace(/^[#?]/,''));
 const select=p.get('select');
 if(select!==null){
  // Deduped in order, so `?select=A,A,B` selects two things and reports two.
  const ids=idList(select);
  if(ids.length)out.select=ids;
 }
 const system=p.get('system');
 if(system!==null){
  if(system.trim().toLowerCase()==='none')out.visible=[];
  else{const ids=system.split(',').map(s=>s.trim()).filter(s=>SYSTEM_IDS.has(s)) as SystemId[];if(ids.length)out.visible=ids;}
 }
 const isolate=flag(p.get('isolate'));if(isolate!==undefined)out.isolate=isolate;
 const view=p.get('view');if(view&&VIEWS.includes(view))out.view=view as View;
 const explode=p.get('explode');
 if(explode!==null&&explode.trim()){const n=Number(explode);if(Number.isFinite(n))out.explode=Math.min(1,Math.max(0,n));}
 const snap=flag(p.get('snap'));if(snap!==undefined)out.snap=snap;
 const title=text(p.get('title'),TITLE_MAX);if(title!==undefined)out.title=title;
 const note=text(p.get('note'),NOTE_MAX);if(note!==undefined)out.note=note;
 // `lang` is the interface language (en | zh-Hans | zh-Hant). A link carrying it beats what
 // the browser remembered, so a Chinese link opens in Chinese on a machine last used in
 // English; an unknown value is ignored, never guessed at.
 const lang=p.get('lang');if(lang&&isLang(lang.trim()))out.lang=lang.trim() as Lang;
 // THE SCENE. A blob that does not decode is ignored, never guessed at -- a corrupt or
 // hostile `scene=` must degrade to "no scene", not to a broken page.
 // An EXPLICIT EMPTY value is a CLEAR, and it is the only way a legacy re-drive can get a
 // warm tab out of a scene: the blob otherwise survives in the tab's own query string, and
 // the authoritative scene apply below would then ignore every legacy key in the new hash
 // and cache the PREVIOUS picture under the new request's key.
 const blob=p.get('scene');
 if(blob!==null){
  const trimmed=blob.trim();
  if(!trimmed){out.scene=undefined;out.sceneBlob=undefined;out.clearScene=true;}
  else{const decoded=decodeScene(trimmed);if(decoded){out.scene=decoded;out.sceneBlob=trimmed;out.clearScene=false;}}
 }
 // The three PRD aliases. Empty means RESET -- see the file header.
 const mode=p.get('mode');
 if(mode!==null){const m=mode.trim();out.mode=m==='render'?'render':'explore';}
 const focus=p.get('focus');
 if(focus!==null)out.focus=idList(focus);
 const contextOpacity=p.get('contextOpacity');
 if(contextOpacity!==null){
  const n=Number(contextOpacity.trim());
  out.contextOpacity=contextOpacity.trim()===''?undefined:Number.isFinite(n)?Math.min(1,Math.max(0,n)):undefined;
 }
 // `size` is deliberately NOT read here: it is the renderer's viewport, and the
 // live page's viewport is the browser window. Ignored, not rejected.
 return out;
}
/**
 * Synthesize a scene from the PRD's literal alias form when no blob was given. The alias
 * form has no vocabulary for three tiers, so it maps the only distinction it can express:
 * whatever `focus=` names is PRIMARY, everything else is CONTEXT at `contextOpacity`.
 * A blob always wins -- it is the full expression and the renderer only ever sends that.
 */
function synthesize(out:UrlState){
 if(out.scene||out.mode!=='render'||!out.select?.length)return;
 const focus=out.focus?.filter(id=>out.select!.includes(id))??[];
 const alpha=out.contextOpacity;
 out.scene=normalizeScene({
  mode:'render',
  lang:out.lang??'en',
  structures:out.select.map(id=>({id,role:focus.length&&!focus.includes(id)?'context':'primary'})),
  camera:{view:out.view??'three-quarter',focus,explode:out.explode??0},
  ...(alpha!==undefined?{roleOpacity:{primary:1,context:alpha,ghost:alpha}}:{}),
  caption:{title:out.title??'',note:out.note??''},
 }) as Scene;
}
export function readUrlState():UrlState{const out:UrlState={};merge(location.search,out);merge(location.hash,out);synthesize(out);return out;}
/** Chrome-less canvas for the snapshot renderer; the class is styled in globals.css. */
export function setSnapMode(on:boolean){setModes(on,renderOn);}
/**
 * Two classes, one call site. RENDER MODE ALWAYS IMPLIES SNAP MODE -- the teaching plate
 * hides everything the snapshot hides plus a little more, and duplicating the hide list
 * across two rules is how the two would drift apart.
 */
export function setModes(snap:boolean,render:boolean){
 snapOn=snap||render;renderOn=render;
 document.body.classList.toggle('snap-mode',snapOn);
 document.body.classList.toggle('render-mode',renderOn);
}
/** Mirror the scene into the query string. Defaults are omitted so a plain visit keeps a clean URL. */
export function writeUrlState(state:SceneState,selectIds:readonly string[],caption:{title?:string;note?:string},lang:Lang='en'){
 const p=new URLSearchParams();
 if(selectIds.length)p.set('select',selectIds.join(','));
 if(lang!=='en')p.set('lang',lang);
 if(sorted(state.visible)!==sorted(DEFAULT_VISIBLE))p.set('system',state.visible.length?state.visible.join(','):'none');
 if(state.isolate)p.set('isolate','1');
 if(state.view!=='three-quarter')p.set('view',state.view);
 if(state.explode>0)p.set('explode',state.explode.toFixed(2));
 if(snapOn)p.set('snap','1');
 if(caption.title)p.set('title',caption.title);
 if(caption.note)p.set('note',caption.note);
 // The blob is written back VERBATIM, never re-encoded from live state: a plate URL a
 // human copies out of the address bar must reproduce the same picture, and re-deriving
 // it from React state would quietly lose whatever the scene carries but the page does
 // not hold (styles, annotations, background, size).
 if(lastBlob)p.set('scene',lastBlob);
 const query=p.toString();
 const next=`${location.pathname}${query?`?${query}`:''}${location.hash}`;
 if(next!==`${location.pathname}${location.search}${location.hash}`)history.replaceState(history.state,'',next);
}
/** Machine-readable load/selection markers for headless verification and batch rendering. */
export function markReady(){document.documentElement.dataset.atlasReady='1';}
export function markSelected(ids:readonly string[]){
 if(ids.length)document.documentElement.dataset.atlasSelected=ids.join(',');
 else document.documentElement.removeAttribute('data-atlas-selected');
}
/** Which scene is on screen, so the renderer can tell a re-driven tab from a stale one. */
export function markScene(blob:string){
 lastBlob=blob;
 if(blob)document.documentElement.dataset.atlasScene=blob.slice(0,16);
 else document.documentElement.removeAttribute('data-atlas-scene');
}
/**
 * SETTLED. The renderer screenshots on this marker instead of on a fixed sleep, because
 * the camera fit is animated (OrbitControls damping) and a sleep can capture it mid-flight
 * -- then R2 caches that half-flown frame for 24 hours under a perfectly valid key.
 * It MUST be cleared before a re-drive or a reused tab's previous marker satisfies the
 * wait instantly, which is the same bug class the exact-selection wait exists to prevent.
 */
export function markSettled(on:boolean){
 if(on)document.documentElement.dataset.atlasSettled='1';
 else document.documentElement.removeAttribute('data-atlas-settled');
}
/**
 * A LOUD FAILURE. Without this a load error renders as a silently BLANK plate: the error
 * card carries `.loading`, which snap mode hides, so the Worker gets HTTP 200, caches the
 * blank picture for 24 hours, and serves it as an answer.
 */
export function markError(code:string){
 if(code)document.documentElement.dataset.atlasError=code;
 else document.documentElement.removeAttribute('data-atlas-error');
}
