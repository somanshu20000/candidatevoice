/**
 * Hiring-event analytics — four metrics over the append-only event log
 * (migrations 0023/0024).
 *
 * THE UNIT OF ANALYSIS IS THE OPPORTUNITY, NOT THE EVENT. Every metric here
 * asks a question about a ROLE ("did it resolve", "did it go stale"), so the
 * denominator counts opportunities. Counting raw events would let one talkative
 * candidate outweigh five quiet ones on the same role.
 *
 * SAME MACHINERY AS EVERYTHING ELSE — no new statistical conventions. Each
 * opportunity is adapted to the EvidenceItem shape at weight 1 and run through
 * the real `weightedRate` (src/lib/evidence/aggregate.ts), so the suppression
 * gate, its ordering, and Kish effectiveN are the SAME code the fingerprint and
 * compensation dimensions use. Because every hiring event is first-party
 * (actor_type is 'candidate' or 'system' — 0023's CHECK forbids anything else),
 * all weights are exactly 1, so kishEffectiveN([1,1,…,1]) === n and the floor
 * behaves as an exact opportunity-count floor.
 *
 * NULL, NEVER A STAND-IN ZERO. Below a floor, or with nothing eligible, every
 * function here returns a suppressed MetricResult whose `value` is null. A
 * rate of 0 means "measured zero"; null means "we don't know yet". Conflating
 * them is the failure mode this whole codebase is built to avoid.
 *
 * NOT WIRED INTO HQS. Deliberately. These are perception-heavy and
 * opportunity-scoped; folding them into a hiring-quality score would silently
 * change what HQS means. That is its own decision (DECISIONS.md Q-3).
 */

import { weightedRate } from "@/lib/evidence";
import { minimalEvidenceItem } from "@/lib/evidence/synthetic";
import type { EvidenceItem, MetricResult } from "@/lib/evidence";
import type { PublicHiringOpportunity } from "./timeline";
import type {
  CandidateOutcomePayload,
  CandidatePerceivedIntentPayload,
  PerceivedSeriousness,
} from "./events";

/** Ordinary opportunity-count floor — matches DIMENSION_MIN_EFFECTIVE_N (3). */
export const HIRING_ANALYTICS_MIN_EFFECTIVE_N = 3;

/**
 * Higher bar for perception-vs-outcome. It pairs a SUBJECTIVE read with a real
 * outcome, so a thin sample doesn't just add noise — it invites a confident
 * claim about how well candidates "read" a company. Same reasoning as
 * PRIVACY_INVASIVE_MIN_EFFECTIVE_N (5) in compensation.ts.
 */
export const PERCEPTION_OUTCOME_MIN_EFFECTIVE_N = 5;

/**
 * A terminal outcome. `no_response` and `ongoing` are deliberately NOT
 * resolutions: treating "they never replied" as an outcome is the ghosting
 * fallacy — it would let a company that ignores everyone score a fast
 * "resolution" time. Ghosting is measured by its own dimension, not here.
 */
const TERMINAL_OUTCOMES = new Set(["offer", "rejected"]);

/** Perceptions that read as "they seemed serious". */
const HIGH_PERCEPTION = new Set<PerceivedSeriousness>(["very_serious", "serious"]);
/** Perceptions that read as "they did not seem serious". */
const LOW_PERCEPTION = new Set<PerceivedSeriousness>(["not_serious", "very_not_serious"]);
// 'neutral' is in NEITHER set, on purpose — see agreementOf().

// ---------------------------------------------------------------------------
// Per-opportunity facts, derived once
// ---------------------------------------------------------------------------

interface OpportunityFacts {
  opportunity: PublicHiringOpportunity;
  /** Terminal outcome present → the role resolved, as far as we can observe. */
  resolved: boolean;
  /** Days from first observation to the resolving event's month. Null unless resolved. */
  daysToResolution: number | null;
  /** Past its observation deadline — the only population where "stale" is even askable. */
  pastDeadline: boolean;
  /** A system_stale_inference event exists. */
  markedStale: boolean;
  /** Strongest candidate perception recorded, or null if none/only 'neutral'. */
  perception: "high" | "low" | null;
  /** True/false when both perception and a terminal outcome exist; else null. */
  agreement: boolean | null;
  /** Count of HR-authored events. Structurally 0 today (0023 forbids actor_type='hr'). */
  hrEventCount: number;
  /** Whole months the opportunity has been observed, min 1 — HR-frequency's denominator. */
  observedMonths: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function deriveFacts(o: PublicHiringOpportunity, now: Date): OpportunityFacts {
  const outcomes = o.events.filter((e) => e.eventType === "candidate_outcome");
  const terminal = outcomes.find((e) => {
    const outcome = (e.payload as CandidateOutcomePayload).outcome;
    return outcome !== null && TERMINAL_OUTCOMES.has(outcome);
  });
  const resolved = terminal !== undefined;

  // Timing note: exact timestamps are used INTERNALLY only. Every consumer sees
  // a floor-gated aggregate (see the metrics below), never a per-opportunity
  // date — so a single-report opportunity's submission time is never derivable
  // from anything this module returns.
  const first = new Date(o.firstObservedAt).getTime();
  const last = new Date(o.lastActivityAt).getTime();
  const daysToResolution = resolved ? Math.max(0, Math.round((last - first) / MS_PER_DAY)) : null;

  const pastDeadline = now.getTime() > new Date(o.observationDeadlineAt).getTime();
  const markedStale = o.events.some((e) => e.eventType === "system_stale_inference");

  const perceptions = o.events
    .filter((e) => e.eventType === "candidate_perceived_intent")
    .map((e) => (e.payload as CandidatePerceivedIntentPayload).perceivedSeriousness);
  const perception = summarizePerception(perceptions);

  const observedMonths = Math.max(1, Math.round((last - first) / MS_PER_DAY / 30));

  return {
    opportunity: o,
    resolved,
    daysToResolution,
    pastDeadline,
    markedStale,
    perception,
    agreement: agreementOf(perception, terminal),
    hrEventCount: o.events.filter((e) => e.actorType !== "candidate" && e.actorType !== "system").length,
    observedMonths,
  };
}

/**
 * Reduce several candidates' perceptions to one per-opportunity read.
 * 'neutral' answers are DROPPED, not counted as a middle value: averaging them
 * in would let "nobody could tell" masquerade as a measured midpoint. If every
 * answer was neutral, the opportunity has no usable perception at all.
 */
function summarizePerception(values: PerceivedSeriousness[]): "high" | "low" | null {
  const high = values.filter((v) => HIGH_PERCEPTION.has(v)).length;
  const low = values.filter((v) => LOW_PERCEPTION.has(v)).length;
  if (high === 0 && low === 0) return null; // none recorded, or all 'neutral'
  if (high === low) return null; // genuinely split — not evidence either way
  return high > low ? "high" : "low";
}

/**
 * Did the candidates' read match what happened?
 *   high perception + offer     → agreed
 *   low  perception + rejected  → agreed
 * Anything else with BOTH signals present → disagreed.
 * Missing either signal → null (excluded from the denominator entirely).
 */
function agreementOf(
  perception: "high" | "low" | null,
  terminal: { payload: unknown } | undefined
): boolean | null {
  if (perception === null || terminal === undefined) return null;
  const outcome = (terminal.payload as CandidateOutcomePayload).outcome;
  if (outcome === null) return null;
  if (perception === "high") return outcome === "offer";
  return outcome === "rejected";
}

// ---------------------------------------------------------------------------
// The EvidenceItem adapter
// ---------------------------------------------------------------------------

/**
 * Adapt one opportunity to the EvidenceItem shape so it can flow through the
 * REAL weightedRate rather than a parallel rate function written here.
 *
 * Every evidence-specific field is null because an opportunity is NOT a report
 * — it is a container for reports. Nothing downstream reads these nulls: the
 * metrics below supply their own `eligible`/`hit` predicates that only ever
 * consult the derived facts. Weight is always 1 (first-party only), which is
 * what makes effectiveN an exact opportunity count.
 */
function asEvidenceItem(facts: OpportunityFacts, organizationId: string): EvidenceItem {
  return minimalEvidenceItem(facts.opportunity.id, organizationId);
}

// ---------------------------------------------------------------------------
// Public result shape
// ---------------------------------------------------------------------------

export interface HiringAnalytics {
  /** Mean days from first observation to resolution. Null below the floor. */
  timeToResolutionDays: number | null;
  /** The MetricResult behind timeToResolutionDays (carries raw counts + suppression). */
  resolutionMetric: MetricResult;
  /** Share of past-deadline opportunities marked stale, 0..1. Null below the floor. */
  staleRoleRate: MetricResult;
  /** Share of perception+outcome pairs that agreed, 0..1. Null below the higher floor. */
  perceptionAccuracy: MetricResult;
  /** HR events per opportunity-month. Null by construction until HR auth exists. */
  hrUpdateFrequency: MetricResult;
  /** Opportunities considered (all of them, before any per-metric eligibility). */
  opportunityCount: number;
}

/**
 * Compute all four metrics for a set of opportunities.
 *
 * `now` is injected (never read from the clock inside) so every metric is a
 * pure function of its inputs and the staleness boundary is testable — the same
 * discipline computeStaleness() uses in stale.ts.
 */
export function buildHiringAnalytics(
  opportunities: PublicHiringOpportunity[],
  now: Date,
  organizationId = "aggregate"
): HiringAnalytics {
  const facts = opportunities.map((o) => deriveFacts(o, now));
  const items = facts.map((f) => asEvidenceItem(f, organizationId));
  const factById = new Map(facts.map((f) => [f.opportunity.id, f]));
  const factOf = (i: EvidenceItem) => factById.get(i.id)!;

  // --- Time to resolution -------------------------------------------------
  // weightedRate gives us the resolved-share plus, crucially, the same
  // suppression gate; the mean itself is computed over the resolved subset
  // ONLY when that gate passes, so a thin sample never yields a headline
  // "average time to hire".
  const resolutionMetric = weightedRate(items, {
    eligible: () => true, // every opportunity is a candidate for resolving
    hit: (i) => factOf(i).resolved,
    minEffectiveN: HIRING_ANALYTICS_MIN_EFFECTIVE_N,
  });
  const resolvedDays = facts.map((f) => f.daysToResolution).filter((d): d is number => d !== null);
  const timeToResolutionDays =
    resolutionMetric.suppressed || resolvedDays.length === 0
      ? null
      : Math.round(resolvedDays.reduce((s, d) => s + d, 0) / resolvedDays.length);

  // --- Stale-role rate ----------------------------------------------------
  // Denominator is opportunities PAST their deadline, not all opportunities:
  // a role still inside its observation window hasn't had the chance to go
  // stale, and counting it would dilute the rate toward a flattering zero.
  const staleRoleRate = weightedRate(items, {
    eligible: (i) => factOf(i).pastDeadline,
    hit: (i) => factOf(i).markedStale,
    minEffectiveN: HIRING_ANALYTICS_MIN_EFFECTIVE_N,
  });

  // --- Candidate perception vs outcome -----------------------------------
  // Eligible ONLY when both a usable perception and a terminal outcome exist.
  // agreement === null covers: no perception recorded, all-'neutral', a genuine
  // split, or no terminal outcome — every one of which is "we can't tell",
  // never "they were wrong".
  const perceptionAccuracy = weightedRate(items, {
    eligible: (i) => factOf(i).agreement !== null,
    hit: (i) => factOf(i).agreement === true,
    minEffectiveN: PERCEPTION_OUTCOME_MIN_EFFECTIVE_N,
  });

  // --- HR update frequency ------------------------------------------------
  // NULL BY CONSTRUCTION TODAY. hiring_events.actor_type admits only
  // 'candidate' and 'system' (0023's CHECK), so hrEventCount is always 0 and
  // nothing is ever eligible → no_coverage → value null. This is built
  // correct-and-ready rather than stubbed: the day actor_type widens to admit
  // 'hr', this metric starts reporting with no rewrite. Its test asserts the
  // null holds while the CHECK does — a guard on the authority boundary
  // (DECISIONS.md D-011), not a placeholder.
  const hrUpdateFrequency = weightedRate(items, {
    eligible: (i) => factOf(i).hrEventCount > 0,
    hit: (i) => factOf(i).hrEventCount >= factOf(i).observedMonths,
    minEffectiveN: HIRING_ANALYTICS_MIN_EFFECTIVE_N,
  });

  return {
    timeToResolutionDays,
    resolutionMetric,
    staleRoleRate,
    perceptionAccuracy,
    hrUpdateFrequency,
    opportunityCount: opportunities.length,
  };
}

/** True when at least one metric survived suppression — the render gate. */
export function hasAnyHiringAnalytics(a: HiringAnalytics): boolean {
  return (
    a.timeToResolutionDays !== null ||
    !a.staleRoleRate.suppressed ||
    !a.perceptionAccuracy.suppressed ||
    !a.hrUpdateFrequency.suppressed
  );
}
