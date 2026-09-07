/**
 * Scene-first chunk ORDER (L31 v2). Pure, so it can be tested without a browser, a GPU or a
 * 33 MB download — the ordering is the entire P1 loading claim and it deserves an assertion that
 * runs in 1 ms rather than only inside a headless render.
 *
 * NOT streaming. `model-download.ts` buffers each whole chunk, so drawing is chunk-atomic at
 * 1.3–4.0 MB and already happens today. This decides only WHICH chunk is fetched first.
 */

export interface ChunkPart {id: string; chunk: number}
export interface ChunkConcept {id: string; elements: string[]}
export interface ChunkAtlas {parts: ChunkPart[]; concepts: ChunkConcept[]; chunks: unknown[]}

export interface ChunkPhases {
 /** Fetched first, then a BARRIER. Ascending chunk index, so the order is deterministic and a
  *  cache key derived from it cannot move with the caller's argument order. */
 first: number[];
 /** Fetched after the barrier, in the background. Empty means "no priority was given" — the
  *  v1 path, where `first` is every chunk in today's 0..14 order. */
 rest: number[];
}

/**
 * @param ids concept or part ids the incoming scene named, RESOLVED BY THE CALLER before the
 *   loader mounts. Passing live selection state instead would race: the scene component mounts
 *   as soon as the atlas arrives, which is before any selection effect has run, so the queue
 *   would prioritise an empty set and fetch exactly the wrong chunks first.
 *
 * Degrades to today's order — not to an empty first phase — when nothing resolves. A stale link
 * naming ids this atlas has dropped must still load the body; a barrier that fires against a
 * blank canvas would be worse than no barrier at all.
 */
export function orderChunks(atlas: ChunkAtlas, ids: readonly string[] | undefined): ChunkPhases {
 const all = atlas.chunks.map((_, i) => i);
 if (!ids?.length) return {first: all, rest: []};
 const concepts = new Map(atlas.concepts.map((c) => [c.id, c]));
 const want = new Set<string>();
 for (const id of ids) {
  const c = concepts.get(id);
  if (c) for (const e of c.elements) want.add(e);
  else want.add(id); // a bare PART id is legal in a scene and must not be dropped
 }
 const need = new Set<number>();
 for (const p of atlas.parts) if (want.has(p.id)) need.add(p.chunk);
 if (!need.size) return {first: all, rest: []};
 return {first: all.filter((i) => need.has(i)), rest: all.filter((i) => !need.has(i))};
}
