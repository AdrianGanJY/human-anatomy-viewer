/** Deep links: the explorer's scene state, readable and writable in the URL.
 * Read merges `location.search` then `location.hash`, so the hash wins -- an agent
 * (or the snapshot renderer) can re-drive an already-loaded page by setting
 * `location.hash` alone, with no reload. Writes use replaceState only, so browsing
 * the atlas never fills the back button.
 * Fork-local addition (L30); kept in its own file so an upstream rebase stays trivial.
 */
import {DEFAULT_VISIBLE,SYSTEMS,type SceneState,type SystemId,type View} from './anatomy';
export interface UrlState {select?:string;visible?:SystemId[];isolate?:boolean;view?:View;explode?:number;snap?:boolean}
const VIEWS:string[]=['three-quarter','front','back','side'];
const SYSTEM_IDS=new Set<string>(SYSTEMS.map(s=>s.id));
const TRUTHY=new Set(['1','true','yes','on']),FALSY=new Set(['0','false','no','off']);
let snapOn=false;
const flag=(value:string|null)=>value===null?undefined:TRUTHY.has(value.toLowerCase())?true:FALSY.has(value.toLowerCase())?false:undefined;
const sorted=(ids:readonly string[])=>[...ids].sort().join(',');
/** Later sources overwrite earlier ones; an unparseable value is ignored, never guessed. */
function merge(source:string,out:UrlState){
 const p=new URLSearchParams(source.replace(/^[#?]/,''));
 const select=p.get('select');if(select&&select.trim())out.select=select.trim();
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
 return out;
}
export function readUrlState():UrlState{const out:UrlState={};merge(location.search,out);merge(location.hash,out);return out;}
/** Chrome-less canvas for the snapshot renderer; the class is styled in globals.css. */
export function setSnapMode(on:boolean){snapOn=on;document.body.classList.toggle('snap-mode',on);}
/** Mirror the scene into the query string. Defaults are omitted so a plain visit keeps a clean URL. */
export function writeUrlState(state:SceneState,selectId:string|null){
 const p=new URLSearchParams();
 if(selectId)p.set('select',selectId);
 if(sorted(state.visible)!==sorted(DEFAULT_VISIBLE))p.set('system',state.visible.length?state.visible.join(','):'none');
 if(state.isolate)p.set('isolate','1');
 if(state.view!=='three-quarter')p.set('view',state.view);
 if(state.explode>0)p.set('explode',state.explode.toFixed(2));
 if(snapOn)p.set('snap','1');
 const query=p.toString();
 const next=`${location.pathname}${query?`?${query}`:''}${location.hash}`;
 if(next!==`${location.pathname}${location.search}${location.hash}`)history.replaceState(history.state,'',next);
}
/** Machine-readable load/selection markers for headless verification and batch rendering. */
export function markReady(){document.documentElement.dataset.atlasReady='1';}
export function markSelected(id:string|null){
 if(id)document.documentElement.dataset.atlasSelected=id;
 else document.documentElement.removeAttribute('data-atlas-selected');
}
