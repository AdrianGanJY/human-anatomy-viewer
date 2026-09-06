/** Every user-visible string in the explorer, in English, keyed.
 *
 * This file is the SOURCE of the interface copy: `en` below is what the app renders when
 * no dictionary is loaded, and it is also the input `scripts/build-zh.mjs` translates into
 * `public/i18n/zh-Hans.json` / `zh-Hant.json`. There is no second English copy anywhere —
 * a string that is not here is a string the language switch cannot reach.
 *
 * Deliberately NOT translated: `title=` / `note=` captions (Adrian's or an assistant's own
 * words, printed verbatim) and FMA identifiers.
 *
 * Erasable-syntax-only TypeScript, like `app/anatomy.ts`: `scripts/build-zh.mjs` imports it
 * directly under Node's type stripping, so the build and the UI cannot disagree about which
 * strings exist.
 */
export type Lang = 'en' | 'zh-Hans' | 'zh-Hant';
export const LANGS: Lang[] = ['en', 'zh-Hans', 'zh-Hant'];
/** The switch's own labels are never translated — each is written in the script it selects. */
export const LANG_LABELS: Record<Lang, string> = {en: 'EN', 'zh-Hans': '简体', 'zh-Hant': '繁體'};
export const isLang = (v: unknown): v is Lang => typeof v === 'string' && (LANGS as string[]).includes(v);

export const UI: Record<string, string> = {
 'app.title': 'Human Atlas',
 'app.eyebrow': 'INTERACTIVE ANATOMY',
 'app.pieces': '{n} modeled pieces',
 'app.lang': 'Language',

 'nav.panels': 'Explorer panels',
 'nav.search': 'Find a structure',
 'nav.searchAria': 'Search anatomy',
 'nav.about': 'About this atlas',
 'nav.basket': 'Selected',
 'nav.basketAria': 'Open the selection basket',

 'layers.aria': 'Anatomical layers',
 'layers.heading': 'Systems',
 'layers.close': 'Close systems',
 'layers.all': 'All',
 'layers.skeleton': 'Skeleton',
 'layers.organs': 'Organs',
 'layers.showOnly': 'Show only {name}',
 'layers.show': 'Show {name}',
 'layers.visible': '{n} pieces visible',
 'layers.hideAll': 'Hide all',

 'search.aria': 'Find anatomy',
 'search.heading': 'Find a structure',
 'search.close': 'Close search',
 'search.placeholder': 'Heart, femur, cranial nerve…',
 'search.inputAria': 'Search named anatomical structures',
 'search.empty': 'No structures match your search.',
 'search.piece': '{n} piece',
 'search.pieces': '{n} pieces',
 'search.noteMore': 'Showing up to 80 matches. Refine your search to find smaller structures.',
 'search.noteStart': 'Start with a major organ, or search every named structure.',
 'search.add': 'Add {name} to the selection',

 'basket.aria': 'Selected structures',
 'basket.heading': 'Selection',
 'basket.close': 'Close the selection',
 'basket.empty': 'Nothing selected yet. Tap a structure in the 3D view, or use Find a structure and the + beside a result.',
 'basket.hideOthers': 'Hide others',
 'basket.hideOthersAria': 'Show only the selected structures',
 'basket.clear': 'Clear all',
 'basket.remove': 'Remove {name} from the selection',
 'basket.focus': 'Focus {name}',
 'basket.count': '{n} selected',
 'basket.piecesTotal': '{n} pieces highlighted',

 'view.aria': 'Camera controls',
 'view.three-quarter': 'Three-quarter view',
 'view.front': 'Front view',
 'view.side': 'Side view',
 'view.back': 'Back view',
 'view.rotate': 'Rotate body',
 'view.pause': 'Pause rotation',
 'view.autoRotate': 'Auto rotate',
 'view.reset': 'Reset view and layers',
 'view.resetShort': 'Reset',

 'scene.selected': 'SELECTED STRUCTURE',
 'scene.inventory': 'ANATOMICAL INVENTORY',
 'scene.separated': 'SEPARATED STRUCTURES',
 'scene.body': 'ADULT HUMAN · MALE',
 'scene.captionAria': 'Note about this view',

 'dock.layers': 'Open system layers',
 'dock.systems': 'Systems',
 'dock.explode': 'Explode anatomy',
 'dock.assembled': 'Assembled',
 'dock.everyPiece': 'Every piece',
 'dock.reset': 'Assemble and reset',

 'foot.pan': 'Drag to pan',
 'foot.orbit': 'Drag to orbit',
 'foot.zoom': 'Pinch to zoom',
 'foot.tap': 'Tap to inspect',
 'foot.credits': 'Source & credits',

 'load.preparing': 'Preparing the anatomy',
 'load.progress': '{p}% · Loading {n} pieces',
 'load.reload': 'Reload viewer',
 'load.failed': 'The anatomy catalogue could not be loaded.',

 'detail.anatomy': 'ANATOMY',
 'detail.contextNote': 'System overview · structure identified from source anatomy',
 'detail.reference': 'Atlas reference',
 'detail.selectedPieces': 'Selected pieces',
 'detail.included': 'Included structures',
 'detail.andMore': 'And {n} more modeled pieces.',
 'detail.source': 'View anatomical source',
 'detail.isolate': 'Isolate structure',
 'detail.unisolate': 'Show surrounding anatomy',
 'detail.add': 'Add to selection',
 'detail.added': 'In the selection',
 'detail.clear': 'Clear selection',

 'about.eyebrow': 'SOURCE & SCOPE',
 'about.title': 'A body, revealed.',
 'about.lead': 'Explore the adult male reference anatomy from BodyParts3D.',
 'about.p1strong': 'Male · BodyParts3D',
 'about.p1': '2,234 individual meshes and 3,432 named concepts from an adult male reference anatomy.',
 'about.p2': 'This reference does not contain every human structure or variation. Named concepts can contain multiple pieces; each source mesh is rendered once.',
 'about.p3': 'Colors and system groupings are designed for exploration. The geometry is simplified for the web, and short explanations provide general educational context. This is an anatomical reference, not a diagnostic or surgical tool.',
 'about.sourceHeading': 'Source',
 'about.sourceBody': 'BodyParts3D, © The Database Center for Life Science licensed under CC Attribution 4.0 International.',
 'about.licence': 'Dataset license',
 'about.geometry': 'Original geometry & metadata',
 'about.paper': 'Read the source publication',
};

/** `{n}`-style placeholders. Missing values are left as the literal placeholder rather than
 *  printed as `undefined`, so a mistranslation that drops one is visible instead of silent. */
export function fmt(template: string, vars?: Record<string, string | number>): string {
 if (!vars) return template;
 return template.replace(/\{(\w+)\}/g, (whole, key) => (vars[key] === undefined ? whole : String(vars[key])));
}
