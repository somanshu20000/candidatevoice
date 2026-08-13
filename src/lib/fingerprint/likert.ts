/**
 * Fingerprint — Likert facet rollup and emotion distribution (migration 0003,
 * extended by 0017's two clarity facets).
 *
 * WHAT THIS CLOSES
 * The submit wizard has collected structured 1-5 facet ratings and self-
 * selected emotion tags from candidates since the relationship selector
 * shipped (facetsForDimension() is rendered generically per taxonomy.ts, so
 * every facet — including 0017's compensation_clarity/work_arrangement_clarity
 * — already has a slider with no per-facet UI code). Nothing has ever read
 * submission_ratings or submission_emotions back out. This module is that
 * read path: it turns the rows the wizard has been writing into the same
 * kind of suppression-gated MetricResult every other panel on the company
 * page renders.
 *
 * SAME MACHINERY (D-001). Every rating row and every emotion selection is
 * adapted to a minimal, weight-1 EvidenceItem (minimalEvidenceItem —
 * everything here is first-party by construction, since submission_ratings
 * and submission_emotions FK only to hiring_submissions, never to
 * external_reports) and reduced with the real weightedMean/weightedRate from
 * aggregate.ts. No parallel statistics layer.
 *
 * SCOPE. Only the three CANDIDATE-sourced Likert dimensions (professionalism,
 * candidate_experience, hiring_process) and the one emotion dimension
 * (emotional_climate) are covered — exactly LIKERT_DIMENSIONS/EMOTION_DIMENSION
 * in submit/page.tsx, i.e. what the wizard actually collects. leadership and
 * work_culture (sourceType 'employee') remain awaiting_source: no UI collects
 * them, and adding one is a separate, larger decision (adr-0004's employee-
 * reporting re-identification tradeoff), not something this module invents.
 *
 * RATING SCALE. A 1-5 rating is rescaled to 0-100 ((rating-1)/4*100) so it
 * sits on the same "higher is better" scale as every other dimension score on
 * the page (behavioural.ts, compensation.ts, offboarding.ts).
 *
 * DIMENSION ROLLUP. Pooled, not mean-of-facet-means: every individual rating
 * under a dimension's facets counts once toward that dimension's weighted
 * mean. A facet with more responses naturally carries more weight in the
 * pooled dimension score, which is the honest reading of "what did people
 * say across everything we asked in this dimension" — not an editorial
 * decision to weight facets equally regardless of how many people answered.
 *
 * EMOTION DENOMINATOR. A candidate who left the emotion picker untouched
 * answered nothing (D-003: NULL is not NO) — the denominator for each
 * emotion's share is submissions that selected AT LEAST ONE emotion, never
 * every submission in the evidence set. Multi-select: one submission can
 * contribute to several emotions' numerators.
 */

import { weightedMean, weightedRate } from "@/lib/evidence";
import { minimalEvidenceItem } from "@/lib/evidence/synthetic";
import type { EvidenceItem, MetricResult } from "@/lib/evidence";
import type { RawFacetRating, RawEmotionSelection } from "@/lib/evidence/load";
import {
  DIMENSIONS,
  EMOTIONS,
  facetsForDimension,
  type DimensionKey,
  type FacetKey,
  type EmotionKey,
} from "./taxonomy";

/** Same ordinary floor as every other dimension (behavioural.ts) — this is
 *  candidate-sourced evidence, the same population and anonymity profile as
 *  the rest of the free/unlocked page, so no elevated bar applies. */
export const LIKERT_MIN_EFFECTIVE_N = 3;

/** The three candidate-collectable Likert dimensions, in display order —
 *  identical filter to submit/page.tsx's LIKERT_DIMENSIONS, so a facet added
 *  to the taxonomy shows up here with no edit to this file. */
const LIKERT_DIMENSIONS = DIMENSIONS.filter((d) => d.measurement === "likert" && d.sourceType !== "employee");

function scaleRating(rating: number): number {
  return ((rating - 1) / 4) * 100;
}

export interface FacetScore {
  key: FacetKey;
  label: string;
  metric: MetricResult;
}

export interface LikertDimensionScore {
  key: DimensionKey;
  label: string;
  /** Pooled across every facet under this dimension. Null when suppressed. */
  metric: MetricResult;
  facets: FacetScore[];
}

export interface EmotionShare {
  key: EmotionKey;
  label: string;
  valence: "positive" | "negative";
  /** Share (0..1) of respondents-who-answered that selected this emotion. */
  metric: MetricResult;
}

export interface LikertFingerprint {
  dimensions: LikertDimensionScore[];
  emotions: EmotionShare[];
}

/** One weight-1 EvidenceItem + its scaled score per rating row, keyed so a
 *  facet or dimension reduction can filter rows first and still look its
 *  score back up by item.id. */
function ratingPairs(rows: RawFacetRating[], organizationId: string): { item: EvidenceItem; score: number }[] {
  return rows.map((r) => ({
    item: minimalEvidenceItem(`${r.submissionId}:${r.facetKey}`, organizationId),
    score: scaleRating(r.rating),
  }));
}

function meanOfRows(rows: RawFacetRating[], organizationId: string, minEffectiveN: number): MetricResult {
  const pairs = ratingPairs(rows, organizationId);
  const scoreById = new Map(pairs.map((p) => [p.item.id, p.score]));
  return weightedMean(pairs.map((p) => p.item), (i) => scoreById.get(i.id) ?? null, minEffectiveN);
}

function facetScore(rows: RawFacetRating[], facetKey: FacetKey, label: string, organizationId: string): FacetScore {
  return { key: facetKey, label, metric: meanOfRows(rows.filter((r) => r.facetKey === facetKey), organizationId, LIKERT_MIN_EFFECTIVE_N) };
}

function dimensionScore(
  rows: RawFacetRating[],
  key: DimensionKey,
  label: string,
  organizationId: string
): LikertDimensionScore {
  const facets = facetsForDimension(key);
  const facetKeys = new Set(facets.map((f) => f.key));
  const dimRows = rows.filter((r) => facetKeys.has(r.facetKey as FacetKey));
  return {
    key,
    label,
    metric: meanOfRows(dimRows, organizationId, LIKERT_MIN_EFFECTIVE_N),
    facets: facets.map((f) => facetScore(rows, f.key, f.label, organizationId)),
  };
}

function emotionShares(rows: RawEmotionSelection[], organizationId: string): EmotionShare[] {
  const bySubmission = new Map<string, Set<EmotionKey>>();
  for (const r of rows) {
    const key = r.emotionKey as EmotionKey;
    const set = bySubmission.get(r.submissionId) ?? new Set<EmotionKey>();
    set.add(key);
    bySubmission.set(r.submissionId, set);
  }
  // Denominator = respondents who selected at least one emotion. Every id in
  // bySubmission answered by construction (a row only exists if selected).
  const items = [...bySubmission.keys()].map((id) => minimalEvidenceItem(id, organizationId));
  const emotionsOf = (i: EvidenceItem) => bySubmission.get(i.id) ?? new Set<EmotionKey>();

  return EMOTIONS.map((e) => ({
    key: e.key,
    label: e.label,
    valence: e.valence,
    metric: weightedRate(items, {
      eligible: () => true,
      hit: (i) => emotionsOf(i).has(e.key),
      minEffectiveN: LIKERT_MIN_EFFECTIVE_N,
    }),
  }));
}

export function buildLikertFingerprint(
  ratings: RawFacetRating[],
  emotions: RawEmotionSelection[],
  organizationId: string
): LikertFingerprint {
  return {
    dimensions: LIKERT_DIMENSIONS.map((d) => dimensionScore(ratings, d.key, d.label, organizationId)),
    emotions: emotionShares(emotions, organizationId),
  };
}

/** Render gate: true when at least one dimension or one emotion cleared its
 *  floor. Below that, the panel must render nothing rather than an empty shell. */
export function hasAnyLikertSignal(fp: LikertFingerprint): boolean {
  return fp.dimensions.some((d) => !d.metric.suppressed) || fp.emotions.some((e) => !e.metric.suppressed);
}
