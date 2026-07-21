/**
 * CandidateVoice — Canonical client IP extraction
 *
 * Single shared implementation for getting the client IP used as the
 * identifier for both /api/submit's rate limiter and admin_utils.ts's
 * brute-force lockout. Previously each had its own copy of this logic
 * (`.split(",")[0]` on x-forwarded-for) — this replaces both.
 *
 * ── Deployment model ──────────────────────────────────────────────────────
 * This app deploys to Vercel (per claude.md), with no CDN/reverse proxy of
 * its own in front of it and no Enterprise "Trusted Proxy" configuration.
 * Verified directly against Vercel's current docs (vercel.com/docs/headers/
 * request-headers) rather than assumed:
 *
 *   - `x-forwarded-for`: Vercel's own words — "we currently overwrite the
 *     X-Forwarded-For header and do not forward external IPs. This
 *     restriction is in place to prevent IP spoofing." Vercel replaces this
 *     header with its own observation of the connecting client; it does NOT
 *     append to whatever the client sent, unlike the generic multi-hop
 *     reverse-proxy convention. On a standard (non-Enterprise) deployment,
 *     a client cannot inject an arbitrary value into this header by simply
 *     setting it themselves.
 *   - `x-vercel-forwarded-for`: documented as identical to the above, EXCEPT
 *     it stays Vercel's own direct observation even in the one scenario
 *     where x-forwarded-for could legitimately reflect something else — an
 *     Enterprise customer running their own reverse proxy in front of
 *     Vercel with "Trusted Proxy" enabled. Strictly the more authoritative
 *     of the two; preferred first.
 *   - `x-real-ip`: documented as identical to the above on Vercel. Kept as a
 *     fallback for portability if this app is ever hosted elsewhere (e.g.
 *     self-hosted behind nginx, which conventionally sets this to a single
 *     clean value via `proxy_set_header X-Real-IP $remote_addr`).
 *   - `NextRequest.ip`/`.geo`: deliberately not used. Removed entirely in
 *     Next.js 15 (vercel/next.js#68379); relying on it means inheriting a
 *     deprecation with a fixed expiry even while still on 14.x. The header
 *     approach above is Vercel's own documented forward path (equivalent to
 *     what `@vercel/functions`'s `ipAddress()` does internally) without
 *     adding a new dependency for three header reads.
 *
 * ── Threat model ──────────────────────────────────────────────────────────
 *   - Trusted proxy: Vercel's edge is the sole trusted hop for this
 *     deployment. There is no downstream proxy between Vercel and this
 *     app's functions, and no upstream proxy between the client and Vercel.
 *   - Untrusted input: raw client-supplied headers are never treated as the
 *     source of truth — only Vercel's own headers are read, and Vercel
 *     documents that it overwrites x-forwarded-for/x-vercel-forwarded-for/
 *     x-real-ip with its own observation rather than forwarding whatever a
 *     client sent.
 *   - Spoofing: a client sending `X-Forwarded-For: 1.2.3.4` (or any of the
 *     other two headers) directly does not reach this code as-is — Vercel's
 *     edge overwrites it first. This closes the specific bypass flagged in
 *     the prior review (which assumed the generic "each hop appends"
 *     convention; verified against Vercel's actual documented behavior,
 *     which is "overwrite," not "append").
 *   - Residual scenario worth naming, not currently applicable: if a
 *     third-party CDN/WAF were ever added in front of Vercel *without*
 *     enabling the paid Enterprise Trusted Proxy feature, Vercel would see
 *     that CDN as "the client," and every real visitor would collapse into
 *     one shared bucket (the CDN's IP) — a rate-limiting *degradation*, not
 *     a spoofing vulnerability. If Trusted Proxy is enabled, x-forwarded-for
 *     reflects the CDN's asserted value by explicit account-level
 *     configuration, which is a deliberate trust decision, not a gap.
 *   - NAT: multiple real users behind one NAT/corporate network share a
 *     public IP and therefore one bucket. Inherent to any IP-based scheme;
 *     not fixable without per-user identity, which this anonymous app
 *     deliberately doesn't have.
 *   - IPv6: Vercel serves IPv6 clients; header values may be IPv6 literals.
 *     Validated as IPv6, not assumed to be IPv4-only.
 *   - Localhost / missing headers: `next dev` has no Vercel edge in front of
 *     it, so none of these headers exist locally — expected, not an error.
 *     Falls back to the literal string "unknown", meaning every local-dev
 *     request shares one bucket. Harmless for local development.
 */

import { NextRequest } from "next/server";

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
// Loose IPv6 shape check (hex groups separated by colons, allowing "::"
// compression) — enough to reject obviously-wrong values without
// implementing full RFC 4291 validation, which isn't needed here.
const IPV6_RE = /^[0-9a-fA-F]{0,4}(:[0-9a-fA-F]{0,4}){2,7}$/;

function looksLikeIp(value: string): boolean {
  if (!value) return false;
  const v4Match = value.match(IPV4_RE);
  if (v4Match) {
    return v4Match.slice(1).every((octet) => Number(octet) <= 255);
  }
  return IPV6_RE.test(value);
}

/**
 * Vercel documents these headers as a single clean IP in the standard case.
 * Parsed defensively in case a value ever contains a comma-separated chain
 * (e.g. a future trusted-proxy configuration) — the LAST valid entry is
 * taken, not the first: in any hop-appending proxy chain (the universal
 * convention whenever multiple hops legitimately exist), the last entry is
 * the one closest to — and therefore most trusted by — the final hop,
 * while the first is the one furthest away and least verified.
 */
function lastValidEntry(headerValue: string | null): string | null {
  if (!headerValue) return null;
  const parts = headerValue.split(",").map((part) => part.trim()).filter(Boolean);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (looksLikeIp(parts[i])) return parts[i];
  }
  return null;
}

/**
 * Returns the best-available client IP for rate-limiting/lockout purposes,
 * or "unknown" if none of Vercel's client-IP headers are present (expected
 * in local development).
 */
export function getClientIp(req: NextRequest): string {
  const candidates = [
    req.headers.get("x-vercel-forwarded-for"),
    req.headers.get("x-forwarded-for"),
    req.headers.get("x-real-ip"),
  ];

  for (const candidate of candidates) {
    const ip = lastValidEntry(candidate);
    if (ip) return ip;
  }

  return "unknown";
}
