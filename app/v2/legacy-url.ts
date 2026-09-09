/**
 * THE LEGACY URL'S CAMERA AND VISIBILITY, as a pure mapping. L31 v2.1a.
 *
 * codex-app-review.md §2 row 2 (R:26): a cold `?select=…&view=side&isolate=1&system=none&explode=.5`
 * link — the P1–P3 contract, and the shape `/mcp` emitted for three releases — arrived on `/v2/` and
 * only its PICKS were applied. `synthesize()` returns early unless `mode==='render'`
 * (app/url-state.ts:108), so a plain legacy visit produces no scene, `applySceneState` never runs,
 * and `baseState`'s three-quarter / not-isolated / everything-visible drew instead. Then the 200 ms
 * debounced `writeUrlState` serialised THAT state back over the address bar, so the requested
 * settings were gone from the URL too and a reload could not recover them. MEASURED before the fix:
 * `?select=FMA22359&view=side&isolate=1&system=none&explode=0.5` became `?select=FMA22359`.
 *
 * WHY IT IS ITS OWN FILE. Two reasons, both practical rather than tidy:
 *  1. It is a MAPPING, not a controller. C2 puts one owner above it; a temporary controller inside
 *     the page would be a thing C2 has to unpick (codex-plan-review.md §A.2).
 *  2. `app/v2/page.tsx` cannot be imported by `node --test` — Node strips TYPES but not JSX — so a
 *     function that lives in the page is a function with no unit coverage. Here it has some.
 *
 * ABSENT IS NOT EMPTY, and that distinction is why each field is spread conditionally on
 * `!== undefined` rather than collapsed with a fallback operator. `system=none` legitimately means
 * "nothing visible" (`visible: []`), which is not "the key was not in the URL" (leave the previous
 * value alone). `||` gets that wrong for `false` and `0` — and `isolate=0` and `explode=0` are real
 * requests. `??` would in fact be correct for all three values; it is not used only because the
 * conditional spread states the absent/present distinction directly at each field.
 */
import type {SceneState, SystemId, View} from '../anatomy';

export interface LegacyUrlFields {view?: View; isolate?: boolean; explode?: number; visible?: SystemId[]}

export function legacySceneState(url: LegacyUrlFields, previous: SceneState): SceneState {
 return {
  ...previous,
  ...(url.view !== undefined ? {view: url.view} : {}),
  ...(url.isolate !== undefined ? {isolate: url.isolate} : {}),
  ...(url.explode !== undefined ? {explode: url.explode} : {}),
  ...(url.visible !== undefined ? {visible: url.visible} : {}),
  // The renderer refits on `s.view !== lastView || s.reset !== lastReset` (app/scene.tsx), so a
  // VIEW change would refit on its own. `reset` is bumped for the others: `isolate` and `explode`
  // are not in that condition, so a link that changes only those would update the state and leave
  // the camera where it was.
  reset: previous.reset + 1,
 };
}
