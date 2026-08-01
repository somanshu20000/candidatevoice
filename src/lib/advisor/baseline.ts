/**
 * Market baseline — the cross-company average of each behavioural dimension.
 *
 * The compromise matrix needs a "market" column: is this company's ghosting
 * better or worse than companies in general? That reference is computed here,
 * from the same fingerprints every company page already builds — no new metric,
 * no new query shape. Pure.
 *
 * A dimension's baseline only counts companies whose score for that dimension
 * is non-suppressed: averaging in a company we couldn't score would be
 * fabricating a data point. A dimension no company has enough evidence for has
 * a `null` baseline, and the compromise matrix says "no market data" rather
 * than inventing one.
 */

import type { BehaviouralFingerprint, BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";
import { BEHAVIOURAL_DIMENSION_KEYS } from "@/lib/fingerprint/behavioural";

export interface DimensionBaseline {
  /** Mean 0-100 score across companies with a non-suppressed score, or null. */
  mean: number | null;
  /** How many companies contributed — the baseline's own sample size. */
  companies: number;
}

export type MarketBaseline = Record<BehaviouralDimensionKey, DimensionBaseline>;

/**
 * Minimum contributing companies before a dimension's market mean is trusted.
 * One company is not a market; showing "market: 82" from a single data point
 * would imply a distribution that does not exist.
 */
export const BASELINE_MIN_COMPANIES = 3;

/**
 * Build the market baseline from a set of company fingerprints (e.g. every
 * company with any evidence). Unweighted mean of company dimension scores —
 * each company counts once regardless of its report volume, so a single
 * heavily-reported company cannot define "the market."
 */
export function marketBaseline(fingerprints: BehaviouralFingerprint[]): MarketBaseline {
  const result = {} as MarketBaseline;

  for (const key of BEHAVIOURAL_DIMENSION_KEYS) {
    const scores: number[] = [];
    for (const fp of fingerprints) {
      const dim = fp.dimensions.find((d) => d.key === key);
      if (dim && !dim.suppressed && dim.score !== null) scores.push(dim.score);
    }
    const enough = scores.length >= BASELINE_MIN_COMPANIES;
    result[key] = {
      mean: enough ? scores.reduce((s, v) => s + v, 0) / scores.length : null,
      companies: scores.length,
    };
  }

  return result;
}
