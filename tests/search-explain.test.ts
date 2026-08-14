/**
 * M3.5 — explainable result assembly (src/lib/search/explain.ts).
 *
 * The load-bearing test is integer provenance: every number in a generated
 * explanation must be one that was passed in (D-006, "no generated text"). The
 * same guarantee advisor/explain.ts enforces, applied to search.
 */

import { describe, expect, it } from "vitest";
import { buildSignalResult } from "@/lib/search/explain";
import type { SignalRankedCompany } from "@/lib/search/signal";
import type { ParsedSignal } from "@/lib/search/parse";
import type { EvidenceBase, EvidenceFamily } from "@/lib/evidence";
import type { SearchDimensionScoreView, EvidenceBand } from "@/lib/search/types";

function base(rawTotal: number, effectiveN: number, latestMonth: string, families: EvidenceFamily[]): EvidenceBase {
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

function dim(score: number, b: EvidenceBase, families: EvidenceFamily[]): SearchDimensionScoreView {
  return { key: "ghosting", label: "Ghosting", score, base: b, suppressed: false, families };
}

function ranked(opts: {
  rawTotal: number;
  effectiveN: number;
  band: EvidenceBand;
  families: EvidenceFamily[];
  populationCalibrated: boolean;
}): SignalRankedCompany {
  const b = base(opts.rawTotal, opts.effectiveN, "2026-06", opts.families);
  return {
    company: { organizationId: "org-1", slug: "acme", displayName: "Acme" } as SignalRankedCompany["company"],
    dimensions: [dim(30, b, opts.families)],
    band: opts.band,
    signalStrength: 0.7,
    populationCalibrated: opts.populationCalibrated,
    confidence: 0.5,
    freshness: 0.9,
    families: opts.families,
    base: b,
  };
}

const GHOST_SIGNAL: ParsedSignal = { term: "ghost", dimensionKey: "ghosting", direction: "low", label: "Ghosting" };

function integersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

describe("integer provenance — every number in the prose was an input", () => {
  it("holds for a well-evidenced result", () => {
    const r = ranked({ rawTotal: 24, effectiveN: 19.4, band: "well_evidenced", families: ["first_party"], populationCalibrated: true });
    const result = buildSignalResult(r, [GHOST_SIGNAL]);
    const allowed = new Set([r.base.rawTotal, Math.round(r.base.effectiveN)]);
    for (const n of integersIn(result.explanation)) {
      expect(allowed.has(n), `explanation contains ${n}, not an input: "${result.explanation}"`).toBe(true);
    }
  });

  it("holds for a limited, uncalibrated, external-inclusive result", () => {
    const r = ranked({ rawTotal: 5, effectiveN: 4.0, band: "limited", families: ["first_party", "external"], populationCalibrated: false });
    const result = buildSignalResult(r, [GHOST_SIGNAL]);
    const allowed = new Set([r.base.rawTotal, Math.round(r.base.effectiveN)]);
    for (const n of integersIn(result.explanation)) {
      expect(allowed.has(n)).toBe(true);
    }
  });

  it("no date digits leak into the prose (the month lives on evidence.base, not the sentence)", () => {
    const r = ranked({ rawTotal: 24, effectiveN: 19, band: "well_evidenced", families: ["first_party"], populationCalibrated: true });
    const result = buildSignalResult(r, [GHOST_SIGNAL]);
    expect(result.explanation).not.toContain("2026");
    // …but the month is still available structurally.
    expect(result.evidence.base.latestMonth).toBe("2026-06");
  });
});

describe("shape + honesty", () => {
  it("signal results carry a dimension and no entityScore", () => {
    const r = ranked({ rawTotal: 10, effectiveN: 8, band: "limited", families: ["first_party"], populationCalibrated: true });
    const result = buildSignalResult(r, [GHOST_SIGNAL]);
    expect(result.mode).toBe("signal");
    expect(result.match.dimension?.key).toBe("ghosting");
    expect(result.match.entityScore).toBeNull();
    expect(result.evidence.dimension).not.toBeNull();
  });

  it("a limited result says so; a well-evidenced one says so", () => {
    const limited = buildSignalResult(
      ranked({ rawTotal: 5, effectiveN: 4, band: "limited", families: ["first_party"], populationCalibrated: true }),
      [GHOST_SIGNAL]
    );
    expect(limited.explanation.toLowerCase()).toContain("limited evidence");

    const well = buildSignalResult(
      ranked({ rawTotal: 40, effectiveN: 30, band: "well_evidenced", families: ["first_party"], populationCalibrated: true }),
      [GHOST_SIGNAL]
    );
    expect(well.explanation.toLowerCase()).toContain("well evidenced");
  });

  it("an uncalibrated result discloses that the ordering is provisional", () => {
    const result = buildSignalResult(
      ranked({ rawTotal: 5, effectiveN: 4, band: "limited", families: ["first_party"], populationCalibrated: false }),
      [GHOST_SIGNAL]
    );
    expect(result.explanation.toLowerCase()).toContain("provisional");
  });

  it("a compound (AND) query names every requested dimension", () => {
    const r = ranked({ rawTotal: 10, effectiveN: 8, band: "limited", families: ["first_party"], populationCalibrated: true });
    r.dimensions = [
      dim(30, r.base, ["first_party"]),
      { key: "response_speed", label: "Response Speed", score: 40, base: r.base, suppressed: false, families: ["first_party"] },
    ];
    const result = buildSignalResult(r, [
      GHOST_SIGNAL,
      { term: "slow response", dimensionKey: "response_speed", direction: "low", label: "Response Speed" },
    ]);
    expect(result.explanation).toContain("Ghosting");
    expect(result.explanation).toContain("Response Speed");
  });
});
