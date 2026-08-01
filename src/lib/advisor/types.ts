/**
 * Candidate Intelligence — canonical types.
 *
 * The advisor is a DETERMINISTIC reduction over the Evidence Engine, in the
 * same spirit as src/utils/hqs.ts: it invents no number, and every figure it
 * produces traces to a company's behavioural fingerprint (which itself traces
 * to real reports). It knows nothing about resumes or LLMs — a preference
 * vector is nine explicit 1-5 priorities the user set, never inferred.
 *
 * Two honesty rules are encoded directly in these types:
 *   1. A preference the user cares about but which no evidence can speak to
 *      (salary, WLB, …) is carried as `not_measured` — never a fabricated cell.
 *   2. A fit score is `null`, never 0, when the evidence is too thin to assess —
 *      the same discipline as HqsResult.
 */

import type { EvidenceBase } from "@/lib/evidence";

/**
 * The preference dimensions a candidate can weight (1-5). The first six map to
 * behavioural evidence that exists today; the rest are experiential (Family B)
 * and have no company evidence yet, so they are collected but never scored.
 */
export type PreferenceDimensionKey =
  // Evidence-backed (map to a behavioural fingerprint dimension)
  | "fast_interviews"
  | "low_ghosting"
  | "offer_odds"
  | "transparency"
  | "thorough_process"
  | "ethical_pay"
  // Family B — not yet measured anywhere
  | "salary"
  | "work_life_balance"
  | "growth"
  | "learning"
  | "remote"
  | "prestige"
  | "stability";

/** A user's priorities. Partial: a dimension the user did not rate is absent. */
export type PreferenceVector = Partial<Record<PreferenceDimensionKey, number>>;

export type FitTier = "best" | "good" | "stretch" | "avoid";

/**
 * Why a weighted preference dimension did or didn't contribute to the fit:
 *  - scored: backed by evidence AND this company has enough of it
 *  - company_insufficient: backed, but this company's dimension is suppressed
 *  - not_measured: experiential (Family B) — no evidence exists anywhere yet
 */
export type FitDimensionStatus = "scored" | "company_insufficient" | "not_measured";

export interface FitContribution {
  key: PreferenceDimensionKey;
  label: string;
  /** 1-5, exactly as the user set it. */
  preferenceWeight: number;
  status: FitDimensionStatus;
  /** The company's 0-100 dimension score (higher always better). Non-null only when scored. */
  companyScore: number | null;
  /** Share of the fit this dimension carried, after renormalising over scored dims. Scored only. */
  normalizedWeight: number | null;
  /** Per-dimension evidence base (reports, first-party %, effectiveN, months) for traceability. Scored only. */
  base: EvidenceBase | null;
}

export interface FitResult {
  /** 0-100 weighted match, or null when suppressed (never 0 as a stand-in). */
  score: number | null;
  tier: FitTier | null;
  /** Every dimension the user weighted, in preference display order — including
   *  the not_measured / company_insufficient ones, so the UI can be honest about
   *  what it could and could not assess. */
  contributions: FitContribution[];
  /** High-priority (weight ≥ threshold) dimensions this company scores WELL on. */
  strengths: PreferenceDimensionKey[];
  /** High-priority dimensions this company scores POORLY on — the trade-offs. */
  risks: PreferenceDimensionKey[];
  /** The company-level evidence base (fingerprint.base) — headline traceability. */
  base: EvidenceBase;
  suppressionReason: "insufficient_evidence" | "no_weighted_dimensions" | null;
}
