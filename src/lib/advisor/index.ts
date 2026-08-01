/**
 * Candidate Intelligence — the advisor's single entry surface. Everything a
 * consumer (API route, company page, /advisor page) needs is re-exported here;
 * no consumer should import the sub-modules directly.
 */

export type {
  PreferenceDimensionKey,
  PreferenceVector,
  FitTier,
  FitDimensionStatus,
  FitContribution,
  FitResult,
} from "./types";

export {
  PREFERENCE_TO_EVIDENCE,
  PREFERENCE_DIMENSION_KEYS,
  PREFERENCE_DIMENSION_LABELS,
  PREFERENCE_DIMENSION_HELP,
  EVIDENCE_BACKED_PREFERENCES,
  isPreferenceDimension,
  isEvidenceBacked,
} from "./preferences";

export {
  computeFit,
  fitTier,
  FIT_MIN_EFFECTIVE_N,
  HIGH_PRIORITY_WEIGHT,
  STRENGTH_SCORE,
  RISK_SCORE,
  FIT_TIER_THRESHOLDS,
} from "./fit";

export {
  marketBaseline,
  BASELINE_MIN_COMPANIES,
} from "./baseline";
export type { MarketBaseline, DimensionBaseline } from "./baseline";

export {
  buildCompromiseMatrix,
  bandFor,
  BAND_THRESHOLDS,
  MARKET_MARGIN,
} from "./compromise";
export type { CompromiseRow, CompromiseMatrix, Band, VsMarket } from "./compromise";

export { rankByFit, groupByTier } from "./recommend";
export type { RankCandidateCompany, RankedCompany, Recommendations } from "./recommend";

export { explainFit, explainCompromise } from "./explain";
export type { Explanation } from "./explain";
