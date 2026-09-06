import {flushSync} from 'react-dom';
import {registerAtlasTools} from './agent-tools';
import {markError,markReady,markScene,markSelected,markSettled,readUrlState,setModes,writeUrlState,type UrlState} from './url-state';
import {encodeScene,sceneSelectIds,structureOpacity,type Scene} from './scene-model';
const NO_IDS:string[]=[];
import {useEffect,useMemo,useRef,useState} from 'react';
import {Activity,ArrowUpRight,ChevronRight,Focus,Info,Layers3,ListChecks,Pause,Plus,RotateCcw,RotateCw,Search,X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Slider} from '@/components/ui/slider';
import {Switch} from '@/components/ui/switch';
import {Sheet,SheetContent,SheetTitle,SheetDescription} from '@/components/ui/sheet';
import {Combobox,ComboboxInput,ComboboxContent,ComboboxList,ComboboxItem,ComboboxEmpty} from '@/components/ui/combobox';
import AnatomyScene from './scene';
import {DEFAULT_VISIBLE,SYSTEMS,EXPLANATIONS,explanation,type Atlas,type Concept,type SceneState,type SystemId,type View} from './anatomy';
import {addPick,dedupe,removePick,resolvePicks,sameIds,unionElements,type Pick} from './selection';
import {LANGS,LANG_LABELS,UI,isLang,type Lang} from './i18n/ui';
import {loadZhDicts,makeT,searchKeys,type Dicts} from './i18n/dict';
const initial:SceneState={explode:0,visible:DEFAULT_VISIBLE,selected:[],isolate:false,view:'three-quarter',rotate:false,reset:0};
/** A click inside a combobox row must not also commit the row. */
const stop=(e:{stopPropagation:()=>void})=>e.stopPropagation();
export default function Home(){
 const detailTitle=useRef<HTMLHeadingElement>(null);
 const [atlas,setAtlas]=useState<Atlas|null>(null),[state,setState]=useState(initial),[progress,setProgress]=useState(0),[error,setError]=useState(''),[panel,setPanel]=useState<'layers'|'search'|'basket'|null>(null),[details,setDetails]=useState(false),[about,setAbout]=useState(false),[query,setQuery]=useState('');
 // THE SELECTION BASKET. `picks` is the source of truth: the ids the CALLER asked for
 // (concept ids and/or part ids), in order. It is what the URL round-trips, what
 // `data-atlas-selected` reports, and what the basket panel lists -- `state.selected` is the
 // expanded union of their meshes, derived from this below and written by nothing else.
 const [picks,setPicks]=useState<string[]>(NO_IDS);
 // Which pick the detail sheet is showing. Null means "the first", which is what a link
 // naming several structures should open on; adding one focuses what was just added.
 const [focusId,setFocusId]=useState<string|null>(null);
 // LANGUAGE. `dicts` holds BOTH Chinese scripts once either is chosen, because search matches
 // across every loaded script -- typing 牙齿 finds the tooth whichever script the UI is in.
 const [lang,setLang]=useState<Lang>('en'),[dicts,setDicts]=useState<Dicts>({});
 const t=useMemo(()=>makeT(lang,dicts[lang]),[lang,dicts]);
 const applyLang=(next:Lang)=>{
  setLang(next);
  try{localStorage.setItem('atlas.lang',next);}catch{/* private browsing; the URL still carries it */}
  document.documentElement.lang=next==='en'?'en':next;
  if(next!=='en')void loadZhDicts().then(setDicts);
 };
 // What the browser remembered, applied before the atlas arrives. A `lang=` in the URL beats
 // it (applyUrl below), because a link should decide what it opens in.
 useEffect(()=>{
  let stored:string|null=null;try{stored=localStorage.getItem('atlas.lang');}catch{/* ignore */}
  const initial=readUrlState().lang??(isLang(stored)?stored:null);
  if(initial&&initial!=='en')applyLang(initial);
 },[]);
 // The assistant's own words, rendered verbatim over the scene. Text nodes only.
 const [caption,setCaption]=useState<{title?:string;note?:string}>({});
 // L30 P4 -- THE TEACHING SCENE. Present only when the URL carried one (`scene=`, or the
 // PRD's `mode=render` alias form). While it is set the page is a PLATE, not an explorer:
 // roles decide opacity, `camera.focus` decides framing, and every field the scene owns is
 // applied EXPLICITLY on each re-drive. That last part is load-bearing on a warm tab -- an
 // empty value resets nothing except title/note, so "clear the legacy keys" does not work
 // and only an authoritative apply can stop the previous request bleeding into this one.
 const [scene,setScene]=useState<Scene|null>(null);
 useEffect(()=>{const abort=new AbortController();setProgress(0);setError('');setAtlas(null);setPicks(NO_IDS);setFocusId(null);setDetails(false);setState({...initial,visible:DEFAULT_VISIBLE});fetch('/models/atlas.json',{signal:abort.signal}).then(r=>{if(!r.ok)throw new Error(UI['load.failed']);return r.json();}).then(data=>setAtlas(data as Atlas)).catch(e=>{if(e.name!=='AbortError'){markError('atlas');setError(e.message);}});return()=>abort.abort();},[]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='/'&&!(e.target instanceof HTMLInputElement)&&!(e.target instanceof HTMLTextAreaElement)){e.preventDefault();setPanel('search');setDetails(false);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[]);
 const parts=useMemo(()=>new Map(atlas?.parts.map(p=>[p.id,p])),[atlas]);
 const conceptsById=useMemo(()=>new Map(atlas?.concepts.map(c=>[c.id,c])),[atlas]);
 const counts=useMemo(()=>Object.fromEntries(SYSTEMS.map(s=>[s.id,atlas?.parts.filter(p=>p.system===s.id).length??0])),[atlas]);
 const activeSystems=SYSTEMS.filter(s=>counts[s.id]>0);
 /** The basket, resolved. An id this atlas has never heard of is dropped HERE and nowhere
  * else, so a stale link degrades to a shorter selection instead of an error. */
 const basket=useMemo(()=>resolvePicks(conceptsById,parts,picks),[conceptsById,parts,picks]);
 const focused=useMemo(()=>basket.find(p=>p.id===focusId)??basket[0]??null,[basket,focusId]);
 /** What the detail sheet renders. Derived, never stored: a `chosen` that could disagree
  * with `picks` was the one desync worth designing out of this file. */
 const chosen=useMemo<Concept|null>(()=>focused?{id:focused.conceptId,name:focused.name,elements:focused.elements}:null,[focused]);
 const selectedParts=state.selected.map(id=>parts.get(id)).filter(p=>!!p),selected=selectedParts[0],system=SYSTEMS.find(s=>s.id===selected?.system);
 const visibleCount=atlas?.parts.filter(p=>state.isolate?state.selected.includes(p.id):state.visible.includes(p.system)||state.selected.includes(p.id)).length??0;
 /** Search matches the English name, the atlas id, AND every loaded Chinese script — so
  * 臀中肌 finds gluteus medius whether the interface is in Chinese or not. */
 const results=useMemo(()=>{if(!atlas)return[];const term=query.toLowerCase().trim();if(!term)return ['heart','brain','liver','stomach','spleen','pancreas','urinary bladder','trachea'].map(name=>atlas.concepts.find(c=>c.name.toLowerCase()===name)).filter((x):x is Concept=>!!x);return atlas.concepts.filter(c=>searchKeys(c.id,c.name,dicts).some(k=>k.includes(term))).sort((a,b)=>t.name(a.id,a.name).length-t.name(b.id,b.name).length||a.name.length-b.name.length).slice(0,80);},[atlas,query,dicts,t]);
 /** `state.selected` is DERIVED from the basket, and this is its ONLY writer. Every other
  * path changes `picks` and lets this effect move the scene, so the list, the URL and the
  * 3D view can never be three different opinions about what is selected. */
 useEffect(()=>{if(!atlas)return;const union=unionElements(basket);setState(s=>sameIds(s.selected,union)?s:{...s,selected:union});},[atlas,basket]);
 const known=(id:string)=>conceptsById.has(id)||parts.has(id);
 /** Start a new selection. A tap on the 3D view, a search result or a link REPLACES the
  * basket -- upstream's ergonomics. `+`, Shift-click and the sheet's add button are the
  * add paths. Ids that resolve to nothing are skipped, so `data-atlas-selected` still
  * names only what actually resolved. */
 const replacePicks=(ids:readonly string[])=>{const next=dedupe(ids).filter(known);if(!next.length)return;setPicks(next);setFocusId(null);setState(s=>({...s,isolate:false,rotate:false}));setDetails(true);setPanel(null);};
 /** Add without disturbing what is already there, and focus what was added. `isolate` is
  * deliberately left alone: adding to a hide-others view should add TO that view. */
 const addToPicks=(id:string)=>{if(!known(id))return;setPicks(p=>addPick(p,id));setFocusId(id);setDetails(true);};
 const removeFromPicks=(id:string)=>{const next=removePick(picks,id);setPicks(next);if(!next.length){setState(s=>({...s,isolate:false}));setDetails(false);}};
 const clearPicks=()=>{setPicks(NO_IDS);setFocusId(null);setState(s=>({...s,isolate:false}));setDetails(false);};
 /** Tapping a basket row focuses it: the sheet follows and the camera re-frames, but the
  * set does not change. */
 const focusPick=(id:string)=>{setFocusId(id);setDetails(true);setState(s=>({...s,reset:s.reset+1,rotate:false}));};
 const choose=(c:Concept)=>replacePicks([c.id]);
 const choosePart=(id:string,add?:boolean)=>{if(!parts.has(id))return;if(add)addToPicks(id);else replacePicks([id]);};
 /** Pressing a search row's `+` makes the combobox fire onOpenChange(false) -- and THAT is
  * what was closing the search panel, not the add itself (measured: the selection was correct
  * and only the panel vanished). The flag tells the close handler to ignore exactly that one,
  * and expires on its own so a genuine dismiss a moment later still closes the panel. */
 const adding=useRef(false);
 const armAdd=(e:{stopPropagation:()=>void;preventDefault:()=>void})=>{adding.current=true;setTimeout(()=>{adding.current=false;},600);e.preventDefault();e.stopPropagation();};
 /** The in-page tools read the LIVE basket, not the one that existed when they registered. */
 const live=useRef<Pick[]>(basket);live.current=basket;
 useEffect(()=>{if(!atlas)return;return registerAtlasTools(atlas,c=>flushSync(()=>choose(c)),id=>flushSync(()=>addToPicks(id)),()=>live.current.map(p=>({id:p.id,name:p.name,pieces:p.elements.length})));},[atlas]);
 const applyUrl=(u:UrlState)=>{
  // A re-drive is not settled and has no error until this one proves otherwise. These two
  // MUST be first: a reused tab still carrying the previous request's markers satisfies the
  // renderer's waits instantly, which is exactly the bug the exact-selection wait exists to
  // prevent, one level up.
  markSettled(false);markError('');
  if(u.scene){
   // AUTHORITATIVE. Every field the scene owns is set from the scene, legacy keys ignored,
   // so a warm tab that previously served a plain `select=` render is fully overwritten.
   const sc=u.scene;
   setScene(sc);
   markScene(u.sceneBlob??encodeScene(sc));
   // An EXPLORE scene is a human opening the link the tool handed him: he gets the roles,
   // the opacities and the framing, but he must also get the chrome back or the "interactive
   // 3D" link opens a picture he cannot interact with. Only `render` forces snap mode.
   setModes(sc.mode==='render'||!!u.snap,sc.mode==='render');
   applyLang(sc.lang);
   setCaption({title:sc.caption.place==='in'&&sc.caption.title?sc.caption.title:undefined,note:sc.caption.place==='in'&&sc.caption.note?sc.caption.note:undefined});
   if(atlas)replacePicks(sceneSelectIds(sc));
   setState(s=>({...s,
    view:sc.camera.view,explode:sc.camera.explode,rotate:sc.camera.rotate,
    // `rest:none` is today's isolate exactly, so every P1-P3 deep link keeps working.
    isolate:sc.rest.include==='none',
    visible:sc.rest.include==='skeletal'?['skeletal']:s.visible,
    reset:s.reset+1}));
   return;
  }
  setScene(null);markScene('');
  setModes(!!u.snap,false);if(u.lang)applyLang(u.lang);if(u.title!==undefined||u.note!==undefined)setCaption({title:u.title,note:u.note});if(u.select&&atlas)replacePicks(u.select);setState(s=>({...s,...(u.visible?{visible:u.visible}:{}),...(u.view?{view:u.view}:{}),...(u.explode!==undefined?{explode:u.explode}:{}),...(u.isolate!==undefined?{isolate:u.isolate}:{}),reset:s.reset+1}));};
 /** Role -> per-PART alpha, and the framing set, both expanded through the resolved basket
  *  because a scene names CONCEPTS while the renderer speaks in meshes. A fresh object
  *  identity every time, because the animate loop's change guard is reference equality. */
 const plate=useMemo(()=>{
  if(!scene)return null;
  const alpha=structureOpacity(scene) as Record<string,number>;
  const roleOf=new Map(scene.structures.map(s=>[s.id,s.role]));
  const wantFocus=new Set(scene.camera.focus);
  const opacity:Record<string,number>={},focus:string[]=[],primary:string[]=[];
  for(const p of basket){
   const a=alpha[p.id];
   for(const el of p.elements){
    // A mesh shared by two named structures takes the MOST opaque of them: primary wins.
    if(a!==undefined)opacity[el]=Math.max(opacity[el]??0,a);
    if(roleOf.get(p.id)==='primary')primary.push(el);
    if(wantFocus.has(p.id))focus.push(el);
   }
  }
  return {opacity,focus,primary,
   focusPadding:scene.camera.padding,
   restOpacity:scene.rest.include==='skeletal'?scene.rest.opacity:undefined,
   render:scene.mode==='render',background:scene.background,ss:scene.ss};
 },[scene,basket]);
 const urlApplied=useRef(false);
 useEffect(()=>{if(!atlas||urlApplied.current)return;urlApplied.current=true;applyUrl(readUrlState());},[atlas]);
 useEffect(()=>{if(!atlas)return;const reapply=()=>applyUrl(readUrlState());window.addEventListener('hashchange',reapply);return()=>window.removeEventListener('hashchange',reapply);},[atlas]);
 useEffect(()=>{markSelected(picks);},[picks]);
 useEffect(()=>{if(!atlas)return;const timer=setTimeout(()=>writeUrlState(state,picks,caption,lang),150);return()=>clearTimeout(timer);},[atlas,state,picks,caption,lang]);
 /** One writer for "which systems are visible" -- it also empties the basket, because a
  * selection you can no longer see is a list that lies. */
 const setSystems=(visible:SystemId[])=>{setDetails(false);setPicks(NO_IDS);setFocusId(null);setState(s=>({...s,isolate:false,visible}));};
 const toggle=(id:SystemId)=>setSystems(state.visible.includes(id)?state.visible.filter(x=>x!==id):[...state.visible,id]);
 const reset=()=>{setState(s=>({...initial,visible:DEFAULT_VISIBLE,reset:s.reset+1}));setPicks(NO_IDS);setFocusId(null);setCaption({});setDetails(false);setPanel(null);};
 const openPanel=(next:'layers'|'search'|'basket')=>{setDetails(false);setPanel(p=>p===next?null:next);};
 /** The explanation the sheet shows: the structure's own when the atlas has one, otherwise
  * its system's — translated where a dictionary is loaded, English otherwise. */
 const describe=(name:string|undefined,sys:SystemId|undefined)=>{
  if(!name||!sys)return '';
  const en=explanation(name,sys),key=name.toLowerCase();
  return EXPLANATIONS[key]?t.explanation(key,en):t.systemDesc(sys,en);
 };
 return <main className="studio">
  {/* L30 P4: `plate` is spread last, so a teaching scene owns opacity, focus and framing.
      inspectorOpen is forced FALSE in render mode: the detail sheet is display:none there,
      but the camera fit still reserves 335-370 px on the right for it, which is a large
      part of why the PRD says the subject occupies about a fifth of the frame. */}
  {atlas&&<AnatomyScene atlas={atlas} state={{...state,inspectorOpen:!plate?.render&&details&&selectedParts.length>0,...(plate??{})}} onSelect={choosePart} onProgress={n=>{setProgress(n);if(n===100){setError('');markReady();}}} onError={e=>{markError('load');setError(e);}}/>}
  <div className="vignette"/>
  <header className="identity"><div className="eyebrow"><span className="status-dot"/> {t.ui('app.eyebrow')}</div><h1>{t.ui('app.title')}<Badge variant="outline" className="edition">3D</Badge></h1><div className="identity-meta">{t.ui('app.pieces',{n:(atlas?atlas.parts.length:2234).toLocaleString()})} <span>·</span> BodyParts3D</div></header>
  {/* One node, positioned per breakpoint (under the header on a desktop, bottom-left on a
      phone, where the measured layout actually has room). Rendering it twice would duplicate
      it for a screen reader. */}
  <div className="lang-switch glass" role="group" aria-label={t.ui('app.lang')}>{LANGS.map(l=><button type="button" key={l} lang={l} className={lang===l?'active':''} aria-pressed={lang===l} onClick={()=>applyLang(l)}>{LANG_LABELS[l]}</button>)}</div>
  <nav className="top-actions" aria-label={t.ui('nav.panels')}><Button variant="ghost" className={`basket-button ${panel==='basket'?'active':''}`} onClick={()=>openPanel('basket')} aria-label={t.ui('nav.basketAria')}><ListChecks size={18}/><span>{t.ui('nav.basket')}</span><i className="pick-count">{picks.length}</i></Button><Button variant="ghost" className={panel==='search'?'active':''} onClick={()=>openPanel('search')} aria-label={t.ui('nav.searchAria')}><Search size={18}/><span>{t.ui('nav.search')}</span><kbd>/</kbd></Button><Button variant="ghost" className="icon-button" aria-label={t.ui('nav.about')} onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}><Info size={18}/></Button></nav>
  <section className={`layers-panel glass ${panel==='layers'?'mobile-open':''}`} aria-label={t.ui('layers.aria')}>
   <div className="panel-heading"><span>{t.ui('layers.heading')}</span><Button variant="ghost" className="mobile-only icon-button" onClick={()=>setPanel(null)} aria-label={t.ui('layers.close')}><X size={18}/></Button><Badge variant="secondary" className="desktop-only small-number">{activeSystems.length}</Badge></div>
   <div className="layer-presets"><Button variant="ghost" aria-pressed={activeSystems.every(x=>state.visible.includes(x.id))} onClick={()=>setSystems(activeSystems.map(x=>x.id))}>{t.ui('layers.all')}</Button><Button variant="ghost" aria-pressed={state.visible.length===1&&state.visible[0]==='skeletal'} onClick={()=>setSystems(['skeletal'])}>{t.ui('layers.skeleton')}</Button><Button variant="ghost" aria-pressed={state.visible.length===6&&['cardiac','respiratory','digestive','urinary','endocrine','reproductive'].every(id=>state.visible.includes(id as SystemId))} onClick={()=>setSystems(['cardiac','respiratory','digestive','urinary','endocrine','reproductive'])}>{t.ui('layers.organs')}</Button></div>
   <div className="system-list">{activeSystems.map(s=><div className={`system-row ${state.visible.includes(s.id)?'enabled':''}`} key={s.id}><Button variant="ghost" className="system-name" title={t.ui('layers.showOnly',{name:t.system(s.id,s.name).toLowerCase()})} onClick={()=>setSystems([s.id])}><span className="system-dot" style={{background:s.color}}/>{t.system(s.id,s.name)}<span className="system-count">{counts[s.id]}</span></Button><Switch checked={state.visible.includes(s.id)} onCheckedChange={()=>toggle(s.id)} aria-label={t.ui('layers.show',{name:t.system(s.id,s.name).toLowerCase()})} /></div>)}</div>
   <div className="panel-foot"><span>{t.ui('layers.visible',{n:visibleCount.toLocaleString()})}</span><Button variant="ghost" onClick={()=>setSystems([])}>{t.ui('layers.hideAll')}</Button></div>
  </section>
  {panel==='search'&&<section className="search-panel glass" aria-label={t.ui('search.aria')}><div className="panel-heading"><span>{t.ui('search.heading')}</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label={t.ui('search.close')}><X size={18}/></Button></div><Combobox<Concept> items={results} value={null} onValueChange={value=>{if(value)choose(value);}} inputValue={query} onInputValueChange={setQuery} itemToStringLabel={c=>t.name(c.id,c.name)} filter={null} open onOpenChange={open=>{if(!open&&!adding.current)setPanel(null);}}><ComboboxInput autoFocus placeholder={t.ui('search.placeholder')} aria-label={t.ui('search.inputAria')} showTrigger={false}/><ComboboxContent className="anatomy-search-results"><ComboboxEmpty>{t.ui('search.empty')}</ComboboxEmpty><ComboboxList>{(c:Concept)=><ComboboxItem key={c.id} value={c}><span className="search-result-name">{t.name(c.id,c.name)}</span>{t.secondary(c.id,c.name)&&<span className="result-en">{t.secondary(c.id,c.name)}</span>}<span className="small-number">{t.ui(c.elements.length===1?'search.piece':'search.pieces',{n:c.elements.length})}</span><Button variant="ghost" className={`result-add ${picks.includes(c.id)?'is-picked':''}`} aria-label={t.ui('search.add',{name:t.name(c.id,c.name)})} onPointerDown={armAdd} onMouseDown={armAdd} onPointerUp={stop} onClick={e=>{stop(e);addToPicks(c.id);}}><Plus size={15}/></Button></ComboboxItem>}</ComboboxList></ComboboxContent></Combobox><p className="search-note">{query?t.ui('search.noteMore'):t.ui('search.noteStart')}</p></section>}
  {panel==='basket'&&<section className="search-panel basket-panel glass" aria-label={t.ui('basket.aria')}>
   <div className="panel-heading"><span>{t.ui('basket.heading')}</span><Button variant="ghost" className="icon-button" onClick={()=>setPanel(null)} aria-label={t.ui('basket.close')}><X size={18}/></Button></div>
   {basket.length===0
    ?<p className="basket-empty">{t.ui('basket.empty')}</p>
    :<><div className="basket-list">{basket.map(pick=><div className={`basket-row ${focused?.id===pick.id?'is-focused':''}`} key={pick.id}>
      <Button variant="ghost" className="basket-name" onClick={()=>focusPick(pick.id)} aria-label={t.ui('basket.focus',{name:t.name(pick.id,pick.name)})}><span className="system-dot" style={{background:SYSTEMS.find(s=>s.id===pick.system)?.color??'#9aa3ab'}}/><span className="basket-text"><span className="basket-label">{t.name(pick.id,pick.name)}</span>{t.secondary(pick.id,pick.name)&&<span className="basket-en">{t.secondary(pick.id,pick.name)}</span>}</span><span className="small-number">{pick.elements.length}</span></Button>
      <Button variant="ghost" className="basket-remove" onClick={()=>removeFromPicks(pick.id)} aria-label={t.ui('basket.remove',{name:t.name(pick.id,pick.name)})}><X size={15}/></Button>
     </div>)}</div>
     <div className="panel-foot basket-foot">
      <div className="basket-hide"><Switch checked={state.isolate} onCheckedChange={()=>setState(s=>({...s,isolate:!s.isolate,explode:0}))} aria-label={t.ui('basket.hideOthersAria')}/><span>{t.ui('basket.hideOthers')}</span></div>
      <span className="basket-total">{t.ui('basket.piecesTotal',{n:state.selected.length.toLocaleString()})}</span>
      <Button variant="ghost" onClick={clearPicks}>{t.ui('basket.clear')}</Button>
     </div></>}
  </section>}
  <nav className="view-controls glass" aria-label={t.ui('view.aria')}>{(['three-quarter','front','side','back'] as View[]).map((v,i)=><Button variant="ghost" key={v} className={state.view===v?'active':''} aria-pressed={state.view===v} disabled={state.explode>.8&&v!=='front'} onClick={()=>setState(s=>({...s,view:v,reset:s.reset+1,rotate:false}))} title={t.ui(`view.${v}`)} aria-label={t.ui(`view.${v}`)}><span>{['¾','F','S','B'][i]}</span></Button>)}<i/><Button variant="ghost" disabled={state.explode>=.4} aria-label={t.ui(state.rotate?'view.pause':'view.rotate')} title={t.ui('view.autoRotate')} className={state.rotate?'active':''} onClick={()=>setState(s=>({...s,rotate:!s.rotate}))}>{state.rotate?<Pause size={17}/>:<RotateCw size={18}/>}</Button><Button variant="ghost" aria-label={t.ui('view.reset')} title={t.ui('view.resetShort')} onClick={reset}><RotateCcw size={17}/></Button></nav>
  <div className="scene-caption"><span className="caption-line"/><span>{state.isolate?(focused?t.name(focused.id,focused.name):t.ui('scene.selected')):state.explode>.95?t.ui('scene.inventory'):state.explode>.05?t.ui('scene.separated'):t.ui('scene.body')}</span><span className="caption-line"/></div>
  {(caption.title||caption.note)&&<aside className="atlas-caption glass" aria-label={t.ui('scene.captionAria')}>{caption.title&&<h2>{caption.title}</h2>}{caption.note&&<p>{caption.note}</p>}</aside>}
  <div className="bottom-dock glass"><Button variant="ghost" className="mobile-only dock-layers" onClick={()=>openPanel('layers')} aria-label={t.ui('dock.layers')}><Layers3 size={20}/><span>{t.ui('dock.systems')}</span></Button><div className="explode-control"><div className="explode-label"><label id="explode-label">{t.ui('dock.explode')}</label><output>{Math.round(state.explode*100)}<span>%</span></output></div><Slider aria-labelledby="explode-label" min={0} max={100} step={1} value={[state.explode*100]} onValueChange={v=>setState(s=>({...s,explode:(Array.isArray(v)?v[0]:v)/100,view:(Array.isArray(v)?v[0]:v)>80?'front':s.view,rotate:false}))}/><div className="slider-endpoints"><span>{t.ui('dock.assembled')}</span><span>{t.ui('dock.everyPiece')}</span></div></div><Button variant="ghost" className="dock-reset" onClick={reset} aria-label={t.ui('dock.reset')}><RotateCcw size={18}/><span>{t.ui('view.resetShort')}</span></Button></div>
  <footer className="studio-footer"><span>{t.ui(state.explode>.8?'foot.pan':'foot.orbit')} <b>·</b> {t.ui('foot.zoom')} <b>·</b> {t.ui('foot.tap')}</span><Button variant="ghost" onClick={()=>{setDetails(false);setPanel(null);setAbout(true);}}>{t.ui('foot.credits')} <ArrowUpRight size={12}/></Button></footer>
  {progress<100&&!error&&<div className="loading glass" role="status"><Activity size={18}/><div><strong>{t.ui('load.preparing')}</strong><span>{t.ui('load.progress',{p:progress,n:(atlas?atlas.parts.length:2234).toLocaleString()})}</span><div className="loading-track"><i style={{width:`${progress}%`}}/></div></div></div>}
  {error&&<div className="loading glass error" role="alert"><p>{error}</p><Button variant="ghost" onClick={()=>location.reload()}>{t.ui('load.reload')}</Button></div>}
  <Sheet open={details&&selectedParts.length>0} modal={false} disablePointerDismissal onOpenChange={setDetails}><SheetContent initialFocus={detailTitle} className={`detail-sheet glass ${state.isolate?'is-isolated':''}`} showCloseButton={true}><div className="detail-header"><div className="detail-accent" style={{background:system?.color}}/><div className="eyebrow">{system?t.system(system.id,system.name):t.ui('detail.anatomy')}</div><SheetTitle ref={detailTitle} tabIndex={-1} className="structure-title">{focused?t.name(focused.id,focused.name):''}</SheetTitle>{focused&&t.secondary(focused.id,focused.name)&&<div className="structure-en">{t.secondary(focused.id,focused.name)}</div>}</div><div className="detail-scroll" key={`${chosen?.id}-${state.isolate}`}><SheetDescription className="structure-description">{describe(chosen?.name,selected?.system)}</SheetDescription>{chosen&&!EXPLANATIONS[chosen.name.toLowerCase()]&&<span className="context-note">{t.ui('detail.contextNote')}</span>}<div className="structure-meta"><span>{t.ui('detail.reference')}<strong>{chosen?.id}</strong></span><span>{t.ui('detail.selectedPieces')}<strong>{state.selected.length.toLocaleString()}</strong></span></div>{selectedParts.length>1&&<div className="member-list"><h3>{t.ui('detail.included')}</h3>{selectedParts.slice(0,50).map(p=><div className="member-row" key={p.id}><Button variant="ghost" className="member-open" onClick={()=>choosePart(p.id)}><span>{t.name(p.id,p.name)}</span><ChevronRight size={14}/></Button><Button variant="ghost" className={`member-add ${picks.includes(p.id)?'is-picked':''}`} onClick={()=>addToPicks(p.id)} aria-label={t.ui('search.add',{name:t.name(p.id,p.name)})}><Plus size={14}/></Button></div>)}{selectedParts.length>50&&<p>{t.ui('detail.andMore',{n:selectedParts.length-50})}</p>}</div>}<a className="source-link" href="https://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer">{t.ui('detail.source')} <ArrowUpRight size={14}/></a></div><div className="detail-actions"><Button className={`primary-action ${state.isolate?'active':''}`} onClick={()=>setState(s=>({...s,isolate:!s.isolate,explode:0}))}><Focus size={18}/>{t.ui(state.isolate?'detail.unisolate':'detail.isolate')}<ChevronRight size={16}/></Button>{focused?.kind==='part'&&!picks.includes(focused.conceptId)&&conceptsById.has(focused.conceptId)&&<Button variant="ghost" className="secondary-action add-action" onClick={()=>addToPicks(focused.conceptId)}><Plus size={14}/>{t.ui('detail.add')}</Button>}<Button variant="ghost" className="secondary-action" onClick={clearPicks}>{t.ui('detail.clear')}</Button></div></SheetContent></Sheet>
  <Sheet open={about} onOpenChange={setAbout}><SheetContent className="about-sheet glass"><div className="eyebrow">{t.ui('about.eyebrow')}</div><SheetTitle className="structure-title">{t.ui('about.title')}</SheetTitle><SheetDescription>{t.ui('about.lead')}</SheetDescription><div className="about-copy"><p><strong>{t.ui('about.p1strong')}</strong><br/>{t.ui('about.p1')}</p><p>{t.ui('about.p2')}</p><p>{t.ui('about.p3')}</p><h3>{t.ui('about.sourceHeading')}</h3><p>{t.ui('about.sourceBody')}</p><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html" target="_blank" rel="noreferrer">{t.ui('about.licence')} <ArrowUpRight size={14}/></a><a href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/download.html" target="_blank" rel="noreferrer">{t.ui('about.geometry')} <ArrowUpRight size={14}/></a><a href="https://academic.oup.com/nar/article/37/suppl_1/D782/1000752" target="_blank" rel="noreferrer">{t.ui('about.paper')} <ArrowUpRight size={14}/></a></div></SheetContent></Sheet>
 </main>;
}
