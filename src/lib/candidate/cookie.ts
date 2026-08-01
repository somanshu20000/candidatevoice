import crypto from "crypto";

/**
 * The candidate identity cookie — a SECOND anonymous identity, entirely
 * separate from the unlock cookie (src/lib/unlock-cookie.ts).
 *
 * WHY A SEPARATE COOKIE (not a field on the unlock cookie):
 * the unlock cookie records which companies a visitor has unlocked by
 * submitting a hiring report. If the candidate id lived alongside those slugs,
 * a single value would tie "this person set these preferences" to "this person
 * submitted about these companies" — a correlation the evidence model forbids
 * (docs/adr-0001 §4.3). Two cookies, read independently, never co-occur in one
 * signed value, so nothing server-side joins the two identities.
 *
 * The cookie carries one opaque UUID (the candidate_profiles.id) and an HMAC of
 * it, using the same COOKIE_SECRET signing scheme as the unlock cookie. The id
 * is a capability: whoever holds it can read/write that profile's preferences
 * through the API, and nothing else. It points at preferences, never at a report.
 */

const COOKIE_NAME = "cv_candidate";
// Longer than the 24h unlock cookie: a preference vector is meant to persist so
// a returning visitor keeps their advisor setup. Still not "permanent" — an
// anonymous convenience, not an account.
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 180; // 180 days

/** UUID v4 shape — what gen_random_uuid() produces for candidate_profiles.id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getCookieSecret() {
  return process.env.COOKIE_SECRET ?? "";
}

function sign(data: string) {
  const secret = getCookieSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/**
 * Encode a candidate id into a signed cookie value, or "" if the id is
 * malformed or no secret is configured (caller then does not set the cookie).
 */
export function encodeCandidateCookie(candidateId: string): string {
  if (!UUID_RE.test(candidateId)) return "";
  const signature = sign(candidateId);
  if (!signature) return "";
  return `${candidateId}.${signature}`;
}

/**
 * Recover the candidate id from a cookie value, verifying the HMAC in constant
 * time. Returns null on any tampering, malformed shape, or missing secret — the
 * caller then treats the visitor as having no profile yet (and may mint one).
 */
export function decodeCandidateCookie(value?: string): string | null {
  try {
    if (!value) return null;
    const dot = value.lastIndexOf(".");
    if (dot <= 0) return null;
    const id = value.slice(0, dot);
    const signature = value.slice(dot + 1);
    if (!UUID_RE.test(id)) return null;

    const expected = sign(id);
    if (!expected) return null;

    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    return id;
  } catch {
    return null;
  }
}

export function getCandidateCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export { COOKIE_NAME as CANDIDATE_COOKIE_NAME };
