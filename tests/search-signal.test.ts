/**
 * M3.4 — signal retrieval + evidence gating (src/lib/search/signal.ts).
 *
 * The ranker is pure over CompanyAnalytics, so tests build minimal analytics
 * fixtures (only the fields rankSignalResults reads) and pin the load-bearing
 * guarantees: the gate excludes suppressed dimensions, low-quality volume can't
 * outrank stronger evidence, bands never interleave, direction is honoured, and
 * a thin population is flagged uncalibrated rather than faking a peer comparison.
 */

import { describe, expect, it } from "vitest";
import { rankSignalResults, SIGNAL_MIN_POPULATION } from "@/lib/search/signal";
import type { CompanyAnalytics, EvidenceBase, EvidenceFamily } from "@/lib/evidence";
import type { BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";

function base(effectiveN: number, latestMonth: string | null, families: EvidenceFamily[]): EvidenceBase {
  const firstParty = families.includes("first_party");
  const external = families.includes("external");
  return {
    rawTotal: effectiveN,
    weightedTotal: effectiveN,
    firstPartyRaw: firstParty ? effectiveN : 0,
    firstPartyWeighted: firstParty ? effectiveN : 0,
    externalRaw: external ? effectiveN : 0,
    externalWeighted: external ? effectiveN : 0,
    firstPartyProportion: firstParty ? 1 : 0,
    sourceDiversity: families.length,
    monthsSpanned: 1,
    earliestMonth: latestMonth,
    latestMonth,
    effectiveN,
  };
}

/** A CompanyAnalytics carrying one behavioural dimension score. Only the fields
 *  rankSignalResults reads are populated; the rest is cast away for the test. */
function company(opts: {
  id: string;
  name: string;
  key: BehaviouralDimensionKey;
  score: number | null;
  suppressed: boolean;
  effectiveN: number;
  latestMonth?: string | null;
  families?: EvidenceFamily[];
}): CompanyAnalytics {
  const families = opts.families ?? ["first_party"];
  const dimBase = base(opts.effectiveN, opts.latestMonth ?? "2026-07", families);
  const dim = {
    key: opts.key,
    label: opts.key,
    score: opts.score,
    metric: {} as never,
    base: dimBase,
    families,
    suppressed: opts.suppressed,
    suppressionReason: opts.suppressed ? ("insufficient_evidence" as const) : null,
  };
  return {
    organizationId: opts.id,
    slug: opts.id,
    displayName: opts.name,
    hqs: null,
    ghosting: dim,
    responseSpeed: dim,
    fingerprint: { dimensions: [dim], base: dimBase, globalMultiplier: 1 },
    compensation: { dimensions: [], base: dimBase },
    offboarding: { dimensions: [], base: dimBase },
    base: dimBase,
    ranked: !opts.suppressed,
  } as unknown as CompanyAnalytics;
}

const REF = "2026-08";

describe("the gate", () => {
  it("a company whose queried dimension is suppressed never appears in signal results", () => {
    const companies = [
      company({ id: "a", name: "A", key: "ghosting", score: 20, suppressed: true, effectiveN: 2 }),
      company({ id: "b", name: "B", key: "ghosting", score: 30, suppressed: false, effectiveN: 6 }),
    ];
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out.map((r) => r.company.slug)).toEqual(["b"]);
  });

  it("high-volume low-confidence evidence that fails suppression cannot outrank a rendered company", () => {
    // "500 external mentions" modelled as a suppressed dimension (fractional
    // weight -> effectiveN below floor -> suppressed by the engine). It is
    // simply absent; the 30-first-party company that rendered is the only result.
    const bigButSuppressed = company({
      id: "big",
      name: "BigExternal",
      key: "ghosting",
      score: 10,
      suppressed: true,
      effectiveN: 2,
      families: ["external"],
    });
    const smallButReal = company({
      id: "real",
      name: "RealFirstParty",
      key: "ghosting",
      score: 40,
      suppressed: false,
      effectiveN: 8,
      families: ["first_party"],
    });
    const out = rankSignalResults([bigButSuppressed, smallButReal], [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out.map((r) => r.company.slug)).toEqual(["real"]);
  });

  it("returns [] when no company renders the dimension (today's zero-evidence reality)", () => {
    const companies = [company({ id: "a", name: "A", key: "ghosting", score: null, suppressed: true, effectiveN: 0 })];
    expect(rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], REF)).toEqual([]);
  });

  it("returns [] for an empty signal list", () => {
    expect(rankSignalResults([], [], REF)).toEqual([]);
  });
});

describe("banding", () => {
  it("well_evidenced results always precede limited ones, regardless of signal strength", () => {
    // The limited company has the STRONGER raw signal (lower ghosting for a
    // 'low' query), but thinner evidence — it must still rank below the
    // well-evidenced one. Bands never interleave.
    const wellEvidenced = company({ id: "well", name: "Well", key: "ghosting", score: 60, suppressed: false, effectiveN: 30 });
    const limited = company({ id: "lim", name: "Lim", key: "ghosting", score: 5, suppressed: false, effectiveN: 4 });
    const out = rankSignalResults([limited, wellEvidenced], [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out.map((r) => r.company.slug)).toEqual(["well", "lim"]);
    expect(out[0].band).toBe("well_evidenced");
    expect(out[1].band).toBe("limited");
  });
});

describe("direction + calibration", () => {
  function population(scores: number[]): CompanyAnalytics[] {
    return scores.map((s, i) =>
      company({ id: `c${i}`, name: `C${i}`, key: "ghosting", score: s, suppressed: false, effectiveN: 25 })
    );
  }

  it("a 'low' query ranks the lowest-scoring (most-ghosting) company first when calibrated", () => {
    const companies = population([10, 30, 50, 70, 90]); // >= SIGNAL_MIN_POPULATION
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out[0].company.slug).toBe("c0"); // score 10, furthest below median
    expect(out.every((r) => r.populationCalibrated)).toBe(true);
  });

  it("a 'high' query ranks the highest-scoring company first when calibrated", () => {
    const companies = population([10, 30, 50, 70, 90]);
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "high" }], REF);
    expect(out[0].company.slug).toBe("c4"); // score 90
  });

  it("below the population floor, ordering falls back to raw score and is flagged uncalibrated", () => {
    expect(SIGNAL_MIN_POPULATION).toBeGreaterThan(2);
    const companies = population([20, 80]).slice(0, 2); // only 2 -> uncalibrated
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out.every((r) => !r.populationCalibrated)).toBe(true);
    expect(out[0].company.slug).toBe("c0"); // raw directional: lower score first for 'low'
  });

  it("signalStrength is always a number for a gated result (null is reserved for the insufficient band, which never gates in)", () => {
    const companies = population([10, 30, 50, 70, 90]);
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], REF);
    expect(out.every((r) => typeof r.signalStrength === "number")).toBe(true);
  });
});

describe("clock-free", () => {
  it("ordering depends only on the supplied referenceMonth, not wall-clock", () => {
    const companies = [
      company({ id: "fresh", name: "Fresh", key: "ghosting", score: 40, suppressed: false, effectiveN: 25, latestMonth: "2026-08" }),
      company({ id: "stale", name: "Stale", key: "ghosting", score: 40, suppressed: false, effectiveN: 25, latestMonth: "2024-08" }),
    ];
    // Same scores; the fresher company wins purely on freshnessFactor(refMonth).
    const out = rankSignalResults(companies, [{ dimensionKey: "ghosting", direction: "low" }], "2026-08");
    expect(out[0].company.slug).toBe("fresh");
  });
});
