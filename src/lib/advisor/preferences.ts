/**
 * The preference vocabulary and its mapping to evidence.
 *
 * This is the single authority on which preference dimensions exist and which
 * are backed by real company evidence. The store (src/lib/candidate/store.ts)
 * deliberately does NOT know this — it persists whatever it is given — so the
 * API validates against this module and nothing else.
 *
 * A preference maps to at most one behavioural fingerprint dimension. Where it
 * maps to `null`, the preference is experiential (Family B): the user can state
 * how much they care, but no evidence can score a company on it yet, so the fit
 * engine reports it as `not_measured` rather than inventing a value.
 */

import type { BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";
import type { PreferenceDimensionKey } from "./types";

/**
 * Preference → behavioural dimension. The behavioural score is already
 * "higher is better" (ghosting and payment risk are inverted at the source),
 * so a candidate who prioritises low ghosting is served by a HIGH `ghosting`
 * dimension score with no re-inversion here.
 */
export const PREFERENCE_TO_EVIDENCE: Record<PreferenceDimensionKey, BehaviouralDimensionKey | null> = {
  fast_interviews: "response_speed",
  low_ghosting: "ghosting",
  offer_odds: "offer_probability",
  transparency: "transparency",
  thorough_process: "process_depth",
  ethical_pay: "payment_risk",
  // Family B — no evidence dimension exists yet.
  salary: null,
  work_life_balance: null,
  growth: null,
  learning: null,
  remote: null,
  prestige: null,
  stability: null,
};

/** Fixed display order — onboarding sliders and fit breakdowns follow this. */
export const PREFERENCE_DIMENSION_KEYS = Object.keys(PREFERENCE_TO_EVIDENCE) as PreferenceDimensionKey[];

export const PREFERENCE_DIMENSION_LABELS: Record<PreferenceDimensionKey, string> = {
  fast_interviews: "Fast interviews",
  low_ghosting: "Low ghosting risk",
  offer_odds: "Offer likelihood",
  transparency: "Transparency",
  thorough_process: "Thorough process",
  ethical_pay: "No pay-to-play",
  salary: "Salary",
  work_life_balance: "Work-life balance",
  growth: "Career growth",
  learning: "Learning",
  remote: "Remote flexibility",
  prestige: "Prestige",
  stability: "Stability",
};

/** One-line help shown under each slider. Describes what the priority means. */
export const PREFERENCE_DIMENSION_HELP: Record<PreferenceDimensionKey, string> = {
  fast_interviews: "How quickly they move between stages",
  low_ghosting: "Whether they keep replying after contact",
  offer_odds: "How often reported candidates got an offer",
  transparency: "Whether they tell you why you were rejected",
  thorough_process: "How far the process goes before a decision",
  ethical_pay: "Never being asked to pay to interview",
  salary: "Pay level and satisfaction",
  work_life_balance: "Sustainable hours and expectations",
  growth: "Advancement and scope over time",
  learning: "How much you'd develop here",
  remote: "Remote and location flexibility",
  prestige: "Brand recognition and reputation",
  stability: "Job security and company durability",
};

export function isPreferenceDimension(key: string): key is PreferenceDimensionKey {
  return key in PREFERENCE_TO_EVIDENCE;
}

/** True when a preference maps to a behavioural dimension with real evidence. */
export function isEvidenceBacked(key: PreferenceDimensionKey): boolean {
  return PREFERENCE_TO_EVIDENCE[key] !== null;
}

/** The subset of preferences that can actually be scored today. */
export const EVIDENCE_BACKED_PREFERENCES: readonly PreferenceDimensionKey[] =
  PREFERENCE_DIMENSION_KEYS.filter(isEvidenceBacked);
