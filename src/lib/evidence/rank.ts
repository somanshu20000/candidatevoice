/**
 * Search ranking (ADR-0002 Part 7).
 *
 *   rank = HQS_normalized × confidence_factor × freshness_factor
 *   confidence_factor = min(1, effectiveN / 20)
 *   freshness_factor  = exp(−ln2 × monthsSince(latestMonth) / 12)   (12-month half-life)
 *
 * The single most important property: a well-evidenced 60 outranks a thin 90.
 * A high HQS built on effectiveN just over the gate, or on year-old evidence,
 * is discounted relative to a lower score backed by lots of recent evidence.
 *
 * External evidence affects this ONLY through its weight (which already flows
 * into HQS and effectiveN via the engine). At globalMultiplier = 0 external
 * weight is 0, so ranking becomes first-party-only automatically — no branch.
 *
 * PURE and clock-free: `monthsSince` is computed against a caller-supplied
 * `referenceMonth`, never `new Date()`, so every ranking is reproducible in a
 * test (same discipline as fingerprint/aggregate.ts's referenceMonth).
 */

import type { CompanyAnalytics } from "./analytics";

/** effectiveN at which confidence saturates to 1. Below it, linearly discounted. */
export const CONFIDENCE_SATURATION_N = 20;

/** Freshness half-life in months: evidence this old counts for half. */
export const FRESHNESS_HALF_LIFE_MONTHS = 12;

function monthIndex(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number);
  return y * 12 + m;
}

function isMonth(value: string | null): value is string {
  return value !== null && /^\d{4}-\d{2}$/.test(value);
}

/** min(1, effectiveN / 20). A thin sample can never reach full confidence. */
export function confidenceFactor(effectiveN: number): number {
  if (effectiveN <= 0) return 0;
  return Math.min(1, effectiveN / CONFIDENCE_SATURATION_N);
}

/**
 * exp(−ln2 × monthsSince / halfLife). 1.0 at the reference month, 0.5 a
 * half-life later, asymptotic to 0. Future-dated evidence (negative age) is
 * clamped to age 0 so a bad month can't inflate freshness above 1.
 *
 * A null/malformed latestMonth returns 1.0 — we don't penalize evidence we
 * can't date rather than guess it's stale. In practice every company has a
 * month (the view coarsens created_at), so this is a guard, not a path.
 */
export function freshnessFactor(latestMonth: string | null, referenceMonth: string): number {
  if (!isMonth(latestMonth) || !isMonth(referenceMonth)) return 1;
  const age = Math.max(0, monthIndex(referenceMonth) - monthIndex(latestMonth));
  return Math.exp((-Math.LN2 * age) / FRESHNESS_HALF_LIFE_MONTHS);
}

export interface SearchRankInputs {
  /** 0..100 HQS point estimate. */
  hqsScore: number;
  effectiveN: number;
  latestMonth: string | null;
}

/**
 * The composite search rank, 0..1. Higher ranks first. Returns the factors
 * alongside the score so a UI can explain WHY one company outranks another
 * (Part 10 self-critique #1: effectiveN must be explained, not hidden).
 */
export function searchRank(inputs: SearchRankInputs, referenceMonth: string): {
  rank: number;
  hqsNormalized: number;
  confidence: number;
  freshness: number;
} {
  const hqsNormalized = Math.max(0, Math.min(1, inputs.hqsScore / 100));
  const confidence = confidenceFactor(inputs.effectiveN);
  const freshness = freshnessFactor(inputs.latestMonth, referenceMonth);
  return { rank: hqsNormalized * confidence * freshness, hqsNormalized, confidence, freshness };
}

export interface RankedCompany {
  company: CompanyAnalytics;
  rank: number;
  confidence: number;
  freshness: number;
}

/**
 * Order companies by search rank, descending. Only companies whose HQS
 * rendered (above the confidence gate) can be ranked — everything else is a
 * directory-order concern the caller handles (Part 7: "Below the confidence
 * gate: listed in directory order, not ranked, not hidden").
 */
export function rankCompanies(companies: CompanyAnalytics[], referenceMonth: string): RankedCompany[] {
  return companies
    .filter((c) => c.hqs !== null)
    .map((company) => {
      const r = searchRank(
        { hqsScore: company.hqs!.score, effectiveN: company.base.effectiveN, latestMonth: company.base.latestMonth },
        referenceMonth
      );
      return { company, rank: r.rank, confidence: r.confidence, freshness: r.freshness };
    })
    .sort((a, b) => b.rank - a.rank);
}
