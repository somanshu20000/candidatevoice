/**
 * Hiring Quality Score — one headline number with an uncertainty interval.
 *
 * HQS is a REDUCTION of the behavioural fingerprint, not a parallel
 * computation: `computeHqs(fingerprint)` re-weights the same
 * BehaviouralDimensionScore[] the page already renders. Nothing here reaches
 * back into the Evidence Engine to reimplement a metric — that would be
 * exactly the drift the blueprint's Weakness W5 warned about ("estimator
 * used by the score" ≠ "estimator used by the trend").
 *
 * Uncertainty uses the Wilson score interval on the composite treated as a
 * proportion, substituting the Kish effective sample size for n
 * (ADR-0002 Part 4). The interval is an honesty gesture: 62 ±8 from 19
 * effective reports vs 62 ±3 from 200 tell the reader wildly different
 * stories about how much to trust the same point number.
 *
 * Early Rejection is DELIBERATELY absent from the composite (blueprint
 * self-critique #4): its only inputs, call_duration and
 * first_interaction_outcome, don't exist on external_reports, so it cannot
 * be a cross-family metric. Existing HQS values will shift as a result —
 * this is visible-by-design, not a silent regression.
 */

import type {
  BehaviouralFingerprint,
  BehaviouralDimensionKey,
} from "@/lib/fingerprint/behavioural";

/**
 * Composite weights — sum to 1 across dimensions that participate. Payment
 * Risk and Process Depth are DELIBERATELY zero in the composite: Payment
 * Risk is too sensitive to blend into a headline (Part 3), and Process Depth
 * encodes a value judgement (final=100, applied=20) that shouldn't dominate
 * one headline number. Both still render as their own dimension.
 */
export const HQS_WEIGHTS: Record<BehaviouralDimensionKey, number> = {
  ghosting: 0.35,
  response_speed: 0.30,
  transparency: 0.25,
  offer_probability: 0.10,
  process_depth: 0,
  payment_risk: 0,
};

/**
 * effectiveN floor below which the HQS is suppressed entirely. Above the
 * dimension floor (3) because HQS aggregates several dimensions and needs
 * more support than any one of them to render.
 */
export const HQS_MIN_EFFECTIVE_N = 5;

/** 95% z-score (two-sided) — the Wilson interval's confidence level. */
export const HQS_INTERVAL_Z = 1.959964;

export type HqsTier = "insufficient" | "low" | "medium" | "high";

/**
 * Confidence tier from effectiveN, replacing the raw-count 50/20 tiers the
 * old count-based path used. Same reading language ("high confidence"), but
 * anchored to the actual information content of the evidence, not its
 * headcount (ADR-0002 W3 consolidation).
 */
export function hqsTier(effectiveN: number): HqsTier {
  if (effectiveN < HQS_MIN_EFFECTIVE_N) return "insufficient";
  if (effectiveN < 20) return "low";
  if (effectiveN < 50) return "medium";
  return "high";
}

export interface HqsContribution {
  key: BehaviouralDimensionKey;
  score: number;
  /** The RE-NORMALIZED weight this dimension carried in the composite (sums to 1 across all contributions).
   *  Not the same as HQS_WEIGHTS[key] — a suppressed dimension's weight is redistributed
   *  proportionally over the survivors, so a missing term never drags the composite down. */
  weight: number;
}

export interface HqsResult {
  /** Rounded 0..100 point estimate — the number the headline renders. */
  score: number;
  /** Wilson interval, ALREADY scaled to the 0..100 axis so the caller
   *  renders "62 (54–70)" without re-multiplying. */
  interval: { lower: number; upper: number };
  effectiveN: number;
  tier: HqsTier;
  /** Which dimensions actually contributed to this score, with their post-normalization weights.
   *  A UI can render this to explain WHY the score is what it is. */
  contributions: HqsContribution[];
}

/**
 * Wilson score interval on a proportion p, sample size n, at the configured
 * z-level. Substituting effectiveN for n is the whole point (ADR-0002 Part 4).
 * Returns [0,1]-scaled bounds; caller multiplies by 100 for HQS's axis.
 */
export function wilsonInterval(p: number, n: number): { lower: number; upper: number } {
  if (n <= 0) return { lower: 0, upper: 1 };
  const z = HQS_INTERVAL_Z;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return {
    lower: Math.max(0, center - half),
    upper: Math.min(1, center + half),
  };
}

/**
 * Compute HQS from the fingerprint. Returns null when suppressed —
 * `null` is the honest "we can't say" answer; a caller that renders 0 in
 * its place is a bug.
 *
 * Suppression order:
 *   1. effectiveN < HQS_MIN_EFFECTIVE_N — the headline gate.
 *   2. Zero surviving contributions — every HQS-weighted dimension is
 *      suppressed for its own reasons (all their coverage failed at once).
 *
 * Both return null; the caller decides how to explain the empty state.
 */
export function computeHqs(fingerprint: BehaviouralFingerprint): HqsResult | null {
  const effectiveN = fingerprint.base.effectiveN;
  if (effectiveN < HQS_MIN_EFFECTIVE_N) return null;

  const contributions: HqsContribution[] = [];
  let totalWeight = 0;
  for (const d of fingerprint.dimensions) {
    const w = HQS_WEIGHTS[d.key] ?? 0;
    if (w === 0) continue;
    if (d.suppressed || d.score === null) continue;
    contributions.push({ key: d.key, score: d.score, weight: w });
    totalWeight += w;
  }
  if (contributions.length === 0 || totalWeight === 0) return null;

  // Re-normalize: a missing dimension redistributes its weight proportionally
  // over the survivors instead of dragging the composite toward zero.
  for (const c of contributions) c.weight = c.weight / totalWeight;
  const weightedSum = contributions.reduce((s, c) => s + c.score * c.weight, 0);
  const score = Math.round(weightedSum);

  const interval = wilsonInterval(score / 100, effectiveN);
  return {
    score,
    interval: { lower: interval.lower * 100, upper: interval.upper * 100 },
    effectiveN,
    tier: hqsTier(effectiveN),
    contributions,
  };
}
