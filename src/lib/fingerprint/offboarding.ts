/**
 * Offboarding / Exit Integrity — dimensions + the Exit Integrity Score.
 *
 * THE PROBLEM THIS MEASURES
 * How a company treats you on the way OUT is invisible to every existing
 * surface — the whole platform until now only heard from people interviewing.
 * A former employee knows things no candidate can: whether the experience /
 * relieving letter arrived, whether full-and-final settlement was paid, whether
 * exit documentation was complete. In India especially, withheld letters and
 * delayed settlements are a real and under-measured harm. This module makes
 * that measurable from what leavers actually reported.
 *
 * SAME MACHINERY AS compensation.ts. Ordinary weightedRate metrics over the
 * Evidence Engine; the Exit Integrity Score is a computeHqs-shaped reduction
 * over them. No new primitive, no invented data.
 *
 * ── THE RULES (inherited from compensation.ts, one addition) ────────────────
 *
 * 1. NULL IS NOT "NO". An unanswered field is not eligible — never scored good
 *    or bad. Every `eligible` predicate tests `!== null`.
 *
 * 2. 'na' IS EXCLUDED, NOT COUNTED. This is where offboarding DIFFERS from the
 *    salary fields. There, "never"/"none" describe a company behaviour (never
 *    asked for salary) and count as good. Here, 'na' means "this didn't apply to
 *    my exit" (e.g. still within notice, letter never requested) — that is NOT a
 *    statement about the company's conduct, so it is excluded like null. Only
 *    on_time / delayed / not_received / complete / partial / none measure the
 *    company.
 *
 * 3. FACTS, NOT INTENT. 'not_received' is what the leaver observed. It is never
 *    rendered as "withheld" or "refused" — we do not infer the company meant to
 *    withhold. Same rule as salary_range's "never".
 *
 * 4. former_employee ONLY. Every predicate also requires
 *    reporterType === 'former_employee'. In practice only leavers populate these
 *    columns, but gating explicitly means an employee/candidate row can never
 *    leak into an exit metric.
 */

import { weightedRate } from "@/lib/evidence";
import type { EvidenceItem, EvidenceBase, MetricResult } from "@/lib/evidence";
import { describeBase } from "@/lib/evidence";

/** Ordinary per-dimension floor, matching the behavioural fingerprint gate. */
export const OFFBOARDING_MIN_EFFECTIVE_N = 3;
/** Headline floor for the composite, matching HQS / the Privacy Score. */
export const OFFBOARDING_SCORE_MIN_EFFECTIVE_N = 5;

export type OffboardingDimensionKey =
  | "experience_letter"
  | "settlement_timeliness"
  | "documentation_completeness";

export const OFFBOARDING_DIMENSION_LABELS: Record<OffboardingDimensionKey, string> = {
  experience_letter: "Experience / relieving letter",
  settlement_timeliness: "Full-and-final settlement",
  documentation_completeness: "Exit documentation",
};

/**
 * Composite weights. A product judgement over real facts, like HQS_WEIGHTS. The
 * letter and the settlement gate your next job and your money, so they carry
 * slightly more than documentation completeness.
 */
export const EXIT_INTEGRITY_WEIGHTS: Record<OffboardingDimensionKey, number> = {
  experience_letter: 0.35,
  settlement_timeliness: 0.35,
  documentation_completeness: 0.3,
};

export interface OffboardingDimensionScore {
  key: OffboardingDimensionKey;
  label: string;
  /** 0..100, higher = cleaner exit. Null when suppressed. */
  score: number | null;
  metric: MetricResult;
  base: EvidenceBase;
  suppressed: boolean;
  suppressionReason: "no_coverage" | "insufficient_evidence" | null;
}

export interface OffboardingProfile {
  dimensions: OffboardingDimensionScore[];
  base: EvidenceBase;
}

/** Only former-employee reports that answered with a conduct-bearing value. */
const isLeaver = (i: EvidenceItem) => i.reporterType === "former_employee";

interface DimensionSpec {
  key: OffboardingDimensionKey;
  eligible: (i: EvidenceItem) => boolean;
  /** The clean-exit case. Score is 100 × rate of this among eligible. */
  cleanExit: (i: EvidenceItem) => boolean;
  minEffectiveN: number;
}

const SPECS: DimensionSpec[] = [
  {
    // Received on time is clean. 'delayed'/'not_received' are the harm; 'na'
    // (didn't apply / never requested) and null are excluded.
    key: "experience_letter",
    eligible: (i) => isLeaver(i) && i.exitExperienceLetter !== null && i.exitExperienceLetter !== "na",
    cleanExit: (i) => i.exitExperienceLetter === "on_time",
    minEffectiveN: OFFBOARDING_MIN_EFFECTIVE_N,
  },
  {
    key: "settlement_timeliness",
    eligible: (i) => isLeaver(i) && i.exitSettlement !== null && i.exitSettlement !== "na",
    cleanExit: (i) => i.exitSettlement === "on_time",
    minEffectiveN: OFFBOARDING_MIN_EFFECTIVE_N,
  },
  {
    // Complete is clean. 'partial'/'none' are the harm; 'na' and null excluded.
    key: "documentation_completeness",
    eligible: (i) => isLeaver(i) && i.exitDocumentation !== null && i.exitDocumentation !== "na",
    cleanExit: (i) => i.exitDocumentation === "complete",
    minEffectiveN: OFFBOARDING_MIN_EFFECTIVE_N,
  },
];

function evaluate(items: EvidenceItem[], spec: DimensionSpec): OffboardingDimensionScore {
  const metric = weightedRate(items, {
    eligible: spec.eligible,
    hit: spec.cleanExit,
    minEffectiveN: spec.minEffectiveN,
  });
  const suppressed = metric.suppressed;
  return {
    key: spec.key,
    label: OFFBOARDING_DIMENSION_LABELS[spec.key],
    score: suppressed || metric.value === null ? null : 100 * metric.value,
    metric,
    base: describeBase(items.filter(spec.eligible)),
    suppressed,
    suppressionReason: suppressed ? (metric.suppressionReason ?? "no_coverage") : null,
  };
}

/** All three dimensions, always in fixed order (suppressed ones included). */
export function buildOffboardingProfile(items: EvidenceItem[]): OffboardingProfile {
  return {
    dimensions: SPECS.map((spec) => evaluate(items, spec)),
    // Base over LEAVER reports only — the honest effectiveN for this stage, not
    // the whole company's evidence (which is mostly interview reports).
    base: describeBase(items.filter(isLeaver)),
  };
}

export type ExitIntegrityTier = "clean" | "mixed" | "poor";

export interface ExitIntegrityResult {
  /** 0..100, higher = cleaner exit conduct. */
  score: number;
  tier: ExitIntegrityTier;
  contributions: { key: OffboardingDimensionKey; score: number; weight: number }[];
  effectiveN: number;
}

export function exitIntegrityTier(score: number): ExitIntegrityTier {
  if (score >= 70) return "clean";
  if (score >= 40) return "mixed";
  return "poor";
}

/**
 * The composite. Mirrors computeHqs / computePrivacyScore exactly: renormalise
 * over the dimensions that actually rendered so a suppressed one never drags the
 * score toward zero, and return NULL — never a fabricated 0 — when the leaver
 * evidence cannot support a headline.
 */
export function computeExitIntegrityScore(profile: OffboardingProfile): ExitIntegrityResult | null {
  if (profile.base.effectiveN < OFFBOARDING_SCORE_MIN_EFFECTIVE_N) return null;

  const contributions: { key: OffboardingDimensionKey; score: number; weight: number }[] = [];
  let totalWeight = 0;
  for (const d of profile.dimensions) {
    if (d.suppressed || d.score === null) continue;
    const w = EXIT_INTEGRITY_WEIGHTS[d.key];
    contributions.push({ key: d.key, score: d.score, weight: w });
    totalWeight += w;
  }
  if (contributions.length === 0 || totalWeight === 0) return null;

  for (const c of contributions) c.weight = c.weight / totalWeight;
  const score = Math.round(contributions.reduce((s, c) => s + c.score * c.weight, 0));

  return { score, tier: exitIntegrityTier(score), contributions, effectiveN: profile.base.effectiveN };
}
