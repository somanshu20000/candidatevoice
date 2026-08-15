/**
 * Workplace Conduct — the load-bearing SAFETY tests. This surface can defame
 * and de-anonymise, so these assert the guardrails, not just the arithmetic:
 *   - below CONDUCT_MIN_EFFECTIVE_N it renders NOTHING (null), not a zero
 *   - the floor is far above every other floor in the codebase
 *   - candidates (who never worked there) and 'na'/null are excluded
 *   - the neutral pointer never names, never asserts cause, and only fires when
 *     serious concerns are corroborated above threshold
 */

import { describe, expect, it } from "vitest";
import {
  conductSignal,
  conductPointer,
  CONDUCT_MIN_EFFECTIVE_N,
  CONDUCT_SERIOUS_POINTER_SHARE,
} from "@/lib/fingerprint/conduct";
import type { EvidenceItem } from "@/lib/evidence";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id">): EvidenceItem {
  return {
    family: "first_party", sourceKey: "candidatevoice", organizationId: "org-1", weight: 1,
    reportedMonth: null, reporterType: "employee", stage: null, outcome: null,
    experienceBucket: null, responseTimeBucket: null, lastInteractionGap: null, reason: null,
    paymentFlag: null, callDuration: null, firstInteractionOutcome: null, applicationChannel: null,
    salaryHistoryStage: null, salaryProofType: null, salaryProofStage: null, salaryRangeDisclosed: null,
    exitExperienceLetter: null, exitSettlement: null, exitDocumentation: null,
    wouldRecommend: null, tenureBucket: null, conductEnvironment: null, extractionConfidence: null, verificationTier: "unverified",
    ...fields,
  };
}

const respectful = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => item({ id: `r-${from + i}`, conductEnvironment: "respectful" }));
const serious = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => item({ id: `s-${from + i}`, conductEnvironment: "serious_concerns" }));

describe("the floor is the anonymity gate", () => {
  it("renders NOTHING (null) below CONDUCT_MIN_EFFECTIVE_N — not a zero", () => {
    // 7 reports, all serious — the most alarming possible input. Still null,
    // because 7 < 8. A thin conduct signal is never published.
    const signal = conductSignal(serious(7));
    expect(signal).toBeNull();
  });

  it("renders once the floor is cleared", () => {
    const signal = conductSignal(serious(8));
    expect(signal).not.toBeNull();
    expect(signal!.total).toBe(8);
    expect(signal!.seriousShare).toBe(1);
  });

  it("the conduct floor is far stricter than any other floor (3 / 5)", () => {
    expect(CONDUCT_MIN_EFFECTIVE_N).toBeGreaterThanOrEqual(8);
    expect(CONDUCT_MIN_EFFECTIVE_N).toBeGreaterThan(5);
  });
});

describe("eligibility", () => {
  it("excludes candidates — they never worked there", () => {
    const items = [
      ...respectful(8),
      // A pile of candidate rows with conduct somehow set must not count.
      ...Array.from({ length: 20 }, (_, i) => item({ id: `c-${i}`, reporterType: "candidate", conductEnvironment: "serious_concerns" })),
    ];
    const signal = conductSignal(items)!;
    expect(signal.total).toBe(8); // only the 8 employees
    expect(signal.seriousShare).toBe(0); // candidate 'serious' values ignored
  });

  it("excludes 'na' and null — prefer-not-to-say never becomes a concern", () => {
    const items = [
      ...respectful(8),
      ...Array.from({ length: 5 }, (_, i) => item({ id: `na-${i}`, conductEnvironment: "na" })),
      ...Array.from({ length: 5 }, (_, i) => item({ id: `nl-${i}` })), // null
    ];
    const signal = conductSignal(items)!;
    expect(signal.total).toBe(8);
    expect(signal.respectfulShare).toBe(1);
  });

  it("counts former_employees alongside current employees", () => {
    const items = [
      ...respectful(4),
      ...Array.from({ length: 4 }, (_, i) => item({ id: `fe-${i}`, reporterType: "former_employee", conductEnvironment: "respectful" })),
    ];
    const signal = conductSignal(items)!;
    expect(signal.total).toBe(8);
  });
});

describe("prevalence shares", () => {
  it("splits respectful vs concern vs serious honestly", () => {
    const items = [
      ...respectful(6),
      ...Array.from({ length: 2 }, (_, i) => item({ id: `sc-${i}`, conductEnvironment: "some_concerns" })),
      ...serious(2, 100),
    ];
    const signal = conductSignal(items)!;
    expect(signal.total).toBe(10);
    expect(signal.respectfulShare).toBeCloseTo(0.6, 5);
    expect(signal.concernShare).toBeCloseTo(0.4, 5);
    expect(signal.seriousShare).toBeCloseTo(0.2, 5);
    expect(signal.counts).toEqual({ respectful: 6, mostly_ok: 0, some_concerns: 2, serious_concerns: 2 });
  });
});

describe("the neutral pointer", () => {
  it("is null when there is no signal at all", () => {
    expect(conductPointer(null)).toBeNull();
  });

  it("does not fire when serious concerns are below threshold", () => {
    // 8 reports, 1 serious (12.5%) < 25% threshold.
    const signal = conductSignal([...respectful(7), ...serious(1, 50)])!;
    expect(conductPointer(signal)).toBeNull();
  });

  it("fires above threshold, and never names or asserts cause", () => {
    const signal = conductSignal([...respectful(4), ...serious(4, 50)])!; // 50% serious
    const pointer = conductPointer(signal);
    expect(pointer).not.toBeNull();
    const text = pointer!.detail.toLowerCase();
    // Neutral language only — never these:
    expect(text).not.toContain("harassment");
    expect(text).not.toContain("toxic");
    expect(text).not.toContain("abus");
    expect(text).not.toMatch(/because|caused|due to/);
    // It IS a prevalence pointing at the section:
    expect(text).toContain("workplace-conduct concerns");
    expect(CONDUCT_SERIOUS_POINTER_SHARE).toBe(0.25);
  });
});
