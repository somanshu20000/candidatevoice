/**
 * Hiring-intent events — types + payload validation (migration 0022).
 *
 * CANDIDATE PERCEPTION IS NOT FACT. `candidate_perceived_intent` is explicitly
 * labelled as one person's read of the process — never rendered as an
 * objective claim about the company. `structuredReasons` is a closed enum
 * list precisely so this can never become a free-text accusation.
 *
 * Reuses HiringStage / HiringOutcome / LastInteractionGap from types/index.ts
 * rather than inventing parallel vocabularies — interview_occurred,
 * candidate_outcome, and candidate_follow_up describe the exact same facts
 * hiring_submissions already collects, just as a timestamped event instead of
 * a single column.
 */

import type { HiringStage, HiringOutcome, LastInteractionGap } from "@/types/index";

export type ActorType = "candidate" | "system";

export type EventType =
  | "role_reported"
  | "interview_occurred"
  | "candidate_perceived_intent"
  | "candidate_outcome"
  | "candidate_follow_up"
  | "system_stale_inference";

/** Ordered worst→best is deliberately NOT assumed anywhere — this is a
 *  perception label, not a score to be averaged into anything else. */
export type PerceivedSeriousness = "very_serious" | "serious" | "neutral" | "not_serious" | "very_not_serious";

export const PERCEIVED_SERIOUSNESS_VALUES: readonly PerceivedSeriousness[] = [
  "very_serious",
  "serious",
  "neutral",
  "not_serious",
  "very_not_serious",
];

/** Structured reasons only — closed enum, never free text (the load-bearing
 *  guardrail: a candidate's frustration must never become an accusation). */
export type IntentReason =
  | "recruiter_responsiveness"
  | "interview_scheduling"
  | "hiring_manager_involvement"
  | "role_clarity"
  | "salary_discussion"
  | "repeated_delays"
  | "vague_process"
  | "role_disappeared"
  | "hiring_freeze_signals";

export const INTENT_REASON_VALUES: readonly IntentReason[] = [
  "recruiter_responsiveness",
  "interview_scheduling",
  "hiring_manager_involvement",
  "role_clarity",
  "salary_discussion",
  "repeated_delays",
  "vague_process",
  "role_disappeared",
  "hiring_freeze_signals",
];

export type RoleReportedPayload = Record<string, never>;
export interface InterviewOccurredPayload {
  stage: HiringStage | null;
}
export interface CandidatePerceivedIntentPayload {
  perceivedSeriousness: PerceivedSeriousness;
  reasons: IntentReason[];
}
export interface CandidateOutcomePayload {
  outcome: HiringOutcome | null;
}
export interface CandidateFollowUpPayload {
  lastContactGap: LastInteractionGap | null;
}
export interface SystemStaleInferencePayload {
  daysSinceActivity: number;
  /** A fixed, neutral constant — never a template that could be made to say
   *  something stronger. See computeStaleness() in stale.ts. */
  inference: "hiring_appears_stale";
}

export type EventPayload =
  | RoleReportedPayload
  | InterviewOccurredPayload
  | CandidatePerceivedIntentPayload
  | CandidateOutcomePayload
  | CandidateFollowUpPayload
  | SystemStaleInferencePayload;

export interface HiringEventInput {
  actorType: ActorType;
  eventType: EventType;
  payload: EventPayload;
  /** Traces back to the anonymous submission that produced this event, for
   *  moderation/audit only — never surfaced publicly (see public_hiring_events). */
  submissionId: string | null;
  /** YYYY-MM, matching public_submissions' own anonymity coarsening. */
  reportedMonth: string | null;
}

const HIRING_STAGES: readonly string[] = ["applied", "screening", "technical", "hr", "final"];
const HIRING_OUTCOMES: readonly string[] = ["rejected", "no_response", "offer", "ongoing"];
const LAST_INTERACTION_GAPS: readonly string[] = ["0-7", "8-14", "15-30", "30+"];

/**
 * Build a validated candidate event from raw submit-flow input, or null if
 * the input doesn't amount to anything worth recording (every field
 * optional/empty). Mirrors the "NULL is not NO" discipline: an unanswered
 * field is simply absent from the event stream, never coerced into a value.
 */
export function buildCandidateEvents(input: {
  stage: string | null;
  perceivedSeriousness: string | null;
  intentReasons: string[];
  outcome: string | null;
  lastContactGap: string | null;
  submissionId: string | null;
  reportedMonth: string | null;
}): HiringEventInput[] {
  const events: HiringEventInput[] = [];
  const base = { submissionId: input.submissionId, reportedMonth: input.reportedMonth };

  if (input.stage && HIRING_STAGES.includes(input.stage)) {
    events.push({ actorType: "candidate", eventType: "interview_occurred", payload: { stage: input.stage as HiringStage }, ...base });
  }
  if (input.perceivedSeriousness && PERCEIVED_SERIOUSNESS_VALUES.includes(input.perceivedSeriousness as PerceivedSeriousness)) {
    const reasons = input.intentReasons.filter((r): r is IntentReason => INTENT_REASON_VALUES.includes(r as IntentReason));
    events.push({
      actorType: "candidate",
      eventType: "candidate_perceived_intent",
      payload: { perceivedSeriousness: input.perceivedSeriousness as PerceivedSeriousness, reasons },
      ...base,
    });
  }
  if (input.outcome && HIRING_OUTCOMES.includes(input.outcome)) {
    events.push({ actorType: "candidate", eventType: "candidate_outcome", payload: { outcome: input.outcome as HiringOutcome }, ...base });
  }
  if (input.lastContactGap && LAST_INTERACTION_GAPS.includes(input.lastContactGap)) {
    events.push({ actorType: "candidate", eventType: "candidate_follow_up", payload: { lastContactGap: input.lastContactGap as LastInteractionGap }, ...base });
  }
  return events;
}
