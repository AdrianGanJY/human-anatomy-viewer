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
 */
import {DEFAULT_VISIBLE,SYSTEMS,type SceneState,type SystemId,type View} from './anatomy';
import {isLang,type Lang} from './i18n/ui';
export interface UrlState {select?:string[];visible?:SystemId[];isolate?:boolean;view?:View;explode?:number;snap?:boolean;title?:string;note?:string;lang?:Lang}
/** Bounds. A caption is a caption, not a document; a selection of everything is not a selection. */
export const TITLE_MAX=80,NOTE_MAX=600,SELECT_MAX=24;
const VIEWS:string[]=['three-quarter','front','back','side'];
const SYSTEM_IDS=new Set<string>(SYSTEMS.map(s=>s.id));
const TRUTHY=new Set(['1','true','yes','on']),FALSY=new Set(['0','false','no','off']);
let snapOn=false;
const flag=(value:string|null)=>value===null?undefined:TRUTHY.has(value.toLowerCase())?true:FALSY.has(value.toLowerCase())?false:undefined;
const sorted=(ids:readonly string[])=>[...ids].sort().join(',');
/** Collapse whitespace and clip -- a pasted paragraph of newlines must not become a wall. */
const text=(v:string|null,max:number)=>{if(v===null)return undefined;const t=v.replace(/\s+/g,' ').trim();return t?t.slice(0,max):'';};
/** Later sources overwrite earlier ones; an unparseable value is ignored, never guessed. */
function merge(source:string,out:UrlState){
 const p=new URLSearchParams(source.replace(/^[#?]/,''));
 const select=p.get('select');
 if(select!==null){
  // Deduped in order, so `?select=A,A,B` selects two things and reports two.
  const ids=[...new Set(select.split(',').map(s=>s.trim()).filter(Boolean))].slice(0,SELECT_MAX);
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
 // `size` is deliberately NOT read here: it is the renderer's viewport, and the
 // live page's viewport is the browser window. Ignored, not rejected.
 return out;
}
export function readUrlState():UrlState{const out:UrlState={};merge(location.search,out);merge(location.hash,out);return out;}
/** Chrome-less canvas for the snapshot renderer; the class is styled in globals.css. */
export function setSnapMode(on:boolean){snapOn=on;document.body.classList.toggle('snap-mode',on);}
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
