/**
 * The Candidate Fit engine — how well a company's *behaviour* matches a
 * candidate's *priorities*. Pure, no I/O.
 *
 * It is the same reduction as computeHqs (src/utils/hqs.ts): take the company's
 * behavioural dimension scores, weight them, renormalise over the ones that
 * actually have evidence, and suppress the headline when the company is too
 * thinly evidenced to assess. The ONLY difference from HQS is where the weights
 * come from — the user's preference vector instead of the fixed HQS_WEIGHTS.
 * That is the whole point: HQS is "how good is this process," fit is "how good
 * is this process *for you*."
 *
 * Because it consumes the fingerprint's dimension scores — which already satisfy
 * the sunset invariant (at multiplier 0 they equal their first-party-only
 * value) — fit inherits that invariant for free.
 */

import type { BehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { PREFERENCE_DIMENSION_KEYS, PREFERENCE_DIMENSION_LABELS, PREFERENCE_TO_EVIDENCE } from "./preferences";
import type { FitContribution, FitResult, FitTier, PreferenceVector } from "./types";

/**
 * Company-level evidence floor for a fit score to render, mirroring
 * HQS_MIN_EFFECTIVE_N. Fit is a composite headline like HQS and needs more
 * support than any single dimension (whose own floor is 3).
 */
export const FIT_MIN_EFFECTIVE_N = 5;

/** A preference at or above this weight (of 5) is "high priority" — used to pick strengths/risks. */
export const HIGH_PRIORITY_WEIGHT = 4;

/** A scored dimension at/above this company score is a strength; below LOW is a risk. */
export const STRENGTH_SCORE = 70;
export const RISK_SCORE = 50;

/** Fit tier thresholds on the 0-100 score. Product judgements, exported for tests/UI. */
export const FIT_TIER_THRESHOLDS = { best: 75, good: 55, stretch: 35 } as const;

export function fitTier(score: number): FitTier {
  if (score >= FIT_TIER_THRESHOLDS.best) return "best";
  if (score >= FIT_TIER_THRESHOLDS.good) return "good";
  if (score >= FIT_TIER_THRESHOLDS.stretch) return "stretch";
  return "avoid";
}

/** Clamp a user-supplied weight into 1-5; anything outside is coerced to the nearest valid value. */
function normalizeWeight(raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  if (rounded < 1) return null; // 0 or negative = "did not rate this"
  return Math.min(rounded, 5);
}

/**
 * Compute the fit of one company for one preference vector.
 *
 * Every dimension the user weighted appears in `contributions` with an honest
 * status, so the UI can say what it could and couldn't assess. Only `scored`
 * dimensions feed the headline; it is renormalised over them so a preference
 * this company can't be assessed on neither helps nor hurts the score.
 */
export function computeFit(vector: PreferenceVector, fingerprint: BehaviouralFingerprint): FitResult {
  const dimByKey = new Map(fingerprint.dimensions.map((d) => [d.key, d]));
  const contributions: FitContribution[] = [];

  for (const key of PREFERENCE_DIMENSION_KEYS) {
    const weight = normalizeWeight(vector[key]);
    if (weight === null) continue; // user did not prioritise this dimension

    const evidenceKey = PREFERENCE_TO_EVIDENCE[key];
    const base = { key, label: PREFERENCE_DIMENSION_LABELS[key], preferenceWeight: weight };

    if (evidenceKey === null) {
      // Family B — nothing measures this yet. Collected, never scored.
      contributions.push({ ...base, status: "not_measured", companyScore: null, normalizedWeight: null, base: null });
      continue;
    }
    const dim = dimByKey.get(evidenceKey);
    if (!dim || dim.suppressed || dim.score === null) {
      contributions.push({ ...base, status: "company_insufficient", companyScore: null, normalizedWeight: null, base: null });
      continue;
    }
    contributions.push({
      ...base,
      status: "scored",
      companyScore: dim.score,
      normalizedWeight: null, // filled once the total is known
      base: dim.base,
    });
  }

  const scored = contributions.filter((c) => c.status === "scored");

  // Suppress the headline honestly, never a 0.
  if (scored.length === 0) {
    return { score: null, tier: null, contributions, strengths: [], risks: [], base: fingerprint.base, suppressionReason: "no_weighted_dimensions" };
  }
  if (fingerprint.base.effectiveN < FIT_MIN_EFFECTIVE_N) {
    return { score: null, tier: null, contributions, strengths: [], risks: [], base: fingerprint.base, suppressionReason: "insufficient_evidence" };
  }

  const totalWeight = scored.reduce((s, c) => s + c.preferenceWeight, 0);
  let weightedSum = 0;
  for (const c of scored) {
    c.normalizedWeight = c.preferenceWeight / totalWeight;
    weightedSum += (c.companyScore as number) * c.normalizedWeight;
  }
  const score = Math.round(weightedSum);

  // Strengths / risks: only among high-priority, scored dimensions.
  const strengths = scored
    .filter((c) => c.preferenceWeight >= HIGH_PRIORITY_WEIGHT && (c.companyScore as number) >= STRENGTH_SCORE)
    .map((c) => c.key);
  const risks = scored
    .filter((c) => c.preferenceWeight >= HIGH_PRIORITY_WEIGHT && (c.companyScore as number) < RISK_SCORE)
    .map((c) => c.key);

  return { score, tier: fitTier(score), contributions, strengths, risks, base: fingerprint.base, suppressionReason: null };
}
