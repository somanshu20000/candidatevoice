/**
 * HQS as a reduction over the fingerprint. These tests pin the product rules
 * the headline number is staked on:
 *   - the composite weights (0.35 / 0.30 / 0.25 / 0.10) and their re-normalization
 *   - suppression at effectiveN < 5 (never render a bare number from a single report)
 *   - tier boundaries against effectiveN (not raw counts — the count-based
 *     50/20 tiers of the old path are deleted)
 *   - the Wilson interval shrinks as effectiveN grows
 *   - the SUNSET regression: at globalMultiplier=0 the HQS matches its
 *     first-party-only equivalent exactly
 */

import { describe, expect, it } from "vitest";
import {
  computeHqs,
  wilsonInterval,
  hqsTier,
  HQS_WEIGHTS,
  HQS_MIN_EFFECTIVE_N,
  HQS_INTERVAL_Z,
} from "@/utils/hqs";
import { buildBehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import type { BehaviouralFingerprint, BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";
import { describeBase } from "@/lib/evidence";
import type { EvidenceItem, EvidenceSet } from "@/lib/evidence";

function evidenceItem(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "family" | "weight">): EvidenceItem {
  return {
    sourceKey: fields.family === "first_party" ? "candidatevoice" : "reddit",
    organizationId: "org-1",
    reportedMonth: null,
    stage: null,
    outcome: null,
    experienceBucket: null,
    responseTimeBucket: null,
    lastInteractionGap: null,
    reason: null,
    paymentFlag: null,
    callDuration: null,
    firstInteractionOutcome: null,
    applicationChannel: null,
    salaryHistoryStage: null,
    salaryProofType: null,
    salaryProofStage: null,
    salaryRangeDisclosed: null,
    reporterType: "candidate",
    exitExperienceLetter: null,
    exitSettlement: null,
    exitDocumentation: null,
    wouldRecommend: null,
    tenureBucket: null,
    conductEnvironment: null,
    verificationTier: "unverified",
    extractionConfidence: null,
    outreachQuality: null,
    sensitiveInfoRequested: null,
    sensitiveInfoStage: null,
    sensitiveInfoPurposeExplained: null,
    sensitiveInfoNecessaryPerceived: null,
    ...fields,
  };
}

function evidenceSet(items: EvidenceItem[], globalMultiplier = 0.35): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier };
}

/** Fabricate a fingerprint from raw dimension scores — bypasses the engine for
 *  formula-only tests, so a broken engine can't mask a broken composite. */
function fingerprint(base: { effectiveN: number }, dims: Array<Partial<BehaviouralDimensionScore> & Pick<BehaviouralDimensionScore, "key" | "score">>): BehaviouralFingerprint {
  return {
    dimensions: dims.map((d) => ({
      label: d.key,
      metric: {
        value: d.score,
        weightedNumerator: 0,
        weightedDenominator: 0,
        rawNumerator: 0,
        rawDenominator: 0,
        coverage: 1,
        suppressed: false,
      },
      base: { rawTotal: 0, weightedTotal: 0, firstPartyRaw: 0, firstPartyWeighted: 0, externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1, monthsSpanned: 0, earliestMonth: null, latestMonth: null, effectiveN: base.effectiveN },
      families: ["first_party"],
      suppressed: d.score === null,
      suppressionReason: d.score === null ? "insufficient_evidence" : null,
      ...d,
    })) as BehaviouralDimensionScore[],
    base: { rawTotal: 0, weightedTotal: 0, firstPartyRaw: 0, firstPartyWeighted: 0, externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1, monthsSpanned: 0, earliestMonth: null, latestMonth: null, effectiveN: base.effectiveN },
    globalMultiplier: 0,
  };
}

// -------------------------------------------------------------------------
// Composite weights & re-normalization
// -------------------------------------------------------------------------

describe("HQS composite weights", () => {
  it("HQS_WEIGHTS sums to 1 across participating dimensions", () => {
    const sum = Object.values(HQS_WEIGHTS).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("Payment Risk and Process Depth carry zero weight in the composite (sensitive / value-laden)", () => {
    expect(HQS_WEIGHTS.payment_risk).toBe(0);
    expect(HQS_WEIGHTS.process_depth).toBe(0);
  });

  it("computes the composite exactly per the four HQS-weighted dimensions", () => {
    const fp = fingerprint({ effectiveN: 20 }, [
      { key: "ghosting", score: 80 },        // 0.35
      { key: "response_speed", score: 60 },  // 0.30
      { key: "transparency", score: 40 },    // 0.25
      { key: "offer_probability", score: 20 }, // 0.10
      { key: "process_depth", score: 100 },  // 0
      { key: "payment_risk", score: 100 },   // 0
    ]);
    const hqs = computeHqs(fp)!;
    // 0.35*80 + 0.30*60 + 0.25*40 + 0.10*20 = 28 + 18 + 10 + 2 = 58
    expect(hqs.score).toBe(58);
    // Process Depth's 100 must NOT leak into the composite (it's weighted 0).
    expect(hqs.contributions.map((c) => c.key).sort()).toEqual([
      "ghosting", "offer_probability", "response_speed", "transparency",
    ]);
  });

  it("re-normalizes when a dimension is suppressed — a missing term never drags the composite toward 0", () => {
    // Only two dimensions render, weights would be 0.35 and 0.10 (sum 0.45).
    // Renormalized: 0.35/0.45 ≈ 0.778 and 0.10/0.45 ≈ 0.222.
    // Composite = 0.778*100 + 0.222*100 = 100. Missing dimensions must NOT drag the score to ~10.
    const fp = fingerprint({ effectiveN: 20 }, [
      { key: "ghosting", score: 100 },
      { key: "response_speed", score: null },  // suppressed
      { key: "transparency", score: null },    // suppressed
      { key: "offer_probability", score: 100 },
      { key: "process_depth", score: null },
      { key: "payment_risk", score: null },
    ]);
    const hqs = computeHqs(fp)!;
    expect(hqs.score).toBe(100);
    const total = hqs.contributions.reduce((s, c) => s + c.weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });
});

// -------------------------------------------------------------------------
// Suppression
// -------------------------------------------------------------------------

describe("HQS suppression", () => {
  it("HQS_MIN_EFFECTIVE_N is 5 — the headline gate (higher than the per-dimension floor)", () => {
    expect(HQS_MIN_EFFECTIVE_N).toBe(5);
  });

  it("returns null (not 0) when effectiveN is below the floor", () => {
    const fp = fingerprint({ effectiveN: 4 }, [
      { key: "ghosting", score: 100 },
      { key: "response_speed", score: 100 },
      { key: "transparency", score: 100 },
      { key: "offer_probability", score: 100 },
    ]);
    expect(computeHqs(fp)).toBeNull();
  });

  it("returns null when every HQS-weighted dimension is suppressed, even at high effectiveN", () => {
    const fp = fingerprint({ effectiveN: 200 }, [
      { key: "ghosting", score: null },
      { key: "response_speed", score: null },
      { key: "transparency", score: null },
      { key: "offer_probability", score: null },
    ]);
    expect(computeHqs(fp)).toBeNull();
  });

  it("null is honest — no fake headline where the underlying data has all failed", () => {
    // A UI that renders 0 in place of null would be a bug — this test exists
    // to make sure computeHqs never returns { score: 0 } as a stand-in.
    const fp = fingerprint({ effectiveN: 4 }, [{ key: "ghosting", score: 100 }]);
    const result = computeHqs(fp);
    expect(result).toBeNull();
    expect(result).not.toEqual(expect.objectContaining({ score: 0 }));
  });
});

// -------------------------------------------------------------------------
// Tier boundaries
// -------------------------------------------------------------------------

describe("hqsTier from effectiveN", () => {
  it("uses effectiveN, NOT raw counts — the old 50/20 raw-count tiers are gone", () => {
    expect(hqsTier(4.99)).toBe("insufficient");
    expect(hqsTier(5)).toBe("low");
    expect(hqsTier(19.99)).toBe("low");
    expect(hqsTier(20)).toBe("medium");
    expect(hqsTier(49.99)).toBe("medium");
    expect(hqsTier(50)).toBe("high");
    expect(hqsTier(1000)).toBe("high");
  });
});

// -------------------------------------------------------------------------
// Wilson interval
// -------------------------------------------------------------------------

describe("wilsonInterval", () => {
  it("uses 95% two-sided z-score (1.96)", () => {
    expect(HQS_INTERVAL_Z).toBeCloseTo(1.96, 2);
  });

  it("brackets the point estimate", () => {
    const { lower, upper } = wilsonInterval(0.6, 20);
    expect(lower).toBeLessThan(0.6);
    expect(upper).toBeGreaterThan(0.6);
  });

  it("shrinks as effectiveN grows — the whole reason we substitute Kish for n", () => {
    const small = wilsonInterval(0.5, 10);
    const large = wilsonInterval(0.5, 100);
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower);
  });

  it("clamps to [0, 1]", () => {
    const zero = wilsonInterval(0, 20);
    const one = wilsonInterval(1, 20);
    expect(zero.lower).toBe(0);
    expect(one.upper).toBe(1);
  });

  it("returns [0, 1] when n <= 0 — never NaN", () => {
    expect(wilsonInterval(0.5, 0)).toEqual({ lower: 0, upper: 1 });
    expect(wilsonInterval(0.5, -1)).toEqual({ lower: 0, upper: 1 });
  });

  it("renders the interval on the 0..100 axis when computeHqs returns it (no double-scaling)", () => {
    const fp = fingerprint({ effectiveN: 20 }, [
      { key: "ghosting", score: 60 },
      { key: "response_speed", score: 60 },
      { key: "transparency", score: 60 },
      { key: "offer_probability", score: 60 },
    ]);
    const hqs = computeHqs(fp)!;
    // Point estimate 60. Wilson at p=0.6, n=20 → roughly ~0.39..0.78 → 39..78 on 0-100.
    expect(hqs.interval.lower).toBeLessThan(hqs.score);
    expect(hqs.interval.upper).toBeGreaterThan(hqs.score);
    expect(hqs.interval.lower).toBeGreaterThanOrEqual(0);
    expect(hqs.interval.upper).toBeLessThanOrEqual(100);
  });
});

// -------------------------------------------------------------------------
// End-to-end through the engine + sunset regression
// -------------------------------------------------------------------------

describe("computeHqs end-to-end through the engine", () => {
  it("suppresses on a small fixture below effectiveN=5", () => {
    // Three first-party reports — effectiveN = 3, below HQS floor of 5.
    const items: EvidenceItem[] = Array.from({ length: 3 }, (_, i) =>
      evidenceItem({
        id: `fp-${i}`,
        family: "first_party",
        weight: 1,
        outcome: "offer",
        lastInteractionGap: "0-7",
        responseTimeBucket: "0-3",
        reason: "skill_mismatch",
      })
    );
    const fp = buildBehaviouralFingerprint(evidenceSet(items));
    expect(computeHqs(fp)).toBeNull();
  });

  it("renders a real HQS on a fixture with sufficient effectiveN", () => {
    const items: EvidenceItem[] = Array.from({ length: 8 }, (_, i) =>
      evidenceItem({
        id: `fp-${i}`,
        family: "first_party",
        weight: 1,
        outcome: i < 2 ? "no_response" : "offer",
        lastInteractionGap: i < 2 ? "30+" : "0-7",
        responseTimeBucket: "4-7",
        reason: i < 4 ? "no_reason" : "other",
      })
    );
    const fp = buildBehaviouralFingerprint(evidenceSet(items));
    const hqs = computeHqs(fp)!;
    expect(hqs).not.toBeNull();
    expect(hqs.effectiveN).toBe(8);
    expect(hqs.tier).toBe("low"); // 5 ≤ 8 < 20
    expect(hqs.score).toBeGreaterThan(0);
    expect(hqs.score).toBeLessThan(100);
  });
});

describe("sunset regression: HQS at globalMultiplier=0 matches first-party-only exactly", () => {
  const firstPartyOnly: EvidenceItem[] = Array.from({ length: 8 }, (_, i) =>
    evidenceItem({
      id: `fp-${i}`,
      family: "first_party",
      weight: 1,
      outcome: i < 2 ? "no_response" : "offer",
      lastInteractionGap: i < 2 ? "30+" : "0-7",
      responseTimeBucket: i < 4 ? "0-3" : "4-7",
      reason: i < 3 ? "no_reason" : "skill_mismatch",
    })
  );
  const sunsetExternal: EvidenceItem[] = Array.from({ length: 10 }, (_, i) =>
    evidenceItem({
      id: `ext-${i}`,
      family: "external",
      weight: 0,
      outcome: i < 8 ? "no_response" : "offer",
      lastInteractionGap: "30+",
      responseTimeBucket: "15+",
      reason: "no_reason",
      sourceKey: "reddit",
    })
  );

  it("produces the identical score, tier, and interval on both fixtures", () => {
    const fpOnly = computeHqs(buildBehaviouralFingerprint(evidenceSet(firstPartyOnly, 0)))!;
    const mixed = computeHqs(buildBehaviouralFingerprint(evidenceSet([...firstPartyOnly, ...sunsetExternal], 0)))!;
    expect(mixed.score).toBe(fpOnly.score);
    expect(mixed.tier).toBe(fpOnly.tier);
    expect(mixed.effectiveN).toBe(fpOnly.effectiveN);
    expect(mixed.interval.lower).toBeCloseTo(fpOnly.interval.lower, 5);
    expect(mixed.interval.upper).toBeCloseTo(fpOnly.interval.upper, 5);
  });
});
