/**
 * Aggregation engine behaviour.
 *
 * The thresholds under test are the product's honesty guarantees, not
 * implementation detail: they are what stops the interface rendering a
 * confident-looking number on top of three data points.
 */

import { describe, expect, it } from "vitest";
import {
  aggregateDimension,
  aggregateEmotions,
  buildFingerprint,
  computeTrend,
  deriveConfidence,
  monthIndex,
  ratingMeanToScore,
  CORROBORATION_MIN_MONTHS,
  MIN_OBSERVATIONS_PER_FACET,
  MIN_SUBMISSIONS_FOR_SCORE,
  TREND_MIN_PER_WINDOW,
  type EmotionObservation,
  type RatingObservation,
} from "@/lib/fingerprint/aggregate";
import { getDimension, type FacetKey } from "@/lib/fingerprint/taxonomy";

const CANDIDATE_EXPERIENCE = getDimension("candidate_experience")!;
const EMOTIONAL_CLIMATE = getDimension("emotional_climate")!;
const LEADERSHIP = getDimension("leadership")!;

/** Build one rating per value, each from a distinct submission. */
function ratings(
  facetKey: FacetKey,
  values: number[],
  month: string,
  idPrefix = "s"
): RatingObservation[] {
  return values.map((rating, i) => ({
    submissionId: `${idPrefix}-${month}-${i}`,
    facetKey,
    rating,
    reportedMonth: month,
  }));
}

function input(
  ratingObs: RatingObservation[],
  emotionObs: EmotionObservation[] = [],
  referenceMonth = "2026-07"
) {
  return { ratings: ratingObs, emotions: emotionObs, referenceMonth };
}

describe("ratingMeanToScore", () => {
  it("maps the 1-5 scale onto 0-100 with 3 as the midpoint", () => {
    expect(ratingMeanToScore(1)).toBe(0);
    expect(ratingMeanToScore(3)).toBe(50);
    expect(ratingMeanToScore(5)).toBe(100);
    expect(ratingMeanToScore(4)).toBe(75);
  });
});

describe("monthIndex", () => {
  it("orders months across a year boundary", () => {
    expect(monthIndex("2026-01")).toBeLessThan(monthIndex("2026-02"));
    expect(monthIndex("2025-12")).toBeLessThan(monthIndex("2026-01"));
    expect(monthIndex("2026-02") - monthIndex("2026-01")).toBe(1);
  });

  it("rejects malformed or impossible months", () => {
    expect(Number.isNaN(monthIndex("2026-13"))).toBe(true);
    expect(Number.isNaN(monthIndex("2026-00"))).toBe(true);
    expect(Number.isNaN(monthIndex("2026-7"))).toBe(true);
    expect(Number.isNaN(monthIndex("not-a-month"))).toBe(true);
    expect(Number.isNaN(monthIndex("2026-07-14"))).toBe(true);
  });
});

describe("deriveConfidence", () => {
  it("reports insufficient below the publication threshold", () => {
    expect(deriveConfidence(MIN_SUBMISSIONS_FOR_SCORE - 1, 3)).toBe("insufficient");
    expect(deriveConfidence(0, 0)).toBe("insufficient");
  });

  it("requires month spread, not just volume, to call evidence corroborated", () => {
    // Twenty reports inside one month may be a single coordinated push.
    expect(deriveConfidence(20, 1)).toBe("single");
    expect(deriveConfidence(MIN_SUBMISSIONS_FOR_SCORE, CORROBORATION_MIN_MONTHS)).toBe(
      "corroborated"
    );
  });

  it("never returns a verified tier", () => {
    // Anonymity makes independence unprovable; the ADR requires "corroborated
    // by N reports", never "independently verified".
    expect(deriveConfidence(10_000, 120)).toBe("corroborated");
  });
});

describe("aggregateDimension — sparse evidence", () => {
  it("refuses to score below the submission threshold", () => {
    const obs = ratings("respect", [5, 5, 5, 5], "2026-07"); // 4 submissions
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));

    expect(result.status).toBe("insufficient");
    expect(result.score).toBeNull();
    expect(result.confidence).toBe("insufficient");
    // The evidence count is still reported — the reader is told what exists.
    expect(result.submissionCount).toBe(4);
  });

  it("scores once the threshold is met", () => {
    const obs = ratings("respect", [4, 4, 4, 4, 4], "2026-07");
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));

    expect(result.status).toBe("scored");
    expect(result.score).toBe(75);
    expect(result.submissionCount).toBe(MIN_SUBMISSIONS_FOR_SCORE);
    expect(result.confidence).toBe("single"); // single month
  });

  it("promotes to corroborated when evidence spans months", () => {
    const obs = [
      ...ratings("respect", [4, 4, 4], "2026-06", "a"),
      ...ratings("respect", [4, 4], "2026-07", "b"),
    ];
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));

    expect(result.distinctMonths).toBe(2);
    expect(result.confidence).toBe("corroborated");
  });
});

describe("aggregateDimension — facet weighting", () => {
  it("excludes facets below the per-facet observation floor from the score", () => {
    const obs = [
      // respect: 5 observations of 5 -> qualifies, score 100
      ...ratings("respect", [5, 5, 5, 5, 5], "2026-07", "r"),
      // fairness: 2 observations of 1 -> below floor, must not drag the score down
      ...ratings("fairness", [1, 1], "2026-07", "f"),
    ];
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));

    expect(MIN_OBSERVATIONS_PER_FACET).toBe(3);
    expect(result.score).toBe(100);

    const fairness = result.facets.find((f) => f.facetKey === "fairness")!;
    expect(fairness.contributesToDimension).toBe(false);
    expect(fairness.score).toBeNull();
    // But its raw evidence is still visible rather than hidden.
    expect(fairness.observationCount).toBe(2);
    expect(fairness.distribution[0]).toBe(2);
  });

  it("weights facets equally rather than pooling raw ratings", () => {
    // respect answered by many at 5; negotiation answered by few at 1.
    // Pooling would give ~4.4 (score 85). Equal facet weighting gives 50.
    const obs = [
      ...ratings("respect", [5, 5, 5, 5, 5, 5, 5, 5, 5], "2026-07", "r"),
      ...ratings("transparency", [1, 1, 1], "2026-07", "t"),
    ];
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));

    expect(result.score).toBe(50); // mean of 100 and 0
  });

  it("reports the full rating distribution as the evidence behind each facet", () => {
    const obs = ratings("respect", [1, 3, 3, 5, 5], "2026-07");
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));
    const respect = result.facets.find((f) => f.facetKey === "respect")!;

    expect(respect.distribution).toEqual([1, 0, 2, 0, 2]);
    expect(respect.observationCount).toBe(5);
    expect(respect.mean).toBeCloseTo(3.4, 2);
  });

  it("ignores out-of-range ratings rather than scoring them", () => {
    const obs: RatingObservation[] = [
      ...ratings("respect", [4, 4, 4, 4, 4], "2026-07"),
      { submissionId: "bad-1", facetKey: "respect", rating: 9, reportedMonth: "2026-07" },
      { submissionId: "bad-2", facetKey: "respect", rating: 0, reportedMonth: "2026-07" },
    ];
    const result = aggregateDimension(CANDIDATE_EXPERIENCE, input(obs));
    const respect = result.facets.find((f) => f.facetKey === "respect")!;

    expect(respect.observationCount).toBe(5);
    expect(result.score).toBe(75);
  });
});

describe("aggregateDimension — dimensions with no enabled source", () => {
  it("reports awaiting_source and never a zero score", () => {
    const result = aggregateDimension(LEADERSHIP, input([]));

    expect(result.status).toBe("awaiting_source");
    expect(result.score).toBeNull();
    // Rendering 0 would read as "this company scores terribly on leadership"
    // when the truth is that no evidence source exists.
    expect(result.score).not.toBe(0);
  });
});

describe("emotions", () => {
  it("counts distinct submissions, not duplicate rows", () => {
    const obs: EmotionObservation[] = [
      { submissionId: "s1", emotionKey: "ignored", reportedMonth: "2026-07" },
      { submissionId: "s1", emotionKey: "ignored", reportedMonth: "2026-07" },
      { submissionId: "s2", emotionKey: "ignored", reportedMonth: "2026-07" },
    ];
    const result = aggregateEmotions(obs);

    expect(result.submissionCount).toBe(2);
    expect(result.emotions.find((e) => e.emotionKey === "ignored")!.count).toBe(2);
  });

  it("computes valence shares over submissions that can overlap", () => {
    const obs: EmotionObservation[] = [
      { submissionId: "s1", emotionKey: "excited", reportedMonth: "2026-07" },
      { submissionId: "s1", emotionKey: "stressed", reportedMonth: "2026-07" },
      { submissionId: "s2", emotionKey: "stressed", reportedMonth: "2026-07" },
    ];
    const result = aggregateEmotions(obs);

    // s1 felt both, so the shares legitimately sum above 1.
    expect(result.positiveShare).toBeCloseTo(0.5, 5);
    expect(result.negativeShare).toBeCloseTo(1, 5);
  });

  it("produces no score for the emotion dimension, only a distribution", () => {
    const emotionObs: EmotionObservation[] = Array.from({ length: 6 }, (_, i) => ({
      submissionId: `s${i}`,
      emotionKey: "frustrated" as const,
      reportedMonth: "2026-07",
    }));
    const result = aggregateDimension(EMOTIONAL_CLIMATE, input([], emotionObs));

    expect(result.status).toBe("scored");
    expect(result.score).toBeNull();
    expect(result.emotions).not.toBeNull();
    expect(result.emotions!.submissionCount).toBe(6);
  });

  it("handles an empty set without dividing by zero", () => {
    const result = aggregateEmotions([]);
    expect(result.submissionCount).toBe(0);
    expect(result.positiveShare).toBe(0);
    expect(result.negativeShare).toBe(0);
    expect(result.emotions.every((e) => e.share === 0)).toBe(true);
  });
});

describe("computeTrend", () => {
  const REF = "2026-07"; // recent window 2026-05..07, prior window 2026-02..04

  function twoWindows(priorValue: number, recentValue: number) {
    return [
      ...ratings("respect", Array(TREND_MIN_PER_WINDOW).fill(priorValue), "2026-03", "p"),
      ...ratings("respect", Array(TREND_MIN_PER_WINDOW).fill(recentValue), "2026-06", "r"),
    ];
  }

  it("returns null when either window is too thin", () => {
    const thin = [
      ...ratings("respect", [4, 4], "2026-03", "p"),
      ...ratings("respect", [5, 5, 5, 5, 5], "2026-06", "r"),
    ];
    expect(computeTrend(thin, REF)).toBeNull();
  });

  it("detects improvement", () => {
    const trend = computeTrend(twoWindows(2, 5), REF)!;
    expect(trend.direction).toBe("improving");
    expect(trend.priorScore).toBe(25);
    expect(trend.recentScore).toBe(100);
    expect(trend.deltaPoints).toBe(75);
  });

  it("detects decline", () => {
    const trend = computeTrend(twoWindows(5, 2), REF)!;
    expect(trend.direction).toBe("declining");
    expect(trend.deltaPoints).toBe(-75);
  });

  it("calls small movements stable rather than directional", () => {
    const trend = computeTrend(twoWindows(4, 4), REF)!;
    expect(trend.direction).toBe("stable");
    expect(trend.deltaPoints).toBe(0);
  });

  it("ignores evidence older than the comparison windows", () => {
    const withAncient = [
      ...twoWindows(4, 4),
      ...ratings("respect", [1, 1, 1, 1, 1, 1], "2020-01", "ancient"),
    ];
    const trend = computeTrend(withAncient, REF)!;
    expect(trend.priorScore).toBe(75);
    expect(trend.priorSubmissions).toBe(TREND_MIN_PER_WINDOW);
  });

  it("returns null for a malformed reference month", () => {
    expect(computeTrend(twoWindows(2, 5), "nonsense")).toBeNull();
  });
});

describe("buildFingerprint", () => {
  it("always returns all six dimensions in display order", () => {
    const fingerprint = buildFingerprint(input([]));

    expect(fingerprint.dimensions).toHaveLength(6);
    expect(fingerprint.dimensions.map((d) => d.dimensionKey)).toEqual([
      "professionalism",
      "candidate_experience",
      "hiring_process",
      "emotional_climate",
      "leadership",
      "work_culture",
    ]);
  });

  it("reports an empty organization as insufficient rather than scoring zero", () => {
    const fingerprint = buildFingerprint(input([]));

    expect(fingerprint.totalSubmissions).toBe(0);
    expect(fingerprint.confidence).toBe("insufficient");
    expect(fingerprint.latestMonth).toBeNull();
    expect(fingerprint.dimensions.every((d) => d.score === null)).toBe(true);
  });

  it("counts a submission once even when it rates many facets", () => {
    const obs: RatingObservation[] = [
      { submissionId: "s1", facetKey: "respect", rating: 4, reportedMonth: "2026-07" },
      { submissionId: "s1", facetKey: "fairness", rating: 5, reportedMonth: "2026-07" },
      { submissionId: "s1", facetKey: "role_clarity", rating: 3, reportedMonth: "2026-07" },
    ];
    const fingerprint = buildFingerprint(input(obs));

    expect(fingerprint.totalSubmissions).toBe(1);
    expect(fingerprint.totalObservations).toBe(3);
  });

  it("surfaces the most recent month of evidence", () => {
    const obs = [
      ...ratings("respect", [4], "2026-02", "a"),
      ...ratings("respect", [4], "2026-07", "b"),
      ...ratings("respect", [4], "2025-11", "c"),
    ];
    expect(buildFingerprint(input(obs)).latestMonth).toBe("2026-07");
  });
});
