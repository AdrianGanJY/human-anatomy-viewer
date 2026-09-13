/**
 * ══ THE RETRY VERDICT — L31 v2.1b+c, S6 prelude ════════════════════════════════════════════════
 *
 * S5b gave the sweep ONE announced retry when the app's own record says the ATLAS FETCH failed, so
 * a transient post-deploy fetch failure could not masquerade as a red run. codex round 23, Medium 6
 * then executed the branch it had bought and found the hole:
 *
 *   · first visit  — atlas 503
 *   · second visit — a RENDERER failure, readiness never reached
 *
 * The sweep announced "the retry SUCCEEDED" and the row "no request failed during this visit"
 * PASSED. Two reasons, and both matter:
 *
 *   1. the success test was `err !== 'atlas'`, so any OTHER failure on the second visit read as
 *      success — the retry was scoped to the atlas on the way in and unscoped on the way out;
 *   2. the exemption was a viewport-level boolean (`retriedHere`), and the record it exempted was
 *      read from the SECOND document. A retry is a licence to ignore the FIRST visit's record. It
 *      was being spent on whatever the second visit produced.
 *
 * So the verdict is computed here, as a pure function over the two visits, and it is the thing the
 * unit test executes. The rule it encodes, in one line: **a retried viewport must report BOTH
 * visits, and the second one has to be clean on its own terms** — empty record, readiness reached —
 * exactly like a viewport that never needed a retry. The retry buys correct measurements for the
 * other rows; it has never bought a green, and now it cannot.
 *
 * Kept in `scripts/lib/` rather than inside `verify-ux.mjs` because that file is a top-level script
 * that runs a whole browser sweep on import — there is no way to unit-test a predicate that lives
 * inside it, which is why this one shipped untested.
 */

/**
 * One visit, as the sweep observes it.
 * @typedef {object} Visit
 * @property {number|null} ready    1 when the readiness marker arrived, null when it never did.
 * @property {string} err           `data-atlas-error` — the app's verdict ('atlas', 'renderer', '').
 * @property {string} record        `data-atlas-failed` — WHICH request failed, or '' when none did.
 */

/** A visit is clean when nothing failed AND the view became usable. Both halves, always. */
export const visitClean = (v) => !!v && v.record === '' && v.ready !== null;

/** The retry fires on the app's own atlas verdict, and on nothing else. */
export const shouldRetry = (first) => !!first && first.err === 'atlas';

/**
 * @param {{first: Visit, second?: Visit|null}} visits
 * @returns {{retried: boolean, ok: boolean, lines: string[], measured: string, want: string}}
 */
export function retryVerdict({first, second = null}) {
  const say = (v, which) => v
    ? `${which} visit: record=${v.record || 'absent'} · readiness=${v.ready === null ? 'NEVER ARRIVED' : 'reached'}`
      + `${v.err ? ` · the app's verdict=${v.err}` : ''}`
    : `${which} visit: not made`;

  if (!shouldRetry(first)) {
    return {
      retried: false,
      ok: visitClean(first),
      lines: [],
      measured: say(first, 'the only'),
      want: 'nothing failed and the view became usable',
    };
  }

  const lines = [
    `the ATLAS FAILED TO LOAD on the first visit (${first.record || 'no detail recorded'}) — retried ONCE`,
  ];
  // ⚠️ THE SECOND VISIT IS JUDGED ON ITS OWN TERMS. Not "did the atlas fail again" — `visitClean`,
  // the same bar every unretried viewport is held to. A renderer failure, an unreached readiness
  // marker or a different failed request on the retry is a NEW failure the sweep has now seen.
  const clean = visitClean(second);
  if (!second) {
    lines.push('AND NO SECOND VISIT WAS MADE — the retry was announced and never taken');
  } else if (second.err === 'atlas') {
    lines.push(`AND THE RETRY FAILED THE SAME WAY (${second.record || 'no detail recorded'})`
      + ' — every row below is a REAL failure, not a flake');
  } else if (!clean) {
    lines.push(`AND THE RETRY FAILED DIFFERENTLY (${say(second, 'second')})`
      + ' — this is a NEW failure on the second visit, not the one that was retried');
  } else {
    lines.push('the retry SUCCEEDED — treat this viewport\'s rows as second-attempt readings');
  }

  return {
    retried: true,
    ok: clean,
    lines,
    measured: `${say(first, 'first')} || ${say(second, 'second')}`,
    want: 'the first visit\'s atlas failure is excused; the SECOND visit must be clean on its own terms',
  };
}
