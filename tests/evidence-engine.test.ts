/**
 * The Unified Evidence Engine (ADR-0002 Part 2) — the single auditable path
 * from a stored row to every user-facing number. These tests exist to prove
 * the properties the architecture is actually staked on, not just formula
 * arithmetic:
 *   - weighting changes the answer (raw and weighted genuinely diverge)
 *   - Kish effectiveN, not raw count, drives confidence
 *   - field asymmetry (W1) shows up as reduced coverage, never a silent drop
 *   - the sunset invariant: an external item at weight 0 must produce the
 *     exact same rendered value/effectiveN as if it were entirely absent —
 *     this is the property that lets `global_external_multiplier = 0` turn
 *     off external evidence with zero code-path changes, and it must be
 *     re-verified at every milestone that touches this engine.
 */

import { describe, expect, it } from "vitest";
import {
  kishEffectiveN,
  weightedRate,
  weightedMean,
  weightedShare,
  describeBase,
} from "@/lib/evidence/aggregate";
import { normalizeFirstParty, normalizeExternal } from "@/lib/evidence/normalize";
import type { EvidenceItem } from "@/lib/evidence/types";
import type { RawFirstPartyRow, RawExternalRow } from "@/lib/evidence/load";
import { externalEvidenceWeight, FIRST_PARTY_WEIGHT } from "@/lib/hiring-intel/weighting";

/** Centralizes the fields most tests don't care about, like fingerprint-aggregate.test.ts's `ratings()`. */
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
    extractionConfidence: null,
    ...fields,
  };
}

function rawFirstPartyRow(fields: Partial<RawFirstPartyRow> & Pick<RawFirstPartyRow, "id">): RawFirstPartyRow {
  return {
    organization_id: "org-1",
    experience_bucket: null,
    stage: null,
    outcome: null,
    response_time_bucket: null,
    last_interaction_gap: null,
    call_duration: null,
    first_interaction_outcome: null,
    reason: null,
    payment_flag: null,
    reported_month: null,
    application_channel: null,
    salary_history_stage: null,
    salary_proof_type: null,
    salary_proof_stage: null,
    salary_range_disclosed: null,
    ...fields,
  };
}

function rawExternalRow(fields: Partial<RawExternalRow> & Pick<RawExternalRow, "id">): RawExternalRow {
  return {
    organization_id: "org-1",
    source_key: "reddit",
    trust_weight: 0.4,
    experience_bucket: null,
    stage: null,
    outcome: null,
    response_time_bucket: null,
    last_interaction_gap: null,
    reason: null,
    payment_flag: null,
    reported_month: null,
    extraction_confidence: null,
    ...fields,
  };
}

describe("kishEffectiveN", () => {
  it("matches the worked example: 10 items at w=1 plus 50 at w=0.084", () => {
    const weights = [...Array(10).fill(1), ...Array(50).fill(0.084)];
    // Σw=14.2, Σw²=10.3528, (Σw)²/Σw²≈19.4769 — see ADR-0002 Part 4.
    expect(kishEffectiveN(weights)).toBeCloseTo(19.48, 1);
  });

  it("equals n when all weights are equal", () => {
    expect(kishEffectiveN(Array(5).fill(2))).toBe(5);
  });

  it("returns 0, not NaN, for an empty or all-zero-weight array", () => {
    expect(kishEffectiveN([])).toBe(0);
    expect(kishEffectiveN([0, 0, 0])).toBe(0);
  });

  it("is unchanged by adding zero-weight items — the sunset invariant at its root", () => {
    expect(kishEffectiveN([1, 1, 1])).toBe(kishEffectiveN([1, 1, 1, 0, 0]));
  });
});

describe("weightedRate", () => {
  it("diverges from the raw rate when few trusted reports meet many low-trust ones", () => {
    // 2 first-party (w=1): one ghosted. 8 external (w=0.1): all "ghosted".
    // Raw: 9/10 = 90% ghosted. Weighted: a handful of low-trust reports must
    // not out-vote the trusted evidence the way a naive count would.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "fp-2", family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" }),
      ...Array.from({ length: 8 }, (_, i) =>
        evidenceItem({ id: `ext-${i}`, family: "external", weight: 0.1, outcome: "no_response", lastInteractionGap: "30+" })
      ),
    ];
    const ghosted = (item: EvidenceItem) => item.outcome === "no_response" && (item.lastInteractionGap === "15-30" || item.lastInteractionGap === "30+");
    const result = weightedRate(items, {
      eligible: (item) => item.outcome !== null && item.lastInteractionGap !== null,
      hit: ghosted,
    });

    expect(result.rawNumerator / result.rawDenominator).toBeCloseTo(0.9, 5);
    expect(result.value).toBeCloseTo(1.8 / 2.8, 5);
    expect(result.value).not.toBeCloseTo(0.9, 1);
  });

  it("suppresses as no_coverage when nothing is eligible", () => {
    const items = [evidenceItem({ id: "a", family: "first_party", weight: 1 })];
    const result = weightedRate(items, { eligible: () => false, hit: () => true });

    expect(result.suppressed).toBe(true);
    expect(result.suppressionReason).toBe("no_coverage");
    expect(result.value).toBeNull();
  });

  it("suppresses as no_coverage (not NaN) when eligible evidence carries zero total weight", () => {
    // The full-sunset shape: eligible external rows exist, but every one is
    // weight 0. minEffectiveN defaults to 0, so without an explicit
    // weightedDenominator===0 check this would fall through to 0/0.
    const items = [
      evidenceItem({ id: "ext-1", family: "external", weight: 0, outcome: "no_response", lastInteractionGap: "30+" }),
      evidenceItem({ id: "ext-2", family: "external", weight: 0, outcome: "offer", lastInteractionGap: "0-7" }),
    ];
    const result = weightedRate(items, {
      eligible: (item) => item.outcome !== null,
      hit: (item) => item.outcome === "no_response",
    });

    expect(result.rawDenominator).toBe(2); // eligible evidence genuinely exists...
    expect(result.value).not.toBeNaN();
    expect(result.value).toBeNull(); // ...but must never render as a number.
    expect(result.suppressed).toBe(true);
    expect(result.suppressionReason).toBe("no_coverage");
  });

  it("suppresses as insufficient_evidence when effectiveN is below the floor but weight exists", () => {
    const items = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, outcome: "offer" }),
      evidenceItem({ id: "fp-2", family: "first_party", weight: 1, outcome: "no_response" }),
    ];
    const result = weightedRate(items, {
      eligible: (item) => item.outcome !== null,
      hit: (item) => item.outcome === "offer",
      minEffectiveN: 5,
    });

    expect(result.suppressed).toBe(true);
    expect(result.suppressionReason).toBe("insufficient_evidence");
    expect(result.value).toBeNull();
  });

  it("measures coverage against all items passed in, not just the eligible subset", () => {
    const items = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, outcome: "offer" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, outcome: null }),
      evidenceItem({ id: "c", family: "first_party", weight: 1, outcome: null }),
      evidenceItem({ id: "d", family: "first_party", weight: 1, outcome: null }),
    ];
    const result = weightedRate(items, { eligible: (item) => item.outcome !== null, hit: () => true });
    expect(result.coverage).toBe(0.25);
  });

  it("passes at effectiveN === minEffectiveN — the gate is strictly less-than, not less-or-equal", () => {
    // Guards the specific silent-regression class where a future refactor
    // flips the check to <= and everything else still passes: a metric whose
    // effectiveN just clears the floor must still render, not suppress.
    const items = Array.from({ length: 5 }, (_, i) =>
      evidenceItem({ id: `fp-${i}`, family: "first_party", weight: 1, outcome: i < 3 ? "offer" : "no_response" })
    );
    const result = weightedRate(items, {
      eligible: (item) => item.outcome !== null,
      hit: (item) => item.outcome === "offer",
      minEffectiveN: 5,
    });

    expect(result.suppressed).toBe(false);
    expect(result.value).toBeCloseTo(0.6, 5);
  });

  it("field asymmetry (ADR-0002 W1): a first-party-only metric on mixed evidence exposes reduced coverage", () => {
    // The exact class of bug that killed Early Rejection as a cross-family
    // metric — callDuration is null on every external row, so a metric using
    // it must show `coverage < 1` and its denominator must exclude external
    // rows entirely, never silently averaging over a biased subset while
    // reporting a "full" sample.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, callDuration: "<2" }),
      evidenceItem({ id: "fp-2", family: "first_party", weight: 1, callDuration: "2-5" }),
      evidenceItem({ id: "fp-3", family: "first_party", weight: 1, callDuration: "15+" }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0.126, callDuration: null }),
      evidenceItem({ id: "ext-2", family: "external", weight: 0.126, callDuration: null }),
    ];
    const result = weightedRate(items, {
      eligible: (item) => item.callDuration !== null,
      hit: (item) => item.callDuration === "<2",
    });

    expect(result.rawDenominator).toBe(3); // external rows excluded from denominator
    expect(result.coverage).toBe(0.6); // 3 of 5 items have the field at all
    expect(result.weightedDenominator).toBe(3);
    expect(result.value).toBeCloseTo(1 / 3, 5);
  });
});

describe("weightedMean", () => {
  it("excludes items the accessor has no opinion on, never coercing them to a placeholder score", () => {
    // The `|| 50` defect this replaces: an unmapped value must shrink
    // coverage, not silently score as neutral. Item C carries the largest
    // weight (5) specifically to prove it cannot leak into the denominator.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 3, stage: "applied" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, stage: "screening" }),
      evidenceItem({ id: "c", family: "first_party", weight: 5, stage: "technical" }), // unmapped below
      evidenceItem({ id: "d", family: "first_party", weight: 1, stage: null }),
    ];
    const score = (item: EvidenceItem): number | null => {
      if (item.stage === "applied") return 10;
      if (item.stage === "screening") return 20;
      return null; // "technical" and null both fall through
    };
    const result = weightedMean(items, score);

    expect(result.rawDenominator).toBe(2);
    expect(result.coverage).toBe(0.5); // 2 of 4 items had an opinion
    expect(result.weightedDenominator).toBe(4); // 3 + 1 — c's weight of 5 excluded entirely
    expect(result.value).toBeCloseTo((3 * 10 + 1 * 20) / 4, 5); // 12.5
    expect(result.rawNumerator / result.rawDenominator).toBe(15); // unweighted mean would say 15
  });
});

describe("weightedShare", () => {
  it("reflects weight, not raw report count, in each value's share", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a1", family: "first_party", weight: 1, stage: "applied" }),
      evidenceItem({ id: "a2", family: "first_party", weight: 1, stage: "applied" }),
      evidenceItem({ id: "s1", family: "external", weight: 6, stage: "screening" }),
      evidenceItem({ id: "n1", family: "first_party", weight: 1, stage: null }),
    ];
    const shares = weightedShare(items, (item) => item.stage);

    // Raw: 2 applied reports outnumber 1 screening report 2:1.
    expect(shares.applied.rawNumerator).toBe(2);
    expect(shares.applied.rawDenominator).toBe(3);
    // Weighted: the single heavily-weighted screening report dominates instead.
    expect(shares.applied.value).toBeCloseTo(0.25, 5);
    expect(shares.screening.value).toBeCloseTo(0.75, 5);
    // Both share the same eligible set (stage !== null), so identical coverage.
    expect(shares.applied.coverage).toBe(0.75);
    expect(shares.screening.coverage).toBe(0.75);
  });
});

describe("describeBase", () => {
  it("measures firstPartyProportion by weight, not raw count", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1 }),
      ...Array.from({ length: 9 }, (_, i) => evidenceItem({ id: `ext-${i}`, family: "external", weight: 0.1 })),
    ];
    const base = describeBase(items);

    expect(base.firstPartyRaw).toBe(1);
    expect(base.externalRaw).toBe(9);
    // By raw count first-party would be 10%; by weight it's the majority voice.
    expect(base.firstPartyProportion).toBeCloseTo(1 / 1.9, 5);
    expect(base.firstPartyProportion).not.toBeCloseTo(0.1, 1);
  });

  it("excludes zero-weight sources from sourceDiversity", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "fp-1", family: "first_party", weight: 1, sourceKey: "candidatevoice" }),
      evidenceItem({ id: "ext-1", family: "external", weight: 0, sourceKey: "reddit" }),
      evidenceItem({ id: "ext-2", family: "external", weight: 0, sourceKey: "reddit" }),
    ];
    // Two distinct sourceKeys are present in the raw data, but reddit is
    // carrying zero weight (e.g. multiplier=0) — it isn't actually "speaking".
    expect(describeBase(items).sourceDiversity).toBe(1);
  });

  it("spans months inclusively across a year boundary", () => {
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, reportedMonth: "2025-11" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, reportedMonth: "2026-02" }),
    ];
    const base = describeBase(items);
    expect(base.earliestMonth).toBe("2025-11");
    expect(base.latestMonth).toBe("2026-02");
    expect(base.monthsSpanned).toBe(4); // Nov, Dec, Jan, Feb
  });

  it("reports monthsSpanned = 1 (not 0) when all evidence is in one month", () => {
    // Off-by-one guard: monthIndex(A) - monthIndex(A) = 0, so the +1 in the
    // formula is what makes "one month of data" report as spanning 1 month
    // rather than 0. Easy to lose in a refactor; no other test would catch it.
    const items: EvidenceItem[] = [
      evidenceItem({ id: "a", family: "first_party", weight: 1, reportedMonth: "2026-07" }),
      evidenceItem({ id: "b", family: "first_party", weight: 1, reportedMonth: "2026-07" }),
    ];
    expect(describeBase(items).monthsSpanned).toBe(1);
  });

  it("handles an empty evidence set without producing NaN", () => {
    const base = describeBase([]);
    expect(base).toEqual({
      rawTotal: 0,
      weightedTotal: 0,
      firstPartyRaw: 0,
      firstPartyWeighted: 0,
      externalRaw: 0,
      externalWeighted: 0,
      firstPartyProportion: 0,
      sourceDiversity: 0,
      monthsSpanned: 0,
      earliestMonth: null,
      latestMonth: null,
      effectiveN: 0,
    });
  });
});

describe("normalizeFirstParty", () => {
  it("drops rows with no resolved organization", () => {
    const rows = [rawFirstPartyRow({ id: "a", organization_id: null })];
    expect(normalizeFirstParty(rows)).toHaveLength(0);
  });

  it("always weights first-party evidence at FIRST_PARTY_WEIGHT and nulls extractionConfidence", () => {
    const [item] = normalizeFirstParty([rawFirstPartyRow({ id: "a" })]);
    expect(item.weight).toBe(FIRST_PARTY_WEIGHT);
    expect(item.extractionConfidence).toBeNull();
  });

  it("drops an unrecognized enum value to null instead of passing it through", () => {
    const [item] = normalizeFirstParty([rawFirstPartyRow({ id: "a", stage: "not_a_real_stage" })]);
    expect(item.stage).toBeNull();
  });

  it("passes through a valid enum value unchanged", () => {
    const [item] = normalizeFirstParty([rawFirstPartyRow({ id: "a", stage: "technical", outcome: "offer" })]);
    expect(item.stage).toBe("technical");
    expect(item.outcome).toBe("offer");
  });

  it("maps application_channel, first-party's basis for cohort filtering (migration 0014)", () => {
    const [valid] = normalizeFirstParty([rawFirstPartyRow({ id: "a", application_channel: "referral" })]);
    expect(valid.applicationChannel).toBe("referral");

    const [missing] = normalizeFirstParty([rawFirstPartyRow({ id: "b", application_channel: null })]);
    expect(missing.applicationChannel).toBeNull();

    const [garbage] = normalizeFirstParty([rawFirstPartyRow({ id: "c", application_channel: "smoke_signal" })]);
    expect(garbage.applicationChannel).toBeNull();
  });
});

describe("normalizeExternal", () => {
  it("drops rows with no resolved organization", () => {
    const rows = [rawExternalRow({ id: "a", organization_id: null })];
    expect(normalizeExternal(rows, 0.35)).toHaveLength(0);
  });

  it("computes weight via the same tested formula as hiring-intel/weighting — not a reimplementation", () => {
    const row = rawExternalRow({ id: "a", trust_weight: 0.5, extraction_confidence: 0.8 });
    const [item] = normalizeExternal([row], 0.35);
    const expected = externalEvidenceWeight({
      sourceTrust: 0.5,
      extractionConfidence: 0.8,
      status: "approved",
      globalMultiplier: 0.35,
    });
    expect(item.weight).toBe(expected);
  });

  it("coerces numeric-shaped strings — the shape PostgREST actually returns for numeric columns", () => {
    // Live-verified: trust_weight and extraction_confidence come back from the
    // public_external_reports view as JSON strings ("0.40", "0.90"), not
    // numbers. RawExternalRow declares `number | string` for exactly this
    // reason; a future change that assumes number-only would silently produce
    // NaN weights, so pin the behaviour explicitly.
    const row = rawExternalRow({
      id: "a",
      trust_weight: "0.40" as unknown as number,
      extraction_confidence: "0.90" as unknown as number,
    });
    const [item] = normalizeExternal([row], 0.35);
    const expected = externalEvidenceWeight({
      sourceTrust: 0.4,
      extractionConfidence: 0.9,
      status: "approved",
      globalMultiplier: 0.35,
    });
    expect(item.weight).toBe(expected);
    expect(Number.isFinite(item.weight)).toBe(true);
    expect(item.extractionConfidence).toBe(0.9);
  });

  it("forces weight to exactly 0 when the global multiplier is 0 — the sunset switch", () => {
    const row = rawExternalRow({ id: "a", trust_weight: 0.9, extraction_confidence: 0.9 });
    const [item] = normalizeExternal([row], 0);
    expect(item.weight).toBe(0);
  });

  it("never populates first-party-only fields (W1 field asymmetry)", () => {
    const [item] = normalizeExternal([rawExternalRow({ id: "a" })], 0.35);
    expect(item.callDuration).toBeNull();
    expect(item.firstInteractionOutcome).toBeNull();
    // applicationChannel (migration 0014) joins the same asymmetry class —
    // a third-party forum post cannot structurally know how the poster
    // applied, so external_reports never gets this column at all.
    expect(item.applicationChannel).toBeNull();
  });
});

describe("sunset regression — external evidence at weight 0 must match first-party-only exactly", () => {
  const firstPartyOnly: EvidenceItem[] = [
    evidenceItem({ id: "fp-1", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "30+" }),
    evidenceItem({ id: "fp-2", family: "first_party", weight: 1, outcome: "offer", lastInteractionGap: "0-7" }),
    evidenceItem({ id: "fp-3", family: "first_party", weight: 1, outcome: "no_response", lastInteractionGap: "0-7" }),
  ];
  const sunsetExternal: EvidenceItem[] = [
    evidenceItem({ id: "ext-1", family: "external", weight: 0, outcome: "no_response", lastInteractionGap: "30+" }),
    evidenceItem({ id: "ext-2", family: "external", weight: 0, outcome: "offer", lastInteractionGap: "0-7" }),
  ];
  const mixed = [...firstPartyOnly, ...sunsetExternal];

  const ghosted = (item: EvidenceItem) => item.outcome === "no_response" && (item.lastInteractionGap === "15-30" || item.lastInteractionGap === "30+");
  const eligible = (item: EvidenceItem) => item.outcome !== null && item.lastInteractionGap !== null;

  it("produces an identical rendered value and weighted counts", () => {
    const a = weightedRate(firstPartyOnly, { eligible, hit: ghosted });
    const b = weightedRate(mixed, { eligible, hit: ghosted });

    expect(b.value).toBe(a.value);
    expect(b.weightedNumerator).toBe(a.weightedNumerator);
    expect(b.weightedDenominator).toBe(a.weightedDenominator);
    expect(b.suppressed).toBe(a.suppressed);
  });

  it("produces an identical effectiveN via kishEffectiveN", () => {
    expect(kishEffectiveN(mixed.map((i) => i.weight))).toBe(kishEffectiveN(firstPartyOnly.map((i) => i.weight)));
  });

  it("produces an identical firstPartyProportion in describeBase", () => {
    expect(describeBase(mixed).firstPartyProportion).toBe(describeBase(firstPartyOnly).firstPartyProportion);
    expect(describeBase(mixed).weightedTotal).toBe(describeBase(firstPartyOnly).weightedTotal);
  });

  it("deliberately does NOT collapse raw counts — presence is honestly still reported", () => {
    // This is the one place mixed and first-party-only MUST differ: raw
    // counts answer "how many reports exist", not "how much do they count for".
    // Losing that distinction was an explicit non-goal (raw_count must never
    // be lost to weighting policy).
    const a = weightedRate(firstPartyOnly, { eligible, hit: ghosted });
    const b = weightedRate(mixed, { eligible, hit: ghosted });
    expect(b.rawDenominator).toBe(5);
    expect(a.rawDenominator).toBe(3);
    expect(b.rawDenominator).not.toBe(a.rawDenominator);
  });
});
