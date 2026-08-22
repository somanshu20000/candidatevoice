/**
 * Compensation Transparency & Privacy. Pins the three rules compensation.ts
 * exists to enforce — each is a way this feature could quietly start lying:
 *   1. null is not "no"  — silence must never score as good OR bad
 *   2. absence is not refusal — no intent inferred from a missing range
 *   3. suppression is honest — no composite from thin evidence, never a 0 stand-in
 */

import { describe, expect, it } from "vitest";
import {
  buildCompensationProfile,
  computePrivacyScore,
  privacyTier,
  PRIVACY_SCORE_WEIGHTS,
  PRIVACY_INVASIVE_MIN_EFFECTIVE_N,
  PRIVACY_SCORE_MIN_EFFECTIVE_N,
} from "@/lib/fingerprint/compensation";
import type { EvidenceItem } from "@/lib/evidence";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id">): EvidenceItem {
  return {
    family: "first_party", sourceKey: "candidatevoice", organizationId: "org-1", weight: 1,
    reportedMonth: null, stage: null, outcome: null, experienceBucket: null,
    responseTimeBucket: null, lastInteractionGap: null, reason: null, paymentFlag: null,
    callDuration: null, firstInteractionOutcome: null, applicationChannel: null,
    salaryHistoryStage: null, salaryProofType: null, salaryProofStage: null,
    salaryRangeDisclosed: null, extractionConfidence: null,
    reporterType: "candidate",
    exitExperienceLetter: null,
    exitSettlement: null,
    exitDocumentation: null,
    wouldRecommend: null,
    tenureBucket: null,
    conductEnvironment: null,
    verificationTier: "unverified",
    outreachQuality: null,
    sensitiveInfoRequested: null,
    sensitiveInfoStage: null,
    sensitiveInfoPurposeExplained: null,
    sensitiveInfoNecessaryPerceived: null,
    hiringChannel: null,
    paymentRequestedBy: null,
    ...fields,
  };
}

const dim = (items: EvidenceItem[], key: string) =>
  buildCompensationProfile(items).dimensions.find((d) => d.key === key)!;

describe("Rule 1 — null is not 'no'", () => {
  it("excludes unanswered reports from the denominator entirely", () => {
    // 6 answered "never asked", 20 unanswered. Rate must be 6/6, not 6/26.
    const items = [
      ...Array.from({ length: 6 }, (_, i) => item({ id: `a-${i}`, salaryHistoryStage: "never" })),
      ...Array.from({ length: 20 }, (_, i) => item({ id: `u-${i}` })), // all null
    ];
    const d = dim(items, "salary_history_privacy");
    expect(d.metric.rawDenominator).toBe(6);
    expect(d.score).toBe(100);
  });

  it("silence never manufactures an accusation either", () => {
    // All unanswered → nothing eligible → suppressed, not a 0 score.
    const items = Array.from({ length: 10 }, (_, i) => item({ id: `u-${i}` }));
    const d = dim(items, "salary_history_privacy");
    expect(d.suppressed).toBe(true);
    expect(d.score).toBeNull();
    expect(d.score).not.toBe(0);
  });

  it("'never' and 'none' ARE answers and do count", () => {
    const items = Array.from({ length: 5 }, (_, i) => item({ id: `n-${i}`, salaryProofType: "none" }));
    const d = dim(items, "document_privacy");
    expect(d.metric.rawDenominator).toBe(5);
    expect(d.score).toBe(100);
  });
});

describe("Rule 2 — the invasiveness ladder scores correctly", () => {
  it("payslip counts as privacy-respecting; bank statement and tax document do not", () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ id: `p-${i}`, salaryProofType: "payslip" })),
      ...Array.from({ length: 3 }, (_, i) => item({ id: `n-${i}`, salaryProofType: "none" })),
      ...Array.from({ length: 2 }, (_, i) => item({ id: `b-${i}`, salaryProofType: "bank_statement" })),
      ...Array.from({ length: 2 }, (_, i) => item({ id: `t-${i}`, salaryProofType: "tax_document" })),
    ];
    const d = dim(items, "document_privacy");
    expect(d.metric.rawDenominator).toBe(10);
    expect(d.score).toBe(60); // 6 of 10 respecting
  });

  it("verification after a written offer is ordinary, before it is not", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => item({ id: `a-${i}`, salaryProofStage: "after_offer" })),
      ...Array.from({ length: 4 }, (_, i) => item({ id: `b-${i}`, salaryProofStage: "before_offer" })),
    ];
    expect(dim(items, "verification_timing").score).toBe(50);
  });
});

describe("Rule 3 — suppression is honest", () => {
  it("holds invasive-document claims to a higher bar than ordinary dimensions", () => {
    expect(PRIVACY_INVASIVE_MIN_EFFECTIVE_N).toBeGreaterThan(3);
    // 4 reports clears the ordinary floor (3) but not the invasive one (5).
    const items = Array.from({ length: 4 }, (_, i) =>
      item({ id: `x-${i}`, salaryProofType: "bank_statement", salaryHistoryStage: "application" })
    );
    expect(dim(items, "document_privacy").suppressed).toBe(true);
    expect(dim(items, "salary_history_privacy").suppressed).toBe(false);
  });

  it("returns null — never 0 — when the composite has too little evidence", () => {
    const items = Array.from({ length: 3 }, (_, i) => item({ id: `t-${i}`, salaryHistoryStage: "application" }));
    const result = computePrivacyScore(buildCompensationProfile(items));
    expect(result).toBeNull();
    expect(result).not.toEqual(expect.objectContaining({ score: 0 }));
    expect(PRIVACY_SCORE_MIN_EFFECTIVE_N).toBe(5);
  });

  it("returns null when nothing was answered at all", () => {
    const items = Array.from({ length: 20 }, (_, i) => item({ id: `u-${i}` }));
    expect(computePrivacyScore(buildCompensationProfile(items))).toBeNull();
  });
});

describe("the composite", () => {
  it("weights sum to 1 and renormalise over the dimensions that rendered", () => {
    expect(Object.values(PRIVACY_SCORE_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 5);

    // Only salary_history answered (6 reports, all "never") → that dimension
    // alone carries the whole composite, renormalised to 1.0, so 100 not 30.
    const items = Array.from({ length: 6 }, (_, i) => item({ id: `h-${i}`, salaryHistoryStage: "never" }));
    const r = computePrivacyScore(buildCompensationProfile(items))!;
    expect(r.score).toBe(100);
    expect(r.contributions.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
  });

  it("tiers on the score", () => {
    expect(privacyTier(85)).toBe("strong");
    expect(privacyTier(50)).toBe("mixed");
    expect(privacyTier(20)).toBe("poor");
  });

  it("a worst-case company scores 0 from real evidence — a measured 0, not a stand-in", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      item({
        id: `w-${i}`,
        salaryHistoryStage: "application",
        salaryProofType: "bank_statement",
        salaryProofStage: "screening",
        salaryRangeDisclosed: "never",
        reporterType: "candidate",
        exitExperienceLetter: null,
        exitSettlement: null,
        exitDocumentation: null,
        wouldRecommend: null,
        tenureBucket: null,
        conductEnvironment: null,
        verificationTier: "unverified",
      })
    );
    const r = computePrivacyScore(buildCompensationProfile(items))!;
    expect(r.score).toBe(0);
    expect(r.tier).toBe("poor");
  });
});
