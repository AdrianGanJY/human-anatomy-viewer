/**
 * _access.js — Cloudflare Access identity for the hub's /mcp endpoint (A234).
 *
 * FAIL-CLOSED by construction. This module is deliberately NOT the hub's
 * `functions/api/_utils.js checkAuth()`, which is fail-OPEN (unset key ⇒ every
 * request allowed) and trusts any request carrying an Origin/Referer header.
 * /mcp carries Adrian's personal reports and life logs; it gets the opposite
 * posture — no config, no access.
 *
 * Verified identity only:
 *   - The signature is checked BEFORE any claim is trusted. The only pre-verify
 *     reads are the header's `alg` (pinned to RS256) and `kid` (which key), both
 *     of which only select a key — they never grant anything.
 *   - `Cf-Access-Authenticated-User-Email` is NEVER read. CF Access Managed
 *     OAuth SUPPRESSES that header, and it is a plaintext request header anyway
 *     (spoofable on any path that does not transit the gate). D78, 2026-07-26.
 *   - ACCESS_TEAM_DOMAIN must end in `.cloudflareaccess.com`, so a typo'd env
 *     var can never install a new trust root.
 *   - ACCESS_AUD is exactly ONE tag. A comma is treated as misconfiguration and
 *     fails closed rather than silently widening the audience.
 *
 * Ported from mipos-dev-center/src/access-jwt.js (compact WebCrypto verifier +
 * owner gate) with the hardenings from mipos-sync-core/src/access.js (the
 * canonical estate resolver, adversarially reviewed 2026-08-19).
 *
 * Browser logins carry `email`; service-token JWTs carry `common_name` (= the
 * token's Client ID) and no email at all.
 *
 * There is deliberately NO local-development bypass. An earlier draft carried the
 * dev-center's "hostname is loopback ⇒ owner" affordance; adversarial review
 * (codex, 2026-09-06) pointed out that on a dev box it combines with permissive
 * CORS into an unauthenticated read for any web page that can reach loopback.
 * It was never needed — local runs authenticate with a real CF-issued JWT — so
 * the whole path is gone rather than hardened. A verified token is the ONLY way in.
 */

const JWKS_TTL_MS = 60 * 60 * 1000; // ~1h
const JWKS_MIN_REFETCH_MS = 60 * 1000; // floor between JWKS fetch ATTEMPTS
const JWKS_FETCH_TIMEOUT_MS = 5000;
const CLOCK_SKEW_S = 60;

// `attempted` is tracked separately from `fetched` on purpose: keying the cooldown
// off successes only means a FAILING certs endpoint is refetched on every single
// request (an unauthenticated caller could amplify an upstream outage).
let jwksCache = { keys: null, fetched: 0, attempted: 0, team: null };
let jwksInflight = null;

const B64U = /^[A-Za-z0-9_-]+$/;
/** A JWT-shaped string: three base64url segments. Cheap shape gate before crypto. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function b64uToBytes(s) {
  if (typeof s !== 'string' || !B64U.test(s)) throw new Error('bad base64url');
  let t = s.replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
const b64uToJson = (s) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

/**
 * The team domain, normalised — or null (⇒ fail closed).
 * The `.cloudflareaccess.com` suffix is the trust-root pin: without it a typo or
 * a hostile env value could point JWKS discovery at an attacker's key set.
 */
export function teamDomain(env) {
  const raw = String(env?.ACCESS_TEAM_DOMAIN || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!raw) return null;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(raw)) return null;
  if (!raw.endsWith('.cloudflareaccess.com')) return null;
  return raw;
}

/** The single expected audience tag — or null (⇒ fail closed). */
export function audTag(env) {
  const raw = String(env?.ACCESS_AUD || '').trim();
  if (!raw) return null;
  // A comma list is a misconfiguration here, not a multi-audience feature.
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(raw)) return null;
  return raw;
}

/** True when a fetch attempt is allowed right now (cooldown covers failures too). */
const mayAttemptJwks = () => Date.now() - jwksCache.attempted >= JWKS_MIN_REFETCH_MS;

async function fetchJwks(team) {
  if (jwksInflight) return jwksInflight;
  // Stamp the ATTEMPT before awaiting, so a failure still starts the cooldown.
  jwksCache = { ...jwksCache, attempted: Date.now() };
  const p = (async () => {
    const res = await fetch(`https://${team}/cdn-cgi/access/certs`, {
      signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
    const body = await res.json();
    const keys = Array.isArray(body?.keys) ? body.keys : [];
    jwksCache = { keys, fetched: Date.now(), attempted: Date.now(), team };
    return keys;
  })();
  jwksInflight = p;
  try {
    return await p;
  } finally {
    if (jwksInflight === p) jwksInflight = null;
  }
}

/**
 * Signing key for `kid`. Refetches on TTL expiry, and once more on a cache miss
 * (that is how key rotation lands mid-TTL) — but never more often than
 * JWKS_MIN_REFETCH_MS, counted from the last ATTEMPT. Without that, a flood of
 * random `kid`s, or a certs endpoint returning 5xx, turns every request into a
 * fresh subrequest against Cloudflare.
 */
async function getSigningKey(team, kid) {
  // A different team is a different cache — including its cooldown and its
  // in-flight fetch, so a config change is never locked out by the previous
  // team's backoff, and no request can await the wrong team's keys.
  if (jwksCache.team !== team) {
    jwksCache = { keys: null, fetched: 0, attempted: 0, team };
    jwksInflight = null;
  }

  // Joining an in-flight fetch must be tried BEFORE the cooldown. Otherwise a
  // cold isolate rejects every request that arrives while the first one is still
  // fetching: they see no cached keys, see a fresh `attempted` stamp, and 401 a
  // perfectly valid token.
  const refresh = async () => {
    try {
      const inflight = jwksInflight;
      if (inflight) {
        const keys = await inflight;
        // Only trust the result if it was this team's fetch that resolved: an
        // overlapping config change could otherwise hand team A team B's keys.
        return jwksCache.team === team ? keys : null;
      }
      if (mayAttemptJwks()) return await fetchJwks(team);
    } catch { /* fall back to whatever is cached */ }
    return jwksCache.team === team ? jwksCache.keys : null;
  };

  let keys = jwksCache.keys;
  if (!keys || Date.now() - jwksCache.fetched > JWKS_TTL_MS) keys = await refresh();
  if (!keys || !keys.length) return null;

  let jwk = keys.find((k) => k.kid === kid);
  if (!jwk) {
    keys = await refresh(); // rotation: one forced refresh, rate-limited
    jwk = (keys || []).find((k) => k.kid === kid);
  }
  return jwk || null;
}

/**
 * The Access JWT, from either place it can arrive:
 *   - `Cf-Access-Jwt-Assertion` — injected by the gate on a request that passed it.
 *   - `Authorization: Bearer <jwt>` — the Managed OAuth flow (claude.ai, ChatGPT,
 *     Cursor all send the CF-issued token here, RFC 6750).
 * Anything not JWT-shaped is ignored, so a static API key in the Bearer slot can
 * never be mistaken for an identity.
 */
export function extractAccessJwt(request) {
  const header = (request.headers.get('Cf-Access-Jwt-Assertion') || '').trim();
  if (JWT_SHAPE.test(header)) return header;
  const auth = request.headers.get('Authorization') || '';
  if (/^Bearer\s+/i.test(auth)) {
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (JWT_SHAPE.test(token)) return token;
  }
  return null;
}

/**
 * Verify the Access JWT → { email, common_name, kind } | null. Never throws.
 * null means "no verified identity" for every reason: unconfigured, absent,
 * malformed, wrong signature, wrong issuer, wrong audience, expired.
 */
export async function verifyAccessJwt(request, env) {
  try {
    const team = teamDomain(env);
    const aud = audTag(env);
    if (!team || !aud) return null; // UNCONFIGURED ⇒ FAIL CLOSED. No dev bypass here.

    const token = extractAccessJwt(request);
    if (!token) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    const header = b64uToJson(parts[0]);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string' || !header.kid) return null;

    // ── signature FIRST: no claim below is trusted until this passes ──
    const jwk = await getSigningKey(team, header.kid);
    if (!jwk || jwk.kty !== 'RSA') return null;
    if (jwk.alg && jwk.alg !== 'RS256') return null;
    const key = await crypto.subtle.importKey(
      'jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5', key,
      b64uToBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return null;

    const payload = b64uToJson(parts[1]);
    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp + CLOCK_SKEW_S <= now) return null;
    if (payload.nbf !== undefined && (typeof payload.nbf !== 'number' || payload.nbf - CLOCK_SKEW_S > now)) return null;
    if (payload.iat !== undefined && (typeof payload.iat !== 'number' || payload.iat - CLOCK_SKEW_S > now)) return null;

    // `iss` may or may not carry the scheme depending on the JWT vintage.
    const iss = String(payload.iss || '');
    if (iss !== team && iss !== `https://${team}`) return null;

    const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!auds.includes(aud)) return null;

    const email = typeof payload.email === 'string' && payload.email ? payload.email : null;
    const common_name = typeof payload.common_name === 'string' && payload.common_name ? payload.common_name : null;
    if (!email && !common_name) return null; // a token with no principal is not an identity

    return { email, common_name, kind: email ? 'user' : 'service' };
  } catch {
    return null;
  }
}

const csv = (v) => String(v || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);

/**
 * The caller → { label, kind, owner, email, common_name } | null.
 *
 * `owner` is the gate that decides which tools exist: a verified-but-not-owner
 * identity still gets an identity object (so `whoami` can diagnose it), but no
 * data tools. Owners are named by OWNER_EMAILS (browser logins) and
 * OWNER_TOKEN_IDS (service tokens, matched on common_name).
 */
export async function resolveIdentity(request, env) {
  const id = await verifyAccessJwt(request, env);
  if (!id) return null;
  const owner =
    (!!id.email && csv(env.OWNER_EMAILS).includes(id.email.toLowerCase())) ||
    (!!id.common_name && csv(env.OWNER_TOKEN_IDS).includes(id.common_name.toLowerCase()));
  return {
    label: id.email || id.common_name,
    kind: id.kind,
    owner,
    email: id.email,
    common_name: id.common_name,
  };
}
