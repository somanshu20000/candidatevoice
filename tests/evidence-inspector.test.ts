/**
 * M4.3 — Evidence Inspector (src/lib/evidence/inspector.ts).
 *
 * Pure over an EvidenceBase, so tested directly. Pins: integer provenance
 * (every number in the explanation traces to an input, matching the
 * discipline search/explain.ts already established for M3.5), honest
 * suppressed-vs-shown phrasing, the "don't claim a floor that's already met"
 * fix for gates other than effectiveN (Payment Risk's corroboration case),
 * and banding thresholds.
 */

import { describe, expect, it } from "vitest";
import { inspectEvidence } from "@/lib/evidence/inspector";
import type { EvidenceBase, EvidenceFamily } from "@/lib/evidence";

function base(rawTotal: number, effectiveN: number, latestMonth: string | null, families: EvidenceFamily[]): EvidenceBase {
  const firstParty = families.includes("first_party");
  const external = families.includes("external");
  return {
    rawTotal,
    weightedTotal: effectiveN,
    firstPartyRaw: firstParty ? rawTotal : 0,
    firstPartyWeighted: firstParty ? effectiveN : 0,
    externalRaw: external ? rawTotal : 0,
    externalWeighted: external ? effectiveN : 0,
    firstPartyProportion: firstParty ? 1 : 0,
    sourceDiversity: families.length,
    monthsSpanned: 1,
    earliestMonth: latestMonth,
    latestMonth,
    effectiveN,
  };
}

function integersIn(text: string): number[] {
  return (text.match(/\d+(\.\d+)?/g) ?? []).map(Number);
}

describe("integer provenance — every number in the explanation was an input", () => {
  it("holds for a shown (not suppressed) dimension", () => {
    const b = base(24, 19.4, "2026-06", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "Ghosting", families: ["first_party"] });
    const allowed = new Set([b.rawTotal, Math.round(b.effectiveN * 10) / 10]);
    for (const n of integersIn(insp.explanation)) {
      expect(allowed.has(n), `explanation has ${n}, not an input: "${insp.explanation}"`).toBe(true);
    }
  });

  it("holds for a suppressed dimension below the effectiveN floor", () => {
    const b = base(2, 2, "2026-06", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: true, minEffectiveN: 3, label: "Ghosting", families: [] });
    const allowed = new Set([b.rawTotal, Math.round(b.effectiveN * 10) / 10, 3]); // 3 = minEffectiveN, a real input
    for (const n of integersIn(insp.explanation)) {
      expect(allowed.has(n)).toBe(true);
    }
  });

  it("no date digits leak into the prose (latestMonth stays structural, not in the sentence)", () => {
    const b = base(10, 8, "2026-06", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "Ghosting", families: ["first_party"] });
    expect(insp.explanation).not.toContain("2026");
    expect(insp.latestMonth).toBe("2026-06");
  });
});

describe("suppressed phrasing — honest, never a fabricated floor claim", () => {
  it("zero reports says so plainly, without inventing a report count", () => {
    const b = base(0, 0, null, []);
    const insp = inspectEvidence(b, { suppressed: true, minEffectiveN: 3, label: "Ghosting", families: [] });
    expect(insp.explanation).toBe("No reports collected yet for Ghosting.");
  });

  it("below the effectiveN floor cites the actual floor", () => {
    const b = base(2, 2, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: true, minEffectiveN: 3, label: "Ghosting", families: [] });
    expect(insp.explanation).toContain("below the 3+ effective reports needed");
  });

  it("REGRESSION GUARD: when effectiveN already clears the floor but the dimension is still suppressed (Payment Risk's corroboration gate), the explanation does NOT claim a floor that's already met", () => {
    // effectiveN=5 clears minEffectiveN=3, yet suppressed=true (a different
    // gate — e.g. PAYMENT_RISK_MIN_SOURCES). Must not say "below the 3+ needed".
    const b = base(5, 5, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: true, minEffectiveN: 3, label: "Payment Risk", families: [] });
    expect(insp.explanation).not.toContain("below the 3+");
    expect(insp.explanation).toContain("additional corroboration");
  });
});

describe("shown phrasing + family composition", () => {
  it("names first-party-only composition", () => {
    const b = base(10, 8, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "Ghosting", families: ["first_party"] });
    expect(insp.explanation).toContain("First-party reports only.");
  });

  it("names external-only composition", () => {
    const b = base(10, 8, "2026-01", ["external"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "Ghosting", families: ["external"] });
    expect(insp.explanation).toContain("External reports only.");
  });

  it("names combined composition", () => {
    const b = base(10, 8, "2026-01", ["first_party", "external"]);
    const insp = inspectEvidence(b, {
      suppressed: false,
      minEffectiveN: 3,
      label: "Ghosting",
      families: ["first_party", "external"],
    });
    expect(insp.explanation).toContain("Combines first-party and external reports.");
  });
});

describe("banding", () => {
  it("suppressed is always 'insufficient', regardless of effectiveN", () => {
    const b = base(50, 50, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: true, minEffectiveN: 3, label: "X", families: [] });
    expect(insp.band).toBe("insufficient");
  });

  it("shown + effectiveN below CONFIDENCE_SATURATION_N (20) is 'limited'", () => {
    const b = base(10, 10, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "X", families: ["first_party"] });
    expect(insp.band).toBe("limited");
  });

  it("shown + effectiveN at or above 20 is 'well_evidenced'", () => {
    const b = base(30, 20, "2026-01", ["first_party"]);
    const insp = inspectEvidence(b, { suppressed: false, minEffectiveN: 3, label: "X", families: ["first_party"] });
    expect(insp.band).toBe("well_evidenced");
  });
});
