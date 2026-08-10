/**
 * Staleness — a SYSTEM INFERENCE, never a fact. Pure function: no clock read
 * inside it (the caller supplies `now`), no I/O, fully unit-testable.
 *
 * "No confirmed hire observed after N days" is a fact about our EVIDENCE, not
 * a fact about the company's intent. This module enforces that distinction in
 * its wording as much as its logic: the only string this ever produces is
 * "Hiring activity appears stale based on available evidence" — never "this
 * company never intended to hire," which is an unprovable claim about intent
 * this codebase's constitution forbids making.
 *
 * NO SCHEDULER EXISTS in this app (grepped — zero cron/background jobs
 * anywhere). This is computed at READ time by whatever renders the timeline,
 * not proactively by a background worker. A documented limitation, not a
 * silent gap: staleness is only detected the next time someone looks.
 */

export const STALE_OBSERVATION_DAYS = 30;

export interface OpportunityForStaleness {
  lastActivityAt: string; // ISO timestamp
  observationDeadlineAt: string; // ISO timestamp
}

export interface StalenessResult {
  stale: boolean;
  daysSinceActivity: number;
}

/** Neutral, fixed wording — never templated with company/role specifics that
 *  could make it read as an accusation about a named employer's intent. */
export const STALE_INFERENCE_TEXT = "Hiring activity appears stale based on available evidence.";

export function computeStaleness(opportunity: OpportunityForStaleness, now: Date): StalenessResult {
  const deadline = new Date(opportunity.observationDeadlineAt);
  const lastActivity = new Date(opportunity.lastActivityAt);
  const daysSinceActivity = Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)));
  return { stale: now.getTime() > deadline.getTime(), daysSinceActivity };
}
