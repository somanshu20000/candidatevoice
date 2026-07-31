import { describe, it, expect } from "vitest";
import {
  FIRST_PARTY_WEIGHT,
  DEFAULT_EXTRACTION_CONFIDENCE,
  FAILSAFE_GLOBAL_MULTIPLIER,
  moderatorConfidence,
  normalizeGlobalMultiplier,
  externalEvidenceWeight,
  type VerificationStatus,
} from "../src/lib/hiring-intel/weighting";

describe("weighting — moderator confidence (the trust boundary)", () => {
  it("counts ONLY approved reports", () => {
    expect(moderatorConfidence("approved")).toBe(1);
    for (const s of ["pending", "rejected", "archived"] as VerificationStatus[]) {
      expect(moderatorConfidence(s)).toBe(0);
    }
  });
});

describe("weighting — global multiplier normalization", () => {
  it("passes valid values through", () => {
    expect(normalizeGlobalMultiplier(0.35)).toBe(0.35);
    expect(normalizeGlobalMultiplier("0.25")).toBe(0.25);
    expect(normalizeGlobalMultiplier(0)).toBe(0);
    expect(normalizeGlobalMultiplier(1)).toBe(1);
  });

  it("clamps out-of-range so external can never outweigh first-party", () => {
    expect(normalizeGlobalMultiplier(2)).toBe(1);
    expect(normalizeGlobalMultiplier(-0.5)).toBe(0);
  });

  it("fails safe to first-party-only on garbage", () => {
    expect(normalizeGlobalMultiplier(null)).toBe(FAILSAFE_GLOBAL_MULTIPLIER);
    expect(normalizeGlobalMultiplier(undefined)).toBe(FAILSAFE_GLOBAL_MULTIPLIER);
    expect(normalizeGlobalMultiplier("not a number")).toBe(FAILSAFE_GLOBAL_MULTIPLIER);
    expect(normalizeGlobalMultiplier(NaN)).toBe(FAILSAFE_GLOBAL_MULTIPLIER);
    expect(FAILSAFE_GLOBAL_MULTIPLIER).toBe(0);
  });
});

describe("weighting — external effective weight", () => {
  const base = {
    sourceTrust: 0.3,
    extractionConfidence: 0.8,
    status: "approved" as VerificationStatus,
    globalMultiplier: 0.35,
  };

  it("is the product of the four factors", () => {
    expect(externalEvidenceWeight(base)).toBeCloseTo(0.3 * 0.8 * 1 * 0.35, 10);
  });

  it("is always strictly below the first-party reference weight", () => {
    // Even a perfect-confidence, top-trust, approved report at multiplier 1 only
    // EQUALS first-party; realistic inputs stay well under it.
    expect(externalEvidenceWeight(base)).toBeLessThan(FIRST_PARTY_WEIGHT);
    const maxed = externalEvidenceWeight({ sourceTrust: 1, extractionConfidence: 1, status: "approved", globalMultiplier: 1 });
    expect(maxed).toBe(FIRST_PARTY_WEIGHT);
    expect(maxed).toBeLessThanOrEqual(FIRST_PARTY_WEIGHT);
  });

  it("SUNSET: global multiplier 0 zeroes every external report", () => {
    expect(externalEvidenceWeight({ ...base, globalMultiplier: 0 })).toBe(0);
    // regardless of how strong the other factors are
    expect(externalEvidenceWeight({ sourceTrust: 1, extractionConfidence: 1, status: "approved", globalMultiplier: 0 })).toBe(0);
  });

  it("non-approved reports contribute nothing", () => {
    for (const status of ["pending", "rejected", "archived"] as VerificationStatus[]) {
      expect(externalEvidenceWeight({ ...base, status })).toBe(0);
    }
  });

  it("a source trust of 0 zeroes the report", () => {
    expect(externalEvidenceWeight({ ...base, sourceTrust: 0 })).toBe(0);
  });

  it("uses the conservative default when extraction confidence is null", () => {
    const w = externalEvidenceWeight({ ...base, extractionConfidence: null });
    expect(w).toBeCloseTo(0.3 * DEFAULT_EXTRACTION_CONFIDENCE * 1 * 0.35, 10);
  });

  it("clamps every factor to [0,1] — no factor can amplify", () => {
    const w = externalEvidenceWeight({ sourceTrust: 5, extractionConfidence: 9, status: "approved", globalMultiplier: 3 });
    expect(w).toBe(1); // all clamped to 1
    const neg = externalEvidenceWeight({ sourceTrust: -1, extractionConfidence: 0.8, status: "approved", globalMultiplier: 0.5 });
    expect(neg).toBe(0);
  });
});
