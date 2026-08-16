/**
 * V0.2 — isVerificationConfigured() is the whole trust surface behind the
 * admin-gated /api/verify/health route (the route itself is thin: auth +
 * return this boolean, live-verified like every other route in this codebase).
 * These tests pin the two things that matter: it reports presence truthfully,
 * and it discloses nothing but a boolean.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isVerificationConfigured } from "@/lib/verification/token";

const ORIGINAL = process.env.VERIFICATION_SECRET;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VERIFICATION_SECRET;
  else process.env.VERIFICATION_SECRET = ORIGINAL;
});

describe("isVerificationConfigured", () => {
  it("returns true when VERIFICATION_SECRET is a non-empty string", () => {
    process.env.VERIFICATION_SECRET = "some-secret-value";
    expect(isVerificationConfigured()).toBe(true);
  });

  it("returns false when VERIFICATION_SECRET is unset", () => {
    delete process.env.VERIFICATION_SECRET;
    expect(isVerificationConfigured()).toBe(false);
  });

  it("returns false when VERIFICATION_SECRET is the empty string", () => {
    process.env.VERIFICATION_SECRET = "";
    expect(isVerificationConfigured()).toBe(false);
  });

  it("returns a boolean, never the secret's value or length", () => {
    process.env.VERIFICATION_SECRET = "super-secret-42-chars-long-xxxxxxxxxxxxxxx";
    const result = isVerificationConfigured();
    expect(typeof result).toBe("boolean");
    // The result carries no information beyond presence.
    expect(result).toBe(true);
  });
});
