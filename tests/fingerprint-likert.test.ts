/**
 * Likert facet rollup + emotion distribution (src/lib/fingerprint/likert.ts).
 * Pins the properties that keep this read path honest:
 *   1. null is not 0 — suppressed below the floor, both per-facet and per-dimension
 *   2. a rating of 1 scores 0, a rating of 5 scores 100 — the 0-100 rescale
 *   3. a dimension rollup POOLS every facet's ratings, not a mean-of-means
 *   4. an emotion's denominator is respondents-who-answered, not all evidence
 *   5. hasAnyLikertSignal is false only when everything is suppressed
 */

import { describe, expect, it } from "vitest";
import { buildLikertFingerprint, hasAnyLikertSignal, LIKERT_MIN_EFFECTIVE_N } from "@/lib/fingerprint/likert";
import type { RawFacetRating, RawEmotionSelection } from "@/lib/evidence/load";

const ORG = "org-1";
let seq = 0;
function submissionId() {
  return `sub-${++seq}`;
}

function ratingsFor(facetKey: string, ratings: number[]): RawFacetRating[] {
  return ratings.map((rating) => ({ submissionId: submissionId(), facetKey, rating }));
}

describe("facet + dimension scoring", () => {
  it("returns null, not 0, with zero ratings", () => {
    const fp = buildLikertFingerprint([], [], ORG);
    expect(fp.dimensions.every((d) => d.metric.value === null)).toBe(true);
    expect(fp.dimensions.every((d) => d.metric.suppressed)).toBe(true);
  });

  it("suppresses a facet one below the floor (n = floor - 1)", () => {
    const rows = ratingsFor("recruiter_professionalism", Array(LIKERT_MIN_EFFECTIVE_N - 1).fill(5));
    const fp = buildLikertFingerprint(rows, [], ORG);
    const dim = fp.dimensions.find((d) => d.key === "professionalism")!;
    const facet = dim.facets.find((f) => f.key === "recruiter_professionalism")!;
    expect(facet.metric.suppressed).toBe(true);
    expect(facet.metric.value).toBeNull();
  });

  it("renders a facet at exactly the floor (n = floor)", () => {
    const rows = ratingsFor("recruiter_professionalism", Array(LIKERT_MIN_EFFECTIVE_N).fill(5));
    const fp = buildLikertFingerprint(rows, [], ORG);
    const dim = fp.dimensions.find((d) => d.key === "professionalism")!;
    const facet = dim.facets.find((f) => f.key === "recruiter_professionalism")!;
    expect(facet.metric.suppressed).toBe(false);
    expect(facet.metric.value).toBe(100); // rating 5 -> 100
  });

  it("rescales 1-5 to 0-100: 1->0, 3->50, 5->100", () => {
    const rows: RawFacetRating[] = [
      ...ratingsFor("punctuality", Array(LIKERT_MIN_EFFECTIVE_N).fill(1)),
    ];
    const fp1 = buildLikertFingerprint(rows, [], ORG);
    const facet1 = fp1.dimensions.find((d) => d.key === "professionalism")!.facets.find((f) => f.key === "punctuality")!;
    expect(facet1.metric.value).toBe(0);

    seq = 0;
    const rows3: RawFacetRating[] = ratingsFor("punctuality", Array(LIKERT_MIN_EFFECTIVE_N).fill(3));
    const fp3 = buildLikertFingerprint(rows3, [], ORG);
    const facet3 = fp3.dimensions.find((d) => d.key === "professionalism")!.facets.find((f) => f.key === "punctuality")!;
    expect(facet3.metric.value).toBe(50);
  });

  it("dimension rollup POOLS ratings across facets, not a mean-of-facet-means", () => {
    // recruiter_professionalism: three 5s (score 100 each).
    // punctuality: one 1 (score 0).
    // A mean-of-means would average 100 and 0 to 50. Pooled, it's (100*3 + 0)/4 = 75.
    const rows: RawFacetRating[] = [
      ...ratingsFor("recruiter_professionalism", [5, 5, 5]),
      ...ratingsFor("punctuality", [1]),
    ];
    const fp = buildLikertFingerprint(rows, [], ORG);
    const dim = fp.dimensions.find((d) => d.key === "professionalism")!;
    expect(dim.metric.suppressed).toBe(false);
    expect(dim.metric.value).toBe(75);
  });

  it("only the three candidate Likert dimensions are scored — no employee-sourced dimension", () => {
    const fp = buildLikertFingerprint([], [], ORG);
    const keys = fp.dimensions.map((d) => d.key);
    expect(keys.sort()).toEqual(["candidate_experience", "hiring_process", "professionalism"].sort());
  });

  it("a facet under one dimension never leaks into another dimension's pool", () => {
    const rows: RawFacetRating[] = ratingsFor("recruiter_professionalism", Array(LIKERT_MIN_EFFECTIVE_N).fill(5));
    const fp = buildLikertFingerprint(rows, [], ORG);
    const otherDim = fp.dimensions.find((d) => d.key === "candidate_experience")!;
    expect(otherDim.metric.suppressed).toBe(true);
  });
});

describe("emotion distribution", () => {
  function emotionRow(emotionKey: string, subId: string): RawEmotionSelection {
    return { submissionId: subId, emotionKey };
  }

  it("returns null, not 0, with zero emotion selections", () => {
    const fp = buildLikertFingerprint([], [], ORG);
    expect(fp.emotions.every((e) => e.metric.value === null)).toBe(true);
  });

  it("suppresses below the floor (n = floor - 1 respondents)", () => {
    const rows = Array.from({ length: LIKERT_MIN_EFFECTIVE_N - 1 }, () => emotionRow("appreciated", submissionId()));
    const fp = buildLikertFingerprint([], rows, ORG);
    const appreciated = fp.emotions.find((e) => e.key === "appreciated")!;
    expect(appreciated.metric.suppressed).toBe(true);
  });

  it("renders at exactly the floor, and unselected emotions read 0% not null", () => {
    const rows = Array.from({ length: LIKERT_MIN_EFFECTIVE_N }, () => emotionRow("appreciated", submissionId()));
    const fp = buildLikertFingerprint([], rows, ORG);
    const appreciated = fp.emotions.find((e) => e.key === "appreciated")!;
    expect(appreciated.metric.suppressed).toBe(false);
    expect(appreciated.metric.value).toBe(1); // 100% of respondents selected it

    const angry = fp.emotions.find((e) => e.key === "angry")!;
    expect(angry.metric.suppressed).toBe(false); // same denominator population
    expect(angry.metric.value).toBe(0); // nobody selected it — 0, not null
  });

  it("denominator is respondents who answered at least one emotion, not the whole evidence set", () => {
    // Multi-select: same 3 people select BOTH appreciated and excited.
    const ids = Array.from({ length: LIKERT_MIN_EFFECTIVE_N }, () => submissionId());
    const rows: RawEmotionSelection[] = ids.flatMap((id) => [emotionRow("appreciated", id), emotionRow("excited", id)]);
    const fp = buildLikertFingerprint([], rows, ORG);
    const appreciated = fp.emotions.find((e) => e.key === "appreciated")!;
    const excited = fp.emotions.find((e) => e.key === "excited")!;
    expect(appreciated.metric.rawDenominator).toBe(LIKERT_MIN_EFFECTIVE_N);
    expect(excited.metric.rawDenominator).toBe(LIKERT_MIN_EFFECTIVE_N);
    expect(appreciated.metric.value).toBe(1);
    expect(excited.metric.value).toBe(1);
  });

  it("a mixed selection produces a genuine partial share, not 0 or 100", () => {
    const yesIds = Array.from({ length: 3 }, () => submissionId());
    const noIds = Array.from({ length: 2 }, () => submissionId());
    const rows: RawEmotionSelection[] = [
      ...yesIds.map((id) => emotionRow("frustrated", id)),
      ...noIds.map((id) => emotionRow("motivated", id)),
    ];
    const fp = buildLikertFingerprint([], rows, ORG);
    const frustrated = fp.emotions.find((e) => e.key === "frustrated")!;
    expect(frustrated.metric.rawDenominator).toBe(5); // all respondents, regardless of which emotion
    expect(frustrated.metric.value).toBeCloseTo(3 / 5, 5);
  });

  it("all 10 emotions are always present in the output, even unsuppressed-empty ones", () => {
    const rows = Array.from({ length: LIKERT_MIN_EFFECTIVE_N }, () => emotionRow("appreciated", submissionId()));
    const fp = buildLikertFingerprint([], rows, ORG);
    expect(fp.emotions.length).toBe(10);
  });
});

describe("hasAnyLikertSignal — the render gate", () => {
  it("false when everything is suppressed (the empty-state case)", () => {
    const fp = buildLikertFingerprint([], [], ORG);
    expect(hasAnyLikertSignal(fp)).toBe(false);
  });

  it("true when a dimension survives, even if all emotions are suppressed", () => {
    const rows = ratingsFor("recruiter_professionalism", Array(LIKERT_MIN_EFFECTIVE_N).fill(5));
    const fp = buildLikertFingerprint(rows, [], ORG);
    expect(hasAnyLikertSignal(fp)).toBe(true);
  });

  it("true when only an emotion survives, even if every dimension is suppressed", () => {
    const rows = Array.from({ length: LIKERT_MIN_EFFECTIVE_N }, () => ({ submissionId: submissionId(), emotionKey: "appreciated" }));
    const fp = buildLikertFingerprint([], rows, ORG);
    expect(hasAnyLikertSignal(fp)).toBe(true);
  });
});
