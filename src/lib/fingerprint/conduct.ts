/**
 * Workplace Conduct — aggregate PREVALENCE, and nothing more.
 *
 * ⚠ THE SHARPEST SURFACE IN THE PRODUCT. This is the only module touching
 * harassment / toxicity. Naming a company as a place with "serious concerns" is
 * the most defamation- and safety-sensitive thing CandidateVoice can say, and a
 * current employee at a small firm is far more identifiable than an anonymous
 * candidate. Every design choice here is a guardrail, not a feature:
 *
 *   1. STRUCTURED PREVALENCE ONLY. The input is one role-neutral scale
 *      (conduct_environment). There is NO free text, ever, and it is NEVER
 *      about a named person — only "the environment I experienced". We report
 *      "N of M reports indicated serious concerns", never an accusation, never
 *      a cause, never a grade for the company.
 *
 *   2. THE FLOOR IS THE ANONYMITY GATE. CONDUCT_MIN_EFFECTIVE_N = 8 is far above
 *      the ordinary dimension floor (3) and the invasive-salary floor (5). It is
 *      simultaneously the statistical gate and the anonymity gate: below it,
 *      conductSignal returns null and the surface renders NOTHING. It is set
 *      high precisely because no company-size field exists yet.
 *      // ponytail: fixed floor of 8 is a proxy for a real headcount gate. When
 *      // an employee_count metadata field lands (Wikidata carries it for many
 *      // orgs), gate small companies harder / suppress entirely. Until then, 8.
 *
 *   3. 'na' / null EXCLUDED. "Prefer not to characterise" (na) and "did not
 *      answer" (null) are never counted as either respectful or concerning.
 *
 *   4. employee + former_employee ONLY. A candidate never worked there and
 *      cannot report on the environment; their rows are excluded.
 *
 * Prominence beyond this defensible minimum (lowering the floor, a headline
 * badge, per-report display) is gated on a live Grievance Officer + takedown
 * path (IT Rules 2021) and a real company-size gate — see adr-0004.
 */

import { weightedRate, describeBase } from "@/lib/evidence";
import type { EvidenceItem } from "@/lib/evidence";

/**
 * The anonymity + statistical floor. NOTHING about workplace conduct renders
 * below this. Deliberately much higher than every other floor in the codebase.
 */
export const CONDUCT_MIN_EFFECTIVE_N = 8;

/** Only people who worked there, who answered with a characterisation. */
const canReportConduct = (i: EvidenceItem) =>
  (i.reporterType === "employee" || i.reporterType === "former_employee") &&
  i.conductEnvironment !== null &&
  i.conductEnvironment !== "na";

export interface ConductSignal {
  /** Eligible raw report count (employee/former_employee who characterised). */
  total: number;
  effectiveN: number;
  /** Weighted share reporting a respectful or mostly-ok environment (0..1). The
   *  positive framing leads; higher is better. */
  respectfulShare: number;
  /** Weighted share reporting some or serious concerns (0..1). */
  concernShare: number;
  /** Weighted share reporting SERIOUS concerns specifically (0..1). Drives the
   *  neutral Action-Engine pointer — never an accusation, only a prevalence. */
  seriousShare: number;
  /** Raw counts per bucket, for an honest small-N display ("3 of 11"). */
  counts: { respectful: number; mostly_ok: number; some_concerns: number; serious_concerns: number };
}

/**
 * Compute the conduct prevalence signal, or null if it must not render.
 *
 * Returns null — the surface shows NOTHING — whenever the eligible evidence is
 * below CONDUCT_MIN_EFFECTIVE_N. This is the load-bearing safety behaviour:
 * a thin or single-voice signal about workplace conduct is never published.
 */
export function conductSignal(items: EvidenceItem[]): ConductSignal | null {
  const eligible = items.filter(canReportConduct);
  const base = describeBase(eligible);
  if (base.effectiveN < CONDUCT_MIN_EFFECTIVE_N) return null;

  // No per-call minEffectiveN — the single floor above is the only gate, so a
  // rate isn't independently re-suppressed once we've decided to render.
  const share = (hit: (i: EvidenceItem) => boolean) =>
    weightedRate(items, { eligible: canReportConduct, hit }).value ?? 0;

  const count = (v: string) => eligible.filter((i) => i.conductEnvironment === v).length;

  return {
    total: eligible.length,
    effectiveN: base.effectiveN,
    respectfulShare: share((i) => i.conductEnvironment === "respectful" || i.conductEnvironment === "mostly_ok"),
    concernShare: share((i) => i.conductEnvironment === "some_concerns" || i.conductEnvironment === "serious_concerns"),
    seriousShare: share((i) => i.conductEnvironment === "serious_concerns"),
    counts: {
      respectful: count("respectful"),
      mostly_ok: count("mostly_ok"),
      some_concerns: count("some_concerns"),
      serious_concerns: count("serious_concerns"),
    },
  };
}

/**
 * Share at or above which the neutral Action-Engine pointer fires. Not a verdict
 * — it only decides whether to point the reader at the Workplace Conduct
 * section, which itself carries the framing and the numbers.
 */
export const CONDUCT_SERIOUS_POINTER_SHARE = 0.25;

/**
 * A NEUTRAL one-line pointer, or null. Never says "harassment", never names,
 * never asserts cause. It only reports a prevalence and points at the section.
 * Fires only when serious concerns clear both the render floor (implied by a
 * non-null signal) and CONDUCT_SERIOUS_POINTER_SHARE.
 */
export function conductPointer(signal: ConductSignal | null): { detail: string } | null {
  if (!signal) return null;
  if (signal.seriousShare < CONDUCT_SERIOUS_POINTER_SHARE) return null;
  const pct = Math.round(signal.seriousShare * 100);
  return {
    detail: `${pct}% of ${signal.total} employee reports described serious workplace-conduct concerns — see Workplace conduct`,
  };
}
