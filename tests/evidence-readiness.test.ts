/**
 * V3.1 — evidenceReadiness() pure reduction. Only `base.effectiveN` is read
 * per company, across both ranked and unranked, so the fixtures are minimal
 * CompanyAnalytics-shaped stubs. Thresholds under test: HQS floor 5, anchor 8,
 * target company count 3.
 */

import { describe, expect, it } from "vitest";
import { evidenceReadiness, READINESS_ANCHOR_EFFECTIVE_N, READINESS_TARGET_COMPANY_COUNT } from "@/lib/evidence/readiness";
import { HQS_MIN_EFFECTIVE_N } from "@/utils/hqs";
import type { AnalyticsResult, CompanyAnalytics } from "@/lib/evidence/analytics";

/** A company stub carrying only what evidenceReadiness reads. */
function company(effectiveN: number): CompanyAnalytics {
  return { base: { effectiveN } } as unknown as CompanyAnalytics;
}

/** Build an AnalyticsResult; effectiveN ≥ HQS floor go in `ranked` (as the real
 *  loader would), the rest in `unranked` — the function counts across both so
 *  the split only mirrors reality, it doesn't change the result. */
function result(effectiveNs: number[]): AnalyticsResult {
  const companies = effectiveNs.map(company);
  return {
    ranked: companies.filter((c) => c.base.effectiveN >= HQS_MIN_EFFECTIVE_N),
    unranked: companies.filter((c) => c.base.effectiveN < HQS_MIN_EFFECTIVE_N),
    globalMultiplier: 0,
  };
}

describe("evidenceReadiness — sanity of the thresholds", () => {
  it("uses the real HQS floor and the documented anchor/target constants", () => {
    expect(HQS_MIN_EFFECTIVE_N).toBe(5);
    expect(READINESS_ANCHOR_EFFECTIVE_N).toBe(8);
    expect(READINESS_TARGET_COMPANY_COUNT).toBe(3);
  });
});

describe("evidenceReadiness — the honest starting point", () => {
  it("zero companies: neither threshold nor target met", () => {
    const r = evidenceReadiness(result([]));
    expect(r.companiesWithEvidence).toBe(0);
    expect(r.companiesAtHqsFloor).toBe(0);
    expect(r.companiesAtAnchor).toBe(0);
    expect(r.metThreshold).toBe(false);
    expect(r.metTarget).toBe(false);
  });

  it("companies below the floor count as evidence but not toward the floor", () => {
    const r = evidenceReadiness(result([1, 2, 4]));
    expect(r.companiesWithEvidence).toBe(3);
    expect(r.companiesAtHqsFloor).toBe(0);
    expect(r.metThreshold).toBe(false);
  });
});

describe("evidenceReadiness — threshold", () => {
  it("one company exactly at the HQS floor meets the threshold but not the target", () => {
    const r = evidenceReadiness(result([5]));
    expect(r.companiesAtHqsFloor).toBe(1);
    expect(r.metThreshold).toBe(true);
    expect(r.metTarget).toBe(false);
  });

  it("effectiveN 4 does not clear the floor (boundary just below)", () => {
    expect(evidenceReadiness(result([4])).metThreshold).toBe(false);
  });
});

describe("evidenceReadiness — target", () => {
  it("three at the floor with one at the anchor meets the target", () => {
    const r = evidenceReadiness(result([5, 6, 8]));
    expect(r.companiesAtHqsFloor).toBe(3);
    expect(r.companiesAtAnchor).toBe(1);
    expect(r.metTarget).toBe(true);
  });

  it("three at the floor but NONE at the anchor does NOT meet the target", () => {
    const r = evidenceReadiness(result([5, 6, 7]));
    expect(r.companiesAtHqsFloor).toBe(3);
    expect(r.companiesAtAnchor).toBe(0);
    expect(r.metTarget).toBe(false);
  });

  it("only two at the floor (even with an anchor) does NOT meet the target", () => {
    const r = evidenceReadiness(result([8, 9]));
    expect(r.companiesAtHqsFloor).toBe(2);
    expect(r.companiesAtAnchor).toBe(2);
    expect(r.metTarget).toBe(false);
  });

  it("effectiveN exactly 8 counts as the anchor (boundary)", () => {
    expect(evidenceReadiness(result([8])).companiesAtAnchor).toBe(1);
    expect(evidenceReadiness(result([7])).companiesAtAnchor).toBe(0);
  });
});
