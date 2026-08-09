/**
 * Culture — "would you recommend working here?" Pins: NULL-is-not-NO,
 * worked-there-only, the higher anonymity floor, and null-not-zero.
 */

import { describe, expect, it } from "vitest";
import { cultureSignal, CULTURE_MIN_EFFECTIVE_N } from "@/lib/fingerprint/culture";
import type { EvidenceItem } from "@/lib/evidence";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id">): EvidenceItem {
  return {
    family: "first_party", sourceKey: "candidatevoice", organizationId: "org-1", weight: 1,
    reportedMonth: null, reporterType: "employee", stage: null, outcome: null,
    experienceBucket: null, responseTimeBucket: null, lastInteractionGap: null, reason: null,
    paymentFlag: null, callDuration: null, firstInteractionOutcome: null, applicationChannel: null,
    salaryHistoryStage: null, salaryProofType: null, salaryProofStage: null, salaryRangeDisclosed: null,
    exitExperienceLetter: null, exitSettlement: null, exitDocumentation: null,
    wouldRecommend: null, tenureBucket: null, conductEnvironment: null, extractionConfidence: null,
    ...fields,
  };
}
const rec = (v: "yes" | "maybe" | "no", n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => item({ id: `${v}-${from + i}`, wouldRecommend: v }));

describe("floor + null-not-zero", () => {
  it("the culture floor is higher than the ordinary interview floor of 3", () => {
    expect(CULTURE_MIN_EFFECTIVE_N).toBeGreaterThan(3);
  });
  it("renders null below the floor, not a zero", () => {
    expect(cultureSignal(rec("no", 4))).toBeNull(); // 4 < 5
  });
});

describe("scoring", () => {
  it("yes=100, maybe=50, no=0 — a faithful 3-point mean", () => {
    const s = cultureSignal([...rec("yes", 3), ...rec("no", 3, 10)])!; // mean of 100,0
    expect(s.recommendScore).toBe(50);
    expect(s.recommendShare).toBeCloseTo(0.5, 5);
    expect(s.total).toBe(6);
    expect(s.counts).toEqual({ yes: 3, maybe: 0, no: 3 });
  });
});

describe("eligibility", () => {
  it("NULL is not NO — unanswered excluded from the denominator", () => {
    const s = cultureSignal([...rec("yes", 5), ...Array.from({ length: 10 }, (_, i) => item({ id: `u-${i}` }))])!;
    expect(s.total).toBe(5);
    expect(s.recommendScore).toBe(100);
  });
  it("candidates are excluded — they never worked there", () => {
    const items = [
      ...rec("yes", 5),
      ...Array.from({ length: 20 }, (_, i) => item({ id: `c-${i}`, reporterType: "candidate", wouldRecommend: "no" })),
    ];
    const s = cultureSignal(items)!;
    expect(s.total).toBe(5);
    expect(s.recommendScore).toBe(100);
  });
  it("former employees count too", () => {
    const items = [
      ...rec("yes", 2),
      ...Array.from({ length: 3 }, (_, i) => item({ id: `fe-${i}`, reporterType: "former_employee", wouldRecommend: "yes" })),
    ];
    expect(cultureSignal(items)!.total).toBe(5);
  });
});
