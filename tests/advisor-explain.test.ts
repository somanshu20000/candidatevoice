/**
 * The explanation layer. The single most important test here is
 * traceability: every number that appears in the generated prose must be a
 * number that was passed in. That is what makes a template-based explanation
 * safe where an LLM one would need a validation pass — a fabricated figure
 * fails the suite mechanically.
 */

import { describe, expect, it } from "vitest";
import { computeFit, buildCompromiseMatrix, marketBaseline, explainFit, explainCompromise } from "@/lib/advisor";
import type { FitResult, PreferenceVector } from "@/lib/advisor";
import type { BehaviouralFingerprint, BehaviouralDimensionScore } from "@/lib/fingerprint/behavioural";

function fingerprint(
  effectiveN: number,
  rawTotal: number,
  dims: Array<Partial<BehaviouralDimensionScore> & Pick<BehaviouralDimensionScore, "key" | "score">>
): BehaviouralFingerprint {
  const base = { rawTotal, weightedTotal: rawTotal, firstPartyRaw: rawTotal, firstPartyWeighted: rawTotal, externalRaw: 0, externalWeighted: 0, firstPartyProportion: 1, sourceDiversity: 1, monthsSpanned: 1, earliestMonth: "2026-01", latestMonth: "2026-01", effectiveN };
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

function integersIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).map(Number);
}

/** Every number the fit explanation is ALLOWED to contain — derived purely from inputs. */
function allowedFitNumbers(fit: FitResult): Set<number> {
  const allowed = new Set<number>();
  if (fit.score !== null) allowed.add(fit.score);
  allowed.add(Math.round(fit.base.effectiveN));
  allowed.add(fit.base.rawTotal);
  allowed.add(100); // "out of 100" — a fixed scale, not a datum
  for (const c of fit.contributions) {
    if (c.companyScore !== null) allowed.add(c.companyScore);
  }
  // Counts of the lists the prose may enumerate.
  allowed.add(fit.contributions.filter((c) => c.status === "not_measured").length);
  allowed.add(fit.contributions.filter((c) => c.status === "company_insufficient").length);
  return allowed;
}

describe("explainFit — traceability (no invented numbers)", () => {
  it("emits only numbers present in the fit result", () => {
    const fp = fingerprint(42, 55, [
      { key: "response_speed", score: 88 },
      { key: "ghosting", score: 30 },
      { key: "transparency", score: 60 },
    ]);
    const vector: PreferenceVector = { fast_interviews: 5, low_ghosting: 5, transparency: 4, salary: 5, growth: 3 };
    const fit = computeFit(vector, fp);
    const ex = explainFit(fit, "Acme");
    const allowed = allowedFitNumbers(fit);

    for (const n of integersIn([ex.summary, ...ex.bullets].join(" "))) {
      expect(allowed.has(n), `explanation contains ${n}, which is not an input value`).toBe(true);
    }
  });

  it("states the score, tier phrasing, and evidence in the summary", () => {
    const fp = fingerprint(42, 55, [{ key: "response_speed", score: 88 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    const ex = explainFit(fit, "Acme");
    expect(ex.summary).toContain(String(fit.score));
    expect(ex.summary).toContain("55 reports");
    expect(ex.summary.toLowerCase()).toContain("acme");
  });

  it("names a strength with its actual company score", () => {
    const fp = fingerprint(30, 40, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    const ex = explainFit(fit, "Acme");
    const strengthBullet = ex.bullets.find((b) => b.startsWith("Strength"));
    expect(strengthBullet).toBeDefined();
    expect(strengthBullet).toContain("90");
  });

  it("is honest about not-measured priorities, naming them without a number-as-fact", () => {
    const fp = fingerprint(30, 40, [{ key: "response_speed", score: 70 }]);
    const fit = computeFit({ fast_interviews: 3, salary: 5, work_life_balance: 4 }, fp);
    const ex = explainFit(fit, "Acme");
    const note = ex.bullets.find((b) => b.toLowerCase().includes("can't be measured"));
    expect(note).toBeDefined();
    expect(note).toContain("Salary");
    expect(note).toContain("Work-life balance");
  });
});

describe("explainFit — suppressed results explain, never fabricate", () => {
  it("explains an insufficient-evidence result as 'not enough data', not a score", () => {
    const fp = fingerprint(3, 3, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ fast_interviews: 5 }, fp);
    expect(fit.score).toBeNull();
    const ex = explainFit(fit, "Acme");
    expect(ex.summary.toLowerCase()).toContain("not enough");
    expect(ex.bullets).toHaveLength(0);
  });

  it("explains a no-scorable-priority result distinctly", () => {
    const fp = fingerprint(50, 60, [{ key: "response_speed", score: 90 }]);
    const fit = computeFit({ salary: 5, work_life_balance: 5 }, fp);
    expect(fit.score).toBeNull();
    const ex = explainFit(fit, "Acme");
    expect(ex.summary.toLowerCase()).toContain("can be measured");
  });
});

describe("explainCompromise — traceability", () => {
  const market = marketBaseline([
    fingerprint(20, 20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
    fingerprint(20, 20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
    fingerprint(20, 20, [{ key: "response_speed", score: 50 }, { key: "ghosting", score: 50 }]),
  ]);

  it("emits only company scores and market means that are in the matrix", () => {
    const company = fingerprint(20, 25, [{ key: "response_speed", score: 80 }, { key: "ghosting", score: 20 }]);
    const matrix = buildCompromiseMatrix({ fast_interviews: 5, low_ghosting: 5 }, company, market);
    const ex = explainCompromise(matrix, "Acme");

    const allowed = new Set<number>();
    for (const row of matrix.rows) {
      if (row.companyScore !== null) allowed.add(row.companyScore);
      if (row.marketMean !== null) allowed.add(Math.round(row.marketMean));
    }
    for (const n of integersIn([ex.summary, ...ex.bullets].join(" "))) {
      expect(allowed.has(n), `compromise prose contains ${n}, not an input`).toBe(true);
    }
  });

  it("describes both the gain and the give-up with their real scores", () => {
    const company = fingerprint(20, 25, [{ key: "response_speed", score: 80 }, { key: "ghosting", score: 20 }]);
    const matrix = buildCompromiseMatrix({ fast_interviews: 5, low_ghosting: 5 }, company, market);
    const ex = explainCompromise(matrix, "Acme");
    const joined = [ex.summary, ...ex.bullets].join(" ");
    expect(joined).toContain("Fast interviews"); // the gain
    expect(joined).toContain("Low ghosting risk"); // the give-up
    expect(ex.bullets.some((b) => b.includes("80"))).toBe(true);
    expect(ex.bullets.some((b) => b.includes("20"))).toBe(true);
  });
});
