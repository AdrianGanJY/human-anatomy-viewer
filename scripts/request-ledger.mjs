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
 *
 * ══ THE POPULATION IS NAMED AND ENFORCED — codex review 7, High 1 ═════════════════════════════
 * `context.newCDPSession(page)` attaches to ONE target. An out-of-process child frame is a target
 * of its own: its `Network.requestWillBeSent` events are dispatched to ITS session
 * (crConnection.js:65 dispatches by session id; crPage.js:595 handles iframe targets separately),
 * and they never reach this ledger. So sixteen page-session starts plus one child-session start is
 * SIXTEEN rows, and `<= 16` passes again — the round-6 defect wearing a different hat.
 *
 * There were two remedies. Attaching to every child target converges on nothing: OOPIFs, then
 * dedicated workers, then shared workers, then service workers, then portals and prerenders, each
 * with its own attach-before-first-request race. The other is to state the population the number
 * describes and REFUSE to report a budget when the page leaves it. That is what this module does:
 *
 *   POPULATION = main frame only, no child targets, no service workers; data:/blob: excluded
 *
 * and `populationCheck()` is a GATE, not a note. `Target.setAutoAttach` is enabled on the page
 * session purely as a DETECTOR (`waitForDebuggerOnStart:false`, so nothing is paused and nothing
 * is driven): any attached iframe / worker / shared_worker / service_worker target, any second
 * frame, or any service-worker registration fails the population row and NAMES the target's type
 * and url. A budget row on a page outside the population is then a red row, not a false green.
 *
 * This also closes the round-7 Low honestly: service-worker-owned fetches are not covered by this
 * ledger, so a page that registers one cannot report a budget at all.
 */

/** Not a network transfer. Excluded, and the exclusion is printed by every consumer. */
export const NON_NETWORK_RE = /^(data|blob):/i;

/** The literal string every gate that reads this ledger must print in its `measured` value. */
export const LEDGER_EXCLUSION = 'data:/blob: excluded';

/** The population the ledger's numbers describe. Printed by EVERY row that consumes the ledger —
 *  including the positive zh-dictionary row, which review 7 caught printing nothing (Low 3). */
export const POPULATION = `main frame only, no child targets, no service workers; ${LEDGER_EXCLUSION}`;

/** Target types whose network traffic this ledger CANNOT see. Their presence is a gate failure. */
export const OUT_OF_LEDGER_TARGETS = new Set(['iframe', 'worker', 'shared_worker', 'service_worker', 'worklet']);

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
  /** Every target that attached during the run — the DETECTOR behind the population gate. */
  const targets = [];
  // The cross-check lane. Nothing asserts on it. Its clock is `Date.now()` — DRIVER RECEIPT, which
  // is precisely why it is not the asserted lane.
  context.on('request', (r) => pw.push({url: r.url(), at: Date.now(), type: r.resourceType()}));
  const session = await context.newCDPSession(page);
  await session.send('Network.enable');
  // DETECTOR ONLY. `waitForDebuggerOnStart:false` means no child is ever paused waiting for us, so
  // enabling this cannot change what the page does; `flatten:true` delivers the attach events on
  // this same session. We do not instrument the children — we REFUSE the budget when any exist.
  session.on('Target.attachedToTarget', (e) => targets.push({
    type: e.targetInfo?.type ?? 'unknown', url: e.targetInfo?.url ?? '', at: Date.now(),
  }));
  await session.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true})
    .catch((err) => targets.push({type: 'detector-unavailable', url: String(err).slice(0, 120), at: Date.now()}));
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
  return {cdp, pw, session, targets};
};

/**
 * IS THIS PAGE INSIDE THE POPULATION THE LEDGER CAN SEE? A gate, run at least twice per pass — once
 * before the barrier snapshot is consumed and once at the end of the run, because a child target
 * that attaches after the snapshot invalidates the number retroactively.
 *
 * Three readings, each of which can only make the gate REFUSE, never relax it:
 *   1. `page.frames().length === 1` — one frame. A same-process child frame IS covered by the page
 *      session, but distinguishing in-process from out-of-process at runtime is exactly the kind of
 *      inference that produced this finding twice; one frame needs no inference.
 *   2. no attached target of an out-of-ledger type (the `Target.setAutoAttach` detector).
 *   3. no service-worker registration. `navigator.serviceWorker` is undefined outside a secure
 *      context, which is itself proof that none can be registered.
 *
 * A reading that THROWS counts as a failure, not as a pass: an unavailable detector is an unknown
 * population, and an unknown population cannot support a budget.
 */
export const populationCheck = async (page, ledger) => {
  const notes = [];
  let ok = true;
  const frames = page.frames().length;
  if (frames !== 1) { ok = false; notes.push(`${frames} frames (want 1): ${page.frames().slice(1).map((f) => f.url().slice(0, 60)).join(', ')}`); }
  const strays = (ledger?.targets ?? []).filter((t) => OUT_OF_LEDGER_TARGETS.has(t.type) || t.type === 'detector-unavailable');
  if (strays.length) { ok = false; notes.push(`${strays.length} out-of-ledger target(s): ${strays.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join(' | ')}`); }
  let sw = null;
  try {
    sw = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return {n: 0, why: 'no serviceWorker API (insecure context)'};
      const regs = await navigator.serviceWorker.getRegistrations();
      return {n: regs.length, why: regs.map((r) => r.scope).join(',')};
    });
  } catch (e) { ok = false; notes.push(`service-worker probe threw: ${String(e).slice(0, 80)}`); }
  if (sw && sw.n > 0) { ok = false; notes.push(`${sw.n} service worker registration(s): ${sw.why}`); }
  return {
    ok,
    frames,
    targets: ledger?.targets ?? [],
    measured: ok
      ? `inside the population (${POPULATION})`
      : `OUTSIDE the population — ${notes.join('; ')} (${POPULATION})`,
  };
};

/**
 * The rows that had started by `barrierAt` (epoch ms from the driver), origin-relativised.
 * `barrierAt === null` means the barrier never arrived; the caller reports that, and takes every
 * row rather than silently taking none.
 */
export const rowsByBarrier = (ledger, barrierAt, origin) => (ledger?.cdp ?? [])
  .filter((r) => barrierAt === null || r.at <= barrierAt)
  .map((r) => r.url.replace(origin, ''));
