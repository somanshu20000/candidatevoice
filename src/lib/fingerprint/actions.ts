/**
 * Action Engine — the decision layer over the behavioural fingerprint.
 *
 * The Forecast (forecast.ts) says what WILL happen ("24% went silent"). This
 * says what to DO about it ("high ghosting risk — keep other options warm").
 * It is a pure REDUCTION of the same fingerprint + HQS the page already
 * computed — no new data, no new query, and every action carries the exact
 * metric that produced it. Nothing here is generated or inferred: an action
 * only appears when a real, non-suppressed dimension crosses a named threshold.
 *
 * Deliberately NOT here (would be fabrication):
 *   - "Expect N rounds" — `stage` is the furthest stage reached, not a round
 *     count (forecast.ts documents this). No field counts rounds.
 *   - "Need a referral" — needs referral-vs-not cohort divergence per company,
 *     which is a cohort computation gated on evidence volume we don't have yet.
 *     A documented future action, not a guess.
 */

import type { BehaviouralFingerprint, BehaviouralDimensionKey } from "./behavioural";
import type { HqsResult } from "@/utils/hqs";
import type { CompensationProfile, CompensationDimensionKey } from "./compensation";
import type { OffboardingProfile, OffboardingDimensionKey } from "./offboarding";
import { conductPointer, type ConductSignal } from "./conduct";

/**
 * Compensation-privacy red flags. Each fires only when a real, non-suppressed
 * dimension shows the privacy-respecting rate BELOW a named threshold — i.e.
 * most reporters experienced the invasive practice. Phrased as observations
 * ("no salary range was shared"), never as intent ("refused to share"), and
 * never as causation. See compensation.ts's three rules.
 */
const COMPENSATION_FLAGS: {
  key: CompensationDimensionKey;
  /** Fires when the privacy-respecting rate is at or below this. */
  below: number;
  label: string;
  /** `bad` is the share that did NOT get the privacy-respecting outcome. */
  detail: (badPct: string, num: number, den: number) => string;
}[] = [
  {
    key: "document_privacy",
    below: 0.8,
    label: "Requests financial documents",
    detail: (p, n, d) => `${p} were asked for bank statements or tax documents · ${n} of ${d} reports`,
  },
  {
    key: "verification_timing",
    below: 0.7,
    label: "Verifies salary before any offer",
    detail: (p, n, d) => `${p} were asked for proof before a written offer · ${n} of ${d} reports`,
  },
  {
    key: "salary_history_privacy",
    below: 0.5,
    label: "Asks for salary history",
    detail: (p, n, d) => `${p} were asked their current or previous salary · ${n} of ${d} reports`,
  },
  {
    key: "range_transparency",
    below: 0.4,
    label: "Rarely shares the salary range up front",
    detail: (p, n, d) => `${p} did not get a range before interviewing · ${n} of ${d} reports`,
  },
];

/**
 * Offboarding red flags (migration 0020). Same shape as COMPENSATION_FLAGS:
 * fires only when the clean-exit rate is at or below a named threshold. Phrased
 * as observations ("did not receive it on time"), never as intent — a leaver
 * cannot know whether a delay was deliberate, only that it happened.
 */
const OFFBOARDING_FLAGS: {
  key: OffboardingDimensionKey;
  below: number;
  label: string;
  detail: (badPct: string, num: number, den: number) => string;
}[] = [
  {
    key: "experience_letter",
    below: 0.7,
    label: "Experience letter often delayed or missing",
    detail: (p, n, d) => `${p} of leavers did not receive it on time · ${n} of ${d} reports`,
  },
  {
    key: "settlement_timeliness",
    below: 0.7,
    label: "Full-and-final settlement often delayed or missing",
    detail: (p, n, d) => `${p} of leavers were not paid on time · ${n} of ${d} reports`,
  },
  {
    key: "documentation_completeness",
    below: 0.7,
    label: "Exit documentation often incomplete",
    detail: (p, n, d) => `${p} of leavers did not get complete documentation · ${n} of ${d} reports`,
  },
];

export type ActionTone = "positive" | "caution" | "risk";

export interface ActionItem {
  key: string;
  /** Imperative/observational, e.g. "High ghosting risk". */
  label: string;
  /** The grounding number + sample, e.g. "28% went silent · 14 of 50 reports". */
  detail: string;
  tone: ActionTone;
}

/** The single headline call. `insufficient` is honest — never a default "apply". */
export type Verdict = "apply" | "apply_with_caution" | "insufficient";

export interface ActionPlan {
  verdict: Verdict;
  headline: string;
  items: ActionItem[];
}

// --- Thresholds (product judgements, named so the UI and tests share them) ---
/** Ghost rate at/above this reads as a genuine risk worth flagging. */
export const GHOSTING_RISK_RATE = 0.25;
/** Ghost rate at/below this is a positive signal. */
export const GHOSTING_GOOD_RATE = 0.1;
/** Offer rate at/below this is a caution (long odds). */
export const OFFER_LOW_RATE = 0.15;
/** Offer rate at/above this is a positive. */
export const OFFER_GOOD_RATE = 0.4;
/** Reason-given rate at/below this is a caution (opaque rejections). */
export const TRANSPARENCY_LOW_RATE = 0.4;
/** Reason-given rate at/above this is a positive. */
export const TRANSPARENCY_GOOD_RATE = 0.7;
/** Response-speed score (0–100) at/below this is a caution. */
export const RESPONSE_SLOW_SCORE = 40;
/** Response-speed score at/above this is a positive. */
export const RESPONSE_FAST_SCORE = 80;

const TONE_RANK: Record<ActionTone, number> = { risk: 0, caution: 1, positive: 2 };

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function basis(numerator: number, denominator: number): string {
  return `${numerator} of ${denominator} ${denominator === 1 ? "report" : "reports"}`;
}

/**
 * Build the action plan from a company's fingerprint and HQS.
 *
 * Verdict comes from HQS (which already encodes effectiveN gating): null HQS →
 * "insufficient"; low tier → caution; medium/high → apply. Items are emitted
 * per dimension only when it is non-suppressed and crosses a threshold, then
 * ordered risk → caution → positive so the most decision-relevant reads first.
 */
export function buildActionPlan(
  fingerprint: BehaviouralFingerprint,
  hqs: HqsResult | null,
  /** Optional: when supplied, compensation-privacy red flags are added too
   *  (migration 0018). Optional so every existing caller keeps working. */
  compensation?: CompensationProfile,
  /** Optional: offboarding (exit-conduct) red flags, migration 0020. */
  offboarding?: OffboardingProfile,
  /** Optional: the workplace-conduct prevalence signal (conduct.ts). Already
   *  null unless it cleared CONDUCT_MIN_EFFECTIVE_N, so no re-gating needed
   *  here — conductPointer() only adds its OWN serious-share threshold on top. */
  conduct?: ConductSignal | null
): ActionPlan {
  const byKey = new Map(fingerprint.dimensions.map((d) => [d.key, d]));
  const rateOf = (key: BehaviouralDimensionKey): { rate: number; num: number; den: number } | null => {
    const d = byKey.get(key);
    if (!d || d.suppressed || d.metric.value === null) return null;
    return { rate: d.metric.value, num: d.metric.rawNumerator, den: d.metric.rawDenominator };
  };

  const items: ActionItem[] = [];

  // Ghosting (metric.value is the ghost rate).
  const ghost = rateOf("ghosting");
  if (ghost) {
    if (ghost.rate >= GHOSTING_RISK_RATE) {
      items.push({ key: "ghosting", tone: "risk", label: "High ghosting risk", detail: `${pct(ghost.rate)} went silent after contact · ${basis(ghost.num, ghost.den)}` });
    } else if (ghost.rate <= GHOSTING_GOOD_RATE) {
      items.push({ key: "ghosting", tone: "positive", label: "Rarely ghosts", detail: `only ${pct(ghost.rate)} went silent · ${basis(ghost.num, ghost.den)}` });
    }
  }

  // Payment risk (metric.value is the flagged rate; any corroborated flag is worth surfacing).
  const pay = rateOf("payment_risk");
  if (pay && pay.rate > 0) {
    items.push({ key: "payment_risk", tone: "risk", label: "Reported requests for payment", detail: `${pct(pay.rate)} reported being asked to pay · ${basis(pay.num, pay.den)} — be wary of unpaid or paid “assignments”` });
  }

  // Offer probability.
  const offer = rateOf("offer_probability");
  if (offer) {
    if (offer.rate <= OFFER_LOW_RATE) {
      items.push({ key: "offer_probability", tone: "caution", label: "Long odds", detail: `only ${pct(offer.rate)} reported an offer · ${basis(offer.num, offer.den)}` });
    } else if (offer.rate >= OFFER_GOOD_RATE) {
      items.push({ key: "offer_probability", tone: "positive", label: "Strong offer odds", detail: `${pct(offer.rate)} reported an offer · ${basis(offer.num, offer.den)}` });
    }
  }

  // Transparency.
  const trans = rateOf("transparency");
  if (trans) {
    if (trans.rate <= TRANSPARENCY_LOW_RATE) {
      items.push({ key: "transparency", tone: "caution", label: "Often no reason given", detail: `only ${pct(trans.rate)} were told why · ${basis(trans.num, trans.den)}` });
    } else if (trans.rate >= TRANSPARENCY_GOOD_RATE) {
      items.push({ key: "transparency", tone: "positive", label: "Usually explains rejections", detail: `${pct(trans.rate)} were told why · ${basis(trans.num, trans.den)}` });
    }
  }

  // Response speed (score is 0–100, higher = faster; here metric.value === score input).
  const speed = byKey.get("response_speed");
  if (speed && !speed.suppressed && speed.score !== null) {
    const den = speed.metric.rawDenominator;
    const speedBasis = `based on ${den} ${den === 1 ? "report" : "reports"}`;
    if (speed.score <= RESPONSE_SLOW_SCORE) {
      items.push({ key: "response_speed", tone: "caution", label: "Slow to respond", detail: `response speed ${Math.round(speed.score)}/100 · ${speedBasis}` });
    } else if (speed.score >= RESPONSE_FAST_SCORE) {
      items.push({ key: "response_speed", tone: "positive", label: "Responds quickly", detail: `response speed ${Math.round(speed.score)}/100 · ${speedBasis}` });
    }
  }

  // Compensation-privacy red flags (0018), only when that profile was supplied.
  if (compensation) {
    const compByKey = new Map(compensation.dimensions.map((d) => [d.key, d]));
    for (const flag of COMPENSATION_FLAGS) {
      const d = compByKey.get(flag.key);
      if (!d || d.suppressed || d.metric.value === null) continue;
      if (d.metric.value > flag.below) continue;
      const badRate = 1 - d.metric.value;
      const badCount = d.metric.rawDenominator - d.metric.rawNumerator;
      items.push({
        key: `comp_${flag.key}`,
        tone: "risk",
        label: flag.label,
        detail: flag.detail(pct(badRate), badCount, d.metric.rawDenominator),
      });
    }
  }

  // Offboarding (exit-conduct) red flags (0020), only when supplied.
  if (offboarding) {
    const offByKey = new Map(offboarding.dimensions.map((d) => [d.key, d]));
    for (const flag of OFFBOARDING_FLAGS) {
      const d = offByKey.get(flag.key);
      if (!d || d.suppressed || d.metric.value === null) continue;
      if (d.metric.value > flag.below) continue;
      const badRate = 1 - d.metric.value;
      const badCount = d.metric.rawDenominator - d.metric.rawNumerator;
      items.push({
        key: `exit_${flag.key}`,
        tone: "risk",
        label: flag.label,
        detail: flag.detail(pct(badRate), badCount, d.metric.rawDenominator),
      });
    }
  }

  // Workplace-conduct pointer (0020) — a single neutral item, never below
  // conduct.ts's own anonymity floor (conductPointer only adds a further,
  // higher-signal threshold on top of an already-cleared signal).
  const conductFlag = conductPointer(conduct ?? null);
  if (conductFlag) {
    items.push({ key: "conduct", tone: "risk", label: "Workplace conduct concerns reported", detail: conductFlag.detail });
  }

  items.sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);

  // Verdict from HQS, which already gates on effectiveN.
  let verdict: Verdict;
  let headline: string;
  if (hqs === null) {
    verdict = "insufficient";
    headline = "Not enough reports yet to make a call — this is a “too little data” result, not a warning.";
  } else if (hqs.tier === "high" || hqs.tier === "medium") {
    verdict = "apply";
    headline = items.some((i) => i.tone === "risk")
      ? "Worth applying — but go in aware of the risks below."
      : "Worth applying on what candidates have reported.";
  } else {
    verdict = "apply_with_caution";
    headline = "Apply with caution — the evidence is thin or mixed.";
  }

  return { verdict, headline, items };
}
