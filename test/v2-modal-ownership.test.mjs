/**
 * ══ MODAL OWNERSHIP — L31 v2.1b+c, S7 (codex round 26, Medium 1) ══════════════════════════════
 *
 * Round 26 executed the production hook through lifecycle adapters and found three holes, all of
 * the same shape: a surface that is a modal to the READER is not a modal to the DISPATCHER.
 *
 *   · opening Scenes while `W` is held leaves `KeyW` in the held set — the camera pans behind it;
 *   · Ctrl+K with Scenes open produced `scenesOpen=true` AND `findOpen=true` — two stacked modals;
 *   · the phone's Ask sheet was absent from ownership entirely, so `Digit2` dispatched a named view
 *     while the reader was typing a question into it.
 *
 * The rule was spread across three expressions in `use-shell.ts` — `modalRef`, the `find` branch and
 * the blur effect — and each had its own list. A rule with three copies has three versions of
 * itself, which is exactly what round 26 measured. It is ONE function now, and this is its test.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clearsHeldKeys, findDeclined, modalOpen} from '../app/v2/shell/keys.ts';

/** Every flag false — the app with nothing open. */
const NONE = {keysOpen: false, settingsOpen: false, findOpen: false, scenesOpen: false,
  askSheetOpen: false, tSheet: null, tabletInline: false};
const with_ = (o) => ({...NONE, ...o});

test('nothing open is not a modal', () => {
  assert.equal(modalOpen(NONE), false);
});

test('every overlay the reader sees as a dialog is a modal to the dispatcher', () => {
  for (const k of ['keysOpen', 'settingsOpen', 'findOpen', 'scenesOpen', 'askSheetOpen']) {
    assert.equal(modalOpen(with_({[k]: true})), true, `${k} must own the keyboard`);
  }
  // The tablet's sheet counts only as an OVERLAY. As a 300 px inline column beside a live field it
  // is not a dialog: it does not dim the field, does not trap focus, and a reader with it open is
  // expected to keep driving the camera (S6).
  assert.equal(modalOpen(with_({tSheet: 'layers', tabletInline: false})), true, 'the portrait overlay');
  assert.equal(modalOpen(with_({tSheet: 'layers', tabletInline: true})), false, 'the inline column');
});

test('Ctrl+K is declined while another modal owns the screen — never two at once', () => {
  // The palette on top of the key map or Settings was already declined; Scenes and the phone's Ask
  // sheet were not, which is how round 26 produced `scenesOpen=true` and `findOpen=true` together.
  for (const k of ['keysOpen', 'settingsOpen', 'scenesOpen', 'askSheetOpen']) {
    assert.equal(findDeclined(with_({[k]: true})), true, `Find must decline over ${k}`);
  }
  assert.equal(findDeclined(with_({tSheet: 'layers', tabletInline: false})), true, 'over the portrait sheet');
});

test('Find is NOT declined by its own palette — a second Ctrl+K re-focuses it', () => {
  // Declining here would hand the chord back to the browser, which is what it used to do.
  assert.equal(findDeclined(with_({findOpen: true})), false);
  assert.equal(findDeclined(NONE), false);
  // …and the inline tablet column is not a modal, so Find opens over it as it does in the studio.
  assert.equal(findDeclined(with_({tSheet: 'ask', tabletInline: true})), false);
});

test('a held camera key is cleared by every surface that takes the pointer and the focus', () => {
  // `Shift+S` is dead while `KeyS` is stuck: a modal that opens within the same document fires no
  // blur, no pointercancel and no visibilitychange, so nothing else clears the held set.
  for (const k of ['keysOpen', 'settingsOpen', 'findOpen', 'scenesOpen', 'askSheetOpen']) {
    assert.equal(clearsHeldKeys(with_({[k]: true})), true, `${k} must clear the held set`);
  }
  assert.equal(clearsHeldKeys(with_({tSheet: 'info', tabletInline: false})), true);
  assert.equal(clearsHeldKeys(with_({tSheet: 'info', tabletInline: true})), false, 'the inline column keeps the camera');
  assert.equal(clearsHeldKeys(NONE), false);
});

// ── the tree's eye: one decision, two paths (codex round 26, Medium 3) ───────────────────────

/**
 * ⚠️ A STRUCTURAL ASSERTION, AND IT SAYS SO. The executable proof that `V` now declines needs the
 * real atlas, the reducer and a mounted tree — codex has that harness and ran it to FIND this; what
 * this file can hold is the invariant the fix rests on: there is exactly ONE actionability guard,
 * and it is inside `toggleEye`, which both the pointer and the key press go through.
 *
 * It is not decoration. The defect was precisely a SECOND guard living at one of the two call
 * sites, and a reader adding a third path (a context menu, a bulk action) reintroduces it the same
 * way. This row goes red the moment a guard reappears at a call site.
 */
test('the eye has exactly one actionability guard, and it is not at a call site', async () => {
  const {readFileSync} = await import('node:fs');
  const {fileURLToPath} = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../app/v2/shell/tree.tsx', import.meta.url)), 'utf8');
  const body = src.slice(src.indexOf('const toggleEye = useCallback'), src.indexOf('}, [eyeOn, eyeKind, p]);'));
  assert.match(body, /actionable === false\) return;/,
    'toggleEye must decline an eye the measurement says cannot act');
  // The old inline guard, which `V` bypassed. Its absence is the fix.
  assert.doesNotMatch(src, /if \(!eyeInert\) toggleEye/, 'no per-call-site guard may return');
  assert.equal((src.match(/actionable === false/g) || []).length, 1, 'exactly one guard');
});
