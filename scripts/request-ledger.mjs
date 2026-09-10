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
 * ══ THE POPULATION IS NAMED AND ENFORCED — codex reviews 7 and 8 ═════════════════════════════
 * `context.newCDPSession(page)` attaches to ONE target. An out-of-process child frame is a target
 * of its own: its `Network.requestWillBeSent` events are dispatched to ITS session
 * (crConnection.js:65 dispatches by session id; crPage.js:595 handles iframe targets separately),
 * and they never reach this ledger. So sixteen page-session starts plus one child-session start is
 * SIXTEEN rows, and `<= 16` passes again — the round-6 defect wearing a different hat.
 *
 * There were two remedies. Attaching to every child target converges on nothing: OOPIFs, then
 * dedicated workers, then shared workers, then service workers, then portals and prerenders, each
 * with its own attach-before-first-request race. The other is to state the population the number
 * describes and REFUSE to report a budget when the page leaves it. That is what this module does.
 *
 * ROUND 8 FOUND THE ROUND-7 DETECTOR TOO NARROW, IN TWO WAYS, AND BOTH ARE CLOSED HERE:
 *
 *  1. SCOPE. Page-session `Target.setAutoAttach` observes only targets DIRECTLY RELATED to the
 *     page; `flatten:true` changes session addressing, not the observed set. A SHARED WORKER is a
 *     browser-level target and never attaches to the page session — measured here, 2026-09-10: a
 *     `new SharedWorker()` whose script fetched two files produced ZERO page-session attachments
 *     while its two requests hit the fixture server. So discovery is now BROWSER-LEVEL
 *     (`browser.newBrowserCDPSession()` + `Target.setDiscoverTargets`), opened BEFORE navigation,
 *     and every `targetCreated` / `targetInfoChanged` / `targetDestroyed` is kept in a lifecycle
 *     history that SURVIVES destruction — a target that existed and died still fails the gate,
 *     because its requests happened.
 *
 *  2. DEFAULT-DENY. The round-7 rule rejected five named types, which is an allowlist by omission:
 *     a `page` target with subtype `prerender` passed, and so did `other` and any type this file
 *     had not heard of. The rule is now inverted. Inside the page's own browser context the ONLY
 *     permitted target is the page's own top-level target (`type: 'page'`, no subtype, matching
 *     targetId). EVERYTHING else fails and is named by type/subtype/url — iframe, worker,
 *     shared_worker, service_worker, worklet, page/prerender, other, unknown, anything future.
 *
 * CONTEXT SCOPING, STATED. Targets in a DIFFERENT browser context cannot share this page's
 * requests — separate storage partition, separate context — so they are outside the population by
 * construction. They are recorded and counted in the measured string anyway, so the reader can see
 * what was discarded and why. A target with NO `browserContextId` is treated as IN context: the
 * conservative direction, because the alternative would let an unattributed target slip out of the
 * population silently.
 *
 * WHAT DISCOVERY DOES NOT SHOW, MEASURED RATHER THAN ASSUMED (2026-09-10, this Chromium):
 * `Target.setDiscoverTargets` with the default filter excludes `browser` and `tab` targets — both
 * verified present under `filter:[{}]` and both irrelevant here, since neither issues requests of
 * its own. And a PRERENDER never becomes a target at all while CDP is attached: the browser's own
 * `Preload.prerenderStatusUpdated` reports `PrerenderingDisabledByDevTools`, so the speculation
 * rule degrades to a PREFETCH issued by the page's own loader — which lands in this ledger like any
 * other row. That is measured in the `prerender-population` regression, not assumed here.
 *
 * `populationCheck()` is a GATE, not a note. A reading that throws counts as a failure: an
 * unavailable detector is an unknown population, and an unknown population cannot support a budget.
 * This also closes the service-worker Low honestly — registration probes at both ends of the run
 * PLUS `service_worker` target lifecycle across the whole run, so a worker that registered and
 * unregistered between the two probes is still caught.
 */

/** Not a network transfer. Excluded, and the exclusion is printed by every consumer. */
export const NON_NETWORK_RE = /^(data|blob):/i;

/** The literal string every gate that reads this ledger must print in its `measured` value. */
export const LEDGER_EXCLUSION = 'data:/blob: excluded';

/** The population the ledger's numbers describe. Printed by EVERY row that consumes the ledger —
 *  including the positive zh-dictionary row, which review 7 caught printing nothing (Low 3). */
export const POPULATION = 'the page’s own top-level target ONLY — one frame; browser-wide discovery, '
  + 'DEFAULT-DENY: any other target in this browser context fails (iframe / worker / shared_worker / '
  + 'service_worker / page+prerender / other / unknown), other browser contexts recorded but out of '
  + `population; ${LEDGER_EXCLUSION}`;

/** Types whose traffic this ledger cannot see, kept ONLY to label the narrower page-session
 *  cross-check lane. The gate itself is default-deny and does not consult this list — a named-type
 *  list is an allowlist by omission, which is precisely review 8's H1.2. */
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

  // ── BROWSER-LEVEL TARGET DISCOVERY, OPENED BEFORE NAVIGATION ────────────────────────────────
  // The page session cannot see a browser-level target (review 8, H1.1). This one can. Every
  // create / change / destroy is appended; nothing is ever removed, so a target that lived and
  // died between two probes still fails the gate — its requests happened either way.
  const lifecycle = [];
  const note = (phase, info, extra = {}) => lifecycle.push({
    phase, at: Date.now(),
    targetId: info?.targetId ?? extra.targetId ?? '?',
    type: info?.type ?? extra.type ?? 'unknown',
    subtype: info?.subtype ?? '',
    url: info?.url ?? '',
    browserContextId: info?.browserContextId ?? '',
    openerId: info?.openerId ?? '',
  });
  const browser = context.browser();
  let root = null;
  try {
    root = await browser.newBrowserCDPSession();
    root.on('Target.targetCreated', (e) => note('created', e.targetInfo));
    root.on('Target.targetInfoChanged', (e) => note('changed', e.targetInfo));
    root.on('Target.targetDestroyed', (e) => note('destroyed', null, {targetId: e.targetId, type: 'destroyed'}));
    // The DEFAULT filter is deliberate: it excludes `browser` and `tab` targets, both of which were
    // verified present under `filter:[{}]` and neither of which issues requests of its own. Naming
    // the filter here rather than passing one keeps the discovered set the one Chromium calls the
    // page-ish set, and the default-deny rule below covers everything inside it.
    await root.send('Target.setDiscoverTargets', {discover: true});
  } catch (err) {
    // An unavailable detector is an UNKNOWN population. Record it as a poison row so the gate
    // refuses rather than reporting a budget it cannot justify.
    note('detector-unavailable', null, {targetId: 'n/a', type: 'detector-unavailable'});
    lifecycle[lifecycle.length - 1].url = String(err).slice(0, 120);
  }
  // WHICH TARGET IS THIS PAGE? Asked of the page's own session, so the answer cannot be inferred
  // from ordering or from a url match.
  let self = null;
  try { self = (await session.send('Target.getTargetInfo')).targetInfo; } catch { /* recorded as a gate failure below */ }

  // The page-session auto-attach stays as a SECONDARY lane. It is strictly narrower than discovery,
  // but it reports attachments (not just existence) and costs nothing. `waitForDebuggerOnStart:false`
  // means no child is ever paused waiting for us, so enabling it cannot change what the page does.
  session.on('Target.attachedToTarget', (e) => {
    targets.push({type: e.targetInfo?.type ?? 'unknown', subtype: e.targetInfo?.subtype ?? '', url: e.targetInfo?.url ?? '', at: Date.now()});
    note('attached', e.targetInfo);
  });
  await session.send('Target.setAutoAttach', {autoAttach: true, waitForDebuggerOnStart: false, flatten: true})
    .catch((err) => targets.push({type: 'detector-unavailable', subtype: '', url: String(err).slice(0, 120), at: Date.now()}));
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
  return {cdp, pw, session, targets, lifecycle, root, self};
};

/** The distinct targets discovery ever saw, last-known info per targetId, destruction remembered. */
export const targetHistory = (ledger) => {
  const byId = new Map();
  for (const e of ledger?.lifecycle ?? []) {
    if (e.phase === 'destroyed') {
      const prior = byId.get(e.targetId);
      if (prior) prior.destroyed = true;
      else byId.set(e.targetId, {...e, destroyed: true});
      continue;
    }
    const prior = byId.get(e.targetId) ?? {destroyed: false};
    byId.set(e.targetId, {
      ...prior, targetId: e.targetId, type: e.type,
      // Keep the FIRST non-empty subtype/url ever seen: a prerender that activates is reported
      // again without its subtype, and forgetting it would launder the very thing we reject on.
      subtype: prior.subtype || e.subtype, url: e.url || prior.url,
      browserContextId: e.browserContextId || prior.browserContextId,
      openerId: e.openerId || prior.openerId,
      phases: [...(prior.phases ?? []), e.phase],
    });
  }
  return [...byId.values()];
};

/**
 * IS THIS PAGE INSIDE THE POPULATION THE LEDGER CAN SEE? A gate, run at least twice per pass — once
 * before the barrier snapshot is consumed and once at the end of the run, because a target that
 * appears after the snapshot invalidates the number retroactively.
 *
 * DEFAULT-DENY. Inside the page's own browser context the ONLY permitted target is the page's own
 * top-level target. Every other discovered target fails and is NAMED — that is the difference from
 * round 7, which listed five rejected types and therefore accepted `page/prerender`, `other`, and
 * everything it had not thought of (review 8, H1.2).
 *
 * Readings, each of which can only make the gate REFUSE, never relax it:
 *   1. `page.frames().length === 1`. A same-process child frame IS covered by the page session, but
 *      distinguishing in-process from out-of-process at runtime is exactly the inference that
 *      produced this finding twice; one frame needs no inference.
 *   2. the discovery lifecycle, default-deny, scoped to this browser context — including targets
 *      already destroyed.
 *   3. the page's own target must actually have been DISCOVERED. A discovery lane that reported
 *      nothing is an unknown population, not an empty one.
 *   4. no service-worker registration, probed at both ends of the run and backed by
 *      `service_worker` target lifecycle across the whole run.
 *
 * A reading that THROWS counts as a failure: an unavailable detector is an unknown population, and
 * an unknown population cannot support a budget.
 */
export const populationCheck = async (page, ledger) => {
  const notes = [];
  let ok = true;
  const frames = page.frames().length;
  if (frames !== 1) { ok = false; notes.push(`${frames} frames (want 1): ${page.frames().slice(1).map((f) => f.url().slice(0, 60)).join(', ')}`); }

  // ── DEFAULT-DENY OVER THE DISCOVERED LIFECYCLE ─────────────────────────────────────────────
  const selfId = ledger?.self?.targetId ?? null;
  const selfCtx = ledger?.self?.browserContextId ?? null;
  if (!selfId) { ok = false; notes.push('the page’s own target id is unknown (Target.getTargetInfo failed)'); }
  const history = targetHistory(ledger);
  // A target with NO browserContextId counts as IN context — the conservative direction.
  const inContext = (t) => !t.browserContextId || !selfCtx || t.browserContextId === selfCtx;
  const permitted = (t) => t.targetId === selfId && t.type === 'page' && !t.subtype;
  const violations = history.filter((t) => inContext(t) && !permitted(t));
  const elsewhere = history.filter((t) => !inContext(t));
  if (violations.length) {
    ok = false;
    notes.push(`${violations.length} target(s) outside the permitted set: ` + violations
      .map((t) => `${t.type}${t.subtype ? `/${t.subtype}` : ''} ${t.url.slice(0, 60) || '(no url)'}${t.destroyed ? ' [destroyed]' : ''}`)
      .join(' | '));
  }
  if (selfId && !history.some((t) => t.targetId === selfId)) {
    ok = false;
    notes.push('browser-level discovery never reported the page’s own target — the detector is not reporting');
  }
  // The narrower page-session lane, kept as a cross-check. It can only ADD refusals.
  const strays = (ledger?.targets ?? []).filter((t) => OUT_OF_LEDGER_TARGETS.has(t.type) || t.type === 'detector-unavailable');
  if (strays.length && !violations.length) {
    ok = false;
    notes.push(`${strays.length} page-session attachment(s) discovery did not explain: ${strays.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join(' | ')}`);
  }
  let sw = null;
  try {
    sw = await page.evaluate(async () => {
      if (!navigator.serviceWorker) return {n: 0, why: 'no serviceWorker API (insecure context)'};
      const regs = await navigator.serviceWorker.getRegistrations();
      return {n: regs.length, why: regs.map((r) => r.scope).join(',')};
    });
  } catch (e) { ok = false; notes.push(`service-worker probe threw: ${String(e).slice(0, 80)}`); }
  if (sw && sw.n > 0) { ok = false; notes.push(`${sw.n} service worker registration(s): ${sw.why}`); }
  const seen = `${history.length} target(s) discovered, ${violations.length} disallowed, `
    + `${elsewhere.length} in other browser contexts (out of population: they cannot share this page’s requests`
    + `${elsewhere.length ? ` — ${elsewhere.map((t) => t.type).join(',')}` : ''})`;
  return {
    ok,
    frames,
    history,
    violations,
    elsewhere,
    targets: ledger?.targets ?? [],
    measured: ok
      ? `inside the population — ${seen} [${POPULATION}]`
      : `OUTSIDE the population — ${notes.join('; ')}; ${seen} [${POPULATION}]`,
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
