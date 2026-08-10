/**
 * Hiring-opportunity matching + event persistence (migration 0022).
 *
 * ONE deterministic tier: same organization_id + same normalized role_key +
 * an opportunity that hasn't gone stale yet → attach; otherwise create a new
 * opportunity. This is a deliberate scope reduction from a fuller
 * STRONG/PROBABLE/AMBIGUOUS tiered matcher — this codebase has no
 * role-taxonomy to corroborate a fuzzy match against (the "fingerprint" here
 * is the per-company BEHAVIOURAL fingerprint, unrelated to job titles), so a
 * confidence-tiered matcher would be guessing. A single clean tier that never
 * falsely merges two different roles is safer than a fuzzy one that might.
 *
 * WRITES ONLY FROM CANDIDATE SUBMISSIONS. Called only when reporter_type ===
 * 'candidate' — an employee/former_employee report has no "did they seem
 * serious about hiring me" to answer. This reuses Tenure Stages' own
 * reporter_type field rather than inventing a parallel gate.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { HiringEventInput } from "./events";

const OBSERVATION_WINDOW_DAYS = 30;

/** Lower, trim, collapse whitespace — matches canonicalize_slug's spirit
 *  without its punctuation-stripping (a role title keeps spaces as spaces,
 *  not hyphens, since it is never used as a URL segment). */
export function normalizeRoleKey(role: string): string {
  return role.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

interface OpportunityRow {
  id: string;
  observation_deadline_at: string;
}

/**
 * Find an open (not-yet-stale) opportunity for this org+role, or create one.
 * Bumps last_activity_at and pushes observation_deadline_at forward by
 * OBSERVATION_WINDOW_DAYS on every call that attaches to an EXISTING
 * opportunity — new activity resets the staleness clock, per the design.
 */
export async function findOrCreateOpportunity(
  supabase: SupabaseClient,
  organizationId: string,
  role: string
): Promise<string | null> {
  const roleKey = normalizeRoleKey(role);
  if (!roleKey) return null;

  const nowIso = new Date().toISOString();
  const { data: existing } = await supabase
    .from("hiring_opportunities")
    .select("id, observation_deadline_at")
    .eq("organization_id", organizationId)
    .eq("role_key", roleKey)
    .gt("observation_deadline_at", nowIso)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const found = existing as OpportunityRow | null;
  if (found) {
    const deadline = new Date(Date.now() + OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await supabase
      .from("hiring_opportunities")
      .update({ last_activity_at: nowIso, observation_deadline_at: deadline })
      .eq("id", found.id);
    return found.id;
  }

  const deadline = new Date(Date.now() + OBSERVATION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data: created, error } = await supabase
    .from("hiring_opportunities")
    .insert({ organization_id: organizationId, role_key: roleKey, observation_deadline_at: deadline })
    .select("id")
    .single();
  if (error || !created) return null;
  return (created as { id: string }).id;
}

/**
 * Persist a batch of events for one opportunity. Best-effort — a failure here
 * must never cost the hiring_submissions row it's attached to (same fail-open
 * discipline as company_requests). Events are genuinely independent inserts,
 * not a single transaction: a partial write here is a smaller loss than a
 * partial write blocking the submission that already succeeded.
 */
export async function recordHiringEvents(
  supabase: SupabaseClient,
  hiringOpportunityId: string,
  events: HiringEventInput[]
): Promise<void> {
  if (events.length === 0) return;
  try {
    await supabase.from("hiring_events").insert(
      events.map((e) => ({
        hiring_opportunity_id: hiringOpportunityId,
        actor_type: e.actorType,
        event_type: e.eventType,
        payload: e.payload,
        submission_id: e.submissionId,
        reported_month: e.reportedMonth,
      }))
    );
  } catch (err) {
    console.error("[hiring-intent] event insert failed (submission still proceeds):", err);
  }
}
