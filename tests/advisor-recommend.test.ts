/**
 * The Recommendation engine. The property that proves it's a real advisor and
 * not a re-skinned quality ranking: two candidates with different priorities
 * get DIFFERENT orders over the same companies. Plus the honesty rule shared
 * with the rest of the system — a thin-evidence company is listed unrated,
 * never force-ranked into a fake position.
 */

import { describe, expect, it } from "vitest";
import { rankByFit, groupByTier, FIT_MIN_EFFECTIVE_N } from "@/lib/advisor";
import type { PreferenceVector, RankCandidateCompany } from "@/lib/advisor";
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

function company(slug: string, fp: BehaviouralFingerprint): RankCandidateCompany {
  return { organizationId: `org-${slug}`, slug, displayName: slug, fingerprint: fp };
}

describe("rankByFit — personalisation", () => {
  // FastCo is great at speed, poor at transparency. OpenCo is the reverse.
  const fastCo = company("fastco", fingerprint(30, [{ key: "response_speed", score: 95 }, { key: "transparency", score: 20 }]));
  const openCo = company("openco", fingerprint(30, [{ key: "response_speed", score: 20 }, { key: "transparency", score: 95 }]));
  const companies = [fastCo, openCo];

  it("ranks the speed-lover's list with FastCo first", () => {
    const vector: PreferenceVector = { fast_interviews: 5, transparency: 1 };
    const { ranked } = rankByFit(vector, companies);
    expect(ranked.map((r) => r.slug)).toEqual(["fastco", "openco"]);
  });

  it("ranks the transparency-lover's list with OpenCo first — same companies, different order", () => {
    const vector: PreferenceVector = { fast_interviews: 1, transparency: 5 };
    const { ranked } = rankByFit(vector, companies);
    expect(ranked.map((r) => r.slug)).toEqual(["openco", "fastco"]);
  });
});

describe("rankByFit — unrated companies are never force-ranked", () => {
  it("separates companies whose fit can't be scored from the ranked list", () => {
    const solid = company("solid", fingerprint(30, [{ key: "response_speed", score: 80 }]));
    const thin = company("thin", fingerprint(FIT_MIN_EFFECTIVE_N - 1, [{ key: "response_speed", score: 99 }]));
    const { ranked, unrated } = rankByFit({ fast_interviews: 5 }, [thin, solid]);

    // The thin company has the higher raw dimension score, but too little
    // evidence — it must not outrank (or rank at all) the well-evidenced one.
    expect(ranked.map((r) => r.slug)).toEqual(["solid"]);
    expect(unrated.map((r) => r.slug)).toEqual(["thin"]);
    expect(unrated[0].fit.score).toBeNull();
  });
});

describe("rankByFit — deterministic tie-breaking", () => {
  it("breaks an equal fit by evidence weight, then name", () => {
    const a = company("aaa", fingerprint(10, [{ key: "response_speed", score: 70 }]));
    const b = company("bbb", fingerprint(40, [{ key: "response_speed", score: 70 }])); // same fit, more evidence
    const c = company("ccc", fingerprint(40, [{ key: "response_speed", score: 70 }])); // same fit + evidence as b
    const { ranked } = rankByFit({ fast_interviews: 5 }, [a, b, c]);
    // b and c outrank a (more evidence); b before c (name), a last.
    expect(ranked.map((r) => r.slug)).toEqual(["bbb", "ccc", "aaa"]);
  });
});

describe("groupByTier", () => {
  it("groups ranked companies by their fit tier, preserving order", () => {
    const best = company("best", fingerprint(30, [{ key: "response_speed", score: 95 }]));
    const avoid = company("avoid", fingerprint(30, [{ key: "response_speed", score: 10 }]));
    const { ranked } = rankByFit({ fast_interviews: 5 }, [avoid, best]);
    const groups = groupByTier(ranked);
    expect(groups.best.map((r) => r.slug)).toEqual(["best"]);
    expect(groups.avoid.map((r) => r.slug)).toEqual(["avoid"]);
  });
});

describe("rankByFit — empty input", () => {
  it("returns empty lists, not an error", () => {
    const { ranked, unrated } = rankByFit({ fast_interviews: 5 }, []);
    expect(ranked).toEqual([]);
    expect(unrated).toEqual([]);
  });
});
