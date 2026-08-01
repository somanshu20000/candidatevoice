/**
 * Per-source weighted-share cap (ADR-0002 Part 8 / self-critique #3). The
 * properties under test are what stops "one viral Reddit thread" from
 * dominating a company once adapters scale:
 *   - an external source over the cap is scaled down to exactly the cap share
 *   - first-party is NEVER capped
 *   - a single-source company is left alone (nothing to drown out)
 *   - the sunset invariant survives: at weight 0 the cap is a no-op
 *   - inputs are never mutated
 */

import { describe, expect, it } from "vitest";
import { capSourceShare, DEFAULT_MAX_SOURCE_SHARE } from "@/lib/evidence/cap";
import type { EvidenceItem } from "@/lib/evidence/types";

function item(fields: Partial<EvidenceItem> & Pick<EvidenceItem, "id" | "family" | "weight" | "sourceKey">): EvidenceItem {
  return {
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
    extractionConfidence: null,
    ...fields,
  };
}

function sourceWeight(items: EvidenceItem[], sourceKey: string): number {
  return items.filter((i) => i.sourceKey === sourceKey).reduce((s, i) => s + i.weight, 0);
}

describe("capSourceShare", () => {
  it("DEFAULT_MAX_SOURCE_SHARE is 0.5 — one source can at most equal everyone else", () => {
    expect(DEFAULT_MAX_SOURCE_SHARE).toBe(0.5);
  });

  it("scales an over-cap external source down to exactly the cap share", () => {
    // 1 first-party (w=1) + 4 external reddit (w=1 each = 4). Reddit is 4/5=80%.
    // At cap 0.5, reddit must end at 50% of the new total.
    const items: EvidenceItem[] = [
      item({ id: "fp", family: "first_party", weight: 1, sourceKey: "candidatevoice" }),
      ...Array.from({ length: 4 }, (_, i) => item({ id: `r-${i}`, family: "external", weight: 1, sourceKey: "reddit" })),
    ];
    const capped = capSourceShare(items, 0.5);
    const reddit = sourceWeight(capped, "reddit");
    const total = capped.reduce((s, i) => s + i.weight, 0);
    // others = 1 (first-party). target = 0.5/0.5 * 1 = 1. reddit scaled 4 → 1.
    expect(reddit).toBeCloseTo(1, 5);
    expect(reddit / total).toBeCloseTo(0.5, 5);
  });

  it("leaves an under-cap source untouched (returns the same array reference)", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 8 }, (_, i) => item({ id: `fp-${i}`, family: "first_party", weight: 1, sourceKey: "candidatevoice" })),
      item({ id: "r", family: "external", weight: 0.2, sourceKey: "reddit" }),
    ];
    // reddit is 0.2 / 8.2 ≈ 2.4%, far under 50%.
    expect(capSourceShare(items, 0.5)).toBe(items);
  });

  it("NEVER caps first-party even when it is the overwhelming majority", () => {
    // 10 first-party (w=1) + 1 external (w=1). First-party is 91%, but it is
    // the reference standard and must never be scaled down.
    const items: EvidenceItem[] = [
      ...Array.from({ length: 10 }, (_, i) => item({ id: `fp-${i}`, family: "first_party", weight: 1, sourceKey: "candidatevoice" })),
      item({ id: "r", family: "external", weight: 1, sourceKey: "reddit" }),
    ];
    const capped = capSourceShare(items, 0.5);
    expect(sourceWeight(capped, "candidatevoice")).toBe(10); // unchanged
  });

  it("does NOT cap a single-source company (nothing to protect against)", () => {
    // Only reddit evidence. others = 0. Capping would zero half the only
    // evidence a company has — worse than the skew.
    const items: EvidenceItem[] = Array.from({ length: 5 }, (_, i) =>
      item({ id: `r-${i}`, family: "external", weight: 1, sourceKey: "reddit" })
    );
    expect(capSourceShare(items, 0.5)).toBe(items);
  });

  it("caps a dominant external source down while leaving a small one alone", () => {
    // 1 fp + 20 reddit + 2 glassdoor. Reddit is 20/23 ≈ 87% — must be capped.
    // Glassdoor (2/23 ≈ 9%) is fine and must be left untouched.
    const items: EvidenceItem[] = [
      item({ id: "fp", family: "first_party", weight: 1, sourceKey: "candidatevoice" }),
      ...Array.from({ length: 20 }, (_, i) => item({ id: `r-${i}`, family: "external", weight: 1, sourceKey: "reddit" })),
      ...Array.from({ length: 2 }, (_, i) => item({ id: `g-${i}`, family: "external", weight: 1, sourceKey: "glassdoor" })),
    ];
    const capped = capSourceShare(items, 0.5);
    const total = capped.reduce((s, i) => s + i.weight, 0);
    // reddit: others = 1 + 2 = 3, target = 3, scaled 20 → 3. Share = 3/6 = 50%.
    expect(sourceWeight(capped, "reddit")).toBeCloseTo(3, 5);
    expect(sourceWeight(capped, "reddit") / total).toBeCloseTo(0.5, 5);
    // glassdoor untouched.
    expect(sourceWeight(capped, "glassdoor")).toBeCloseTo(2, 5);
  });

  it("is a no-op at globalMultiplier=0 (all external weight 0) — sunset preserved", () => {
    const items: EvidenceItem[] = [
      ...Array.from({ length: 3 }, (_, i) => item({ id: `fp-${i}`, family: "first_party", weight: 1, sourceKey: "candidatevoice" })),
      ...Array.from({ length: 20 }, (_, i) => item({ id: `r-${i}`, family: "external", weight: 0, sourceKey: "reddit" })),
    ];
    expect(capSourceShare(items, 0.5)).toBe(items);
  });

  it("never mutates the input array or its items", () => {
    const items: EvidenceItem[] = [
      item({ id: "fp", family: "first_party", weight: 1, sourceKey: "candidatevoice" }),
      ...Array.from({ length: 4 }, (_, i) => item({ id: `r-${i}`, family: "external", weight: 1, sourceKey: "reddit" })),
    ];
    const originalWeights = items.map((i) => i.weight);
    capSourceShare(items, 0.5);
    expect(items.map((i) => i.weight)).toEqual(originalWeights);
  });

  it("treats a degenerate cap (<=0 or >=1) as a no-op, not a divide-by-zero", () => {
    const items: EvidenceItem[] = [
      item({ id: "fp", family: "first_party", weight: 1, sourceKey: "candidatevoice" }),
      item({ id: "r", family: "external", weight: 9, sourceKey: "reddit" }),
    ];
    expect(capSourceShare(items, 0)).toBe(items);
    expect(capSourceShare(items, 1)).toBe(items);
    expect(capSourceShare(items, -0.5)).toBe(items);
    for (const i of capSourceShare(items, 1)) expect(Number.isFinite(i.weight)).toBe(true);
  });
});
