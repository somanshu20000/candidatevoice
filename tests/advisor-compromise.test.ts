/**
 * Market baseline + compromise matrix. The load-bearing honesty property: a
 * priority no evidence measures (salary/WLB/…) is NEVER given a band — it reads
 * "not yet measured" — while behavioural dimensions show real High/Med/Low
 * cells derived from the fingerprint. This is the difference between an
 * evidence product and a fabricated "compromise matrix."
 */

import { describe, expect, it } from "vitest";
import {
  marketBaseline,
  buildCompromiseMatrix,
  bandFor,
  BAND_THRESHOLDS,
  BASELINE_MIN_COMPANIES,
  MARKET_MARGIN,
} from "@/lib/advisor";
import type { PreferenceVector } from "@/lib/advisor";
import type { BehaviouralFingerprint, BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";

function fingerprint(
  effectiveN: number,
  dims: Array<Partial<BehaviouralDimensionScore> & Pick<BehaviouralDimensionScore, "key" | "score">>
): BehaviouralFingerprint {
  const base = { rawTotal: 0, weightedTotal: 0, firstPartyRaw: 0, firstPartyWeighted: 0, externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1, monthsSpanned: 0, earliestMonth: null, latestMonth: null, effectiveN };
  return {
    dimensions: dims.map((d) => ({
      label: d.key,
      metric: { value: d.score, weightedNumerator: 0, weightedDenominator: 0, rawNumerator: 0, rawDenominator: 0, coverage: 1, suppressed: d.score === null },
      base,
      families: ["first_party"],
      suppressed: d.score === null,
      suppressionReason: d.score === null ? "insufficient_evidence" : null,
      ...d,
    })) as BehaviouralDimensionScore[],
    base,
    globalMultiplier: 0,
  };
}

describe("bandFor", () => {
  it("bands a 0-100 score at the exported thresholds", () => {
    expect(bandFor(BAND_THRESHOLDS.high)).toBe("high");
    expect(bandFor(BAND_THRESHOLDS.high - 1)).toBe("medium");
    expect(bandFor(BAND_THRESHOLDS.medium)).toBe("medium");
    expect(bandFor(BAND_THRESHOLDS.medium - 1)).toBe("low");
    expect(bandFor(0)).toBe("low");
  });
});

describe("marketBaseline", () => {
  it("averages only companies with a non-suppressed score for a dimension", () => {
    const companies = [
      fingerprint(20, [{ key: "response_speed", score: 90 }]),
      fingerprint(20, [{ key: "response_speed", score: 60 }]),
      fingerprint(20, [{ key: "response_speed", score: 30 }]),
      fingerprint(20, [{ key: "response_speed", score: null }]), // suppressed → excluded
    ];
    const base = marketBaseline(companies);
    expect(base.response_speed.mean).toBeCloseTo(60, 5); // (90+60+30)/3
    expect(base.response_speed.companies).toBe(3);
  });

  it("returns null mean for a dimension below the company floor — one company is not a market", () => {
    const companies = [
      fingerprint(20, [{ key: "ghosting", score: 80 }]),
      fingerprint(20, [{ key: "ghosting", score: 40 }]),
    ]; // only 2 < BASELINE_MIN_COMPANIES
    const base = marketBaseline(companies);
    expect(BASELINE_MIN_COMPANIES).toBe(3);
    expect(base.ghosting.mean).toBeNull();
    expect(base.ghosting.companies).toBe(2);
  });

  it("gives each company equal weight regardless of its report volume", () => {
    // effectiveN differs wildly but the mean is a plain average of scores.
    const companies = [
      fingerprint(500, [{ key: "transparency", score: 100 }]),
      fingerprint(5, [{ key: "transparency", score: 40 }]),
      fingerprint(5, [{ key: "transparency", score: 40 }]),
    ];
    expect(marketBaseline(companies).transparency.mean).toBeCloseTo(60, 5); // (100+40+40)/3
  });
});

describe("buildCompromiseMatrix", () => {
  const market = marketBaseline([
    fingerprint(20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
    fingerprint(20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
    fingerprint(20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
  ]);

  it("never bands a Family B preference — it stays not_measured", () => {
    const company = fingerprint(20, [{ key: "response_speed", score: 80 }]);
    const vector: PreferenceVector = { fast_interviews: 4, salary: 5, work_life_balance: 5 };
    const { rows } = buildCompromiseMatrix(vector, company, market);

    for (const key of ["salary", "work_life_balance"]) {
      const row = rows.find((r) => r.key === key)!;
      expect(row.status).toBe("not_measured");
      expect(row.companyBand).toBeNull();
      expect(row.marketBand).toBeNull();
      expect(row.companyScore).toBeNull();
    }
  });

  it("bands the company and market for a scored behavioural preference", () => {
    const company = fingerprint(20, [{ key: "response_speed", score: 80 }]);
    const { rows } = buildCompromiseMatrix({ fast_interviews: 4 }, company, market);
    const row = rows.find((r) => r.key === "fast_interviews")!;
    expect(row.status).toBe("scored");
    expect(row.companyScore).toBe(80);
    expect(row.companyBand).toBe("high");
    expect(row.marketMean).toBeCloseTo(50, 5);
    expect(row.marketBand).toBe("medium");
    expect(row.vsMarket).toBe("above");
  });

  it("shows the market even when THIS company lacks the evidence", () => {
    // Company has no response_speed dimension, but the market does.
    const company = fingerprint(20, [{ key: "ghosting", score: 70 }]);
    const { rows } = buildCompromiseMatrix({ fast_interviews: 5 }, company, market);
    const row = rows.find((r) => r.key === "fast_interviews")!;
    expect(row.status).toBe("company_insufficient");
    expect(row.companyScore).toBeNull();
    expect(row.marketMean).toBeCloseTo(50, 5); // market still informs the user
    expect(row.vsMarket).toBeNull();           // but no comparison without a company score
  });

  it("derives 'giving up' for a high-priority dimension below market, 'gaining' for above", () => {
    const company = fingerprint(20, [
      { key: "response_speed", score: 80 }, // above market 50 → gaining
      { key: "ghosting", score: 20 },       // below market 50 → giving up
    ]);
    const { givingUp, gaining } = buildCompromiseMatrix({ fast_interviews: 5, low_ghosting: 5 }, company, market);
    expect(gaining).toContain("fast_interviews");
    expect(givingUp).toContain("low_ghosting");
  });

  it("a company within the market margin is neither giving up nor gaining", () => {
    const company = fingerprint(20, [{ key: "response_speed", score: 50 + MARKET_MARGIN - 1 }]);
    const { givingUp, gaining, rows } = buildCompromiseMatrix({ fast_interviews: 5 }, company, market);
    expect(rows.find((r) => r.key === "fast_interviews")!.vsMarket).toBe("at");
    expect(givingUp).toHaveLength(0);
    expect(gaining).toHaveLength(0);
  });

  it("a low-priority below-market dimension is not counted as giving up", () => {
    const company = fingerprint(20, [{ key: "ghosting", score: 10 }]);
    const { givingUp } = buildCompromiseMatrix({ low_ghosting: 1 }, company, market);
    expect(givingUp).toHaveLength(0);
  });
});
