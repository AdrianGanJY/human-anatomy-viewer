/** Loading and reading the Chinese dictionaries.
 *
 * The dictionaries are built ahead of time by `scripts/build-zh.mjs` into
 * `public/i18n/zh-Hans.json` and `public/i18n/zh-Hant.json` (~5,700 names each). They are
 * fetched LAZILY — an English visit never downloads them — and BOTH are fetched the first
 * time either Chinese script is chosen, because search matches across every loaded script:
 * typing 牙齿 should find the tooth whether the interface is 简体 or 繁體.
 *
 * Fork-local (L30 P3).
 */
import {UI,fmt,type Lang} from './ui.ts';

export interface Dict {
 version:number;lang:string;
 concepts:Record<string,string>;parts:Record<string,string>;
 systems:Record<string,{name:string;description:string}>;
 explanations:Record<string,string>;ui:Record<string,string>;
}
export type Dicts=Partial<Record<Lang,Dict>>;

const PATHS:Partial<Record<Lang,string>>={'zh-Hans':'/i18n/zh-Hans.json','zh-Hant':'/i18n/zh-Hant.json'};

/** A missing static asset on Cloudflare Pages is answered with the SPA shell at HTTP **200**
 *  (measured on this very project in P2). So `res.ok` proves nothing here: the content type
 *  and the shape are what distinguish a dictionary from the app's own home page. */
async function fetchDict(lang:Lang):Promise<Dict|null>{
 const path=PATHS[lang];
 if(!path)return null;
 try{
  const res=await fetch(path,{headers:{Accept:'application/json'}});
  if(!res.ok)return null;
  if(!/application\/json/i.test(res.headers.get('content-type')??''))return null;
  const body=await res.json() as Dict;
  if(!body||typeof body!=='object'||!body.concepts||!body.ui)return null;
  return body;
 }catch{return null;}
}

/**
 * ── PER-LANE, NOT PER-PAIR (L31 v2.1b+c, S2 — opus-plan-review-2.md RC9) ────────────────────────
 *
 * The first version memoised the PAIR: one `inflight` promise for both dictionaries, cleared only
 * when BOTH lanes failed. So a PARTIAL failure — zh-Hant 500s, zh-Hans succeeds, which is the
 * ordinary shape of a CDN hiccup because the two are separate requests — was cached as success for
 * the life of the page. `繁體` search then stayed silently broken until a reload, and nothing in the
 * UI could retry it: the memo said the load had already happened.
 *
 * Each lane now memoises itself, and a lane that FAILED drops its memo, so the next palette open
 * retries exactly the missing one and leaves the loaded one alone. `loadedLanes()` is what lets the
 * palette say "one script is missing, retrying" instead of quietly returning fewer matches.
 */
const LANES:Lang[]=['zh-Hans','zh-Hant'];
const loaded:Dicts={};
const inflight:Partial<Record<Lang,Promise<Dict|null>>>={};

/** One lane. Resolved from cache when it has already succeeded; retried when it has not. */
function loadLane(lang:Lang):Promise<Dict|null>{
 const have=loaded[lang];
 if(have)return Promise.resolve(have);
 let p=inflight[lang];
 if(!p){
  p=fetchDict(lang).then((d)=>{
   if(d)loaded[lang]=d;
   // A FAILED LANE FORGETS ITSELF. Without this the rejection is memoised as "there is no
   // 繁體", which is a claim a 500 does not license.
   else inflight[lang]=undefined;
   return d;
  }).catch(()=>{inflight[lang]=undefined;return null;});
  inflight[lang]=p;
 }
 return p;
}

/** The lanes that are loaded RIGHT NOW, without starting a fetch. The palette reads this to decide
 *  whether it may say "no results" yet: `spec.md` — "No 'no results' before dictionaries finish." */
export const loadedLanes=():Lang[]=>LANES.filter((l)=>!!loaded[l]);
/** True when at least one lane is still missing, so the next open has something to retry. */
export const zhPartial=():boolean=>loadedLanes().length<LANES.length;

/** Both Chinese dictionaries. Safe to call repeatedly: loaded lanes are reused, missing ones retried.
 *  The returned map is a SNAPSHOT — a fresh object each call, so React sees a new reference and a
 *  lane that arrived on a retry actually re-renders the results. */
export function loadZhDicts():Promise<Dicts>{
 return Promise.all(LANES.map(loadLane)).then(()=>({...loaded}));
}

/** Reading side. Every lookup takes the English as its fallback, so a name the dictionary
 *  happens not to carry renders in English instead of disappearing. */
export interface T {
 lang:Lang;
 zh:boolean;
 ui(key:string,vars?:Record<string,string|number>):string;
 name(id:string,en:string):string;
 secondary(id:string,en:string):string|null;
 /**
  * L31 v2.1a — A NAME IN A NAMED SCRIPT, INDEPENDENT OF THE INTERFACE LANGUAGE.
  *
  * `secondary` cannot do this and must not be changed to (v21-design.md:930, critic gap 10):
  * `makeT` sets `const zh = lang !== 'en' && !!dict`, so in EN mode `secondary` returns null BY
  * DESIGN — there is nothing to pair the English with. But cross-script search MATCHES on the
  * Chinese name in EN mode (`searchKeys` reads every loaded dictionary), so a palette row could
  * match "胸骨" and then have no accessor able to DISPLAY the spelling it matched on. That is the
  * gap: a result the reader cannot see the reason for.
  *
  * So `alt` reads the requested script's dictionary DIRECTLY, and returns null when that dictionary
  * is not loaded or has no entry — never a silent English fallback, because "the Chinese name is
  * the English name" is a claim this accessor must not make. `secondary` is deliberately untouched.
  */
 alt(id:string,script:Lang):string|null;
 system(id:string,en:string):string;
 systemDesc(id:string,en:string):string;
 explanation(name:string,en:string):string;
}

/**
 * `all` is the FULL dictionary map, and it is optional so every existing call site keeps working:
 * `makeT(lang, dicts[lang])` behaves exactly as before, with `alt` simply returning null. A caller
 * that wants cross-script display passes the map as well.
 */
export function makeT(lang:Lang,dict:Dict|null|undefined,all?:Dicts):T{
 const zh=lang!=='en'&&!!dict;
 const look=(id:string)=>dict?(dict.concepts[id]??dict.parts[id]):undefined;
 return {
  lang,zh,
  // `all` first, then the dictionary this T was built with — so `alt(id, lang)` works even when the
  // caller passed only the active dictionary. `alt(id,'en')` is null on purpose: English names live
  // in atlas.json, not in a dictionary, and the caller already has the English in hand.
  alt:(id,script)=>{
   const d=all?.[script]??(script===lang?dict:undefined);
   return d?(d.concepts[id]??d.parts[id]??null):null;
  },
  ui:(key,vars)=>fmt((zh?dict!.ui[key]:undefined)??UI[key]??key,vars),
  name:(id,en)=>(zh?look(id):undefined)??en,
  // The English is kept as a small second line under the Chinese: Adrian is LEARNING the
  // vocabulary, so seeing both is the point. Null in English mode -- nothing to pair with.
  secondary:(id,en)=>{const n=zh?look(id):undefined;return n&&n!==en?en:null;},
  system:(id,en)=>(zh?dict!.systems[id]?.name:undefined)??en,
  systemDesc:(id,en)=>(zh?dict!.systems[id]?.description:undefined)??en,
  explanation:(name,en)=>(zh?dict!.explanations[name.toLowerCase()]:undefined)??en,
 };
}

/**
 * A SEARCH KEY AND THE SCRIPT IT IS WRITTEN IN (L31 v2.1b+c, S2).
 *
 * `searchKeys` returns bare strings, which is all the v1 page and v2's phone list ever needed. The
 * palette needs one thing more: WHICH spelling matched, so an English interface can show the reader
 * the 胸骨体 their query actually hit rather than an English row with no visible reason to be there
 * (codex-plan-review.md §A.8, "display the matched Chinese spelling in an English UI").
 *
 * It is a NEW function rather than a changed signature on purpose — `searchKeys` has two live call
 * sites, one of them in v1 (`app/page.tsx:86`), and v1 is untouched this increment.
 */
export interface SearchKey {k:string;script:Lang|'id'}
export function searchEntries(id:string,en:string,dicts:Dicts):SearchKey[]{
 const out:SearchKey[]=[{k:en.toLowerCase(),script:'en'},{k:id.toLowerCase(),script:'id'}];
 for(const key of Object.keys(dicts) as Lang[]){
  const n=dicts[key]?.concepts[id]??dicts[key]?.parts[id];
  if(n)out.push({k:n.toLowerCase(),script:key});
 }
 return out;
}

/** Every string a concept or part can be FOUND by, lowercased: its English name, its id, and
 *  its name in every dictionary loaded so far. Both Chinese scripts are searched at once, so
 *  the query does not have to match the interface language. */
export function searchKeys(id:string,en:string,dicts:Dicts):string[]{
 return searchEntries(id,en,dicts).map((e)=>e.k);
}

/**
 * THE SYSTEM LANE'S OWN MATCHER, and it is separate because the POPULATION is separate.
 *
 * A system's name lives in `dict.systems[id].name`, not in `concepts`/`parts` — so `searchEntries`
 * returns NOTHING for it and a system would only ever have matched on its English name and its id.
 * Worse, folding systems into the structure lane would have put 15 rows into a denominator of 3,432
 * and reported "16 of 3,432" for a query that matched one system and fifteen structures. Three
 * populations, three denominators (opus-plan-review-2.md RC9; `spec.md`: "never combine them into
 * '3,432 results'").
 */
export function systemEntries(id:string,en:string,dicts:Dicts):SearchKey[]{
 const out:SearchKey[]=[{k:en.toLowerCase(),script:'en'},{k:id.toLowerCase(),script:'id'}];
 for(const key of Object.keys(dicts) as Lang[]){
  const n=dicts[key]?.systems[id]?.name;
  if(n)out.push({k:n.toLowerCase(),script:key});
 }
 return out;
}
