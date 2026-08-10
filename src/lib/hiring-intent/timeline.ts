/**
 * Read-side: the public timeline + the opportunistic stale-inference writer.
 *
 * WHY "OPPORTUNISTIC." No scheduler exists in this app (see stale.ts). The
 * only way a system_stale_inference event ever gets recorded is if something
 * reads the timeline after the deadline has passed — typically a company-page
 * view. This is honest about the limitation: staleness is detected on next
 * read, not proactively. A real background worker is future work.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { computeStaleness } from "./stale";
import type { EventType, EventPayload, ActorType } from "./events";

export interface PublicHiringEvent {
  id: string;
  actorType: ActorType;
  eventType: EventType;
  payload: EventPayload;
  reportedMonth: string | null;
}

export interface PublicHiringOpportunity {
  id: string;
  roleKey: string;
  firstObservedAt: string;
  lastActivityAt: string;
  /** The actual stored deadline (set by findOrCreateOpportunity) — read here
   *  directly rather than recomputed, so the read side can never drift from
   *  whatever window the write side actually applied. */
  observationDeadlineAt: string;
  events: PublicHiringEvent[];
}

interface OppRow {
  id: string;
  role_key: string;
  first_observed_at: string;
  last_activity_at: string;
  observation_deadline_at: string;
}
interface EventRow {
  id: string;
  hiring_opportunity_id: string;
  actor_type: string;
  event_type: string;
  payload: EventPayload;
  reported_month: string | null;
}

/**
 * Load every hiring opportunity + its public event timeline for a company.
 * Read-only surface — never mutates. Opportunistic staleness recording (see
 * recordStaleInferenceIfDue) is a SEPARATE, explicit call the caller makes,
 * so a page render is never surprised by a side-effecting read.
 */
export async function loadHiringOpportunities(
  supabase: SupabaseClient,
  organizationId: string
): Promise<PublicHiringOpportunity[]> {
  const { data: opps } = await supabase
    .from("public_hiring_opportunities")
    .select("id, role_key, first_observed_at, last_activity_at, observation_deadline_at")
    .eq("organization_id", organizationId)
    .order("last_activity_at", { ascending: false });

  const opportunities = (opps ?? []) as OppRow[];
  if (opportunities.length === 0) return [];

  const ids = opportunities.map((o) => o.id);
  const { data: events } = await supabase
    .from("public_hiring_events")
    .select("id, hiring_opportunity_id, actor_type, event_type, payload, reported_month")
    .in("hiring_opportunity_id", ids)
    .order("id", { ascending: true }); // insertion order proxy — reported_month is coarser than createdAt and not reliable to sort on alone

  const eventsByOpp = new Map<string, PublicHiringEvent[]>();
  for (const e of (events ?? []) as EventRow[]) {
    const list = eventsByOpp.get(e.hiring_opportunity_id) ?? [];
    list.push({ id: e.id, actorType: e.actor_type as ActorType, eventType: e.event_type as EventType, payload: e.payload, reportedMonth: e.reported_month });
    eventsByOpp.set(e.hiring_opportunity_id, list);
  }

  return opportunities.map((o) => ({
    id: o.id,
    roleKey: o.role_key,
    firstObservedAt: o.first_observed_at,
    lastActivityAt: o.last_activity_at,
    observationDeadlineAt: o.observation_deadline_at,
    events: eventsByOpp.get(o.id) ?? [],
  }));
}

/**
 * Called explicitly (not from loadHiringOpportunities) so the effect is
 * opt-in per caller. Idempotent: only inserts when the opportunity is past
 * its deadline AND its most recent event is not already a stale inference —
 * re-reading the same stale opportunity twice does not spam the event log.
 */
export async function recordStaleInferenceIfDue(
  supabase: SupabaseClient,
  opportunity: PublicHiringOpportunity
): Promise<void> {
  const { stale, daysSinceActivity } = computeStaleness(
    { lastActivityAt: opportunity.lastActivityAt, observationDeadlineAt: opportunity.observationDeadlineAt },
    new Date()
  );
  if (!stale) return;

  const alreadyRecorded = opportunity.events.some((e) => e.eventType === "system_stale_inference");
  if (alreadyRecorded) return;

  try {
    await supabase.from("hiring_events").insert({
      hiring_opportunity_id: opportunity.id,
      actor_type: "system",
      event_type: "system_stale_inference",
      payload: { daysSinceActivity, inference: "hiring_appears_stale" },
    });
  } catch (err) {
    console.error("[hiring-intent] stale-inference insert failed (non-fatal, read-only path):", err);
  }
}
