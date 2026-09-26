/**
 * THE BEACON EXEMPTION MUST NOT SWALLOW A LOOK-ALIKE HOST — L34, codex round 1 MEDIUM 4.
 *
 * `verify-ux.mjs` tolerates exactly one CSP violation on the live origin: Cloudflare's Web Analytics
 * beacon, which the edge INJECTS into HTML and `script-src 'self'` refuses. Before L34 the suite had no
 * exemption at all and the first live run produced 12 reds that were all this one script.
 *
 * The first fix copied verify-live's pattern: `/static\.cloudflareinsights\.com.*violates …/`. codex
 * executed the hole — a script blocked from `https://static.cloudflareinsights.com.evil.invalid/x.js`
 * matches that substring, so a genuinely foreign refusal would be reported as "the expected beacon" and
 * disappear from the gate. THAT is the failure mode an exemption must not have: it makes the instrument
 * blind to the thing it is instrumenting.
 *
 * These rows execute the two classifiers against the adversarial hostname. They read the classifiers out
 * of the sweep's source rather than re-declaring them, because a second copy in the test is how an
 * exemption passes here while the shipped one is wrong.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = readFileSync(join(ROOT, 'scripts', 'verify-ux.mjs'), 'utf8').replace(/\r\n/g, '\n');

/**
 * Lift the shipped classifiers out of the sweep and evaluate them, rather than re-declaring them here.
 * A second copy in the test is exactly how an exemption passes while the shipped one is wrong — the
 * defect family this whole suite exists for. The slice runs from the `BEACON_ORIGIN` declaration to the
 * end of `isBeaconEvent`, which is one contiguous block by construction.
 */
const lift = () => {
  const from = SRC.indexOf("const BEACON_ORIGIN = ");
  assert.ok(from >= 0, 'verify-ux.mjs no longer declares BEACON_ORIGIN — this test cannot see the shipped rule');
  const end = SRC.indexOf('};', SRC.indexOf('const isBeaconEvent'));
  assert.ok(end > from, 'verify-ux.mjs no longer declares isBeaconEvent as a block arrow');
  const block = SRC.slice(from, end + 2);
  // eslint-disable-next-line no-new-func
  return new Function(`${block}\nreturn {BEACON_ORIGIN, EXPECTED_CSP_VIOLATION, unexpectedErrors, isBeaconEvent};`)();
};

const { EXPECTED_CSP_VIOLATION, BEACON_ORIGIN, isBeaconEvent } = lift();

const REAL = "Refused to load the script 'https://static.cloudflareinsights.com/beacon.min.js/vcd15cbe7772f49c399c6a5babf22c1241717689176015' because it violates the following Content Security Policy directive: \"script-src 'self'\".";
const LOOKALIKE = "Refused to load the script 'https://static.cloudflareinsights.com.evil.invalid/x.js' because it violates the following Content Security Policy directive: \"script-src 'self'\".";
const SUBDOMAIN = "Refused to load the script 'https://evil.static.cloudflareinsights.com.attacker.test/x.js' because it violates the following Content Security Policy directive: \"script-src 'self'\".";

test('the console-message exemption matches the REAL edge-injected beacon', () => {
  assert.ok(EXPECTED_CSP_VIOLATION.test(REAL));
});

test('and it does NOT match a look-alike hostname (codex round 1, MEDIUM 4)', () => {
  assert.ok(!EXPECTED_CSP_VIOLATION.test(LOOKALIKE),
    'static.cloudflareinsights.com.evil.invalid would be tolerated as the expected beacon');
  assert.ok(!EXPECTED_CSP_VIOLATION.test(SUBDOMAIN));
});

test('a genuinely different blocked script is never exempt', () => {
  assert.ok(!EXPECTED_CSP_VIOLATION.test(
    "Refused to load the script 'https://evil.example.invalid/x.js' because it violates the following Content Security Policy directive: \"script-src 'self'\"."));
  // And a NON-CSP console error is not a CSP exemption's business at all.
  assert.ok(!EXPECTED_CSP_VIOLATION.test('Uncaught TypeError: x is not a function'));
});

test('the in-page violation classifier pins the full origin too', () => {
  assert.equal(BEACON_ORIGIN, 'https://static.cloudflareinsights.com/');
  assert.ok(isBeaconEvent('script-src-elem <- https://static.cloudflareinsights.com/beacon.min.js'));
  assert.ok(isBeaconEvent('script-src <- https://static.cloudflareinsights.com/beacon.min.js/abc'));
  assert.ok(!isBeaconEvent('script-src-elem <- https://static.cloudflareinsights.com.evil.invalid/x.js'),
    'a hostname that merely STARTS with the beacon host must not be exempt');
  assert.ok(!isBeaconEvent('script-src-elem <- https://evil.example.invalid/x.js'));
  // Any other DIRECTIVE is a red regardless of host — the exemption is about one script, not one origin.
  assert.ok(!isBeaconEvent('style-src-attr <- https://static.cloudflareinsights.com/beacon.min.js'));
  assert.ok(!isBeaconEvent('connect-src <- https://static.cloudflareinsights.com/cdn-cgi/rum'));
});

/**
 * AND THE SUITE MUST USE ONE CLASSIFIER, not three hand-written patterns with three strictnesses —
 * which is what MEDIUM 4 actually found. A fourth copy appearing anywhere is the regression.
 */
test('the sweep classifies the beacon in exactly one place per shape', () => {
  // CODE lines only. A comment naming the host is documentation; a second matcher is a second rule.
  const code = SRC.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
  const sites = code.filter((l) => /cloudflareinsights/.test(l));
  assert.deepEqual(sites.map((l) => l.trim().slice(0, 24)), [
    "const BEACON_ORIGIN = 'h",
    'const EXPECTED_CSP_VIOLA',
  ], 'the beacon host appears in CODE somewhere other than the two declarations — every other site must '
    + 'call isBeaconEvent() or unexpectedErrors(), or the three copies drift apart again (round 1, MEDIUM 4)');
});
