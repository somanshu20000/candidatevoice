/**
 * Offboarding / Exit Integrity. Pins the rules offboarding.ts enforces, with
 * two that are specific to this stage:
 *   - 'na' is EXCLUDED, not counted (unlike salary's "never"/"none")
 *   - former_employee ONLY — an interview or employee row never leaks in
 * plus the shared discipline: NULL-is-not-NO, honest suppression, null-not-zero.
 */

import { describe, expect, it } from "vitest";
import {
  buildOffboardingProfile,
  computeExitIntegrityScore,
  exitIntegrityTier,
  EXIT_INTEGRITY_WEIGHTS,
  OFFBOARDING_SCORE_MIN_EFFECTIVE_N,
} from "@/lib/fingerprint/offboarding";
import type { EvidenceItem } from "@/lib/evidence";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id">): EvidenceItem {
  return {
    family: "first_party", sourceKey: "candidatevoice", organizationId: "org-1", weight: 1,
    reportedMonth: null, reporterType: "former_employee", stage: null, outcome: null,
    experienceBucket: null, responseTimeBucket: null, lastInteractionGap: null, reason: null,
    paymentFlag: null, callDuration: null, firstInteractionOutcome: null, applicationChannel: null,
    salaryHistoryStage: null, salaryProofType: null, salaryProofStage: null, salaryRangeDisclosed: null,
    exitExperienceLetter: null, exitSettlement: null, exitDocumentation: null,
    wouldRecommend: null, tenureBucket: null, conductEnvironment: null, extractionConfidence: null,
    ...fields,
  };
}

const dim = (items: EvidenceItem[], key: string) =>
  buildOffboardingProfile(items).dimensions.find((d) => d.key === key)!;

describe("Rule 1 — null is not 'no'", () => {
  it("excludes unanswered leaver reports from the denominator", () => {
    const items = [
      ...Array.from({ length: 4 }, (_, i) => item({ id: `a-${i}`, exitExperienceLetter: "on_time" })),
      ...Array.from({ length: 10 }, (_, i) => item({ id: `u-${i}` })), // former_employee, but didn't answer
    ];
    const d = dim(items, "experience_letter");
    expect(d.metric.rawDenominator).toBe(4);
    expect(d.score).toBe(100);
  });

  it("all-unanswered → suppressed, never a 0", () => {
    const items = Array.from({ length: 8 }, (_, i) => item({ id: `u-${i}` }));
    const d = dim(items, "settlement_timeliness");
    expect(d.suppressed).toBe(true);
    expect(d.score).toBeNull();
  });
});

describe("Rule 2 — 'na' is excluded, not scored (offboarding-specific)", () => {
  it("'na' answers do not count as good OR bad — they leave the denominator", () => {
    // 3 on_time (clean), 3 na (didn't apply). Rate must be 3/3 = 100, not 3/6.
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ id: `ok-${i}`, exitExperienceLetter: "on_time" })),
      ...Array.from({ length: 3 }, (_, i) => item({ id: `na-${i}`, exitExperienceLetter: "na" })),
    ];
    const d = dim(items, "experience_letter");
    expect(d.metric.rawDenominator).toBe(3);
    expect(d.score).toBe(100);
  });

  it("'not_received' and 'delayed' ARE the harm and do count against the rate", () => {
    const items = [
      ...Array.from({ length: 2 }, (_, i) => item({ id: `ok-${i}`, exitExperienceLetter: "on_time" })),
      ...Array.from({ length: 1 }, (_, i) => item({ id: `d-${i}`, exitExperienceLetter: "delayed" })),
      ...Array.from({ length: 1 }, (_, i) => item({ id: `nr-${i}`, exitExperienceLetter: "not_received" })),
    ];
    const d = dim(items, "experience_letter");
    expect(d.metric.rawDenominator).toBe(4);
    expect(d.score).toBe(50); // 2 of 4 on time
  });
});

describe("Rule 4 — former_employee only", () => {
  it("an employee or candidate row with exit fields set never enters the metric", () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ id: `f-${i}`, exitExperienceLetter: "on_time" })),
      // Stray non-leaver rows carrying exit data (should be impossible, but gated):
      item({ id: "emp", reporterType: "employee", exitExperienceLetter: "not_received" }),
      item({ id: "cand", reporterType: "candidate", exitExperienceLetter: "not_received" }),
    ];
    const d = dim(items, "experience_letter");
    expect(d.metric.rawDenominator).toBe(3); // only the 3 leavers
    expect(d.score).toBe(100); // the stray not_received values are ignored
  });
});

describe("documentation completeness", () => {
  it("only 'complete' is clean; partial and none are the harm", () => {
    const items = [
      ...Array.from({ length: 3 }, (_, i) => item({ id: `c-${i}`, exitDocumentation: "complete" })),
      ...Array.from({ length: 1 }, (_, i) => item({ id: `p-${i}`, exitDocumentation: "partial" })),
      ...Array.from({ length: 1 }, (_, i) => item({ id: `n-${i}`, exitDocumentation: "none" })),
    ];
    const d = dim(items, "documentation_completeness");
    expect(d.metric.rawDenominator).toBe(5);
    expect(d.score).toBe(60); // 3 of 5 complete
  });
});

describe("the Exit Integrity composite", () => {
  it("weights sum to 1", () => {
    expect(Object.values(EXIT_INTEGRITY_WEIGHTS).reduce((s, w) => s + w, 0)).toBeCloseTo(1, 5);
  });

  it("renormalises over rendered dimensions; null — not 0 — below the floor", () => {
    // 3 leaver reports: clears the per-dimension floor (3) but not the composite (5).
    const thin = Array.from({ length: 3 }, (_, i) => item({ id: `t-${i}`, exitExperienceLetter: "on_time" }));
    expect(computeExitIntegrityScore(buildOffboardingProfile(thin))).toBeNull();
    expect(OFFBOARDING_SCORE_MIN_EFFECTIVE_N).toBe(5);

    // 6 reports answering ONLY experience_letter (all on_time) → that dimension
    // carries the whole composite, renormalised to 1.0 → 100, not dragged down.
    const items = Array.from({ length: 6 }, (_, i) => item({ id: `h-${i}`, exitExperienceLetter: "on_time" }));
    const r = computeExitIntegrityScore(buildOffboardingProfile(items))!;
    expect(r.score).toBe(100);
    expect(r.contributions.reduce((s, c) => s + c.weight, 0)).toBeCloseTo(1, 5);
  });

  it("a worst-case exit scores a measured 0, not a stand-in", () => {
    const items = Array.from({ length: 6 }, (_, i) =>
      item({
        id: `w-${i}`,
        exitExperienceLetter: "not_received",
        exitSettlement: "not_received",
        exitDocumentation: "none",
      })
    );
    const r = computeExitIntegrityScore(buildOffboardingProfile(items))!;
    expect(r.score).toBe(0);
    expect(r.tier).toBe("poor");
  });

  it("tiers on the score", () => {
    expect(exitIntegrityTier(85)).toBe("clean");
    expect(exitIntegrityTier(50)).toBe("mixed");
    expect(exitIntegrityTier(20)).toBe("poor");
  });
});
