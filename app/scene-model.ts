/**
 * TypeScript types over `app/scene-codec.js`. L30 P4a.
 *
 * The codec itself is plain ESM with no imports so that the Vite bundle AND the Pages
 * Function (`functions/mcp.js`) can import the SAME FILE — one definition, no hand-mirrored
 * copy to drift. This module only adds types and re-exports; it contains no logic, so
 * there is nothing here that could disagree with the server.
 */
export {
  SCENE_V, VIEWS, LANGS, MODES, ROLES, REST_MODES, BACKGROUNDS, EMPHASIS, EMPHASIS_ALIAS,
  ANNOTATION_TYPES, ANNOTATION_ALIAS, DIRECTIONS, LIMITS, DEFAULTS,
  isId, b64urlEncode, b64urlDecode,
  normalizeScene, validateScene, canonicalScene, encodeScene, decodeScene,
  structureOpacity, sceneSelectIds, sceneFits,
} from './scene-codec.js';

export type SceneMode = 'explore' | 'render';
export type SceneLang = 'en' | 'zh-Hans' | 'zh-Hant';
export type SceneView = 'three-quarter' | 'front' | 'back' | 'side';
export type Role = 'primary' | 'context' | 'ghost';
export type Emphasis = 'neutral' | 'highlight' | 'secondary' | 'ghost' | 'warning';
export type RestInclude = 'none' | 'skeletal';
export type Background = 'light' | 'dark';
export type AnnotationType = 'label' | 'arrow' | 'rotation-arrow' | 'stretch' | 'point';

export interface SceneStructure { id: string; role: Role }
export interface SceneStyle { id: string; emphasis?: Emphasis; opacity?: number }
export interface SceneAnnotation {
  type: AnnotationType;
  target?: string; from?: string; to?: string;
  direction?: string; text?: string;
}

/** The canonical, fully-defaulted form: what `decodeScene` returns and what every
 *  consumer reads. Nothing downstream needs to handle an absent field. */
export interface Scene {
  v: number;
  mode: SceneMode;
  lang: SceneLang;
  structures: SceneStructure[];
  rest: { include: RestInclude; opacity: number };
  camera: { view: SceneView; focus: string[]; padding: number; explode: number; rotate: boolean };
  roleOpacity: { primary: number; context: number; ghost: number };
  styles: SceneStyle[];
  annotations: SceneAnnotation[];
  caption: { title: string; note: string; place: 'in' | 'out' };
  background: Background;
  size: { w: number; h: number };
  /** 0 or 1; typed as number because the codec is plain JS and infers it that way. */
  ss: number;
}
