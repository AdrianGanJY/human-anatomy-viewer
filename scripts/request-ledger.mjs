/**
 * request-ledger.mjs — THE REQUEST-START LEDGER, READ AT THE PROTOCOL LEVEL.
 *
 * Extracted from verify-ux.mjs so the acceptance suite and the regression suite assert on the SAME
 * ledger. A regression that exercises a copy of the instrument is evidence about the copy.
 *
 * ══ WHY CDP AND NOT `context.on('request')` ═══════════════════════════════════════════════════
 * codex review 6, High 1. Playwright 1.55.1 does not emit its context `request` event for every
 * request the browser issues. Its `Request` constructor flags any URL ending in `/favicon.ico`
 * (playwright-core/lib/server/network.js:122, `_isFavicon`), and `FrameManager.requestStarted()`
 * RETURNS BEFORE emitting the context event for a flagged request — and, when interception is
 * installed, `route.abort('aborted')`s it before any custom route handler can see it
 * (playwright-core/lib/server/frames.js:229). So sixteen ordinary starts plus one `/favicon.ico`
 * start produce SIXTEEN ledger rows, and a `<= 16` budget passes on a page that issued seventeen.
 * The gate's own stated population names the favicon, so this is an acceptance defect: the
 * instrument cannot see a member of the population it claims to measure.
 *
 * `Network.requestWillBeSent` is emitted by the browser itself, before Playwright's driver-side
 * filtering exists to apply. It sees the suppressed request (the abort happens after the event),
 * it sees each redirect hop as its own event, and it does not care who initiated the request.
 * That is the vantage point "how many requests had STARTED by the barrier" actually requires.
 *
 * ══ THE TWO CLOCKS, NAMED ═════════════════════════════════════════════════════════════════════
 * A ledger that is compared against a barrier timestamp is only as good as the clock the two share.
 *
 *   `at`   = `e.wallTime * 1000` — CDP's WALL clock, Unix epoch milliseconds, sampled by the
 *            BROWSER at issuance. This is the asserted clock, and it is comparable to the driver's
 *            `Date.now()` barrier sample because both are the same host's wall clock.
 *   `mono` = `e.timestamp` — CDP's MONOTONIC clock (seconds since an arbitrary browser epoch).
 *            Recorded for ordering between rows only; it is NOT comparable to `Date.now()` and
 *            nothing compares it to the barrier.
 *
 * This also answers review 6's standing Medium ("cutoff measures driver receipt, not browser
 * issuance") for the ledger half: `at` is issuance-side, taken in the browser, not the moment the
 * driver got around to receiving an event. The BARRIER sample is still driver-side and therefore a
 * few milliseconds LATE — which counts a little extra in-flight work into a `<=` bound. That bias
 * is conservative: it can only make the gate stricter, never manufacture a green.
 *
 * ══ WHAT IS EXCLUDED, OUT LOUD ════════════════════════════════════════════════════════════════
 * `data:` and `blob:` URLs are dropped: they are not network transfers, and counting them against a
 * request budget would measure the bundler's inlining rather than the wire. Nothing else is
 * dropped. Every caller prints `LEDGER_EXCLUSION` inside the row's measured string, because a
 * silent exclusion is the same defect as a suppressed event wearing a different hat.
 */

/** Not a network transfer. Excluded, and the exclusion is printed by every consumer. */
export const NON_NETWORK_RE = /^(data|blob):/i;

/** The literal string every gate that reads this ledger must print in its `measured` value. */
export const LEDGER_EXCLUSION = 'data:/blob: excluded';

/**
 * Attach both lanes to one page.
 *
 * MUST be awaited BEFORE the page navigates — the CDP session is opened here, and a request issued
 * before `Network.enable` resolves is a request no ledger has.
 *
 * @returns {Promise<{cdp: object[], pw: object[], session: object}>}
 *   `cdp` is THE LEDGER — the asserted one. `pw` is Playwright's `context.on('request')` lane, kept
 *   as an UNASSERTED cross-check so the two counts can be printed side by side; when they disagree,
 *   the difference is what Playwright suppressed.
 */
export const attachRequestLedger = async (context, page) => {
  const cdp = [];
  const pw = [];
  // The cross-check lane. Nothing asserts on it. Its clock is `Date.now()` — DRIVER RECEIPT, which
  // is precisely why it is not the asserted lane.
  context.on('request', (r) => pw.push({url: r.url(), at: Date.now(), type: r.resourceType()}));
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  session.on('Network.requestWillBeSent', (e) => {
    const url = e.request?.url ?? '';
    if (NON_NETWORK_RE.test(url)) return;
    cdp.push({
      url,
      at: (e.wallTime ?? 0) * 1000,   // wall clock, epoch ms, browser-side issuance
      mono: e.timestamp,              // monotonic, ordering only — never compared to Date.now()
      type: e.type,
      requestId: e.requestId,
      // A redirect hop is its own start, exactly as Playwright models it with a separate Request.
      redirect: !!e.redirectResponse,
    });
  });
  return {cdp, pw, session};
};

/**
 * The rows that had started by `barrierAt` (epoch ms from the driver), origin-relativised.
 * `barrierAt === null` means the barrier never arrived; the caller reports that, and takes every
 * row rather than silently taking none.
 */
export const rowsByBarrier = (ledger, barrierAt, origin) => (ledger?.cdp ?? [])
  .filter((r) => barrierAt === null || r.at <= barrierAt)
  .map((r) => r.url.replace(origin, ''));
