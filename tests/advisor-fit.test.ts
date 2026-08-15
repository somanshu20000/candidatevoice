/**
 * The Candidate Fit engine. The properties under test are the honesty
 * guarantees the advisor is staked on — the same ones HQS carries, plus the
 * new one that makes this on-mission: a preference nothing can measure is
 * reported as such, never fabricated into the score.
 */

import { describe, expect, it } from "vitest";
import {
  computeFit,
  fitTier,
  FIT_MIN_EFFECTIVE_N,
  FIT_TIER_THRESHOLDS,
  HIGH_PRIORITY_WEIGHT,
} from "@/lib/advisor";
import type { PreferenceVector } from "@/lib/advisor";
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
    ...fields,
  };
}

function evidenceSet(items: EvidenceItem[], globalMultiplier = 0.35): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier };
}

/** Fabricate a fingerprint with chosen dimension scores + effectiveN, bypassing the
 *  engine so a fit-formula bug can't hide behind an engine bug (mirrors hqs.test.ts). */
function fingerprint(
  effectiveN: number,
  dims: Array<Partial<BehaviouralDimensionScore> & Pick<BehaviouralDimensionScore, "key" | "score">>
): BehaviouralFingerprint {
  const base = { rawTotal: 0, weightedTotal: 0, firstPartyRaw: 0, firstPartyWeighted: 0, externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1, monthsSpanned: 0, earliestMonth: null, latestMonth: null, effectiveN };
  return {
    dimensions: dims.map((d) => ({
      label: d.key,
      metric: { value: d.score, weightedNumerator: 0, weightedDenominator: 0, rawNumerator: 0, rawDenominator: 0, coverage: 1, suppressed: d.score === null },
      base,
      families: ["first_party"],
      suppressed: d.score === null,
      suppressionReason: d.score === null ? "insufficient_evidence" : null,
      ...d,
    })) as BehaviouralDimensionScore[],
    base,
    globalMultiplier: 0,
  };
}

describe("fitTier boundaries", () => {
  it("maps score to tier at the exported thresholds", () => {
    expect(fitTier(FIT_TIER_THRESHOLDS.best)).toBe("best");
    expect(fitTier(FIT_TIER_THRESHOLDS.best - 1)).toBe("good");
    expect(fitTier(FIT_TIER_THRESHOLDS.good)).toBe("good");
    expect(fitTier(FIT_TIER_THRESHOLDS.good - 1)).toBe("stretch");
    expect(fitTier(FIT_TIER_THRESHOLDS.stretch)).toBe("stretch");
    expect(fitTier(FIT_TIER_THRESHOLDS.stretch - 1)).toBe("avoid");
    expect(fitTier(0)).toBe("avoid");
  });
});

describe("computeFit — weighting", () => {
  it("weights company dimension scores by the user's priorities", () => {
    // User cares only about fast interviews (5) and transparency (1).
    // response_speed=90, transparency=30. Weighted: (5*90 + 1*30)/6 = 80.
    const fp = fingerprint(20, [
      { key: "response_speed", score: 90 },
      { key: "transparency", score: 30 },
      { key: "ghosting", score: 10 }, // not weighted by the user → excluded
    ]);
    const vector: PreferenceVector = { fast_interviews: 5, transparency: 1 };
    const fit = computeFit(vector, fp);

    expect(fit.score).toBe(80);
    // ghosting was not in the vector, so it must not appear in contributions.
    expect(fit.contributions.map((c) => c.key)).toEqual(["fast_interviews", "transparency"]);
  });

  it("a different priority ordering on the same company yields a different fit", () => {
    const fp = fingerprint(20, [
      { key: "response_speed", score: 90 },
      { key: "transparency", score: 30 },
    ]);
    const caresSpeed = computeFit({ fast_interviews: 5, transparency: 1 }, fp).score;
    const caresTransparency = computeFit({ fast_interviews: 1, transparency: 5 }, fp).score;
    expect(caresSpeed).toBe(80);
    expect(caresTransparency).toBe(40); // (1*90 + 5*30)/6
    expect(caresSpeed).not.toBe(caresTransparency);
  });

  it("renormalises over scored dims — an unmeasurable priority neither helps nor hurts", () => {
    // salary (Family B) is weighted 5 but cannot be scored; the fit must be
    // computed purely from the one backed dimension, not dragged toward 0.
    const fp = fingerprint(20, [{ key: "response_speed", score: 88 }]);
    const fit = computeFit({ fast_interviews: 3, salary: 5 }, fp);
    expect(fit.score).toBe(88);
    const salary = fit.contributions.find((c) => c.key === "salary")!;
    expect(salary.status).toBe("not_measured");
    expect(salary.companyScore).toBeNull();
    const normalisedTotal = fit.contributions
      .filter((c) => c.normalizedWeight !== null)
      .reduce((s, c) => s + (c.normalizedWeight as number), 0);
    expect(normalisedTotal).toBeCloseTo(1, 5);
  });
});

describe("computeFit — honest status per dimension", () => {
  it("marks Family B preferences not_measured, never a number", () => {
    const fp = fingerprint(20, [{ key: "response_speed", score: 70 }]);
    const fit = computeFit({ salary: 5, work_life_balance: 4, growth: 3, fast_interviews: 2 }, fp);
    for (const key of ["salary", "work_life_balance", "growth"]) {
      const c = fit.contributions.find((x) => x.key === key)!;
      expect(c.status).toBe("not_measured");
      expect(c.companyScore).toBeNull();
    }
  });

  it("marks a backed preference company_insufficient when THIS company's dimension is suppressed", () => {
    // transparency is backed, but this company's transparency dim is suppressed.
    const fp = fingerprint(20, [
      { key: "response_speed", score: 70 },
      { key: "transparency", score: null }, // suppressed
    ]);
    const fit = computeFit({ transparency: 5, fast_interviews: 2 }, fp);
    const t = fit.contributions.find((c) => c.key === "transparency")!;
    expect(t.status).toBe("company_insufficient");
    expect(t.companyScore).toBeNull();
    // The fit still renders off the one scored dimension.
    expect(fit.score).toBe(70);
  });
});

describe("computeFit — suppression (never a fake 0)", () => {
  it("returns null score when the company is below the effectiveN floor", () => {
    const fp = fingerprint(FIT_MIN_EFFECTIVE_N - 1, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    expect(fit.score).toBeNull();
    expect(fit.tier).toBeNull();
    expect(fit.suppressionReason).toBe("insufficient_evidence");
  });

  it("returns null score when no weighted preference can be scored", () => {
    // Company has plenty of evidence, but the user only weighted Family B dims.
    const fp = fingerprint(50, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ salary: 5, work_life_balance: 5 }, fp);
    expect(fit.score).toBeNull();
    expect(fit.suppressionReason).toBe("no_weighted_dimensions");
  });

  it("null is honest — never returns { score: 0 } as a stand-in", () => {
    const fp = fingerprint(2, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    expect(fit.score).toBeNull();
    expect(fit.score).not.toBe(0);
  });

  it("ignores weights ≤ 0 or non-finite as 'not rated'", () => {
    const fp = fingerprint(20, [{ key: "response_speed", score: 90 }, { key: "transparency", score: 40 }]);
    const fit = computeFit({ fast_interviews: 5, transparency: 0 as number, offer_odds: NaN as number }, fp);
    expect(fit.contributions.map((c) => c.key)).toEqual(["fast_interviews"]);
    expect(fit.score).toBe(90);
  });
});

describe("computeFit — strengths and risks", () => {
  it("names high-priority dims the company does well as strengths, poorly as risks", () => {
    const fp = fingerprint(30, [
      { key: "response_speed", score: 85 }, // high priority + high score → strength
      { key: "ghosting", score: 30 },       // high priority + low score → risk
      { key: "transparency", score: 60 },   // high priority + middling → neither
    ]);
    const fit = computeFit({ fast_interviews: 5, low_ghosting: 5, transparency: 4 }, fp);
    expect(fit.strengths).toContain("fast_interviews");
    expect(fit.risks).toContain("low_ghosting");
    expect(fit.strengths).not.toContain("transparency");
    expect(fit.risks).not.toContain("transparency");
  });

  it("a low-priority dimension is never a strength or risk, however the company scores", () => {
    const fp = fingerprint(30, [{ key: "response_speed", score: 95 }, { key: "ghosting", score: 5 }]);
    // Both rated below the high-priority threshold.
    const fit = computeFit({ fast_interviews: HIGH_PRIORITY_WEIGHT - 1, low_ghosting: 1 }, fp);
    expect(fit.strengths).toHaveLength(0);
    expect(fit.risks).toHaveLength(0);
  });
});

describe("computeFit — carries traceability", () => {
  it("exposes the company evidence base and per-dimension base for scored dims", () => {
    const fp = fingerprint(42, [{ key: "response_speed", score: 80 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    expect(fit.base.effectiveN).toBe(42);
    const scored = fit.contributions.find((c) => c.status === "scored")!;
    expect(scored.base).not.toBeNull();
  });
});

describe("sunset regression — fit at globalMultiplier = 0 equals first-party-only", () => {
  const firstParty: EvidenceItem[] = Array.from({ length: 8 }, (_, i) =>
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
  const silenced: EvidenceItem[] = Array.from({ length: 12 }, (_, i) =>
    evidenceItem({
      id: `ext-${i}`,
      family: "external",
      weight: 0,
      outcome: "no_response",
      lastInteractionGap: "30+",
      responseTimeBucket: "15+",
      reason: "no_reason",
      sourceKey: "reddit",
    })
  );
  const vector: PreferenceVector = { fast_interviews: 5, low_ghosting: 4, transparency: 3, offer_odds: 2 };

  it("produces the identical fit score and tier whether or not zero-weight external evidence is present", () => {
    const only = computeFit(vector, buildBehaviouralFingerprint(evidenceSet(firstParty, 0)));
    const mixed = computeFit(vector, buildBehaviouralFingerprint(evidenceSet([...firstParty, ...silenced], 0)));
    expect(mixed.score).toBe(only.score);
    expect(mixed.tier).toBe(only.tier);
  });
});
