/**
 * Hiring channel + payment attribution cohort axes (migration 0037, D-037).
 * Extends the existing cohort machinery in src/lib/evidence/cohort.ts —
 * same predicate-filter-then-recompute-base shape tests/evidence-cohort.test.ts
 * already proves for experienceBucket/applicationChannel/reporterType. This
 * file covers ONLY what's new: the two new axes, the COHORT_MIN_EFFECTIVE_N
 * disclosure floor, and the explicit "filtering actually changes the
 * denominator" regression Task 1 §7 demands.
 */
import { describe, expect, it } from "vitest";
import {
  filterByCohort,
  scopeToCohort,
  isEmptyCohort,
  describeCohort,
  parseHiringChannel,
  parsePaymentRequested,
  COHORT_MIN_EFFECTIVE_N,
} from "@/lib/evidence/cohort";
import { describeBase, weightedRate } from "@/lib/evidence/aggregate";
import type { EvidenceItem, EvidenceSet } from "@/lib/evidence/types";
import type { CohortFilter } from "@/lib/evidence/cohort";

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
    hiringChannel: null,
    paymentRequestedBy: null,
    ...fields,
  };
}

function evidenceSet(items: EvidenceItem[], globalMultiplier = 0.35): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier };
}

describe("parseHiringChannel / parsePaymentRequested", () => {
  it("passes through every valid hiring_channel value", () => {
    for (const v of ["company_direct", "consultancy_agency", "referral", "other"] as const) {
      expect(parseHiringChannel(v)).toBe(v);
    }
  });

  it("passes through every valid paymentRequested value", () => {
    expect(parsePaymentRequested("no")).toBe("no");
    expect(parsePaymentRequested("yes")).toBe("yes");
  });

  it("never throws on garbage or missing input — falls back to undefined (no filter)", () => {
    expect(parseHiringChannel(undefined)).toBeUndefined();
    expect(parseHiringChannel("")).toBeUndefined();
    expect(parseHiringChannel("<script>alert(1)</script>")).toBeUndefined();
    expect(parseHiringChannel("not_a_real_channel")).toBeUndefined();
    expect(parsePaymentRequested(undefined)).toBeUndefined();
    expect(parsePaymentRequested("not_sure")).toBeUndefined(); // not a valid top-level payment-requested value — see cohort.ts's own doc comment
  });
});

describe("isEmptyCohort with the two new axes", () => {
  it("is false when only hiringChannel or only paymentRequested is set", () => {
    expect(isEmptyCohort({ hiringChannel: "referral" })).toBe(false);
    expect(isEmptyCohort({ paymentRequested: "yes" })).toBe(false);
  });
});

describe("filterByCohort — hiring_channel", () => {
  it("filters on hiring_channel alone", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, hiringChannel: "company_direct" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, hiringChannel: "consultancy_agency" }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, hiringChannel: "consultancy_agency" }),
    ];
    expect(filterByCohort(items, { hiringChannel: "consultancy_agency" }).map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("excludes a null hiringChannel — null is never a wildcard match", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, hiringChannel: null }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, hiringChannel: "referral" }),
    ];
    expect(filterByCohort(items, { hiringChannel: "referral" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("field asymmetry: external evidence never matches a hiringChannel filter (normalize.ts hardcodes it null)", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, hiringChannel: "referral" }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0.3, hiringChannel: null }),
    ];
    expect(filterByCohort(items, { hiringChannel: "referral" }).map((i) => i.id)).toEqual(["fp-1"]);
  });
});

describe("filterByCohort — paymentRequested", () => {
  it("'yes' matches paymentFlag===true regardless of attribution — a report with no attribution answer still counts", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: true, paymentRequestedBy: "company" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, paymentFlag: true, paymentRequestedBy: null }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, paymentFlag: false, paymentRequestedBy: null }),
    ];
    expect(filterByCohort(items, { paymentRequested: "yes" }).map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("'no' matches paymentFlag===false", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: true }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, paymentFlag: false }),
    ];
    expect(filterByCohort(items, { paymentRequested: "no" }).map((i) => i.id)).toEqual(["b"]);
  });

  it("a null paymentFlag (synthetic/opportunity items) matches neither 'yes' nor 'no'", () => {
    const items: EvidenceItem[] = [evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: null })];
    expect(filterByCohort(items, { paymentRequested: "yes" })).toHaveLength(0);
    expect(filterByCohort(items, { paymentRequested: "no" })).toHaveLength(0);
  });
});

describe("combined multi-axis filters, including both new axes together with existing ones", () => {
  it("ANDs hiringChannel, paymentRequested, experienceBucket, applicationChannel, and reporterType all at once", () => {
    const target = evidenceItem({
      id: "match", family: "first_party", weight: 1,
      hiringChannel: "consultancy_agency",
      paymentFlag: true, experienceBucket: "5-8", applicationChannel: "job_board", reporterType: "candidate",
    });
    const near1 = evidenceItem({ id: "near1", family: "first_party", weight: 1, hiringChannel: "referral", paymentFlag: true, experienceBucket: "5-8", applicationChannel: "job_board", reporterType: "candidate" });
    const near2 = evidenceItem({ id: "near2", family: "first_party", weight: 1, hiringChannel: "consultancy_agency", paymentFlag: false, experienceBucket: "5-8", applicationChannel: "job_board", reporterType: "candidate" });
    const filter: CohortFilter = {
      hiringChannel: "consultancy_agency",
      paymentRequested: "yes",
      experienceBucket: "5-8",
      applicationChannel: "job_board",
      reporterType: "candidate",
    };
    const result = filterByCohort([target, near1, near2], filter);
    expect(result.map((i) => i.id)).toEqual(["match"]);
  });
});

describe("REGRESSION (Task 1 §7): filtered result differs from the full set, and every rate is computed against the filtered denominator", () => {
  it("filterByCohort output !== the unfiltered items, and the counts genuinely differ", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 5 }, (_, i) => evidenceItem({ id: `direct-${i}`, family: "first_party", weight: 1, hiringChannel: "company_direct" })),
      ...Array.from({ length: 5 }, (_, i) => evidenceItem({ id: `agency-${i}`, family: "first_party", weight: 1, hiringChannel: "consultancy_agency" })),
    ];
    const filtered = filterByCohort(items, { hiringChannel: "consultancy_agency" });
    expect(filtered).not.toEqual(items);
    expect(filtered.length).not.toBe(items.length);
    expect(filtered).toHaveLength(5);
  });

  it("scopeToCohort's base.rawTotal AND every metric's weightedDenominator change under the filter — never left at the company-wide figure", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        evidenceItem({ id: `direct-${i}`, family: "first_party", weight: 1, hiringChannel: "company_direct", paymentFlag: false })
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        evidenceItem({ id: `agency-${i}`, family: "first_party", weight: 1, hiringChannel: "consultancy_agency", paymentFlag: i < 3 })
      ),
    ];
    const overall = evidenceSet(items);
    expect(overall.base.rawTotal).toBe(15);

    const cohort = scopeToCohort(overall, { hiringChannel: "consultancy_agency" });
    expect(cohort.base.rawTotal).toBe(5);
    expect(cohort.base.rawTotal).not.toBe(overall.base.rawTotal); // the denominator itself moved

    const overallPaymentRate = weightedRate(overall.items, { eligible: (i) => i.paymentFlag !== null, hit: (i) => i.paymentFlag === true });
    const cohortPaymentRate = weightedRate(cohort.items, { eligible: (i) => i.paymentFlag !== null, hit: (i) => i.paymentFlag === true });
    expect(cohortPaymentRate.weightedDenominator).not.toBe(overallPaymentRate.weightedDenominator);
    expect(cohortPaymentRate.rawDenominator).toBe(5);
    expect(overallPaymentRate.rawDenominator).toBe(15);
    // The rate itself genuinely differs too (3/5 = 0.6 vs 3/15 = 0.2) — proves
    // this isn't just a relabelled company-wide number.
    expect(cohortPaymentRate.value).toBeCloseTo(0.6, 5);
    expect(overallPaymentRate.value).toBeCloseTo(0.2, 5);
  });
});

describe("COHORT_MIN_EFFECTIVE_N — the disclosure floor (D-037, A5)", () => {
  it("is exactly 3", () => {
    expect(COHORT_MIN_EFFECTIVE_N).toBe(3);
  });

  it("a cohort of 1-2 falls below the floor even though scopeToCohort still computes a real base", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 20 }, (_, i) => evidenceItem({ id: `bg-${i}`, family: "first_party", weight: 1, hiringChannel: "company_direct" })),
      evidenceItem({ id: "rare-1", family: "first_party", weight: 1, hiringChannel: "other" }),
      evidenceItem({ id: "rare-2", family: "first_party", weight: 1, hiringChannel: "other" }),
    ];
    const cohort = scopeToCohort(evidenceSet(items), { hiringChannel: "other" });
    expect(cohort.base.rawTotal).toBe(2);
    expect(cohort.base.effectiveN).toBeLessThan(COHORT_MIN_EFFECTIVE_N);
  });

  it("a cohort of exactly 3 clears the floor", () => {
    const items: EvidenceItem[] = Array.from({ length: 3 }, (_, i) =>
      evidenceItem({ id: `x-${i}`, family: "first_party", weight: 1, hiringChannel: "referral" })
    );
    const cohort = scopeToCohort(evidenceSet(items), { hiringChannel: "referral" });
    expect(cohort.base.effectiveN).toBe(3);
    expect(cohort.base.effectiveN).toBeGreaterThanOrEqual(COHORT_MIN_EFFECTIVE_N);
  });
});

describe("null / unanswered is excluded from every metric, never counted as a 'no'", () => {
  it("payment attribution: an unanswered payment_requested_by never lowers a 'company' share", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: true, paymentRequestedBy: "company" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, paymentFlag: true, paymentRequestedBy: null }), // unanswered
    ];
    const rate = weightedRate(items, {
      eligible: (i) => i.paymentFlag === true && i.paymentRequestedBy !== null,
      hit: (i) => i.paymentRequestedBy === "company",
    });
    // Only the ONE item that actually answered is in the denominator — the
    // unanswered one is excluded, not folded in as a non-"company" answer.
    expect(rate.rawDenominator).toBe(1);
    expect(rate.value).toBe(1);
  });

  it("hiring_channel: an item with no answer never matches any specific channel filter", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, hiringChannel: null }),
    ];
    for (const channel of ["company_direct", "consultancy_agency", "referral", "other"] as const) {
      expect(filterByCohort(items, { hiringChannel: channel })).toHaveLength(0);
    }
  });
});

describe("describeCohort includes the two new axes", () => {
  it("describes hiringChannel and paymentRequested", () => {
    expect(describeCohort({ hiringChannel: "consultancy_agency" })).toBe("hired through a consultancy/agency");
    expect(describeCohort({ paymentRequested: "yes" })).toBe("payment requested");
  });

  it("joins new and existing axes together", () => {
    const description = describeCohort({ experienceBucket: "3-5", hiringChannel: "referral", paymentRequested: "no" });
    expect(description).toBe("3–5 years, hired through a referral, no payment requested");
  });
});

describe("empty filter is unaffected by the presence of the new fields — no regression on existing behaviour", () => {
  it("an item carrying hiringChannel/paymentRequestedBy still matches the empty cohort, same array reference", () => {
    const items = [evidenceItem({ id: "a", family: "first_party", weight: 1, hiringChannel: "referral", paymentRequestedBy: "company" })];
    expect(filterByCohort(items, {})).toBe(items);
  });
});
