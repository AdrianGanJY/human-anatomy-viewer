/** The selection basket — pure helpers over the list of ids the user has picked.
 *
 * `picks` is the source of truth: an ORDERED, unique list of atlas ids. `state.selected`
 * (what the scene highlights) is derived from it as the union of the picks' meshes, so the
 * scene never has to know the basket exists and `scene.tsx` stays upstream's.
 *
 * A pick is a CONCEPT id (`FMA22315`) or a PART id (`FJ1252`) — whichever the caller named.
 * Part ids are deliberately NOT rewritten to their concept: the URL contract round-trips the
 * ids the caller asked for (`data-atlas-selected`, verified in P2), and rewriting them would
 * also make a single mesh unreachable, since the detail sheet's "Included structures" list is
 * exactly how you drill from a concept down to one of its parts. `conceptOf` gives the parent
 * concept where a display needs it.
 *
 * Fork-local (L30 P3), in its own file so an upstream rebase stays trivial.
 */
import {SYSTEMS,type Concept,type Part,type SystemId} from './anatomy';
export type Concepts=ReadonlyMap<string,Concept>;
export type Parts=ReadonlyMap<string,Part>;
/** One row of the basket: what it is, what it highlights, and which system colours it. */
export interface Pick {id:string;kind:'concept'|'part';name:string;conceptId:string;elements:string[];system:SystemId|null}
/** Dominant system of a set of meshes, ties broken by the SYSTEMS order — the same rule
 *  `scripts/build-index.mjs` applies, so a basket dot and the index never disagree. */
function dominantSystem(parts:Parts,elements:readonly string[]):SystemId|null{
 const tally=new Map<string,number>();
 for(const e of elements){const s=parts.get(e)?.system;if(s)tally.set(s,(tally.get(s)??0)+1);}
 let best=-1,dominant:SystemId|null=null;
 for(const s of SYSTEMS){const n=tally.get(s.id)??0;if(n>best){best=n;dominant=s.id;}}
 return best>0?dominant:null;
}
/** Resolve one id to a pick, or null when this atlas has never heard of it. */
export function resolvePick(concepts:Concepts,parts:Parts,id:string):Pick|null{
 const c=concepts.get(id);
 if(c)return {id:c.id,kind:'concept',name:c.name,conceptId:c.id,elements:c.elements,system:dominantSystem(parts,c.elements)};
 const p=parts.get(id);
 if(p)return {id:p.id,kind:'part',name:p.name,conceptId:p.conceptId,elements:[p.id],system:p.system};
 return null;
}
/** Unknown ids are skipped, not fatal — a stale link shows what it still can. */
export function resolvePicks(concepts:Concepts,parts:Parts,ids:readonly string[]):Pick[]{
 const out:Pick[]=[];
 for(const id of ids){const pick=resolvePick(concepts,parts,id);if(pick)out.push(pick);}
 return out;
}
/** The parent concept of a pick, for the detail sheet's atlas reference. */
export function conceptOf(concepts:Concepts,pick:Pick|null):Concept|null{return pick?concepts.get(pick.conceptId)??null:null;}
/** Every mesh the basket highlights, deduped, in pick order. */
export function unionElements(picks:readonly Pick[]):string[]{
 const seen=new Set<string>(),out:string[]=[];
 for(const pick of picks)for(const e of pick.elements)if(!seen.has(e)){seen.add(e);out.push(e);}
 return out;
}
export function dedupe(ids:readonly string[]):string[]{return [...new Set(ids.map(s=>s.trim()).filter(Boolean))];}
/** Append if absent. An id already in the basket keeps its position — adding twice must not
 *  reorder a list the user has been building. */
export function addPick(ids:readonly string[],id:string):string[]{return ids.includes(id)?[...ids]:[...ids,id];}
export function removePick(ids:readonly string[],id:string):string[]{return ids.filter(x=>x!==id);}
export function togglePick(ids:readonly string[],id:string):string[]{return ids.includes(id)?removePick(ids,id):addPick(ids,id);}
/** Order-sensitive equality — the basket's order is part of its meaning (and of the URL). */
export function sameIds(a:readonly string[],b:readonly string[]):boolean{return a.length===b.length&&a.every((x,i)=>x===b[i]);}
