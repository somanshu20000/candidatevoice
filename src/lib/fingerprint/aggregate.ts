/**
 * Organizational Fingerprint aggregation.
 *
 * Pure functions only — no I/O, no clock, no Supabase. Callers pass in the
 * observations and a reference month. This mirrors the discipline in
 * src/utils/hqs.ts and makes every threshold in here directly testable.
 *
 * DESIGN CONSTRAINTS THIS FILE HONOURS
 *
 * 1. Confidence is derived on read, never stored.
 *    docs/adr-0001-evidence-model.md §7 trap #1: storing it "builds an update
 *    pipeline you don't need". At this scale the computation is trivial and
 *    cannot go stale.
 *
 * 2. Confidence rewards corroboration, not volume alone.
 *    ADR §3: "Confidence rewards corroboration, not popularity or activity.
 *    No AI, no Bayesian inference, no scoring model." Reports spread across
 *    several months corroborate; twenty reports in one week may be a single
 *    coordinated push, so month spread — not raw count — is what promotes a
 *    dimension to `corroborated`.
 *
 * 3. Sparse evidence produces no number at all.
 *    A score computed from three ratings is not a weak score, it is not a
 *    score. Below the threshold the aggregate reports `insufficient` and the UI
 *    is expected to say so rather than render a precise-looking figure.
 *
 * 4. Absence of a source is not a bad result.
 *    Leadership and Work Culture have no candidate-collectable evidence, so
 *    they report `awaiting_source` — never 0.
 */

import {
  DIMENSIONS,
  facetsForDimension,
  EMOTIONS,
  type Dimension,
  type DimensionKey,
  type EmotionKey,
  type Facet,
  type FacetKey,
} from "./taxonomy";

// --- Thresholds ----------------------------------------------------------
// Every one of these is a product judgement, not a statistical law. They are
// named and exported so the UI can explain them to a reader and tests can
// assert against them rather than against magic numbers.

/**
 * Distinct submissions a dimension needs before any score is shown.
 * Matches the existing `metrics.total >= 5` suppression already applied to HQS
 * on the company page, so the two surfaces stay consistent.
 */
export const MIN_SUBMISSIONS_FOR_SCORE = 5;

/** Ratings a single facet needs before it contributes to its dimension's score. */
export const MIN_OBSERVATIONS_PER_FACET = 3;

/** Distinct calendar months required to call evidence corroborated (ADR §3). */
export const CORROBORATION_MIN_MONTHS = 2;

/** Width of each trend comparison window, in months. */
export const TREND_WINDOW_MONTHS = 3;

/** Distinct submissions required in BOTH windows before a trend is reported. */
export const TREND_MIN_PER_WINDOW = 5;

/** Score movement (0-100 points) below which a change is reported as stable rather than directional. */
export const TREND_SIGNIFICANCE_POINTS = 5;

// --- Types ---------------------------------------------------------------

export type Confidence = "insufficient" | "single" | "corroborated";

export type DimensionStatus = "scored" | "insufficient" | "awaiting_source";

export type TrendDirection = "improving" | "declining" | "stable";

/** One rating of one facet by one submission. `reportedMonth` is "YYYY-MM" — never a precise timestamp. */
export interface RatingObservation {
  submissionId: string;
  facetKey: FacetKey;
  rating: number;
  reportedMonth: string;
}

/** One emotion selected by one submission. */
export interface EmotionObservation {
  submissionId: string;
  emotionKey: EmotionKey;
  reportedMonth: string;
}

export interface FacetAggregate {
  facetKey: FacetKey;
  label: string;
  /** Mean on the original 1-5 scale, or null when below threshold. */
  mean: number | null;
  /** Mean normalized to 0-100, or null when below threshold. */
  score: number | null;
  observationCount: number;
  /** Count of each rating 1..5, index 0 = rating 1. Always present — this is the evidence behind the number. */
  distribution: [number, number, number, number, number];
  contributesToDimension: boolean;
}

export interface EmotionShare {
  emotionKey: EmotionKey;
  label: string;
  valence: "positive" | "negative";
  count: number;
  /** Proportion of submissions selecting this emotion, 0-1. Emotions are multi-select, so these do not sum to 1. */
  share: number;
}

export interface EmotionAggregate {
  submissionCount: number;
  emotions: EmotionShare[];
  /** Proportion of submissions selecting at least one positive emotion, 0-1. */
  positiveShare: number;
  /** Proportion selecting at least one negative emotion, 0-1. */
  negativeShare: number;
}

export interface Trend {
  direction: TrendDirection;
  /** Change in score, in 0-100 points. Positive means improvement. */
  deltaPoints: number;
  recentScore: number;
  priorScore: number;
  recentSubmissions: number;
  priorSubmissions: number;
}

export interface DimensionAggregate {
  dimensionKey: DimensionKey;
  label: string;
  description: string;
  status: DimensionStatus;
  /** 0-100, or null unless status === "scored". */
  score: number | null;
  confidence: Confidence;
  /** Distinct submissions contributing any evidence to this dimension. */
  submissionCount: number;
  /** Total individual ratings across all facets — the "extracted observations" count. */
  observationCount: number;
  distinctMonths: number;
  facets: FacetAggregate[];
  /** Present only for the emotion-measured dimension. */
  emotions: EmotionAggregate | null;
  /** Null when either comparison window lacks enough evidence. */
  trend: Trend | null;
}

export interface Fingerprint {
  dimensions: DimensionAggregate[];
  /** Distinct submissions contributing any fingerprint evidence at all. */
  totalSubmissions: number;
  totalObservations: number;
  distinctMonths: number;
  confidence: Confidence;
  /** Most recent month with any evidence, "YYYY-MM", or null. */
  latestMonth: string | null;
}

// --- Month helpers -------------------------------------------------------
// Months are handled as "YYYY-MM" strings and converted to a comparable
// integer index. Deliberately no Date arithmetic: these values are already
// coarsened at the SQL boundary and reintroducing Date would risk timezone
// shifts moving a report between months.

/** "2026-07" -> 24318. Returns NaN for malformed input. */
export function monthIndex(reportedMonth: string): number {
  const match = /^(\d{4})-(\d{2})$/.exec(reportedMonth);
  if (!match) return Number.NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return Number.NaN;
  return year * 12 + (month - 1);
}

function isValidMonth(reportedMonth: string): boolean {
  return !Number.isNaN(monthIndex(reportedMonth));
}

/** Convert 0-100 back from a 1-5 mean. 1 -> 0, 3 -> 50, 5 -> 100. */
export function ratingMeanToScore(mean: number): number {
  return Math.round(((mean - 1) / 4) * 100);
}

/**
 * Confidence for a body of evidence.
 *
 * Below MIN_SUBMISSIONS_FOR_SCORE nothing is publishable. Above it, spread
 * across calendar months is what separates corroborated from single-source:
 * a burst of reports in one month is not independent corroboration.
 *
 * Note the deliberate ceiling. There is no "verified" level here. With true
 * anonymity we cannot prove two reports came from different people, so the ADR
 * requires the language "corroborated by N reports", never "independently
 * verified". A `verified` tier needs stored moderator state and is out of scope.
 */
export function deriveConfidence(
  submissionCount: number,
  distinctMonths: number
): Confidence {
  if (submissionCount < MIN_SUBMISSIONS_FOR_SCORE) return "insufficient";
  if (distinctMonths >= CORROBORATION_MIN_MONTHS) return "corroborated";
  return "single";
}

// --- Facet aggregation ---------------------------------------------------

function aggregateFacet(
  facet: Facet,
  observations: RatingObservation[]
): FacetAggregate {
  const distribution: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let sum = 0;
  let count = 0;

  for (const obs of observations) {
    if (obs.rating < 1 || obs.rating > 5 || !Number.isInteger(obs.rating)) continue;
    distribution[obs.rating - 1] += 1;
    sum += obs.rating;
    count += 1;
  }

  const contributes = count >= MIN_OBSERVATIONS_PER_FACET;
  const mean = count > 0 ? sum / count : null;

  return {
    facetKey: facet.key,
    label: facet.label,
    mean: contributes && mean !== null ? Number(mean.toFixed(2)) : null,
    score: contributes && mean !== null ? ratingMeanToScore(mean) : null,
    observationCount: count,
    distribution,
    contributesToDimension: contributes,
  };
}

// --- Emotion aggregation -------------------------------------------------

export function aggregateEmotions(
  observations: EmotionObservation[]
): EmotionAggregate {
  const submissions = new Set(observations.map((o) => o.submissionId));
  const submissionCount = submissions.size;

  // Count distinct submissions per emotion, not raw rows — a malformed double
  // insert of the same (submission, emotion) must not inflate a share.
  const perEmotion = new Map<EmotionKey, Set<string>>();
  const positiveSubmissions = new Set<string>();
  const negativeSubmissions = new Set<string>();

  for (const obs of observations) {
    const emotion = EMOTIONS.find((e) => e.key === obs.emotionKey);
    if (!emotion) continue;

    let bucket = perEmotion.get(obs.emotionKey);
    if (!bucket) {
      bucket = new Set<string>();
      perEmotion.set(obs.emotionKey, bucket);
    }
    bucket.add(obs.submissionId);

    if (emotion.valence === "positive") positiveSubmissions.add(obs.submissionId);
    else negativeSubmissions.add(obs.submissionId);
  }

  const emotions: EmotionShare[] = EMOTIONS.map((emotion) => {
    const count = perEmotion.get(emotion.key)?.size ?? 0;
    return {
      emotionKey: emotion.key,
      label: emotion.label,
      valence: emotion.valence,
      count,
      share: submissionCount > 0 ? count / submissionCount : 0,
    };
  }).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    submissionCount,
    emotions,
    positiveShare:
      submissionCount > 0 ? positiveSubmissions.size / submissionCount : 0,
    negativeShare:
      submissionCount > 0 ? negativeSubmissions.size / submissionCount : 0,
  };
}

// --- Trend ---------------------------------------------------------------

function scoreForObservations(observations: RatingObservation[]): number | null {
  const valid = observations.filter(
    (o) => Number.isInteger(o.rating) && o.rating >= 1 && o.rating <= 5
  );
  if (valid.length === 0) return null;
  const mean = valid.reduce((acc, o) => acc + o.rating, 0) / valid.length;
  return ratingMeanToScore(mean);
}

/**
 * Compare the most recent TREND_WINDOW_MONTHS against the window immediately
 * before it.
 *
 * Returns null unless BOTH windows independently clear TREND_MIN_PER_WINDOW
 * distinct submissions. A "trend" drawn from two reports against one is noise
 * presented as a direction, which is exactly the false precision this product
 * exists to avoid.
 *
 * @param referenceMonth "YYYY-MM" anchor for the recent window — pass the
 *        current month. Injected rather than read from a clock so the function
 *        stays pure and testable.
 */
export function computeTrend(
  observations: RatingObservation[],
  referenceMonth: string
): Trend | null {
  const refIndex = monthIndex(referenceMonth);
  if (Number.isNaN(refIndex)) return null;

  const recentStart = refIndex - (TREND_WINDOW_MONTHS - 1);
  const priorEnd = recentStart - 1;
  const priorStart = priorEnd - (TREND_WINDOW_MONTHS - 1);

  const recent: RatingObservation[] = [];
  const prior: RatingObservation[] = [];

  for (const obs of observations) {
    const index = monthIndex(obs.reportedMonth);
    if (Number.isNaN(index)) continue;
    if (index >= recentStart && index <= refIndex) recent.push(obs);
    else if (index >= priorStart && index <= priorEnd) prior.push(obs);
  }

  const recentSubmissions = new Set(recent.map((o) => o.submissionId)).size;
  const priorSubmissions = new Set(prior.map((o) => o.submissionId)).size;

  if (
    recentSubmissions < TREND_MIN_PER_WINDOW ||
    priorSubmissions < TREND_MIN_PER_WINDOW
  ) {
    return null;
  }

  const recentScore = scoreForObservations(recent);
  const priorScore = scoreForObservations(prior);
  if (recentScore === null || priorScore === null) return null;

  const deltaPoints = recentScore - priorScore;
  const direction: TrendDirection =
    deltaPoints >= TREND_SIGNIFICANCE_POINTS
      ? "improving"
      : deltaPoints <= -TREND_SIGNIFICANCE_POINTS
        ? "declining"
        : "stable";

  return {
    direction,
    deltaPoints,
    recentScore,
    priorScore,
    recentSubmissions,
    priorSubmissions,
  };
}

// --- Dimension aggregation -----------------------------------------------

export interface AggregateInput {
  ratings: RatingObservation[];
  emotions: EmotionObservation[];
  /** "YYYY-MM" anchor for trend windows. */
  referenceMonth: string;
}

export function aggregateDimension(
  dimension: Dimension,
  input: AggregateInput
): DimensionAggregate {
  const facets = facetsForDimension(dimension.key);
  const facetKeys = new Set<FacetKey>(facets.map((f) => f.key));

  const dimensionRatings = input.ratings.filter((r) => facetKeys.has(r.facetKey));
  const isEmotionDimension = dimension.measurement === "emotion";

  const relevantSubmissionIds = new Set<string>(
    isEmotionDimension
      ? input.emotions.map((e) => e.submissionId)
      : dimensionRatings.map((r) => r.submissionId)
  );
  const months = new Set<string>(
    (isEmotionDimension
      ? input.emotions.map((e) => e.reportedMonth)
      : dimensionRatings.map((r) => r.reportedMonth)
    ).filter(isValidMonth)
  );

  const submissionCount = relevantSubmissionIds.size;
  const distinctMonths = months.size;

  const facetAggregates = facets.map((facet) =>
    aggregateFacet(
      facet,
      dimensionRatings.filter((r) => r.facetKey === facet.key)
    )
  );

  const observationCount = isEmotionDimension
    ? input.emotions.length
    : facetAggregates.reduce((acc, f) => acc + f.observationCount, 0);

  const base = {
    dimensionKey: dimension.key,
    label: dimension.label,
    description: dimension.description,
    submissionCount,
    observationCount,
    distinctMonths,
    facets: facetAggregates,
  };

  // No enabled evidence source. Explicitly not a score of zero.
  if (dimension.sourceType === "employee") {
    return {
      ...base,
      status: "awaiting_source",
      score: null,
      confidence: "insufficient",
      emotions: null,
      trend: null,
    };
  }

  const confidence = deriveConfidence(submissionCount, distinctMonths);

  if (confidence === "insufficient") {
    return {
      ...base,
      status: "insufficient",
      score: null,
      confidence,
      emotions: isEmotionDimension ? aggregateEmotions(input.emotions) : null,
      trend: null,
    };
  }

  if (isEmotionDimension) {
    // An emotion distribution has no single "score" — collapsing ten distinct
    // feelings into one number would discard exactly the information the
    // dimension exists to carry. It reports its distribution instead.
    return {
      ...base,
      status: "scored",
      score: null,
      confidence,
      emotions: aggregateEmotions(input.emotions),
      trend: null,
    };
  }

  // Dimension score is the unweighted mean of qualifying facet scores.
  //
  // Unweighted, rather than pooling every rating, so that a facet answered by
  // everyone (respect) does not drown out one answered by few (offer conduct,
  // which only candidates who reached an offer can speak to). Facets below
  // MIN_OBSERVATIONS_PER_FACET are excluded rather than counted as zero.
  const contributing = facetAggregates.filter(
    (f) => f.contributesToDimension && f.score !== null
  );

  if (contributing.length === 0) {
    return {
      ...base,
      status: "insufficient",
      score: null,
      confidence: "insufficient",
      emotions: null,
      trend: null,
    };
  }

  const score = Math.round(
    contributing.reduce((acc, f) => acc + (f.score as number), 0) /
      contributing.length
  );

  return {
    ...base,
    status: "scored",
    score,
    confidence,
    emotions: null,
    trend: computeTrend(dimensionRatings, input.referenceMonth),
  };
}

/** Build the full six-node fingerprint. */
export function buildFingerprint(input: AggregateInput): Fingerprint {
  const dimensions = [...DIMENSIONS]
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .map((dimension) => aggregateDimension(dimension, input));

  const allSubmissions = new Set<string>([
    ...input.ratings.map((r) => r.submissionId),
    ...input.emotions.map((e) => e.submissionId),
  ]);
  const allMonths = new Set<string>(
    [
      ...input.ratings.map((r) => r.reportedMonth),
      ...input.emotions.map((e) => e.reportedMonth),
    ].filter(isValidMonth)
  );

  const latestMonth =
    allMonths.size > 0
      ? [...allMonths].sort((a, b) => monthIndex(b) - monthIndex(a))[0]
      : null;

  return {
    dimensions,
    totalSubmissions: allSubmissions.size,
    totalObservations: input.ratings.length + input.emotions.length,
    distinctMonths: allMonths.size,
    confidence: deriveConfidence(allSubmissions.size, allMonths.size),
    latestMonth,
  };
}
