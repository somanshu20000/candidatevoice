/**
 * Compensation Transparency & Privacy — dimensions + the Privacy Score.
 *
 * THE PROBLEM THIS MEASURES
 * Salary negotiation is an information-asymmetry problem: the employer knows
 * the band, the candidate knows only their own history. Asking for salary
 * history anchors the offer to the candidate's past rather than the role's
 * value; asking for payslips or bank statements before an offer exists turns
 * that anchor into a demand for financial records. This module makes those
 * practices measurable from what candidates actually reported experiencing.
 *
 * SAME MACHINERY AS EVERYTHING ELSE. These are ordinary weightedRate metrics
 * over the Evidence Engine, exactly like ghosting or payment_risk. The Privacy
 * Score is a reduction over them in the same shape as computeHqs over the
 * behavioural fingerprint — a product-judgement weighting of REAL collected
 * facts, never invented data.
 *
 * ── THE THREE RULES THIS FILE EXISTS TO ENFORCE ────────────────────────────
 *
 * 1. NULL IS NOT "NO". An unanswered field means the report is not eligible
 *    for that metric. It must never count as good behaviour (inflating a
 *    score) or bad (manufacturing an accusation). Every `eligible` predicate
 *    below tests `!== null`, and `"never"`/`"none"` are ANSWERS that do count.
 *
 * 2. ABSENCE IS NOT REFUSAL. `salary_range_disclosed: "never"` means the
 *    candidate observed that no range was ever disclosed. It does NOT mean the
 *    company refused — the candidate may never have asked. Labels here say
 *    "no range disclosed", never "refused to disclose". We do not infer intent
 *    from silence.
 *
 * 3. NO CAUSAL CLAIMS. We deliberately do NOT model "reduced the offer after
 *    learning previous salary". A candidate can observe a sequence but not the
 *    counterfactual, and publishing an inferred cause attached to a named
 *    employer is the most defamation-shaped claim in this whole product. If it
 *    is ever collected, it must render as a reported sequence, never as cause.
 *
 * HIGHER CORROBORATION BAR. "Company X demands bank statements" is a sharper
 * accusation than "Company X is slow to respond", so the invasive-proof
 * dimension uses a stricter floor than the ordinary dimension gate — see
 * PRIVACY_INVASIVE_MIN_EFFECTIVE_N.
 */

import { weightedRate } from "@/lib/evidence";
import type { EvidenceItem, EvidenceBase, MetricResult } from "@/lib/evidence";
import { describeBase } from "@/lib/evidence";

/** Ordinary floor, matching the behavioural fingerprint's per-dimension gate. */
export const PRIVACY_MIN_EFFECTIVE_N = 3;
/**
 * Stricter floor for the invasive-document-request dimension. A claim that a
 * named company demands bank statements or tax documents carries a materially
 * higher reputational cost than a slow-response claim, so it needs more
 * corroboration before it renders at all.
 */
export const PRIVACY_INVASIVE_MIN_EFFECTIVE_N = 5;
/** Headline floor for the composite, matching HQS's own gate. */
export const PRIVACY_SCORE_MIN_EFFECTIVE_N = 5;

export type CompensationDimensionKey =
  | "salary_history_privacy"
  | "document_privacy"
  | "range_transparency"
  | "verification_timing";

export const COMPENSATION_DIMENSION_LABELS: Record<CompensationDimensionKey, string> = {
  salary_history_privacy: "Salary history privacy",
  document_privacy: "Financial document privacy",
  range_transparency: "Pay range transparency",
  verification_timing: "Verification timing",
};

/**
 * Composite weights. A product judgement over real collected facts — the same
 * class of decision as HQS_WEIGHTS, not invented data. Weighted toward the two
 * dimensions a candidate has least power over: whether their history is
 * demanded at all, and whether financial documents are required.
 */
export const PRIVACY_SCORE_WEIGHTS: Record<CompensationDimensionKey, number> = {
  salary_history_privacy: 0.3,
  document_privacy: 0.3,
  range_transparency: 0.25,
  verification_timing: 0.15,
};

export interface CompensationDimensionScore {
  key: CompensationDimensionKey;
  label: string;
  /** 0..100, higher = more privacy-respecting. Null when suppressed. */
  score: number | null;
  metric: MetricResult;
  base: EvidenceBase;
  suppressed: boolean;
  suppressionReason: "no_coverage" | "insufficient_evidence" | null;
}

export interface CompensationProfile {
  dimensions: CompensationDimensionScore[];
  base: EvidenceBase;
}

interface DimensionSpec {
  key: CompensationDimensionKey;
  /** Rule 1: only reports that ANSWERED this question are eligible. */
  eligible: (i: EvidenceItem) => boolean;
  /** The privacy-RESPECTING case. Score is 100 × rate of this. */
  respectsPrivacy: (i: EvidenceItem) => boolean;
  minEffectiveN: number;
}

const SPECS: DimensionSpec[] = [
  {
    // Never asked at all is the privacy-respecting case. Asking at offer stage
    // is materially better than at application, but this dimension answers the
    // binary "is history demanded?"; the STAGE detail surfaces as a red flag.
    key: "salary_history_privacy",
    eligible: (i) => i.salaryHistoryStage !== null,
    respectsPrivacy: (i) => i.salaryHistoryStage === "never",
    minEffectiveN: PRIVACY_MIN_EFFECTIVE_N,
  },
  {
    // No document, or a payslip only, versus bank statements / tax documents —
    // the latter are requests for the candidate's wider financial records.
    key: "document_privacy",
    eligible: (i) => i.salaryProofType !== null,
    respectsPrivacy: (i) => i.salaryProofType === "none" || i.salaryProofType === "payslip",
    minEffectiveN: PRIVACY_INVASIVE_MIN_EFFECTIVE_N,
  },
  {
    // Disclosing the range before the candidate invests interview time is the
    // transparent case. "never" is an observation, not an accusation (Rule 2).
    key: "range_transparency",
    eligible: (i) => i.salaryRangeDisclosed !== null,
    respectsPrivacy: (i) =>
      i.salaryRangeDisclosed === "in_posting" || i.salaryRangeDisclosed === "before_first",
    minEffectiveN: PRIVACY_MIN_EFFECTIVE_N,
  },
  {
    // Verifying salary AFTER a written offer (for payroll) is ordinary. Demanding
    // it before any offer exists is the coercive pattern candidates report.
    key: "verification_timing",
    eligible: (i) => i.salaryProofStage !== null,
    respectsPrivacy: (i) => i.salaryProofStage === "none" || i.salaryProofStage === "after_offer",
    minEffectiveN: PRIVACY_MIN_EFFECTIVE_N,
  },
];

function evaluate(items: EvidenceItem[], spec: DimensionSpec): CompensationDimensionScore {
  const metric = weightedRate(items, {
    eligible: spec.eligible,
    hit: spec.respectsPrivacy,
    minEffectiveN: spec.minEffectiveN,
  });
  const suppressed = metric.suppressed;
  return {
    key: spec.key,
    label: COMPENSATION_DIMENSION_LABELS[spec.key],
    score: suppressed || metric.value === null ? null : 100 * metric.value,
    metric,
    base: describeBase(items.filter(spec.eligible)),
    suppressed,
    suppressionReason: suppressed ? (metric.suppressionReason ?? "no_coverage") : null,
  };
}

/** All four dimensions, always returned in fixed order (suppressed ones included). */
export function buildCompensationProfile(items: EvidenceItem[]): CompensationProfile {
  return {
    dimensions: SPECS.map((spec) => evaluate(items, spec)),
    base: describeBase(items),
  };
}

export type PrivacyTier = "strong" | "mixed" | "poor";

export interface PrivacyScoreResult {
  /** 0..100, higher = more privacy-respecting. */
  score: number;
  tier: PrivacyTier;
  /** Which dimensions actually contributed, with post-renormalisation weights. */
  contributions: { key: CompensationDimensionKey; score: number; weight: number }[];
  effectiveN: number;
}

export function privacyTier(score: number): PrivacyTier {
  if (score >= 70) return "strong";
  if (score >= 40) return "mixed";
  return "poor";
}

/**
 * The composite. Mirrors computeHqs exactly: re-normalise over the dimensions
 * that actually rendered so a suppressed one never drags the score toward
 * zero, and return NULL rather than a fabricated number when the evidence
 * cannot support a headline. Never returns 0 as a stand-in for "unknown".
 */
export function computePrivacyScore(profile: CompensationProfile): PrivacyScoreResult | null {
  if (profile.base.effectiveN < PRIVACY_SCORE_MIN_EFFECTIVE_N) return null;

  const contributions: { key: CompensationDimensionKey; score: number; weight: number }[] = [];
  let totalWeight = 0;
  for (const d of profile.dimensions) {
    if (d.suppressed || d.score === null) continue;
    const w = PRIVACY_SCORE_WEIGHTS[d.key];
    contributions.push({ key: d.key, score: d.score, weight: w });
    totalWeight += w;
  }
  if (contributions.length === 0 || totalWeight === 0) return null;

  for (const c of contributions) c.weight = c.weight / totalWeight;
  const score = Math.round(contributions.reduce((s, c) => s + c.score * c.weight, 0));

  return { score, tier: privacyTier(score), contributions, effectiveN: profile.base.effectiveN };
}
