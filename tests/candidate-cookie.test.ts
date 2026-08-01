/**
 * The candidate identity cookie. The property that matters is that it is a
 * tamper-evident capability and NOTHING more — you cannot forge one without the
 * secret, and a malformed or altered value yields no identity rather than a
 * usable one. (The de-anonymisation guarantee — that this id never joins to a
 * report — is a schema property, asserted in account-evidence-disjointness.)
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  encodeCandidateCookie,
  decodeCandidateCookie,
  getCandidateCookieOptions,
  CANDIDATE_COOKIE_NAME,
} from "@/lib/candidate/cookie";

const UUID = "11111111-2222-4333-8444-555555555555";

beforeAll(() => {
  process.env.COOKIE_SECRET = "test-secret-for-candidate-cookie";
});

describe("encode / decode round-trip", () => {
  it("recovers the id from a value it signed", () => {
    const encoded = encodeCandidateCookie(UUID);
    expect(encoded).not.toBe("");
    expect(decodeCandidateCookie(encoded)).toBe(UUID);
  });

  it("refuses to encode a non-UUID", () => {
    expect(encodeCandidateCookie("not-a-uuid")).toBe("");
    expect(encodeCandidateCookie("")).toBe("");
    // A slug-shaped value must never be accepted as an id.
    expect(encodeCandidateCookie("stripe")).toBe("");
  });
});

describe("tamper evidence", () => {
  it("rejects a value whose id was swapped but signature kept", () => {
    const encoded = encodeCandidateCookie(UUID);
    const other = "99999999-2222-4333-8444-555555555555";
    const forged = `${other}.${encoded.split(".")[1]}`;
    expect(decodeCandidateCookie(forged)).toBeNull();
  });

  it("rejects a value signed with a different secret", () => {
    const encoded = encodeCandidateCookie(UUID);
    process.env.COOKIE_SECRET = "a-completely-different-secret";
    expect(decodeCandidateCookie(encoded)).toBeNull();
    process.env.COOKIE_SECRET = "test-secret-for-candidate-cookie";
  });

  it("returns null on malformed shapes rather than throwing", () => {
    expect(decodeCandidateCookie(undefined)).toBeNull();
    expect(decodeCandidateCookie("")).toBeNull();
    expect(decodeCandidateCookie("no-dot-here")).toBeNull();
    expect(decodeCandidateCookie(".onlysig")).toBeNull();
    expect(decodeCandidateCookie(`${UUID}.`)).toBeNull();
    expect(decodeCandidateCookie(`${UUID}`)).toBeNull();
  });

  it("yields no identity when no secret is configured", () => {
    const encoded = encodeCandidateCookie(UUID);
    const saved = process.env.COOKIE_SECRET;
    delete process.env.COOKIE_SECRET;
    expect(encodeCandidateCookie(UUID)).toBe("");
    expect(decodeCandidateCookie(encoded)).toBeNull();
    process.env.COOKIE_SECRET = saved;
  });
});

describe("cookie identity is separate and hardened", () => {
  it("is NOT the unlock cookie — a distinct name so the two identities never share a value", () => {
    expect(CANDIDATE_COOKIE_NAME).toBe("cv_candidate");
    expect(CANDIDATE_COOKIE_NAME).not.toBe("unlocked_companies");
  });

  it("is httpOnly and same-site lax so it is not script-readable or sent cross-site", () => {
    const opts = getCandidateCookieOptions();
    expect(opts.httpOnly).toBe(true);
    expect(opts.sameSite).toBe("lax");
    expect(opts.path).toBe("/");
    expect(opts.maxAge).toBeGreaterThan(0);
  });
});
