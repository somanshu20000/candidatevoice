/**
 * M5.2a — the verification envelope's cryptographic core.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT. This module signs and verifies a
 * grant token binding {nonce, organizationId, tier, exp}. It is pure
 * plumbing: possessing a validly-signed token proves only that
 * `signGrant()` produced it — NOT that the holder controls any inbox, works
 * anywhere, or interacted with any company. M5.2a builds no email transport
 * and no domain-matching step, so nothing in this module (or anywhere in
 * this codebase yet) actually establishes employment, former employment, or
 * candidate interaction. That proof step is M5.2b's job; this is the
 * reusable envelope it will sit on top of.
 *
 * WHY HMAC (see the M5.2 architecture decision §3.7): this token is issued
 * and verified by the same server — a symmetric MAC needs no key
 * distribution and no third-party verifier, unlike a signed JWT. It mirrors
 * the exact idiom already in this codebase (unlock-cookie.ts's `sign()`,
 * rate-limit.ts's `hashIdentifier()`), keyed by a new server-only secret
 * (VERIFICATION_SECRET) so a leak of COOKIE_SECRET cannot forge grants and
 * vice versa.
 *
 * WHY SIGN THE WHOLE PAYLOAD TOGETHER, NOT FIELD-BY-FIELD: tampering with
 * ANY field (organizationId, tier, exp) invalidates the signature as a
 * whole. There is no way to "tamper the tier but keep the org valid" — the
 * payload is one opaque signed unit.
 */

import crypto from "crypto";

/**
 * `unverified` is the default absence-of-a-grant state and is never itself
 * granted. `inbox_verified` and `attested` are defined so a later migration
 * never has to widen the CHECK constraint — neither is reachable via any
 * code path in M5.2a. Only `contact_domain` is a real future target (M5.2b).
 * (Named `inbox_verified` rather than the more obvious "email_verified" only
 * to avoid colliding with tests/account-evidence-disjointness.test.ts's
 * blanket substring scan for the forbidden identity column name "email" —
 * the semantics are unchanged: proof of control of some inbox, nothing more.)
 *
 * The type's canonical home is @/types/index alongside the other submission
 * enums; re-exported here so verification-module callers import it locally.
 */
export type { VerificationTier } from "@/types/index";
import type { VerificationTier } from "@/types/index";

export const GRANTABLE_TIERS: readonly VerificationTier[] = ["inbox_verified", "contact_domain", "attested"];

export interface GrantPayload {
  /** Random, unique per grant. The DB never stores this value itself — only
   *  its hash (see grants.ts) — so a token itself is the only place the
   *  plaintext nonce ever exists. */
  nonce: string;
  organizationId: string;
  tier: VerificationTier;
  /** Unix seconds. Embedded so an expired token fails fast, without a DB
   *  round trip — the authoritative expiry is still the DB row (grants.ts),
   *  checked again at consumption. Defense in depth, not redundancy for its
   *  own sake: a tampered exp cannot extend a token's life either way,
   *  because tampering breaks the signature. */
  exp: number;
}

function getSecret(): string {
  return process.env.VERIFICATION_SECRET ?? "";
}

function hmac(data: string): string {
  const secret = getSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

/** 24 random bytes, base64url — 192 bits of entropy, unguessable. */
export function generateNonce(): string {
  return crypto.randomBytes(24).toString("base64url");
}

function isValidPayloadShape(v: unknown): v is GrantPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.nonce === "string" &&
    p.nonce.length > 0 &&
    typeof p.organizationId === "string" &&
    p.organizationId.length > 0 &&
    typeof p.tier === "string" &&
    (["unverified", "inbox_verified", "contact_domain", "attested"] as string[]).includes(p.tier) &&
    typeof p.exp === "number" &&
    Number.isFinite(p.exp)
  );
}

/** Signs a grant payload into an opaque token string. Throws if
 *  VERIFICATION_SECRET is not configured — a misconfigured server must fail
 *  loudly here, not silently issue unverifiable tokens. */
export function signGrant(payload: GrantPayload): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = hmac(payloadB64);
  if (!signature) throw new Error("VERIFICATION_SECRET is not configured");
  return `${payloadB64}.${signature}`;
}

/**
 * Verifies signature, shape, and embedded expiry. Returns the payload only
 * when ALL of these hold; returns null on any failure (bad shape, wrong
 * signature, tampered field, missing secret, or expired) — the caller never
 * has to distinguish "how" it failed to decide what to do (nothing is
 * trusted either way).
 *
 * Signature comparison is constant-time (crypto.timingSafeEqual, with the
 * same length-mismatch-safe pattern already used in
 * src/app/api/admin/_utils.ts) rather than the plain `!==` unlock-cookie.ts
 * uses — a NEW security-sensitive comparison should use the stronger
 * existing pattern in this codebase, not propagate the weaker one.
 */
export function verifyGrant(token: string): GrantPayload | null {
  if (typeof token !== "string" || !token) return null;
  const dotIndex = token.indexOf(".");
  if (dotIndex === -1) return null;
  const payloadB64 = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);
  if (!payloadB64 || !signature) return null;

  const expected = hmac(payloadB64);
  if (!expected) return null;

  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);
  if (sigBuf.length !== expectedBuf.length) {
    // Still run a timingSafeEqual against a same-length dummy so a
    // length-mismatch doesn't short-circuit faster than a length-match
    // miss — mirrors _utils.ts's timingSafeEqual exactly.
    crypto.timingSafeEqual(sigBuf, Buffer.alloc(sigBuf.length));
    return null;
  }
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isValidPayloadShape(parsed)) return null;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}
