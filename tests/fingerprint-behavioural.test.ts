/**
 * Fingerprint v1 — Family A (behavioural dimensions).
 *
 * These tests pin the SIX product rules the fingerprint is staked on:
 *   - each formula produces the expected 0..100 score on controlled evidence
 *   - suppression kicks in below the effectiveN floor, and returns a specific
 *     reason (never a fabricated "neutral" number)
 *   - each dimension carries per-dimension provenance (only families that
 *     had eligible evidence for THIS dimension are listed)
 *   - Payment Risk's OR-corroboration gate: passes on multi-source OR high
 *     effectiveN, suppressed as "uncorroborated" when neither holds
 *   - Response Speed uses weightedMean of a bucket-score map — unknown
 *     buckets are excluded (never scored as neutral 50, the `|| 50` defect)
 *   - the SUNSET regression: at globalMultiplier=0, external items carry
 *     weight 0 and every dimension score matches its first-party-only
 *     equivalent exactly (the invariant that must hold at every milestone)
 */

import { describe, expect, it } from "vitest";
import {
  buildBehaviouralFingerprint,
  BEHAVIOURAL_DIMENSION_KEYS,
  BEHAVIOURAL_DIMENSION_LABELS,
  DIMENSION_MIN_EFFECTIVE_N,
  PAYMENT_RISK_MIN_SOURCES,
  RESPONSE_SPEED_SCORES,
  STAGE_ORDINALS,
  type BehaviouralDimensionKey,
  type BehaviouralDimensionScore,
} from "@/lib/fingerprint/behavioural";
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

function dim(fp: { dimensions: BehaviouralDimensionScore[] }, key: BehaviouralDimensionKey) {
  const d = fp.dimensions.find((x) => x.key === key);
  if (!d) throw new Error(`missing dimension ${key}`);
  return d;
}

describe("buildBehaviouralFingerprint — structural guarantees", () => {
  it("always returns all six dimensions, in the fixed display order", () => {
    const fp = buildBehaviouralFingerprint(evidenceSet([]));
    expect(fp.dimensions).toHaveLength(6);
    expect(fp.dimensions.map((d) => d.key)).toEqual(BEHAVIOURAL_DIMENSION_KEYS);
  });

  it("attaches the correct label to each dimension", () => {
    const fp = buildBehaviouralFingerprint(evidenceSet([]));
    for (const d of fp.dimensions) {
      expect(d.label).toBe(BEHAVIOURAL_DIMENSION_LABELS[d.key]);
    }
  });

  it("threads the globalMultiplier through untouched", () => {
    expect(buildBehaviouralFingerprint(evidenceSet([], 0.35)).globalMultiplier).toBe(0.35);
    expect(buildBehaviouralFingerprint(evidenceSet([], 0)).globalMultiplier).toBe(0);
  });

  it("reports every dimension as suppressed with no eligible evidence — never a fake zero", () => {
    const fp = buildBehaviouralFingerprint(evidenceSet([]));
    for (const d of fp.dimensions) {
      expect(d.suppressed).toBe(true);
      expect(d.score).toBeNull();
      expect(d.score).not.toBe(0);
    }
  });
});

// -------------------------------------------------------------------------
// Ghosting
// -------------------------------------------------------------------------

describe("ghosting", () => {
  it("cross-family: uses BOTH first-party and external evidence when both have the required fields", () => {
    // 5 items: 2 ghosted, 3 not. Cross-family.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "fp-2", family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" }),
      evidenceItem({ id: "fp-3", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "0-7" }),
      evidenceItem({ id: "ext-1", family: "external", weight: 1, outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "ext-2", family: "external", weight: 1, outcome: "offer", lastInteractionGap: "0-7" }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "ghosting");
    // 2 ghosted / 5 eligible = 0.4 → score = 60 (higher is better).
    expect(d.suppressed).toBe(false);
    expect(d.score).toBeCloseTo(60, 5);
    expect(d.families.sort()).toEqual(["external", "first_party"]);
  });

  it("suppresses when effectiveN is below the floor", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "fp-2", family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "ghosting");
    expect(d.suppressed).toBe(true);
    expect(d.score).toBeNull();
    expect(d.suppressionReason).toBe("insufficient_evidence");
  });
});

// -------------------------------------------------------------------------
// Response Speed
// -------------------------------------------------------------------------

describe("responseSpeed", () => {
  it("weights the bucket-score map correctly", () => {
    // Mix: 2 items at 0-3 (100), 2 at 4-7 (80). Unweighted mean = 90.
    const items: EvidenceItem[] = Array.from({ length: 2 }, (_, i) =>
      evidenceItem({ id: `a-${i}`, family: "first_party", weight: 1, responseTimeBucket: "0-3" })
    ).concat(
      Array.from({ length: 2 }, (_, i) => evidenceItem({ id: `b-${i}`, family: "first_party", weight: 1, responseTimeBucket: "4-7" }))
    );
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "response_speed");
    expect(d.score).toBeCloseTo(90, 5);
  });

  it("uses the exported RESPONSE_SPEED_SCORES — tests break loudly if the map changes without deliberation", () => {
    expect(RESPONSE_SPEED_SCORES).toEqual({ "0-3": 100, "4-7": 80, "8-14": 50, "15+": 20 });
  });

  it("excludes unknown buckets from the mean — the fix for the latent `|| 50` defect", () => {
    // Three items with valid buckets + one with an unknown one at a heavy
    // weight. If the unknown were coerced to 50, its weight would drag the
    // mean down. Instead it must shrink coverage and be absent from the mean.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, responseTimeBucket: "0-3" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, responseTimeBucket: "0-3" }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, responseTimeBucket: "0-3" }),
      evidenceItem({ id: "d", family: "first_party", weight: 10, responseTimeBucket: "never_heard_of_this_bucket" as unknown as "0-3" }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "response_speed");
    expect(d.score).toBe(100); // all THREE mapped items scored 100; the heavy unknown is excluded
    expect(d.metric.coverage).toBeCloseTo(0.75, 5);
  });
});

// -------------------------------------------------------------------------
// Process Depth
// -------------------------------------------------------------------------

describe("processDepth", () => {
  it("uses the exported STAGE_ORDINALS", () => {
    expect(STAGE_ORDINALS).toEqual({ applied: 1, screening: 2, technical: 3, hr: 4, final: 5 });
  });

  it("computes weighted mean of stage ordinal × 20", () => {
    // Five items, ordinals [1,2,3,4,5]. Mean=3. Score = 3*20 = 60.
    const stages: Array<EvidenceItem["stage"]> = ["applied", "screening", "technical", "hr", "final"];
    const items: EvidenceItem[] = stages.map((s, i) => evidenceItem({ id: `s-${i}`, family: "first_party", weight: 1, stage: s }));
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "process_depth");
    expect(d.score).toBeCloseTo(60, 5);
  });
});

// -------------------------------------------------------------------------
// Offer Probability
// -------------------------------------------------------------------------

describe("offerProbability", () => {
  it("scores the rate of offer outcomes among eligible items × 100", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 2 }, (_, i) => evidenceItem({ id: `o-${i}`, family: "first_party", weight: 1, outcome: "offer" })),
      ...Array.from({ length: 3 }, (_, i) => evidenceItem({ id: `r-${i}`, family: "first_party", weight: 1, outcome: "rejected" })),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "offer_probability");
    expect(d.score).toBeCloseTo(40, 5); // 2/5 = 0.4 → 40
  });
});

// -------------------------------------------------------------------------
// Transparency
// -------------------------------------------------------------------------

describe("transparency", () => {
  it("rewards eligible reports that carry a specific reason (not no_reason)", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, reason: "skill_mismatch" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, reason: "experience_mismatch" }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, reason: "no_reason" }),
      evidenceItem({ id: "d", family: "first_party", weight: 1, reason: "no_reason" }),
      evidenceItem({ id: "e", family: "first_party", weight: 1, reason: null }), // excluded — no reason at all
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "transparency");
    // 2 specific / 4 eligible = 0.5 → 50.
    expect(d.score).toBeCloseTo(50, 5);
    expect(d.metric.rawDenominator).toBe(4);
  });
});

// -------------------------------------------------------------------------
// Payment Risk — the sensitive dimension
// -------------------------------------------------------------------------

describe("paymentRisk", () => {
  it("PAYMENT_RISK_MIN_SOURCES = 2 — a single-source signal cannot corroborate on its own", () => {
    expect(PAYMENT_RISK_MIN_SOURCES).toBe(2);
  });

  it("suppresses as 'uncorroborated' when neither the multi-source nor the effectiveN gate is met", () => {
    // ONE source (all first-party), effectiveN = 2 → below floor 3 AND fewer
    // than 2 sources. Must NOT render, even though a naive rate would compute.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, paymentFlag: true }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, paymentFlag: false }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "payment_risk");
    expect(d.suppressed).toBe(true);
    expect(d.score).toBeNull();
    expect(d.suppressionReason).toBe("uncorroborated");
  });

  it("passes when effectiveN clears the floor (single source, big enough)", () => {
    // ONE source, effectiveN = 5. Passes even though there is only one source
    // — the OR rule allows this.
    const items: EvidenceItem[] = [
      ...Array.from({ length: 5 }, (_, i) => evidenceItem({ id: `a-${i}`, family: "first_party", weight: 1, paymentFlag: false })),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "payment_risk");
    expect(d.suppressed).toBe(false);
    expect(d.score).toBe(100); // 0/5 flagged → invert → 100
  });

  it("passes on multi-source even when effectiveN is small", () => {
    // TWO sources, effectiveN small. The other side of the OR rule.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, paymentFlag: true }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0.1, paymentFlag: true, sourceKey: "reddit" }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "payment_risk");
    expect(d.suppressed).toBe(false);
    expect(d.families.sort()).toEqual(["external", "first_party"]);
  });

  it("zero-weight sources do NOT count toward multi-source corroboration (sunset composes correctly)", () => {
    // If reddit is silenced (weight 0), we should NOT get the multi-source
    // rescue: from a "who is actually speaking" standpoint there is one source.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, paymentFlag: true }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0, paymentFlag: true, sourceKey: "reddit" }),
    ];
    const d = dim(buildBehaviouralFingerprint(evidenceSet(items)), "payment_risk");
    expect(d.suppressed).toBe(true);
    expect(d.suppressionReason).toBe("uncorroborated");
  });
});

// -------------------------------------------------------------------------
// Per-dimension provenance
// -------------------------------------------------------------------------

describe("per-dimension provenance", () => {
  it("families lists only those that had eligible evidence for THIS dimension", () => {
    // First-party rows have callDuration; external rows never do (W1 asymmetry).
    // Family A doesn't consume callDuration directly, but the same principle
    // holds for stage — a mix where external has null stage should show
    // process_depth as first-party-only.
    const items: EvidenceItem[] = [
      ...Array.from({ length: 5 }, (_, i) =>
        evidenceItem({ id: `fp-${i}`, family: "first_party", weight: 1, stage: "technical" })
      ),
      // External with no stage — cannot contribute to process_depth
      evidenceItem({ id: "ext-1", family: "external", weight: 1, stage: null, outcome: "no_response", lastInteractionGap: "30+" }),
    ];
    const fp = buildBehaviouralFingerprint(evidenceSet(items));
    expect(dim(fp, "process_depth").families).toEqual(["first_party"]);
    // ghosting on the same fixture SHOULD list external too (5 fp with null outcome vs 1 ext ghosted → suppressed by effectiveN, but families still lists whoever was eligible)
    const ghostingDim = dim(fp, "ghosting");
    expect(ghostingDim.families).toEqual(["external"]);
  });
});

// -------------------------------------------------------------------------
// Sunset regression — the ADR-0002 invariant that must hold at EVERY milestone
// -------------------------------------------------------------------------

describe("sunset regression: at globalMultiplier=0, dimensions collapse to first-party-only", () => {
  const firstPartyOnly: EvidenceItem[] = [
    ...Array.from({ length: 5 }, (_, i) =>
      evidenceItem({
        id: `fp-${i}`,
        family: "first_party",
        weight: 1,
        outcome: i < 2 ? "no_response" : "offer",
        lastInteractionGap: i < 2 ? "30+" : "0-7",
        responseTimeBucket: i < 3 ? "0-3" : "4-7",
        stage: "technical",
        reason: i < 2 ? "no_reason" : "skill_mismatch",
        paymentFlag: false,
      })
    ),
  ];
  const sunsetExternal: EvidenceItem[] = [
    // External items with weight EXACTLY 0 — as they would be with
    // globalMultiplier=0 flowing through externalEvidenceWeight (any factor 0 zeros the product).
    evidenceItem({
      id: "ext-1",
      family: "external",
      weight: 0,
      outcome: "no_response",
      lastInteractionGap: "30+",
      responseTimeBucket: "15+",
      stage: "applied",
      reason: "no_reason",
      paymentFlag: true,
      sourceKey: "reddit",
    }),
    evidenceItem({
      id: "ext-2",
      family: "external",
      weight: 0,
      outcome: "offer",
      lastInteractionGap: "0-7",
      responseTimeBucket: "0-3",
      stage: "final",
      reason: "other",
      paymentFlag: false,
      sourceKey: "reddit",
    }),
  ];

  it("every dimension's score is identical whether or not the zero-weight external evidence is present", () => {
    const fpOnly = buildBehaviouralFingerprint(evidenceSet(firstPartyOnly, 0));
    const mixed = buildBehaviouralFingerprint(evidenceSet([...firstPartyOnly, ...sunsetExternal], 0));
    for (const key of BEHAVIOURAL_DIMENSION_KEYS) {
      const a = dim(fpOnly, key);
      const b = dim(mixed, key);
      expect({ key, score: b.score, suppressed: b.suppressed }).toEqual({ key, score: a.score, suppressed: a.suppressed });
    }
  });

  it("Payment Risk's multi-source rescue is disabled by sunset (zero-weight ext ≠ 'speaking' source)", () => {
    // With multiplier=0 the ext row is silenced. Payment Risk on 5 first-party
    // rows (all paymentFlag=false) has ONE source and effectiveN=5 — so it
    // passes on the effectiveN branch, not the multi-source one. The score
    // must match first-party-only exactly, not be pumped up by the ext=true row.
    const fpOnly = buildBehaviouralFingerprint(evidenceSet(firstPartyOnly, 0));
    const mixed = buildBehaviouralFingerprint(evidenceSet([...firstPartyOnly, ...sunsetExternal], 0));
    expect(dim(mixed, "payment_risk").score).toBe(dim(fpOnly, "payment_risk").score);
    expect(dim(mixed, "payment_risk").score).toBe(100);
  });
});

// -------------------------------------------------------------------------
// Threshold constants — pin them so future drift is deliberate
// -------------------------------------------------------------------------

describe("threshold constants", () => {
  it("DIMENSION_MIN_EFFECTIVE_N is 3 — matches ADR-0002 Part 4 dimension floor", () => {
    expect(DIMENSION_MIN_EFFECTIVE_N).toBe(3);
  });
});
