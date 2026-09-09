import {useEffect,useRef} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/examples/jsm/controls/OrbitControls.js';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {mergeGeometries} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {createExplosionLayout} from './explosion-layout';
import {decodeModelResponse} from './model-download';
import {orderChunks} from './scene-chunks';
import {PointerTap} from './pointer-tap';
import {SYSTEMS,type Atlas,type SceneState} from './anatomy';
import {markSettled} from './url-state';
// L30 P4a.1: the supersampled capture hook. Fork-local, and deliberately its own module --
// nothing in it belongs to the scene's frame loop.
import {installCapture} from './capture';
// L30: `add` carries the modifier key so a Shift-click can ADD to the selection basket
// instead of replacing it. The scene itself stays stateless about the basket.
// L31 v2: `priority` and `onSceneReady` are ADDITIVE and both absent in v1, where the loader
// keeps its 0..14 cursor byte-for-byte. See the loader below for why the ORDER is the whole
// change and why `data-atlas-ready` must not move.
interface Props {atlas:Atlas;state:SceneState;onSelect:(id:string,add?:boolean)=>void;onProgress:(n:number)=>void;onError:(s:string)=>void;
 /** Concept or part ids whose chunks load FIRST, resolved by the CALLER before mount.
  *  Passing React selection state here would be a race — the atlas mounts this component
  *  before applyUrl has run, so the selection is still empty and the queue would prioritise
  *  nothing (astra-ux-astra.md:206). v2 reads them straight out of the URL blob instead. */
 priority?:readonly string[];
 /** Fires once every chunk the priority set needs is merged AND DRAWN — the PHASE BARRIER.
  *  Never fires before the barrier and never replaces `onProgress(100)`.
  *  @param armedAt `performance.now()` at the moment the last priority chunk was merged, i.e.
  *   BEFORE the frame that draws it. The callback itself is deferred to that frame, so a
  *   consumer measuring "what had loaded at the barrier" must use this cut-off rather than
  *   sampling when it is called: background chunks keep arriving in between, and on a fast run
  *   the whole atlas can land first, which reported 33 MB / 15 chunks for a 9 MB / 4 chunk
  *   barrier at one viewport out of four (measured 2026-09-07 — a flake, and therefore the
  *   worst kind of number to publish). */
 onSceneReady?:(armedAt:number)=>void;
 /** L31 v2.1a — THE SCENE GENERATION, and the ids that generation requires.
  *
  *  `onSceneReady` above fires ONCE, for the priority set frozen at mount. A page that re-drives
  *  itself (`location.hash`, `window.atlas.applyScene`) then has no way to say "readiness now means
  *  a DIFFERENT set of meshes", and codex's review found both halves of that broken
  *  (codex-app-review.md §2 row 5, R:29): between the barrier and full load the re-drive cleared
  *  readiness and nothing restored it, and before the first barrier the pending barrier belonged to
  *  the superseded scene and published readiness for it.
  *
  *  So the barrier is re-armable. When `sceneEpoch` changes, readiness is withdrawn and re-armed
  *  against `requiredIds` — and it is published only once every chunk those ids live in has been
  *  merged AND a frame has been drawn. Absent (v1) means exactly the previous behaviour: one
  *  generation, one barrier, and since v1 also passes no `onSceneReady`, none of this runs at all. */
 sceneEpoch?:number;
 requiredIds?:readonly string[]}
export default function AnatomyScene({atlas,state,onSelect,onProgress,onError,priority,onSceneReady,sceneEpoch,requiredIds}:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(state),select=useRef(onSelect);
 const priorityRef=useRef(priority),sceneReadyCb=useRef(onSceneReady);
 const epochRef=useRef(sceneEpoch),requiredRef=useRef(requiredIds);
 latest.current=state;select.current=onSelect;priorityRef.current=priority;sceneReadyCb.current=onSceneReady;
 epochRef.current=sceneEpoch;requiredRef.current=requiredIds;
 useEffect(()=>{
  const el=host.current!;let disposed=false,frame=0,dirty=true,ready=false,sceneReady=false,sceneReadyPending=false,sceneReadyFired=false,sceneReadyAt=0,lastView='',lastReset=-1,lastIsolate='',layoutKey='',amount=0;
  /** Whether a barrier is OWED. The loader sets it for the first generation; an epoch change sets
   *  it again. Distinct from `sceneReadyPending` (armed, waiting for a frame) and from
   *  `sceneReadyFired` (published for the current generation) — three states, because "we owe a
   *  barrier but the geometry has not arrived" is a real and previously unrepresented one. */
  let sceneReadyWanted=false;
  let lastState:SceneState|null=null;
  // L30 P4: teaching-plate bookkeeping. `still` counts consecutive frames with nothing
  // left to draw, which is what `data-atlas-settled` means; `settled` stops us writing
  // the marker every frame. `lastPlate` re-runs resize() when render mode or the
  // supersample factor flips, because both change the drawing buffer.
  let still=0,settled=false,lastPlate='',lastBg='';
  const abort=new AbortController();
  let renderer:T.WebGLRenderer;
  // L30 P4: `alpha:true` unconditionally. It costs nothing at clearAlpha 1 (verified by
  // eye against the Explorer) and it CANNOT be changed after construction -- the warm tab
  // the renderer re-drives is never reconstructed, so a transparent plate has to be
  // possible from the first frame or never.
  try{renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});}catch{onError('This browser could not start the 3D viewer. Please try a browser with WebGL enabled.');return;}
  renderer.setPixelRatio(Math.min(devicePixelRatio,innerWidth<768?1.5:2));renderer.setClearColor('#f2f3f3');renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.12;el.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','Interactive human anatomy. Drag to orbit, pinch or scroll to zoom, and tap a structure to inspect it.');
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(34,1,.005,100),controls=new OrbitControls(camera,renderer.domElement);
  camera.position.set(1.4,1.05,3.6);controls.target.set(0,.85,0);controls.enableDamping=true;controls.dampingFactor=.085;controls.minDistance=.07;controls.maxDistance=40;controls.maxPolarAngle=Math.PI*.96;
  /**
   * L31: `change` IS NOT EVIDENCE THAT THE CAMERA MOVED, and believing it hangs the renderer.
   *
   * OrbitControls r159 dispatches `change` when the target differs from the previous update by
   * MORE THAN ZERO -- `lastTargetPosition.distanceToSquared(scope.target) > 0`
   * (node_modules/three/examples/jsm/controls/OrbitControls.js:393), no epsilon, unlike the
   * position and quaternion terms beside it which use EPS 1e-6. And its own
   * `scope.target.clampLength(scope.minTargetRadius, scope.maxTargetRadius)` (:261) is a
   * divide-by-length-then-multiply-by-length round trip, which for some coordinates does not
   * return the identical float. One ULP of drift, forever, for target values that happen to
   * land on the wrong side of that round trip.
   *
   * The consequence is not a wobble -- it is `dirty` never clearing, so the three still frames
   * that mean `data-atlas-settled` never happen, so the snapshot renderer waits 60 s and fails
   * on a picture that finished flying seconds earlier. MEASURED on the L31 forward-bend plate
   * (focus = hip bone + semitendinosus): `change` fired on 100% of frames while dPos and
   * dTarget were 1.2e-32 and dQuat 1.8e-15 -- i.e. sixteen orders of magnitude below one
   * ULP of anything visible.
   *
   * So the movement test lives HERE, on the numbers, not on the event. 1e-12 on a squared
   * distance is a micrometre on a 1.6 m subject: twenty orders of magnitude above the float
   * noise and far below one pixel, so no real camera motion is ever swallowed.
   */
  const moved={p:new T.Vector3(),t:new T.Vector3(),q:new T.Quaternion()};
  controls.addEventListener('change',()=>{
   if(moved.p.distanceToSquared(camera.position)<=1e-12&&moved.t.distanceToSquared(controls.target)<=1e-12&&8*(1-Math.abs(moved.q.dot(camera.quaternion)))<=1e-12)return;
   moved.p.copy(camera.position);moved.t.copy(controls.target);moved.q.copy(camera.quaternion);dirty=true;
  });
  const pmrem=new T.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose();
  scene.add(new T.HemisphereLight(0xffffff,0xa7acb2,1.05));
  const key=new T.DirectionalLight(0xfffaf4,2.3);key.position.set(-2,4,3);scene.add(key);
  const rim=new T.DirectionalLight(0xe9f0ff,1.8);rim.position.set(2,2,-3);scene.add(rim);
  const ground=new T.Mesh(new T.CircleGeometry(30,96),new T.MeshStandardMaterial({color:0xd5d9dc,roughness:1}));ground.rotation.x=-Math.PI/2;ground.position.y=-.019;scene.add(ground);
  const platform=new T.Mesh(new T.CylinderGeometry(.68,.7,.028,100),new T.MeshStandardMaterial({color:0xeeeeec,metalness:.12,roughness:.67}));platform.position.y=-.016;scene.add(platform);
  const ring=new T.Mesh(new T.RingGeometry(.63,.632,128),new T.MeshBasicMaterial({color:0x8c969f,transparent:true,opacity:.4,side:T.DoubleSide}));ring.rotation.x=-Math.PI/2;ring.position.y=.001;scene.add(ring);
  const innerRing=new T.Mesh(new T.RingGeometry(.55,.551,128),new T.MeshBasicMaterial({color:0xa4aeb8,transparent:true,opacity:.16,side:T.DoubleSide}));innerRing.rotation.x=-Math.PI/2;innerRing.position.y=.001;scene.add(innerRing);
  const width=T.MathUtils.ceilPowerOfTwo(atlas.parts.length),data=new Float32Array(width*4),partTexture=new T.DataTexture(data,width,1,T.RGBAFormat,T.FloatType);partTexture.needsUpdate=true;
  const selectedData=new Uint8Array(width*4),selectionTexture=new T.DataTexture(selectedData,width,1);selectionTexture.needsUpdate=true;
  const materials:T.Material[]=[],geometries:T.BufferGeometry[]=[],pickers:(T.Mesh|undefined)[]=[],centers=atlas.parts.map(p=>new T.Vector3().fromArray(p.bounds[0]).add(new T.Vector3().fromArray(p.bounds[1])).multiplyScalar(.5));
  const offsets:T.Vector3[]=[],bounds=atlas.parts.map(p=>new T.Box3(new T.Vector3().fromArray(p.bounds[0]),new T.Vector3().fromArray(p.bounds[1])));
  let packingWidth=1,packingHeight=1;
  const markerPositions=new Float32Array(atlas.parts.length*3),markerGeometry=new T.BufferGeometry();markerGeometry.setAttribute('position',new T.BufferAttribute(markerPositions,3));
  const markerMaterial=new T.PointsMaterial({color:0x64748b,size:5,sizeAttenuation:false,transparent:true,opacity:.72,depthTest:false});
  markerMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (distance(gl_PointCoord, vec2(0.5)) > 0.5) discard;');};
  const markers=new T.Points(markerGeometry,markerMaterial);markers.frustumCulled=false;markers.renderOrder=10;markers.visible=false;scene.add(markers);
  const hover=document.createElement('div');hover.className='part-hover';hover.setAttribute('role','tooltip');hover.hidden=true;el.appendChild(hover);
  type Target={index:number;x:number;y:number;left:number;right:number;top:number;bottom:number};let targets:Target[]=[];
  // L30 P4: read-only introspection for headless verification. The projected screen rect of
  // every DRAWN part is the only oracle that can tell "a picture appeared" from "the picture
  // shows what was asked for" -- pixel statistics pass equally for the wrong muscles, the
  // wrong side of the body, or a stale plate served from cache.
  // `groups` resolves a NAMED concept to the union rect of its meshes. A part's own
  // `conceptId` is NOT enough: FMA16203 "lumbar vertebral column" is a grouping of ten
  // meshes whose individual concepts are the five vertebrae and the five discs, so matching
  // by conceptId finds nothing and the check silently degrades to "structure absent".
  // `camera` is exposed so a view assertion can read the direction rather than infer it
  // from how wide something looks, which is the difference between proving the camera moved
  // and guessing from a 3% change.
  (window as unknown as {__atlasTargets?:(ids?:string[])=>unknown}).__atlasTargets=(ids?:string[])=>{
   // L30 P4a.1: the frame loop only projects when the body is exploded or a plate is being
   // drawn (hover is the only consumer otherwise, and projecting 2,234 parts every frame in
   // the assembled explorer would be pure cost). The EXPLORER is now under test too, so the
   // getter projects on demand when the loop has not -- read-only, and the frame loop is
   // untouched.
   const drawn=new Map((targets.length?targets:computeTargets()).map(t=>[atlas.parts[t.index].id,t]));
   const groups:Record<string,{left:number;right:number;top:number;bottom:number;n:number;a:number}>={};
   for(const id of ids??[]){
    const members=atlas.concepts.find(c=>c.id===id)?.elements??(drawn.has(id)?[id]:[]);
    const hit=members.map(m=>drawn.get(m)).filter(Boolean) as typeof targets;
    if(!hit.length)continue;
    groups[id]={left:Math.min(...hit.map(t=>t.left)),right:Math.max(...hit.map(t=>t.right)),
     top:Math.min(...hit.map(t=>t.top)),bottom:Math.max(...hit.map(t=>t.bottom)),n:hit.length,
     // L30 P4a.1: the ALPHA LANE, read back from the byte actually uploaded to the GPU --
     // not from React state, which is the thing under test. A group takes its FAINTEST
     // member, so "every named structure is opaque in explore mode" is one assertion.
     a:Math.min(...hit.map(t=>selectedData[t.index*4+1]/255))};
   }
   return {
    w:el.clientWidth,h:el.clientHeight,
    camera:{x:camera.position.x,y:camera.position.y,z:camera.position.z,
     tx:controls.target.x,ty:controls.target.y,tz:controls.target.z},
    // L31: WHICH FIT OWNS THE CAMERA. A framing oracle that only sees the result cannot tell
    // "the focus fit computed a bad frame" from "the focus fit never ran and the default fit is
    // what you are looking at" — and those need opposite repairs. `fitKey` is the focus fit's
    // own change key: empty means it is not active.
    fit:{key:lastIsolate,focus:(latest.current.focus??[]).length,frame:(latest.current.frame??[]).length,isolate:!!latest.current.isolate},
    groups,
    parts:targets.map(t=>({id:atlas.parts[t.index].id,concept:atlas.parts[t.index].conceptId,x:t.x,y:t.y,left:t.left,right:t.right,top:t.top,bottom:t.bottom,a:selectedData[t.index*4+1]/255})),
   };
  };
  // L30 P4a.1: `window.__atlasCapture({scale})` — one supersampled frame, area-averaged
  // down, painted over the live canvas so the renderer's screenshot (which is what carries
  // the caption card) shows the smooth version. See app/capture.ts for why four samples
  // per pixel was not enough and why the compositor cannot supply more.
  const uninstallCapture=installCapture({renderer,scene,camera,host:el});
  const projected=new T.Vector3();
  // L30 P4a.1: the projection, extracted verbatim from the frame loop so the read-only
  // getter above can run it on demand in modes the loop does not. ONE implementation --
  // a second copy would make the verification measure a projection the page never draws.
  const computeTargets=()=>{
   const out:Target[]=[];
   const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
   atlas.parts.forEach((p,i)=>{
    if(data[i*4+3]<.5||(hasSolid&&p.system==='integumentary'))return;
    let left=Infinity,right=-Infinity,top=Infinity,bottom=-Infinity;
    for(let corner=0;corner<8;corner++){
     projected.set(p.bounds[(corner&1)?1:0][0]+data[i*4],p.bounds[(corner&2)?1:0][1]+data[i*4+1],p.bounds[(corner&4)?1:0][2]+data[i*4+2]).project(camera);
     const x=(projected.x+1)*el.clientWidth/2,y=(1-projected.y)*el.clientHeight/2;
     left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);
    }
    projected.copy(centers[i]).add(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2])).project(camera);
    if(projected.z< -1||projected.z>1)return;
    out.push({index:i,x:(projected.x+1)*el.clientWidth/2,y:(1-projected.y)*el.clientHeight/2,left,right,top,bottom});
   });
   return out;
  };
  const findTarget=(x:number,y:number,radius:number)=>{
   let best=-1,score=Infinity;
   for(const t of targets){const dx=Math.max(t.left-x,0,x-t.right),dy=Math.max(t.top-y,0,y-t.bottom),distance=Math.hypot(dx,dy);if(distance>radius)continue;const candidate=distance+Math.hypot(t.x-x,t.y-y)*.025;if(candidate<score){score=candidate;best=t.index;}}
   return best;
  };
  const materialFor=(system:string)=>{
   // L30 P4: alphaHash on the 14 SOLID materials only. The body-surface material is
   // already transparent:true with opacity .1, where a per-fragment alpha blends normally
   // and a hash would visibly regress the smooth skin ghost this fork already ships.
   const m=new T.MeshStandardMaterial({color:SYSTEMS.find(s=>s.id===system)?.color??'#aebbb8',metalness:.08,roughness:.53,side:T.DoubleSide,transparent:system==='integumentary',opacity:system==='integumentary'?.1:1,depthWrite:system!=='integumentary',alphaHash:system!=='integumentary'});
   m.onBeforeCompile=shader=>{
    shader.uniforms.partState={value:partTexture};shader.uniforms.selectionState={value:selectionTexture};shader.uniforms.stateWidth={value:width};
    shader.vertexShader='attribute float partIndex; uniform sampler2D partState; uniform sampler2D selectionState; uniform float stateWidth; varying float partVisible; varying float partSelected; varying float partAlpha;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvec2 stateUv = vec2((partIndex + 0.5) / stateWidth, 0.5); vec4 state = texture2D(partState, stateUv); transformed += state.xyz; partVisible = state.w; vec4 sel = texture2D(selectionState, stateUv); partSelected = sel.r; partAlpha = sel.g;');
    shader.fragmentShader='varying float partVisible; varying float partSelected; varying float partAlpha;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <clipping_planes_fragment>','#include <clipping_planes_fragment>\nif (partVisible < 0.5) discard;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.85, 0.78), partSelected * 0.75);');
    // L30 P4: GHOST ANATOMY. `alphahash_fragment` sits after color_fragment and long
    // before opaque_fragment, so an alpha written here survives to the hash and is then
    // resolved by COVERAGE (a stochastic discard), not by blending. That is deliberate:
    // geometry is merged per (chunk x system) into one mesh, there is no per-structure or
    // per-triangle depth sort anywhere in this file, and every material is DoubleSide --
    // so real blended transparency has no correct draw order available to it. Coverage
    // needs none. `transparent` therefore stays false and is never toggled at runtime
    // (a toggle would recompile all 15 shared programs mid-session).
    // L30 P4a.1: `alphaToCoverage` was TRIED here as the smooth alternative and MEASURED to
    // be wrong on this stack: with no usable multisample buffer on the default framebuffer,
    // alpha-to-coverage resolves every fragment to FULL coverage, so the ghost and the
    // context render SOLID -- a beautiful, plausible picture with the teaching signal
    // deleted. Caught by the oracle, not by eye: the ghost region's mean luminance fell
    // BELOW the primary's (197 vs 202) where a translucent ghost must stay above it.
    // Route B (a real second translucent pass) remains the only true cure; it is P4b.
    shader.fragmentShader=shader.fragmentShader.replace('#include <alphahash_fragment>','diffuseColor.a *= partAlpha;\n#include <alphahash_fragment>');
   };materials.push(m);return m;
  };
  const mats=new Map(SYSTEMS.map(s=>[s.id,materialFor(s.id)]));
  let loaded=0;
  /**
   * ── L31 v2.1a: GENERATION-AWARE READINESS ────────────────────────────────────────────────────
   *
   * `loadedChunks` is which chunk indices are merged into the graph. `chunksFor` maps the ids a
   * generation needs onto that set through atlas.json metadata — a CONCEPT names elements, and a
   * part carries its chunk, so "is this scene's geometry here yet" is answerable without waiting
   * for all 15. `armIfSatisfied` is the only place readiness is ever armed after the first barrier:
   * it fires nothing itself, it sets `sceneReadyPending`, and the FRAME LOOP publishes it after the
   * next `renderer.render()` — because merged is not drawn, and the marker means drawn.
   *
   * `lastEpoch` starts at the incoming epoch rather than at -1, so a page that never re-drives
   * takes exactly the original path and the first barrier is still the loader's.
   */
  const loadedChunks=new Set<number>();
  let lastEpoch=epochRef.current;
  // Built ONCE. The obvious spelling of `chunksFor` is a `.find()` per element over 3,432 concepts
  // and 2,234 parts, and it would run on every chunk completion — ~2.8M comparisons across a load
  // for a scene the size of the heart (83 elements). Two maps make it a lookup.
  const chunkOfPart=new Map(atlas.parts.map(p=>[p.id,p.chunk]));
  const elementsOfConcept=new Map(atlas.concepts.map(c=>[c.id,c.elements]));
  const chunksFor=(ids:readonly string[])=>{
   const want=new Set<number>();
   for(const id of ids){
    for(const el of (elementsOfConcept.get(id)??[id])){
     const c=chunkOfPart.get(el);
     if(c!==undefined)want.add(c);
    }
   }
   return want;
  };
  /** True when every chunk this generation needs is merged. An UNKNOWN id contributes no chunk, so
   *  a scene naming a structure this atlas does not have cannot block readiness for ever. */
  const satisfied=()=>{
   if(ready)return true;                                   // all 15 chunks in: trivially satisfied
   const ids=requiredRef.current??priorityRef.current??[];
   // NOTHING NAMED ⇒ NOTHING TO WAIT FOR. `armIfSatisfied` is only ever called at or after the
   // first-phase boundary, so by the time this can return true the first phase is complete — which
   // is exactly when a no-selection visit used to publish. Returning `ready` here instead would
   // silently delay the marker to full load on a plain `/v2/`.
   if(!ids.length)return true;
   for(const c of chunksFor(ids))if(!loadedChunks.has(c))return false;
   return true;
  };
  const armIfSatisfied=()=>{
   // `sceneReadyPending` IS AN EARLY RETURN, and leaving it out was a measured regression rather
   // than a theoretical one. `armedAt` is the byte cut-off the page freezes at the barrier, so
   // re-arming an already-armed generation pushes that timestamp forward every time another chunk
   // lands before the frame loop gets to publish — and the loader runs three concurrent fetches,
   // so several land between two frames. The phone's barrier reported 29,361,939 B / 13 chunks
   // instead of 9,053,527 B / 4 (verify-ux.mjs, first post-fix run): not a slower page, a moving
   // ruler. The first satisfied moment is the one that means anything.
   if(disposed||!sceneReadyCb.current||sceneReadyFired||sceneReadyPending||!sceneReadyWanted)return;
   if(!satisfied())return;
   sceneReadyPending=true;sceneReadyAt=performance.now();dirty=true;
  };
  const loadChunk=async(ci:number)=>{
   const chunk=atlas.chunks[ci],compressed=!!chunk.gzip&&typeof DecompressionStream!=='undefined';const response=await fetch(compressed?chunk.gzip!:chunk.url,{signal:abort.signal});const buffer=await decodeModelResponse(response,chunk.bytes,compressed);if(disposed)return;
   const groups=new Map<string,T.BufferGeometry[]>();
   atlas.parts.forEach((p,i)=>{
    if(p.chunk!==ci)return;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(buffer,p.positions,p.vertexCount*3),3));
    // GPU normalized signed-short normals keep the complete atlas compact in memory.
    g.setAttribute('normal',new T.BufferAttribute(new Int16Array(buffer,p.normals,p.vertexCount*3),3,true));g.setIndex(new T.BufferAttribute(new Uint32Array(buffer,p.indices,p.indexCount),1));
    g.boundingBox=bounds[i].clone();g.computeBoundingSphere();const pick=new T.Mesh(g);pick.matrixAutoUpdate=false;pickers[i]=pick;geometries.push(g);
    g.setAttribute('partIndex',new T.BufferAttribute(new Float32Array(p.vertexCount).fill(i),1));
    const list=groups.get(p.system)??[];list.push(g);groups.set(p.system,list);
   });
   groups.forEach((gs,system)=>{const geometry=mergeGeometries(gs,false);if(!geometry)throw new Error('Could not assemble anatomy geometry.');geometries.push(geometry);const mesh=new T.Mesh(geometry,mats.get(system as never));mesh.frustumCulled=false;scene.add(mesh);});
   lastState=null;loaded++;loadedChunks.add(ci);onProgress(Math.round(loaded/atlas.chunks.length*100));dirty=true;
   // A LATE CHUNK CAN COMPLETE A WAITING GENERATION. Without this, a re-drive whose meshes were
   // still queued would arm nothing and wait forever — which is failure mode (a) of R:29.
   armIfSatisfied();
  };
  /**
   * L31 v2 — SCENE-FIRST CHUNK ORDER WITH A PHASE BARRIER. Not streaming: `model-download.ts:6`
   * buffers each whole chunk, so progressive drawing is chunk-atomic at 1.3–4.0 MB and ALREADY
   * ships (:199 adds each merged group the moment its chunk decodes). The only thing that
   * changes is the ORDER of the cursor below, and there is NO re-batching: merging is per
   * chunk, and the selection texture, the explosion layout and the focus fit are all driven by
   * atlas.json metadata, which is chunk-order-independent.
   *
   * Measured (audit-current.md:26-32): the six benchmark scenes each need 3 or 4 of the 15
   * chunks — 20.4%–27.5% of 32,956,129 B — but the shared 0..14 cursor fetches the scene's own
   * chunks LAST, because every scene needs chunk 12 or 13. Ordering them first cuts
   * bytes-to-scene-complete 3.6x–4.9x. It does NOT cut bytes-to-first-visible-model (already
   * one chunk) and it does NOT cut the steady-state memory floor: all 15 buffers still land.
   *
   * `data-atlas-ready` MUST KEEP MEANING "ALL 15 CHUNKS". Nine wait sites depend on it
   * (verify-live 67,123,238,348,421,428; verify-render 98,384,549) and the Pages screenshotter
   * is one of them: re-pointing it captures a half-loaded scene at HTTP 200 and R2 caches that
   * PNG for 24 hours. So `onProgress` still counts loaded/15 and the barrier gets its OWN
   * signal. The temptation to reuse the old flag is the dangerous shortcut; it is not taken.
   */
  (async()=>{try{
   const {first,rest}=orderChunks(atlas,priorityRef.current);
   const run=async(list:number[])=>{let cursor=0;await Promise.all(Array.from({length:3},async()=>{while(cursor<list.length){const i=list[cursor++];await loadChunk(i);}}));};
   await run(first);
   // THE BARRIER. Everything the scene named is merged and in the graph; one more frame draws
   // it. Picking unlocks here so the user is not shown structures he cannot tap.
   // MERGED IS NOT DRAWN. The callback is ARMED here and fired by the frame loop after the next
   // renderer.render() — one frame later. Adversarial review caught the first version claiming
   // "drawn" while firing synchronously after the merge, which also meant the byte count the
   // page freezes at the barrier was read before the last chunk's PerformanceResourceTiming
   // entry was guaranteed complete.
   // ⚠️ THE LOADER MUST NOT ARM THE BARRIER DIRECTLY. Adversarial review (codex gpt-6-astra,
   // 2026-09-09, High 2) found and EXECUTED this sequence against the first version of this block,
   // which set `sceneReadyPending` and `sceneReadyAt` here by hand:
   //
   //   1. scene A starts its priority load
   //   2. scene B supersedes it — the frame loop sees B's epoch and finds B NOT satisfied
   //   3. A's first phase completes and this line unconditionally set pending = true
   //   4. the next frame published readiness for B without B's chunks having arrived
   //
   // i.e. exactly failure mode (b) of R:29, reintroduced by the fix for failure mode (a). It also
   // let a superseding generation's already-frozen `armedAt` be overwritten here. There must be ONE
   // arming path, and it must be the generation-aware one — `armIfSatisfied` checks `satisfied()`
   // and returns early when a barrier is already pending, so it both refuses a premature publish
   // and preserves the first satisfied instant.
   if(!disposed&&rest.length){sceneReady=true;dirty=true;sceneReadyWanted=true;armIfSatisfied();}
   await run(rest);
   if(!disposed){ready=true;dirty=true;if(!rest.length){sceneReady=true;sceneReadyWanted=true;}
    // EVERY CHUNK IS IN. If a generation is still owed a barrier at this point it is satisfied by
    // definition, and this is the line that makes failure mode (a) of R:29 impossible: previously
    // `onProgress(100)` restored `data-atlas-ready` and nothing ever restored the scene marker.
    armIfSatisfied();}
  }catch(e){if(!disposed)onError(e instanceof Error?e.message:'Could not load the anatomy.');}})();
  // L30 P4: the camera direction per named view, extracted so the focus fit below uses the
  // SAME table `fit` does. It used to be inlined here and hard-coded there, which is why
  // `view` was silently ignored whenever isolate was on.
  const dirFor=(view:string)=>view==='front'?new T.Vector3(0,.02,1):view==='back'?new T.Vector3(0,.02,-1):view==='side'?new T.Vector3(1,.02,0):new T.Vector3(.35,.06,1).normalize();
  // L31 D04: how far the camera target leans from the CONTAINED set's centre toward the
  // FOCUSED set's centre. It is not free -- the extent is measured symmetrically about the
  // leaned centre, so every centimetre of lean is two centimetres of extra frame height and
  // the subject shrinks. MEASURED on the forward-bend scene (frame box .295 x .675 x .146,
  // centres .0966 m apart in y): bias .2 costs +5.7% height, .35 costs +10.0%, 1.0 costs
  // +28.6% -- i.e. a full lean would throw away a third of the subject's area to move it
  // 9.7 cm. .2 keeps the orbit pivot and the composition near the taught structure at a cost
  // small enough to be worth it. Set it to 0 for the tightest possible fit.
  const FOCUS_CENTER_BIAS=.2;
  const fit=(view:string,extent=0)=>{
   const insets=latest.current.insets;
   const reserve=insets?insets.top+insets.bottom:(el.clientWidth<768?350:270);
   const aspect=camera.aspect,mobile=el.clientWidth<768,normalDistance=mobile?Math.max(4.5,1.8*el.clientHeight/Math.max(160,el.clientHeight-reserve)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))):4;
   // L31 v2: with a static inset the field IS the free space, so the reservation is the
   // inset — not the 350/270 px of chrome v1 has to assume is sitting on top of the canvas.
   const reservedHeight=reserve;const availableAspect=Math.max(.35,(el.clientWidth-(insets?insets.left+insets.right:(mobile?40:340)))/Math.max(160,el.clientHeight-reservedHeight));const atlasDistance=Math.max(packingHeight,packingWidth/availableAspect)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*(el.clientHeight/Math.max(160,el.clientHeight-reservedHeight))*1.08;
   const distance=T.MathUtils.lerp(normalDistance,Math.max(.2,atlasDistance),extent);if(extent>.8)view='front';
   const direction=dirFor(view);
   controls.target.set(extent>.1&&el.clientWidth>767?-packingWidth*.12:0,extent>.1||mobile?.85:.68,0);camera.position.copy(controls.target).addScaledVector(direction,distance);controls.update();dirty=true;
  };
  // L30 P4: on a teaching plate the drawing buffer may be SUPERSAMPLED (ss=1 -> 2x) and
  // downsampled on composite. That is the one free cure for alphaHash's stochastic dither:
  // four samples averaged per output pixel turn speckle into a wash, at zero extra draw
  // calls and zero extra vertices. It is off by default and lives inside the scene blob,
  // so it is part of the render cache key.
  /**
   * L31 v2: `resize()` ends with an UNCONDITIONAL `fit()`, which overwrites the camera even when
   * a focus fit owns it — and because the focus fit is guarded by a change key that resize does
   * not touch, it never runs again. The camera is then left on the default framing forever.
   *
   * MEASURED, and it is why v2's first framing run came back WORSE than v1's: at t=466 ms the
   * focus-fit key was already set (so it had run) while the camera read target (0, .85, 0) and
   * distance exactly 4.500 — `fit()`'s mobile default, not the box centre (0.010, 0.679) the
   * focus fit computes. One trace of the camera against the fit key settled it; three rounds of
   * reasoning about the arithmetic had not.
   *
   * Clearing the key here is the whole fix: the next frame recomputes the focus fit against the
   * NEW aspect and wins. It is also a real repair for v1, where rotating a phone or opening the
   * keyboard on a `focus=` link silently dropped the scene's framing — the reason it was never
   * noticed is that v1's layout never resizes the canvas, so nothing after mount triggered it.
   */
  const resize=()=>{layoutKey='';lastState=null;
   // SCOPED TO v2. Adversarial review (claude-opus-4-6-thinking, 2026-09-07) refuted the first
   // version of this line: it cleared the key unconditionally, and v1 DOES resize on a desktop
   // window drag, so "v1 is unchanged in behaviour" would have been false. The clear is the fix
   // for v2's grid (where the field really does change size), and v1 keeps its existing
   // behaviour — a window resize there still leaves the focus framing alone.
   if(latest.current.insets)lastIsolate='';
   const s=latest.current;renderer.setPixelRatio(s.render&&s.ss?2:Math.min(devicePixelRatio,el.clientWidth<768||el.clientHeight<600?1.5:2));camera.aspect=el.clientWidth/el.clientHeight;camera.updateProjectionMatrix();renderer.setSize(el.clientWidth,el.clientHeight);fit(s.view,amount);};const observer=new ResizeObserver(resize);observer.observe(el);
  const raycaster=new T.Raycaster(),pointer=new T.Vector2(),tap=new PointerTap(),worldBox=new T.Box3(),hitPoint=new T.Vector3();
  const down=(e:PointerEvent)=>{hover.hidden=true;tap.down(e.pointerId,e.clientX,e.clientY,e.pointerType==='touch'?12:5);};
  const move=(e:PointerEvent)=>{tap.move(e.pointerId,e.clientX,e.clientY);if(e.buttons||amount<.5||e.pointerType==='touch'){hover.hidden=true;return;}const rect=el.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top,index=findTarget(x,y,12);hover.hidden=index<0;renderer.domElement.style.cursor=index<0?'grab':'pointer';if(index>=0){hover.textContent=atlas.parts[index].name;hover.style.left=`${Math.max(8,Math.min(x+14,el.clientWidth-260))}px`;hover.style.top=`${Math.max(8,Math.min(y+18,el.clientHeight-55))}px`;}};
  const cancel=(e:PointerEvent)=>tap.cancel(e.pointerId);
  const up=(e:PointerEvent)=>{
   // L31 v2: `sceneReady` unlocks picking at the phase barrier. In v1 it is set at the same
   // instant as `ready` (no priority set ⇒ one phase), so this reads exactly as `!ready` did.
   const validTap=tap.up(e.pointerId,e.clientX,e.clientY);if(!validTap||!(ready||sceneReady))return;const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
   let nearest=Infinity,found=-1;const hasSolid=atlas.parts.some((p,i)=>p.system!=='integumentary'&&data[i*4+3]>.5);
   pickers.forEach((mesh,i)=>{if(!mesh||data[i*4+3]<.5||(hasSolid&&atlas.parts[i].system==='integumentary'))return;worldBox.copy(bounds[i]).translate(mesh.position);if(!raycaster.ray.intersectBox(worldBox,hitPoint))return;const hits=raycaster.intersectObject(mesh,false);if(hits[0]&&hits[0].distance<nearest){nearest=hits[0].distance;found=i;}});
   if(found<0&&amount>.45)found=findTarget(e.clientX-rect.left,e.clientY-rect.top,e.pointerType==='touch'?24:16);if(found>=0){hover.hidden=true;select.current(atlas.parts[found].id,e.shiftKey);}
  };
  renderer.domElement.addEventListener('pointerdown',down);renderer.domElement.addEventListener('pointermove',move);renderer.domElement.addEventListener('pointerup',up);renderer.domElement.addEventListener('pointercancel',cancel);
  const clock=new T.Clock();let lastExtent=-1;
  const animate=()=>{
   if(disposed)return;frame=requestAnimationFrame(animate);const dt=Math.min(clock.getDelta(),.05),s=latest.current;
   // ── A NEW SCENE GENERATION ────────────────────────────────────────────────────────────────
   // Checked here rather than in an effect so it cannot race the loader: the loop is the only
   // thing that publishes the marker, so it is also the right place to withdraw it. The page has
   // already cleared `data-atlas-scene-ready` in the DOM by the time it bumps the epoch (that is
   // its own re-drive contract); this side clears the FIRED flag so the next satisfied generation
   // can publish again, and re-arms immediately when the geometry is already present.
   if(epochRef.current!==lastEpoch){
    lastEpoch=epochRef.current;
    sceneReadyFired=false;sceneReadyPending=false;sceneReadyWanted=true;
    armIfSatisfied();
   }
   // L30 P4: the new style inputs join this guard. It is REFERENCE equality by design, so
   // every one of them must be a fresh object identity when it changes and must be named
   // here -- a map mutated in place, or one left out of this line, never reaches the GPU,
   // and the failure is a correct-looking render of the PREVIOUS scene which R2 then
   // caches for 24 hours under a correct-looking key.
   const changed=lastState?.visible!==s.visible||lastState?.selected!==s.selected||lastState?.isolate!==s.isolate
    ||lastState?.opacity!==s.opacity||lastState?.restOpacity!==s.restOpacity||lastState?.primary!==s.primary;
   // Render mode and supersampling change the drawing buffer, which only resize() owns.
   const plateKey=`${s.render?1:0}:${s.ss??0}`;
   if(plateKey!==lastPlate){lastPlate=plateKey;resize();}
   const bg=s.background??'light';
   if(bg!==lastBg){lastBg=bg;renderer.setClearColor(bg==='dark'?'#101418':'#f2f3f3',1);dirty=true;}
   const moving=Math.abs(amount-s.explode)>.0001;
   if(moving){amount=T.MathUtils.damp(amount,s.explode,8,dt);dirty=true;}
   if(changed||moving||lastExtent<0){
    const visible=new Set(s.visible),selection=new Set(s.selected),primary=s.primary?new Set(s.primary):null;
    const visibleParts=atlas.parts.filter(p=>s.isolate?selection.has(p.id):visible.has(p.system)||selection.has(p.id));
    const nextLayoutKey=visibleParts.map(p=>p.id).join(',')+':'+camera.aspect.toFixed(3);
    if(nextLayoutKey!==layoutKey){const layout=createExplosionLayout(visibleParts,camera.aspect);packingWidth=layout.width;packingHeight=layout.height;atlas.parts.forEach((p,i)=>{const cell=layout.cells.get(p.id);offsets[i]=cell?new T.Vector3(cell.x,cell.y+.85,0):centers[i].clone();});layoutKey=nextLayoutKey;if(amount>.05&&!s.isolate)fit(s.view,Math.max(0,(amount-.3)/.7));}

    atlas.parts.forEach((p,i)=>{
     const c=centers[i],destination=offsets[i];let dx=0,dy=0,dz=0;
     if(amount<=.45){const t=amount/.45;const group=SYSTEMS.findIndex(sys=>sys.id===p.system);const angle=group/SYSTEMS.length*Math.PI*2;dx=Math.sin(angle)*t*.48;dy=(c.y-.85)*t*.28;dz=Math.cos(angle)*t*.48;}
     else {const t=(amount-.45)/.55,group=SYSTEMS.findIndex(sys=>sys.id===p.system),angle=group/SYSTEMS.length*Math.PI*2;dx=T.MathUtils.lerp(Math.sin(angle)*.48,destination.x-c.x,t);dy=T.MathUtils.lerp((c.y-.85)*.28,destination.y-c.y,t);dz=T.MathUtils.lerp(Math.cos(angle)*.48,-c.z,t);}
     // L30 P4: the selection texture's .g lane is per-structure ALPHA. Only .r was ever
     // written; G, B and A are uploaded every frame already, so this costs nothing.
     // alpha 0 means NOT DRAWN and is routed through the visibility lane (.w) instead --
     // cheaper than an alpha of zero, and it sidesteps blending entirely.
     // The .r lane (the highlight tint) follows the scene's PRIMARY role on a teaching
     // plate rather than the raw selection, or every structure in the scene -- context
     // and ghost included -- would come out tinted and the emphasis would say nothing.
     const selected=selection.has(p.id);
     const alpha=s.opacity?.[p.id]??(selected?1:(s.restOpacity??1));
     const shown=(s.isolate?selected:visible.has(p.system)||selected)&&alpha>0;
     data.set([dx,dy,dz,shown?1:0],i*4);
     selectedData[i*4]=(primary?primary.has(p.id):selected)?255:0;
     selectedData[i*4+1]=shown?Math.round(Math.min(1,Math.max(0,alpha))*255):255;
     markerPositions.set(data[i*4+3]>.5?[c.x+dx,c.y+dy,c.z+dz]:[10000,10000,10000],i*3);const mesh=pickers[i];if(mesh){mesh.position.set(dx,dy,dz);mesh.updateMatrix();mesh.updateMatrixWorld(true);}
    });partTexture.needsUpdate=true;selectionTexture.needsUpdate=true;markerGeometry.attributes.position.needsUpdate=true;lastState=s;lastExtent=amount;dirty=true;
   }
   // L30 P4: a focus fit owns the camera, so the view/reset refit must not fight it.
   const focusIds=s.focus?.length?s.focus:s.selected;
   // L31 D04: the set the frustum must CONTAIN. Absent means "the focus set", which is
   // exactly the old behaviour, so Explorer isolate and every legacy `select=` link are
   // untouched -- only a teaching scene that names supporting structure sends a frame set.
   const frameIds=s.frame?.length?s.frame:focusIds;
   const focusActive=s.isolate||!!s.focus?.length;
   if(s.view!==lastView||s.reset!==lastReset){if(!focusActive)fit(s.view,amount);lastView=s.view;lastReset=s.reset;}
   if(moving&&!focusActive)fit(amount>.5?'front':s.view,Math.max(0,(amount-.3)/.7));
   // L30 P4: FOCUS FRAMING (PRD section 4). This block was already a focus fit in all but
   // name -- it unions per-structure AABBs at their LIVE explosion offsets, measures the
   // real UI bands, shifts the frustum with setViewOffset and derives a distance from the
   // AABB against the available rect accounting for aspect. Three changes:
   //   1. it runs when `focus` is set as well as when isolate is on -- contextOpacity
   //      means isolate is FALSE, which is the entire point of ghost anatomy;
   //   2. the 1.35 distance multiplier becomes the caller's `padding`;
   //   3. the direction comes from dirFor(view) instead of the literal (.2,.1,1).
   // (3) IS A PRE-EXISTING DEFECT, NOT A NEW FEATURE: `view` has been ignored whenever
   // isolate is true -- which is what the MCP server defaults to -- because the direction
   // was hard-coded here and `s.view` was absent from the key below. Recorded as such.
   const isolateKey=focusActive?focusIds.join(',')+'|'+frameIds.join(',')+':'+(s.focusPadding??1.35)+':'+s.view+':'+s.reset+':'+s.inspectorOpen+':'+camera.aspect+':'+(s.render?'r':'')
    // L31 v2: the detent moves the band, so the band must be part of the key or the camera
    // keeps the framing it computed for the previous one.
    +':'+(s.insets?`${s.insets.top},${s.insets.right},${s.insets.bottom},${s.insets.left}`:''):'';
   if(isolateKey!==lastIsolate||(focusActive&&moving)){
    if(focusActive){const box=new T.Box3(),focusBox=new T.Box3(),want=new Set(frameIds),wantFocus=new Set(focusIds);
     atlas.parts.forEach((p,i)=>{const inFrame=want.has(p.id),inFocus=wantFocus.has(p.id);if(!inFrame&&!inFocus)return;
      const b=bounds[i].clone().translate(new T.Vector3(data[i*4],data[i*4+1],data[i*4+2]));if(inFrame)box.union(b);if(inFocus)focusBox.union(b);});
     if(box.isEmpty())box.copy(focusBox);
     // L31 D04: TWO boxes, two jobs. `focusBox` says where to LOOK; `box` says what must
     // stay inside the frame. The target is nudged toward the focus centre so the taught
     // structure still sits where the eye lands, and then the extent is measured
     // SYMMETRICALLY about that nudged centre against the whole frame box -- which is what
     // makes containment survive the nudge. Taking box.getSize() after moving the centre is
     // the bug that would look right and clip anyway.
     if(!box.isEmpty()){const frameCenter=box.getCenter(new T.Vector3()),focusCenter=focusBox.isEmpty()?frameCenter:focusBox.getCenter(new T.Vector3());
      const center=frameCenter.clone().lerp(focusCenter,FOCUS_CENTER_BIAS);
      const size=new T.Vector3(Math.max(center.x-box.min.x,box.max.x-center.x),Math.max(center.y-box.min.y,box.max.y-center.y),Math.max(center.z-box.min.z,box.max.z-center.z)).multiplyScalar(2);
      const w=el.clientWidth,h=el.clientHeight,mobile=w<768,landscape=w>h&&h<=600;let left=20,right=w-20,top=mobile?175:110,bottom=h-170;
      // L30 P4: on a teaching plate there is NO chrome to measure, so the reservation is
      // a uniform pad. Reserving 280+ px of a 720-tall plate for panels that are
      // display:none is most of why the PRD complains the subject sits at ~20% of frame.
      if(s.render){const band=Math.round(.04*Math.min(w,h));left=band;right=w-band;top=band;bottom=h-band;}
      // L31 v2: THE FIELD IS A GRID CELL. The canvas host owns exactly the free space, so the
      // band is a declared constant and NOTHING here reads the DOM. That deletes the whole
      // arithmetic that put the phone camera 2.6x further from the subject than the desktop
      // one purely because a detail sheet was open (audit-current.md:67-68). Checked BEFORE
      // `inspectorOpen`, which v2 never sets.
      else if(s.insets){left=s.insets.left;right=w-s.insets.right;top=s.insets.top;bottom=h-s.insets.bottom;}
      else if(s.inspectorOpen){if(landscape){right=w-335;top=100;bottom=h-125;}else if(mobile){const sheet=document.querySelector('.detail-sheet')?.getBoundingClientRect(),header=document.querySelector('.identity')?.getBoundingClientRect(),cap=document.querySelector('.atlas-caption')?.getBoundingClientRect();
     // L30: the caption sits under the header on a phone, so it is part of the top
     // reservation. Measured, not assumed to exist -- and only counted when it really
     // IS above the model, which is what keeps snap mode (caption at the bottom) right.
     const capBottom=cap&&cap.bottom<h*.5?cap.bottom:0;top=Math.max(capBottom,header?.bottom??94)+16;bottom=(sheet?.top??h*.58-139)-16;}else{right=w-370;left=w>1100?285:25;}}const availableWidth=Math.max(150,right-left),availableHeight=Math.max(40,bottom-top);camera.setViewOffset(w,h,w/2-(left+right)/2,h/2-(top+bottom)/2,w,h);
     // `padding` is a camera DISTANCE multiplier -- larger means further away. The PRD
     // writes 1.25 as if it were a percentage; it is mapped 1:1 onto this and the tool
     // schema says so, because a naive reinterpretation moves framing the wrong way and
     // reads as a bug in auto-focus itself.
     const padding=Math.min(3,Math.max(1,s.focusPadding??1.35));const distance=Math.max(.07,Math.max(size.y*h/availableHeight,size.x*w/availableWidth/camera.aspect,size.z)/(2*Math.tan(T.MathUtils.degToRad(camera.fov/2)))*padding);controls.maxDistance=Math.max(40,distance*2);controls.target.copy(center);camera.position.copy(center).addScaledVector(dirFor(s.view).normalize(),distance);controls.update();dirty=true;}
    }else if(lastIsolate){camera.clearViewOffset();fit(s.view,amount);}
    lastIsolate=isolateKey;
   }
   // L30 P4: the studio floor and the turntable are Explorer furniture. contextOpacity
   // implies isolate:false, so without `!s.render` here every ghost-anatomy plate would
   // be rendered standing on a lit platform, slowly spinning.
   controls.enableRotate=amount<.8;controls.mouseButtons.LEFT=amount<.8?T.MOUSE.ROTATE:T.MOUSE.PAN;controls.touches.ONE=amount<.8?T.TOUCH.ROTATE:T.TOUCH.PAN;ground.visible=platform.visible=ring.visible=innerRing.visible=amount<.5&&!s.isolate&&!s.render;markers.visible=amount>.75&&!s.render;controls.autoRotate=s.rotate&&!s.isolate&&amount<.4&&!s.render;controls.autoRotateSpeed=.65;controls.update();if(controls.autoRotate)dirty=true;
   // L30 P4: `|| s.render` -- the projected screen rects are computed for hover, which only
   // matters once the body is exploded. A teaching plate never explodes, so without this
   // there is nothing to measure the framing against and nothing for annotations to anchor
   // to later.
   if(dirty){renderer.render(scene,camera);targets=(amount>.45||s.render)?computeTargets():[];
    dirty=false;still=0;if(settled){settled=false;markSettled(false);}
    // THE PHASE BARRIER, published only now that the CURRENT generation's set has been DRAWN.
    if(sceneReadyPending&&!sceneReadyFired){sceneReadyFired=true;sceneReadyPending=false;sceneReadyWanted=false;sceneReadyCb.current?.(sceneReadyAt);}
   }
   // L30 P4: SETTLED. Three consecutive frames with nothing left to draw means the camera
   // fit has finished flying (OrbitControls damping keeps `dirty` true while it moves) and
   // the last texture upload has been drawn. The renderer waits on this marker instead of
   // the fixed 1.2/1.4 s sleep it used to use -- a sleep can screenshot a mid-flight camera
   // and R2 then caches that half-flown frame for 24 hours under a perfectly valid key.
   else if(ready&&!settled&&++still>=3){settled=true;markSettled(true);}

  };animate();
  const contextLost=(e:Event)=>{e.preventDefault();onError('The 3D session was paused by your device. Reload to continue.');};renderer.domElement.addEventListener('webglcontextlost',contextLost);
  return()=>{disposed=true;abort.abort();cancelAnimationFrame(frame);observer.disconnect();uninstallCapture();delete (window as unknown as {__atlasTargets?:()=>unknown}).__atlasTargets;controls.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());scene.traverse(o=>{if(o instanceof T.Mesh&&!geometries.includes(o.geometry)){o.geometry.dispose();const ms=Array.isArray(o.material)?o.material:[o.material];ms.forEach(m=>m.dispose());}});env.dispose();partTexture.dispose();selectionTexture.dispose();markerGeometry.dispose();markerMaterial.dispose();hover.remove();renderer.dispose();renderer.domElement.remove();};
 },[atlas]);
 return <div className="scene" ref={host}/>;
}
