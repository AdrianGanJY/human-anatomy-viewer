import type {Atlas,Concept} from './anatomy';
type Tool={name:string;description:string;inputSchema:object;annotations:{readOnlyHint:boolean};execute:(input:unknown)=>unknown};
function record(input:unknown):Record<string,unknown>{if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Expected an object.');return input as Record<string,unknown>;}
/** The selection basket, as the in-page (WebMCP) agent sees it. `inspect` REPLACES the
 * selection, `add` appends to it, and `list` reads the live basket -- the same three verbs
 * the visible UI offers, so an agent driving the page can build a set exactly the way a
 * finger can. (L30 P3; upstream shipped only the first two tools.) */
export interface SelectionRow {id:string;name:string;pieces:number}
export function atlasTools(atlas:Atlas,inspect:(concept:Concept)=>void,add:(id:string)=>void,list:()=>SelectionRow[]):Tool[]{return [
 {name:'find_anatomy',description:'Find anatomical structures by name or source atlas identifier in this atlas.',inputSchema:{type:'object',properties:{query:{type:'string',minLength:1}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true},execute(input){const data=record(input);if(typeof data.query!=='string'||!data.query.trim())throw new Error('A nonempty query is required.');const q=data.query.toLowerCase().trim();return atlas.concepts.filter(c=>c.name.toLowerCase().includes(q)||c.id.toLowerCase().includes(q)).slice(0,30).map(c=>({id:c.id,name:c.name,pieces:c.elements.length}));}},
 {name:'inspect_anatomical_structure',description:'Select an atlas concept in the 3D anatomy and open its visible detail panel.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){const data=record(input);if(typeof data.id!=='string')throw new Error('An atlas identifier is required.');const concept=atlas.concepts.find(c=>c.id===data.id);if(!concept)throw new Error('That structure is not present in this atlas.');inspect(concept);return {id:concept.id,name:concept.name,selectedPieces:concept.elements.length};}},
 {name:'add_to_selection',description:'Add one structure to the current selection without clearing it, and show the selection basket. Use this to build up a group ("show me the three hip stabilisers together"); use inspect_anatomical_structure to start a new selection instead.',inputSchema:{type:'object',properties:{id:{type:'string'}},required:['id'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){const data=record(input);if(typeof data.id!=='string')throw new Error('An atlas identifier is required.');const concept=atlas.concepts.find(c=>c.id===data.id),part=concept?null:atlas.parts.find(p=>p.id===data.id);if(!concept&&!part)throw new Error('That structure is not present in this atlas.');add(data.id);return {added:data.id,name:concept?concept.name:part!.name,selection:list()};}},
 {name:'list_selection',description:'The structures currently selected in the 3D view, in the order they were added, with how many meshes each contributes.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(){const rows=list();return {count:rows.length,selection:rows,pieces:rows.reduce((n,r)=>n+r.pieces,0)};}}
 ];}
export function registerAtlasTools(atlas:Atlas,inspect:(concept:Concept)=>void,add:(id:string)=>void,list:()=>SelectionRow[]){
 const context=(document as Document&{modelContext?:{registerTool:(tool:Tool,options:{signal:AbortSignal})=>void|Promise<void>}}).modelContext;
 if(!context?.registerTool)return;const lifecycle=new AbortController();
 for(const tool of atlasTools(atlas,inspect,add,list)){try{void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(()=>{});}catch{/* Optional browser capability; the visible UI remains available. */}}
 return()=>lifecycle.abort();
}
