/**
 * Search ranking (ADR-0002 Part 7). The one property everything else serves:
 * a well-evidenced 60 outranks a thin 90. Plus the factor mechanics
 * (confidence saturates at effectiveN=20, freshness halves every 12 months)
 * and the sunset invariant (external at weight 0 changes no ranking).
 */

import { describe, expect, it } from "vitest";
import {
  searchRank,
  rankCompanies,
  confidenceFactor,
  freshnessFactor,
  CONFIDENCE_SATURATION_N,
  FRESHNESS_HALF_LIFE_MONTHS,
} from "@/lib/evidence/rank";
import type { CompanyAnalytics } from "@/lib/evidence/analytics";
import type { EvidenceBase } from "@/lib/evidence/types";
import type { HqsResult } from "@/utils/hqs";

const REF = "2026-07";

function base(effectiveN: number, latestMonth: string | null): EvidenceBase {
  return {
    rawTotal: 0, weightedTotal: 0, firstPartyRaw: 0, firstPartyWeighted: 0,
    externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1,
    monthsSpanned: 0, earliestMonth: latestMonth, latestMonth, effectiveN,
  };
}

function hqs(score: number): HqsResult {
  return { score, interval: { lower: score - 5, upper: score + 5 }, effectiveN: 0, tier: "medium", contributions: [] };
}

function company(id: string, score: number | null, effectiveN: number, latestMonth: string | null): CompanyAnalytics {
  const b = base(effectiveN, latestMonth);
  return {
    organizationId: id, slug: id, displayName: id,
    hqs: score === null ? null : hqs(score),
    // ghosting/responseSpeed/fingerprint unused by rankCompanies — minimal stubs.
    ghosting: null as never, responseSpeed: null as never,
    fingerprint: { dimensions: [], base: b, globalMultiplier: 0 },
    base: b, ranked: score !== null,
  };
}

describe("confidenceFactor", () => {
  it("saturates to 1 at effectiveN = 20 and above", () => {
    expect(CONFIDENCE_SATURATION_N).toBe(20);
    expect(confidenceFactor(20)).toBe(1);
    expect(confidenceFactor(200)).toBe(1);
  });
  it("discounts a thin sample linearly", () => {
    expect(confidenceFactor(5)).toBeCloseTo(0.25, 5);
    expect(confidenceFactor(10)).toBeCloseTo(0.5, 5);
  });
  it("is 0 at or below zero effectiveN", () => {
    expect(confidenceFactor(0)).toBe(0);
    expect(confidenceFactor(-1)).toBe(0);
  });
});

describe("freshnessFactor", () => {
  it("is 1.0 at the reference month", () => {
    expect(freshnessFactor("2026-07", REF)).toBeCloseTo(1, 5);
  });
  it("halves after one half-life (12 months)", () => {
    expect(FRESHNESS_HALF_LIFE_MONTHS).toBe(12);
    expect(freshnessFactor("2025-07", REF)).toBeCloseTo(0.5, 5);
  });
  it("quarters after two half-lives", () => {
    expect(freshnessFactor("2024-07", REF)).toBeCloseTo(0.25, 5);
  });
  it("clamps future-dated evidence to age 0 (never above 1)", () => {
    expect(freshnessFactor("2027-01", REF)).toBe(1);
  });
  it("returns 1 (no penalty) for an undatable latestMonth", () => {
    expect(freshnessFactor(null, REF)).toBe(1);
    expect(freshnessFactor("garbage", REF)).toBe(1);
  });
});

describe("searchRank — the core property", () => {
  it("a well-evidenced 60 outranks a thin, stale 90", () => {
    // 90 HQS but effectiveN 5 (confidence 0.25) and 12 months old (freshness 0.5):
    //   rank = 0.9 × 0.25 × 0.5 = 0.1125
    // 60 HQS, effectiveN 40 (confidence 1) and current (freshness 1):
    //   rank = 0.6 × 1 × 1 = 0.6
    const thin90 = searchRank({ hqsScore: 90, effectiveN: 5, latestMonth: "2025-07" }, REF);
    const solid60 = searchRank({ hqsScore: 60, effectiveN: 40, latestMonth: "2026-07" }, REF);
    expect(thin90.rank).toBeCloseTo(0.1125, 4);
    expect(solid60.rank).toBeCloseTo(0.6, 4);
    expect(solid60.rank).toBeGreaterThan(thin90.rank);
  });

  it("returns the factors so the ordering can be explained, not just asserted", () => {
    const r = searchRank({ hqsScore: 80, effectiveN: 10, latestMonth: "2026-01" }, REF);
    expect(r.hqsNormalized).toBeCloseTo(0.8, 5);
    expect(r.confidence).toBeCloseTo(0.5, 5);
    expect(r.freshness).toBeCloseTo(Math.exp((-Math.LN2 * 6) / 12), 5); // 6 months old
    expect(r.rank).toBeCloseTo(0.8 * 0.5 * r.freshness, 5);
  });

  it("clamps HQS into [0,1] defensively", () => {
    expect(searchRank({ hqsScore: 150, effectiveN: 20, latestMonth: REF }, REF).hqsNormalized).toBe(1);
    expect(searchRank({ hqsScore: -10, effectiveN: 20, latestMonth: REF }, REF).hqsNormalized).toBe(0);
  });
});

describe("rankCompanies", () => {
  it("orders by composite rank and excludes below-gate (null HQS) companies", () => {
    const companies = [
      company("thin-90", 90, 5, "2025-07"),   // rank ≈ 0.1125
      company("solid-60", 60, 40, "2026-07"), // rank = 0.6
      company("mid-75", 75, 20, "2026-07"),   // rank = 0.75
      company("ungated", null, 3, "2026-07"), // excluded — HQS suppressed
    ];
    const ranked = rankCompanies(companies, REF);
    expect(ranked.map((r) => r.company.slug)).toEqual(["mid-75", "solid-60", "thin-90"]);
    expect(ranked.find((r) => r.company.slug === "ungated")).toBeUndefined();
  });

  it("attaches the confidence and freshness factors to each ranked row", () => {
    const ranked = rankCompanies([company("c", 80, 10, "2026-01")], REF);
    expect(ranked[0].confidence).toBeCloseTo(0.5, 5);
    expect(ranked[0].freshness).toBeCloseTo(Math.exp((-Math.LN2 * 6) / 12), 5);
  });

  it("is empty when no company clears the gate", () => {
    expect(rankCompanies([company("a", null, 2, REF), company("b", null, 1, REF)], REF)).toEqual([]);
  });
});
