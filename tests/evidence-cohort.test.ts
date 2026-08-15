/**
 * Cohort filtering ("Evidence Match") — the honest alternative to an ATS
 * score. These tests exist to prove:
 *   - filterByCohort composes correctly and is a true identity on the empty filter
 *   - a null field never "matches" a filter, even implicitly
 *   - the field asymmetry falls out naturally: external evidence can match an
 *     experienceBucket cohort but NEVER an applicationChannel cohort, because
 *     normalize.ts hardcodes external's applicationChannel to null — nothing
 *     in cohort.ts had to special-case this, which is exactly the point of
 *     building it on top of the existing engine rather than beside it
 *   - scopeToCohort's `base` is ALWAYS freshly computed from the filtered
 *     items, never inherited — a thin cohort must show its own thin effectiveN
 *   - cohort-scoped fingerprint/forecast genuinely diverge from the
 *     unfiltered ones (decisive: proves filtering actually changes the answer)
 *   - suppression and the sunset invariant continue to hold on a cohort,
 *     because buildBehaviouralFingerprint/buildForecast are the exact same
 *     functions called on fewer items — nothing new to break
 */

import { describe, expect, it } from "vitest";
import {
  filterByCohort,
  scopeToCohort,
  isEmptyCohort,
  describeCohort,
  parseExperienceBucket,
  parseApplicationChannel,
  describeBase,
} from "@/lib/evidence";
import type { EvidenceItem, EvidenceSet, CohortFilter } from "@/lib/evidence";
import { buildBehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { buildForecast, hasAnyForecast } from "@/lib/fingerprint/forecast";

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

describe("isEmptyCohort", () => {
  it("is true only when neither dimension is set", () => {
    expect(isEmptyCohort({})).toBe(true);
    expect(isEmptyCohort({ experienceBucket: "3-5" })).toBe(false);
    expect(isEmptyCohort({ applicationChannel: "referral" })).toBe(false);
    expect(isEmptyCohort({ experienceBucket: "3-5", applicationChannel: "referral" })).toBe(false);
  });
});

describe("filterByCohort", () => {
  it("returns the SAME array reference on an empty filter — the common path costs nothing", () => {
    const items = [evidenceItem({ id: "a", family: "first_party", weight: 1 })];
    expect(filterByCohort(items, {})).toBe(items);
  });

  it("filters on a single dimension", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, experienceBucket: "1-3" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, experienceBucket: "3-5" }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, experienceBucket: "3-5" }),
    ];
    const result = filterByCohort(items, { experienceBucket: "3-5" });
    expect(result.map((i) => i.id)).toEqual(["b", "c"]);
  });

  it("ANDs both dimensions when both are set", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, experienceBucket: "3-5", applicationChannel: "referral" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, experienceBucket: "3-5", applicationChannel: "job_board" }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, experienceBucket: "1-3", applicationChannel: "referral" }),
    ];
    const result = filterByCohort(items, { experienceBucket: "3-5", applicationChannel: "referral" });
    expect(result.map((i) => i.id)).toEqual(["a"]);
  });

  it("excludes items with a null field — null is never a wildcard match", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, experienceBucket: null }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, experienceBucket: "3-5" }),
    ];
    const result = filterByCohort(items, { experienceBucket: "3-5" });
    expect(result.map((i) => i.id)).toEqual(["b"]);
  });

  it("field asymmetry falls out naturally: external evidence can match on experience but never on channel", () => {
    // experienceBucket exists on both families; applicationChannel is
    // first-party only (normalize.ts hardcodes external's to null). Neither
    // cohort.ts nor this test special-cases that — it's a structural
    // consequence of the null-never-matches rule applied to real data shapes.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, experienceBucket: "3-5", applicationChannel: "referral" }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0.3, experienceBucket: "3-5", applicationChannel: null }),
    ];
    expect(filterByCohort(items, { experienceBucket: "3-5" }).map((i) => i.id).sort()).toEqual(["ext-1", "fp-1"]);
    expect(filterByCohort(items, { applicationChannel: "referral" }).map((i) => i.id)).toEqual(["fp-1"]);
  });
});

describe("scopeToCohort", () => {
  it("recomputes base fresh from the filtered items — never inherits the parent's confidence", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 20 }, (_, i) => evidenceItem({ id: `many-${i}`, family: "first_party", weight: 1, experienceBucket: "1-3" })),
      evidenceItem({ id: "thin-1", family: "first_party", weight: 1, experienceBucket: "8+" }),
    ];
    const parent = evidenceSet(items);
    expect(parent.base.effectiveN).toBe(21); // full set

    const cohort = scopeToCohort(parent, { experienceBucket: "8+" });
    expect(cohort.items).toHaveLength(1);
    expect(cohort.base.effectiveN).toBe(1); // NOT 21 — the cohort's own thin confidence
    expect(cohort.base.rawTotal).toBe(1);
  });

  it("preserves organizationId and globalMultiplier from the parent set", () => {
    const parent = evidenceSet([evidenceItem({ id: "a", family: "first_party", weight: 1 })], 0.7);
    const cohort = scopeToCohort(parent, { experienceBucket: "3-5" });
    expect(cohort.organizationId).toBe(parent.organizationId);
    expect(cohort.globalMultiplier).toBe(0.7);
  });
});

describe("describeCohort", () => {
  it("returns null for the empty cohort", () => {
    expect(describeCohort({})).toBeNull();
  });

  it("describes a single dimension", () => {
    expect(describeCohort({ experienceBucket: "3-5" })).toBe("3–5 years");
  });

  it("joins both dimensions when both are set", () => {
    expect(describeCohort({ experienceBucket: "3-5", applicationChannel: "referral" })).toBe("3–5 years, applying via a referral");
  });
});

describe("parseExperienceBucket / parseApplicationChannel", () => {
  it("passes through valid values", () => {
    expect(parseExperienceBucket("3-5")).toBe("3-5");
    expect(parseApplicationChannel("referral")).toBe("referral");
  });

  it("never throws on garbage or missing input — falls back to undefined (no filter)", () => {
    expect(parseExperienceBucket(undefined)).toBeUndefined();
    expect(parseExperienceBucket("")).toBeUndefined();
    expect(parseExperienceBucket("<script>alert(1)</script>")).toBeUndefined();
    expect(parseApplicationChannel("not_a_real_channel")).toBeUndefined();
  });
});

describe("cohort filtering end-to-end — genuinely changes the fingerprint and forecast", () => {
  it("diverges from the unfiltered company when the cohort behaves differently", () => {
    // Referral applicants: mostly offers. Everyone else: mostly ghosted.
    const items: EvidenceItem[] = [
      ...Array.from({ length: 8 }, (_, i) =>
        evidenceItem({ id: `ref-${i}`, family: "first_party", weight: 1, applicationChannel: "referral", outcome: "offer", lastInteractionGap: "0-7" })
      ),
      ...Array.from({ length: 8 }, (_, i) =>
        evidenceItem({ id: `other-${i}`, family: "first_party", weight: 1, applicationChannel: "job_board", outcome: "no_response", lastInteractionGap: "30+" })
      ),
    ];
    const overall = evidenceSet(items);
    const overallForecast = buildForecast(buildBehaviouralFingerprint(overall), overall.items);
    const overallGhosting = overallForecast.find((l) => l.key === "ghosting")!;
    expect(overallGhosting.value).toBe("50%"); // 8 of 16

    const referralCohort = scopeToCohort(overall, { applicationChannel: "referral" });
    const referralForecast = buildForecast(buildBehaviouralFingerprint(referralCohort), referralCohort.items);
    const referralGhosting = referralForecast.find((l) => l.key === "ghosting")!;
    expect(referralGhosting.value).toBe("0%"); // none of the 8 referrals ghosted

    expect(referralGhosting.value).not.toBe(overallGhosting.value);
  });

  it("suppresses on a thin cohort exactly like the main engine — same effectiveN floors, nothing new", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 20 }, (_, i) =>
        evidenceItem({ id: `many-${i}`, family: "first_party", weight: 1, experienceBucket: "1-3", outcome: "offer", lastInteractionGap: "0-7" })
      ),
      evidenceItem({ id: "rare-1", family: "first_party", weight: 1, experienceBucket: "8+", outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "rare-2", family: "first_party", weight: 1, experienceBucket: "8+", outcome: "offer", lastInteractionGap: "0-7" }),
    ];
    const overall = evidenceSet(items);
    const rareCohort = scopeToCohort(overall, { experienceBucket: "8+" });
    const rareFingerprint = buildBehaviouralFingerprint(rareCohort);
    const ghostingDim = rareFingerprint.dimensions.find((d) => d.key === "ghosting")!;

    expect(rareCohort.base.effectiveN).toBe(2); // below DIMENSION_MIN_EFFECTIVE_N=3
    expect(ghostingDim.suppressed).toBe(true);
    expect(ghostingDim.score).toBeNull();
  });

  it("ANONYMITY GATE: a cohort of 1–2 people produces no renderable forecast at all", () => {
    // The load-bearing privacy property. The page only renders the cohort
    // ForecastPanel when hasAnyForecast() is true; when it's false it shows a
    // count-free "no reports match yet" message. So proving hasAnyForecast is
    // false for n=1 and n=2 proves the UI can never (a) show a bare 0%/100%
    // computed from one person, nor (b) reveal that the cohort has exactly 1–2
    // members — both of which are re-identification risks at this sample size.
    const base: EvidenceItem[] = Array.from({ length: 20 }, (_, i) =>
      evidenceItem({ id: `bg-${i}`, family: "first_party", weight: 1, experienceBucket: "1-3", outcome: "offer", lastInteractionGap: "0-7", responseTimeBucket: "0-3", stage: "final", reason: "other", applicationChannel: "job_board" })
    );

    for (const n of [1, 2]) {
      const rare = Array.from({ length: n }, (_, i) =>
        evidenceItem({ id: `rare-${n}-${i}`, family: "first_party", weight: 1, experienceBucket: "8+", outcome: "no_response", lastInteractionGap: "30+", responseTimeBucket: "15+", stage: "screening", reason: "no_reason", applicationChannel: "referral" })
      );
      const cohort = scopeToCohort(evidenceSet([...base, ...rare]), { experienceBucket: "8+" });
      expect(cohort.base.rawTotal).toBe(n);
      const forecast = buildForecast(buildBehaviouralFingerprint(cohort), cohort.items);
      // Every line suppressed → nothing renders → count never surfaces.
      expect(hasAnyForecast(forecast)).toBe(false);
      expect(forecast.every((l) => l.value === null)).toBe(true);
    }
  });
});

describe("sunset regression composes with cohort filtering", () => {
  it("a cohort at globalMultiplier=0 matches the first-party-only equivalent exactly", () => {
    const firstPartyOnly: EvidenceItem[] = Array.from({ length: 6 }, (_, i) =>
      evidenceItem({
        id: `fp-${i}`,
        family: "first_party",
        weight: 1,
        experienceBucket: "3-5",
        outcome: i < 2 ? "no_response" : "offer",
        lastInteractionGap: i < 2 ? "30+" : "0-7",
      })
    );
    const sunsetExternal: EvidenceItem[] = Array.from({ length: 10 }, (_, i) =>
      evidenceItem({
        id: `ext-${i}`,
        family: "external",
        weight: 0,
        experienceBucket: "3-5",
        outcome: "no_response",
        lastInteractionGap: "30+",
        sourceKey: "reddit",
      })
    );

    const cohortFilter: CohortFilter = { experienceBucket: "3-5" };
    const only = scopeToCohort(evidenceSet(firstPartyOnly, 0), cohortFilter);
    const mixed = scopeToCohort(evidenceSet([...firstPartyOnly, ...sunsetExternal], 0), cohortFilter);

    const onlyForecast = buildForecast(buildBehaviouralFingerprint(only), only.items);
    const mixedForecast = buildForecast(buildBehaviouralFingerprint(mixed), mixed.items);

    expect(mixedForecast.find((l) => l.key === "ghosting")!.value).toBe(onlyForecast.find((l) => l.key === "ghosting")!.value);
    expect(mixed.base.effectiveN).toBe(only.base.effectiveN);
    // Raw counts still honestly differ — presence vs weight, same invariant as evidence-engine.test.ts.
    expect(mixed.base.rawTotal).toBe(16);
    expect(only.base.rawTotal).toBe(6);
  });
});
