/**
 * Recruitment Process Intelligence (D-031).
 *
 * These tests pin the product rules this module is staked on:
 *   - profile_research_rate and sensitive_info_request_rate compute as
 *     expected weighted rates on controlled evidence
 *   - `rate` is a plain 0..1 share, NEVER inverted into a "higher is better"
 *     score — this is the one thing that distinguishes this module from
 *     behavioural.ts, and a regression here would silently reintroduce the
 *     value judgment the product explicitly avoids (see recruitmentIntel.ts's
 *     header and DECISIONS.md D-031)
 *   - suppression kicks in below the effectiveN floor with a specific reason,
 *     never a fabricated number
 *   - sensitive_info_request_rate's OR-corroboration gate mirrors Payment
 *     Risk exactly: a single accusation must never render alone
 *   - reporterType === 'candidate' gates both metrics — an employee/
 *     former_employee row (which never went through interview outreach) must
 *     never dilute or pollute either rate
 *   - external evidence never contributes (field asymmetry, migration 0033
 *     columns are first-party only)
 */

import { describe, expect, it } from "vitest";
import {
  buildRecruitmentIntelFingerprint,
  RECRUITMENT_INTEL_MIN_EFFECTIVE_N,
  SENSITIVE_INFO_MIN_SOURCES,
} from "@/lib/fingerprint/recruitmentIntel";
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
    extractionConfidence: null,
    verificationTier: "unverified",
    outreachQuality: null,
    sensitiveInfoRequested: null,
    sensitiveInfoStage: null,
    sensitiveInfoPurposeExplained: null,
    sensitiveInfoNecessaryPerceived: null,
    ...fields,
  };
}

function evidenceSet(items: EvidenceItem[]): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier: 1 };
}

function metric(fp: ReturnType<typeof buildRecruitmentIntelFingerprint>, key: "profile_research_rate" | "sensitive_info_request_rate") {
  const m = fp.metrics.find((x) => x.key === key);
  if (!m) throw new Error(`missing metric ${key}`);
  return m;
}

function fpItems(n: number, overrides: (i: number) => Partial<EvidenceItem>): EvidenceItem[] {
  return Array.from({ length: n }, (_, i) =>
    evidenceItem({ id: `s-${i}`, family: "first_party", weight: 1, ...overrides(i) })
  );
}

describe("buildRecruitmentIntelFingerprint", () => {
  it("always returns exactly two metrics, in fixed order, even with zero evidence", () => {
    const fp = buildRecruitmentIntelFingerprint(evidenceSet([]));
    expect(fp.metrics.map((m) => m.key)).toEqual(["profile_research_rate", "sensitive_info_request_rate"]);
    expect(fp.metrics.every((m) => m.suppressed)).toBe(true);
    expect(fp.metrics.every((m) => m.rate === null)).toBe(true);
  });

  describe("profile_research_rate", () => {
    it("computes the weighted rate of profile_reviewed_relevant among answered reports", () => {
      const items = [
        ...fpItems(3, () => ({ outreachQuality: "profile_reviewed_relevant" })),
        ...fpItems(2, () => ({ outreachQuality: "obvious_mismatch" })),
      ];
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.suppressed).toBe(false);
      expect(m.rate).toBeCloseTo(3 / 5);
      expect(m.metric.rawNumerator).toBe(3);
      expect(m.metric.rawDenominator).toBe(5);
    });

    it("is a plain rate, never inverted — 100% mismatches yields rate 0, not a 'good' score", () => {
      const items = fpItems(4, () => ({ outreachQuality: "obvious_mismatch" }));
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.rate).toBe(0);
    });

    it("excludes reports that never answered the question (null is not a value)", () => {
      const items = [
        ...fpItems(3, () => ({ outreachQuality: "profile_reviewed_relevant" })),
        ...fpItems(10, () => ({ outreachQuality: null })), // did not answer
      ];
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.metric.rawDenominator).toBe(3);
      expect(m.rate).toBe(1);
    });

    it("suppresses below the effectiveN floor", () => {
      const items = fpItems(RECRUITMENT_INTEL_MIN_EFFECTIVE_N - 1, () => ({ outreachQuality: "profile_reviewed_relevant" }));
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.suppressed).toBe(true);
      expect(m.rate).toBeNull();
      expect(m.suppressionReason).toBe("insufficient_evidence");
    });

    it("excludes non-candidate reporter types (employee/former_employee never went through interview outreach)", () => {
      const items = [
        ...fpItems(5, () => ({ outreachQuality: "profile_reviewed_relevant" })),
        ...fpItems(5, (i) => ({ id: `emp-${i}`, reporterType: "employee", outreachQuality: "profile_reviewed_relevant" })),
      ];
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.metric.rawDenominator).toBe(5);
    });

    it("external evidence never contributes — first-party only field (asymmetry, not a bug)", () => {
      // normalizeExternal always sets outreachQuality to null (field
      // asymmetry — external_reports has no equivalent column), so a real
      // external item is never eligible regardless of reporterType. Modeled
      // here as the default null rather than overridden, matching what
      // normalize.ts actually produces.
      const items = [
        ...fpItems(5, () => ({ outreachQuality: "profile_reviewed_relevant" })),
        evidenceItem({ id: "ext-1", family: "external", weight: 1 }),
      ];
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "profile_research_rate");
      expect(m.metric.rawDenominator).toBe(5);
      expect(m.families).toEqual(["first_party"]);
    });
  });

  describe("sensitive_info_request_rate", () => {
    it("computes the weighted rate of any non-'none' request among answered reports, gated by corroboration", () => {
      const items = [
        ...fpItems(2, () => ({ sensitiveInfoRequested: "aadhaar" })),
        ...fpItems(3, () => ({ sensitiveInfoRequested: "none" })),
      ];
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "sensitive_info_request_rate");
      expect(m.suppressed).toBe(false); // effectiveN = 5 clears the floor
      expect(m.rate).toBeCloseTo(2 / 5);
    });

    it("'none' is a real, counted answer — not treated as absence", () => {
      const items = fpItems(4, () => ({ sensitiveInfoRequested: "none" }));
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "sensitive_info_request_rate");
      expect(m.metric.rawDenominator).toBe(4);
      expect(m.rate).toBe(0);
    });

    it("passes the corroboration gate on multi-source even below the effectiveN floor", () => {
      const items = [
        evidenceItem({ id: "s-1", family: "first_party", weight: 1, sourceKey: "candidatevoice", sensitiveInfoRequested: "pan" }),
        evidenceItem({ id: "s-2", family: "first_party", weight: 1, sourceKey: "reddit", sensitiveInfoRequested: "bank_details" }),
      ];
      expect(items.length).toBeLessThan(RECRUITMENT_INTEL_MIN_EFFECTIVE_N);
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "sensitive_info_request_rate");
      expect(m.suppressed).toBe(false);
    });

    it("suppresses as 'uncorroborated' below both the source count AND the effectiveN floor — a single accusation never renders", () => {
      const items = [evidenceItem({ id: "s-1", family: "first_party", weight: 1, sensitiveInfoRequested: "aadhaar" })];
      expect(SENSITIVE_INFO_MIN_SOURCES).toBeGreaterThan(1);
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "sensitive_info_request_rate");
      expect(m.suppressed).toBe(true);
      expect(m.suppressionReason).toBe("uncorroborated");
      expect(m.rate).toBeNull();
    });

    it("passes on high effectiveN alone even with a single distinct source", () => {
      const items = fpItems(RECRUITMENT_INTEL_MIN_EFFECTIVE_N, () => ({ sensitiveInfoRequested: "aadhaar" }));
      const m = metric(buildRecruitmentIntelFingerprint(evidenceSet(items)), "sensitive_info_request_rate");
      expect(m.suppressed).toBe(false);
    });
  });
});
