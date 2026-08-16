/**
 * V3.1 — internal evidence-readiness metric.
 *
 * Measures progress toward the documented "is the product genuinely useful
 * yet" target, defined entirely by the engine's OWN floors — no new statistic,
 * no new aggregation path (D-001). It is a pure reduction over the same
 * `AnalyticsResult` the /analytics page already builds via
 * `loadCompanyAnalytics`, reading each company's `base.effectiveN`.
 *
 * THE TARGET (from the roadmap / D-025):
 *   - THRESHOLD ("the mechanism is proven"): at least ONE company whose
 *     effectiveN clears the HQS floor (HQS_MIN_EFFECTIVE_N) — i.e. at least one
 *     company where HQS actually renders.
 *   - TARGET ("genuinely useful"): at least THREE companies at the HQS floor,
 *     AND at least one of them at a stronger anchor (effectiveN ≥ 8) so search
 *     ranking and the forecast have a real anchor, not just a bare pass.
 *
 * INTERNAL ONLY. Surfaced through an admin-gated route — it is an operations
 * metric ("how close are we"), never a public product surface, and it exposes
 * only aggregate counts, nothing a company page doesn't already show.
 */

import { HQS_MIN_EFFECTIVE_N } from "@/utils/hqs";
import type { AnalyticsResult } from "./analytics";

/** The stronger per-company anchor for the "genuinely useful" target — a
 *  company at this effectiveN gives search/forecast a real anchor rather than a
 *  bare floor pass. Named here (not imported) because it is a readiness-target
 *  choice, not an engine floor. */
export const READINESS_ANCHOR_EFFECTIVE_N = 8;

/** How many companies must clear the HQS floor for the product to be "useful". */
export const READINESS_TARGET_COMPANY_COUNT = 3;

export interface EvidenceReadiness {
  /** Companies that have ANY evidence (ranked + unranked). */
  companiesWithEvidence: number;
  /** Companies whose effectiveN clears the HQS floor (HQS renders). */
  companiesAtHqsFloor: number;
  /** Companies whose effectiveN clears the stronger anchor (≥ 8). */
  companiesAtAnchor: number;
  /** The HQS floor in force (echoed so a caller renders the real number). */
  hqsFloor: number;
  /** The anchor threshold in force. */
  anchor: number;
  /** ≥ 1 company at the HQS floor — the mechanism is proven. */
  metThreshold: boolean;
  /** ≥ 3 companies at the HQS floor AND ≥ 1 at the anchor — genuinely useful. */
  metTarget: boolean;
}

/**
 * Reduce an AnalyticsResult to the readiness counts. Pure: no I/O, no clock.
 * Counts across BOTH ranked and unranked companies (unranked still have
 * evidence, just below the HQS floor) so `companiesWithEvidence` is honest.
 */
export function evidenceReadiness(result: AnalyticsResult): EvidenceReadiness {
  const all = [...result.ranked, ...result.unranked];
  const companiesWithEvidence = all.length;
  const companiesAtHqsFloor = all.filter((c) => c.base.effectiveN >= HQS_MIN_EFFECTIVE_N).length;
  const companiesAtAnchor = all.filter((c) => c.base.effectiveN >= READINESS_ANCHOR_EFFECTIVE_N).length;

  const metThreshold = companiesAtHqsFloor >= 1;
  const metTarget = companiesAtHqsFloor >= READINESS_TARGET_COMPANY_COUNT && companiesAtAnchor >= 1;

  return {
    companiesWithEvidence,
    companiesAtHqsFloor,
    companiesAtAnchor,
    hqsFloor: HQS_MIN_EFFECTIVE_N,
    anchor: READINESS_ANCHOR_EFFECTIVE_N,
    metThreshold,
    metTarget,
  };
}
