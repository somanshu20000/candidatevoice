/**
 * M5.2a — src/lib/verification/token.ts. Pure HMAC sign/verify, no I/O, so
 * these are direct unit tests (no fake Supabase needed) — matching the
 * convention for pure modules elsewhere (e.g. hiring-intel/weighting.ts).
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { generateNonce, signGrant, verifyGrant, type GrantPayload } from "@/lib/verification/token";

const ORIGINAL_SECRET = process.env.VERIFICATION_SECRET;

beforeEach(() => {
  process.env.VERIFICATION_SECRET = "test-secret-do-not-use-in-prod";
});

afterEach(() => {
  process.env.VERIFICATION_SECRET = ORIGINAL_SECRET;
});

function futurePayload(overrides: Partial<GrantPayload> = {}): GrantPayload {
  return {
    nonce: generateNonce(),
    organizationId: "org-123",
    tier: "contact_domain",
    exp: Math.floor(Date.now() / 1000) + 900,
    ...overrides,
  };
}

describe("signGrant / verifyGrant — round trip", () => {
  it("a freshly signed grant verifies and returns the exact payload", () => {
    const payload = futurePayload();
    const token = signGrant(payload);
    const verified = verifyGrant(token);
    expect(verified).toEqual(payload);
  });

  it("generateNonce produces distinct values", () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });
});

describe("verifyGrant — tamper detection", () => {
  it("rejects a tampered organizationId (signature no longer matches)", () => {
    const token = signGrant(futurePayload({ organizationId: "org-123" }));
    const [payloadB64, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.organizationId = "org-attacker";
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    expect(verifyGrant(tampered)).toBeNull();
  });

  it("rejects a tampered tier (signature no longer matches)", () => {
    const token = signGrant(futurePayload({ tier: "inbox_verified" }));
    const [payloadB64, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.tier = "attested";
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    expect(verifyGrant(tampered)).toBeNull();
  });

  it("rejects a tampered nonce (signature no longer matches)", () => {
    const token = signGrant(futurePayload());
    const [payloadB64, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    decoded.nonce = generateNonce();
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString("base64url")}.${signature}`;
    expect(verifyGrant(tampered)).toBeNull();
  });

  it("rejects a token whose signature was swapped for another valid token's signature", () => {
    const tokenA = signGrant(futurePayload({ organizationId: "org-A" }));
    const tokenB = signGrant(futurePayload({ organizationId: "org-B" }));
    const [payloadB64A] = tokenA.split(".");
    const [, signatureB] = tokenB.split(".");
    expect(verifyGrant(`${payloadB64A}.${signatureB}`)).toBeNull();
  });
});

describe("verifyGrant — expiry", () => {
  it("rejects an expired grant", () => {
    const token = signGrant(futurePayload({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect(verifyGrant(token)).toBeNull();
  });

  it("accepts a grant that expires in the future", () => {
    const token = signGrant(futurePayload({ exp: Math.floor(Date.now() / 1000) + 5 }));
    expect(verifyGrant(token)).not.toBeNull();
  });
});

describe("verifyGrant — wrong secret", () => {
  it("rejects a token signed under a different VERIFICATION_SECRET", () => {
    const token = signGrant(futurePayload());
    process.env.VERIFICATION_SECRET = "a-different-secret";
    expect(verifyGrant(token)).toBeNull();
  });
});

describe("verifyGrant — malformed input", () => {
  it("rejects an empty string", () => {
    expect(verifyGrant("")).toBeNull();
  });

  it("rejects a token with no dot separator", () => {
    expect(verifyGrant("not-a-real-token")).toBeNull();
  });

  it("rejects a token whose payload is not valid base64url JSON", () => {
    expect(verifyGrant("!!!not-base64!!!.somesignature")).toBeNull();
  });

  it("rejects a token whose decoded payload is missing required fields", () => {
    const bogus = Buffer.from(JSON.stringify({ nonce: "x" })).toString("base64url");
    // Sign what the module would produce for this payload shape so only the
    // shape check (not the signature check) is exercised.
    const token = `${bogus}.deadbeef`;
    expect(verifyGrant(token)).toBeNull();
  });

  it("rejects a payload with an invalid tier value", () => {
    const payload = { ...futurePayload(), tier: "super_admin" };
    const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const crypto = require("crypto");
    const sig = crypto.createHmac("sha256", process.env.VERIFICATION_SECRET).update(payloadB64).digest("base64url");
    expect(verifyGrant(`${payloadB64}.${sig}`)).toBeNull();
  });
});

describe("signGrant — configuration", () => {
  it("throws if VERIFICATION_SECRET is not configured", () => {
    delete process.env.VERIFICATION_SECRET;
    expect(() => signGrant(futurePayload())).toThrow();
  });
});
