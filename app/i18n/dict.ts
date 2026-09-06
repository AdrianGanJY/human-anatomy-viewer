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
import {UI,fmt,type Lang} from './ui';

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

let inflight:Promise<Dicts>|null=null;
/** Both Chinese dictionaries, fetched once per page load and then reused. */
export function loadZhDicts():Promise<Dicts>{
 if(!inflight){
  inflight=Promise.all([fetchDict('zh-Hans'),fetchDict('zh-Hant')])
   .then(([hans,hant])=>{
    const out:Dicts={};
    if(hans)out['zh-Hans']=hans;
    if(hant)out['zh-Hant']=hant;
    // A failed load must not be cached as "there is no Chinese" forever -- a flaky network
    // would then leave the switch permanently dead until a reload.
    if(!hans&&!hant)inflight=null;
    return out;
   })
   .catch(()=>{inflight=null;return {};});
 }
 return inflight;
}

/** Reading side. Every lookup takes the English as its fallback, so a name the dictionary
 *  happens not to carry renders in English instead of disappearing. */
export interface T {
 lang:Lang;
 zh:boolean;
 ui(key:string,vars?:Record<string,string|number>):string;
 name(id:string,en:string):string;
 secondary(id:string,en:string):string|null;
 system(id:string,en:string):string;
 systemDesc(id:string,en:string):string;
 explanation(name:string,en:string):string;
}

export function makeT(lang:Lang,dict:Dict|null|undefined):T{
 const zh=lang!=='en'&&!!dict;
 const look=(id:string)=>dict?(dict.concepts[id]??dict.parts[id]):undefined;
 return {
  lang,zh,
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

/** Every string a concept or part can be FOUND by, lowercased: its English name, its id, and
 *  its name in every dictionary loaded so far. Both Chinese scripts are searched at once, so
 *  the query does not have to match the interface language. */
export function searchKeys(id:string,en:string,dicts:Dicts):string[]{
 const out=[en.toLowerCase(),id.toLowerCase()];
 for(const key of Object.keys(dicts) as Lang[]){
  const n=dicts[key]?.concepts[id]??dicts[key]?.parts[id];
  if(n)out.push(n.toLowerCase());
 }
 return out;
}
