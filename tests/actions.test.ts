/**
 * Action Engine — the decision layer over the fingerprint. Pins the two things
 * it must never get wrong: (1) an action only appears when a real, non-suppressed
 * dimension crosses a named threshold — never invented; (2) the verdict is
 * honest — "insufficient" when HQS can't render, never a default "apply".
 *
 * Fixtures build a REAL fingerprint via buildBehaviouralFingerprint so the
 * engine is tested against the same shapes production produces, not hand-mocked
 * dimension objects that could drift from the engine.
 */

import { describe, expect, it } from "vitest";
import {
  buildActionPlan,
  GHOSTING_RISK_RATE,
  OFFER_GOOD_RATE,
} from "@/lib/fingerprint/actions";
import { buildBehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { computeHqs } from "@/utils/hqs";
import { describeBase } from "@/lib/evidence";
import type { EvidenceItem, EvidenceSet } from "@/lib/evidence";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id">): EvidenceItem {
  return {
    family: "first_party",
    sourceKey: "candidatevoice",
    organizationId: "org-1",
    weight: 1,
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
    extractionConfidence: null,
    ...fields,
  };
}

function set(items: EvidenceItem[]): EvidenceSet {
  return { organizationId: "org-1", items, base: describeBase(items), globalMultiplier: 0.35 };
}

/** n reports, `ghosted` of them ghosted, `offers` of them offers, rest rejected-with-reason. */
function fixture(n: number, ghosted: number, offers: number): EvidenceItem[] {
  return Array.from({ length: n }, (_, i) =>
    item({
      id: `r-${i}`,
      outcome: i < ghosted ? "no_response" : i < ghosted + offers ? "offer" : "rejected",
      lastInteractionGap: i < ghosted ? "30+" : "0-7",
      responseTimeBucket: i < ghosted ? "15+" : "0-3",
      reason: i < ghosted + offers ? "skill_mismatch" : "skill_mismatch",
      paymentFlag: false,
    })
  );
}

function plan(items: EvidenceItem[]) {
  const fp = buildBehaviouralFingerprint(set(items));
  return buildActionPlan(fp, computeHqs(fp));
}

describe("verdict honesty", () => {
  it("is 'insufficient' when there is too little evidence for HQS", () => {
    const p = plan(fixture(3, 1, 1)); // effectiveN 3 < HQS floor 5
    expect(p.verdict).toBe("insufficient");
    expect(p.headline).toMatch(/not enough|too little/i);
    // Never emits a default apply on thin data.
    expect(p.verdict).not.toBe("apply");
  });

  it("says 'apply' on a healthy company with enough evidence", () => {
    // 12 reports, 1 ghosted, 6 offers → strong.
    const p = plan(fixture(12, 1, 6));
    expect(["apply", "apply_with_caution"]).toContain(p.verdict);
  });
});

describe("actions are grounded, never invented", () => {
  it("flags high ghosting as a risk with the real rate", () => {
    // 10 reports, 5 ghosted = 50% >= GHOSTING_RISK_RATE.
    const p = plan(fixture(10, 5, 2));
    const ghost = p.items.find((i) => i.key === "ghosting");
    expect(GHOSTING_RISK_RATE).toBe(0.25);
    expect(ghost?.tone).toBe("risk");
    expect(ghost?.detail).toContain("50%");
    expect(ghost?.detail).toMatch(/5 of 10 reports/);
  });

  it("flags strong offer odds as a positive with the real rate", () => {
    // 10 reports, 0 ghosted, 6 offers = 60% >= OFFER_GOOD_RATE.
    const p = plan(fixture(10, 0, 6));
    const offer = p.items.find((i) => i.key === "offer_probability");
    expect(OFFER_GOOD_RATE).toBe(0.4);
    expect(offer?.tone).toBe("positive");
    expect(offer?.detail).toContain("60%");
  });

  it("emits NO item for a dimension sitting between thresholds", () => {
    // Offer rate 25% is between OFFER_LOW (15%) and OFFER_GOOD (40%) → no offer item.
    const p = plan(fixture(12, 2, 3)); // 3/12 = 25%
    expect(p.items.find((i) => i.key === "offer_probability")).toBeUndefined();
  });

  it("surfaces a corroborated payment request as a risk", () => {
    const items = Array.from({ length: 8 }, (_, i) =>
      item({ id: `p-${i}`, paymentFlag: i < 3, outcome: "rejected", lastInteractionGap: "0-7" })
    );
    const p = plan(items);
    const pay = p.items.find((i) => i.key === "payment_risk");
    expect(pay?.tone).toBe("risk");
    expect(pay?.detail).toMatch(/asked to pay/i);
  });

  it("orders items risk → caution → positive", () => {
    // High ghosting (risk) + strong offers (positive) together.
    const p = plan(fixture(12, 5, 6));
    const tones = p.items.map((i) => i.tone);
    const firstPositive = tones.indexOf("positive");
    const lastRisk = tones.lastIndexOf("risk");
    if (firstPositive !== -1 && lastRisk !== -1) expect(lastRisk).toBeLessThan(firstPositive);
  });

  it("produces no items at all when every dimension is suppressed (empty company)", () => {
    const p = plan([]);
    expect(p.items).toEqual([]);
    expect(p.verdict).toBe("insufficient");
  });
});

describe("sunset invariant", () => {
  it("the DECISION is identical when external is silenced (verdict + which flags + tone)", () => {
    // The weighted rate that drives each flag is sunset-invariant (proven
    // exhaustively in fingerprint-behavioural / forecast tests). The raw-count
    // BASIS in `detail` legitimately differs — external reports still exist at
    // weight 0, and raw counts are never collapsed by weighting policy. So the
    // invariant the Action Engine must hold is the decision: verdict, and the
    // set of {key, tone, label} flags. That is what a reader acts on.
    const firstParty = fixture(12, 5, 3);
    const external: EvidenceItem[] = Array.from({ length: 20 }, (_, i) =>
      item({ id: `e-${i}`, family: "external", sourceKey: "reddit", weight: 0, outcome: "no_response", lastInteractionGap: "30+", paymentFlag: true })
    );
    const onlyFp = buildBehaviouralFingerprint(set(firstParty));
    const only = buildActionPlan(onlyFp, computeHqs(onlyFp));
    const mixedFp = buildBehaviouralFingerprint(set([...firstParty, ...external]));
    const mixed = buildActionPlan(mixedFp, computeHqs(mixedFp));

    expect(mixed.verdict).toBe(only.verdict);
    expect(mixed.items.map((i) => `${i.key}:${i.tone}:${i.label}`)).toEqual(
      only.items.map((i) => `${i.key}:${i.tone}:${i.label}`)
    );
    // And the weighted percentage itself is unchanged (extract "NN%" from each detail).
    const pctOf = (items: typeof only.items) => items.map((i) => i.detail.match(/\d+%/)?.[0] ?? null);
    expect(pctOf(mixed.items)).toEqual(pctOf(only.items));
  });
});
