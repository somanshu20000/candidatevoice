/**
 * Live presence — persistence. The ONLY file that touches
 * presence_sessions. Uses the service-role client: RLS is enabled with no
 * policy (migration 0036), the same "opaque id verified by the route is the
 * capability" shape as candidate_preferences/rate_limit_counters.
 *
 * Fails open on the READ side (a count query error returns null, which the
 * caller renders as "hide the indicator" — never an error, per the
 * graceful-failure requirement) and fails LOUD on the WRITE side (a
 * heartbeat insert error is returned to the caller as ok:false, since a
 * silently-dropped heartbeat is invisible and harmless either way — there is
 * no user-facing consequence to surface).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PresenceCounts {
  globalCount: number;
  companyCount: number;
}

/** "Active" = a heartbeat within the last ~2 minutes. Slightly wider than
 *  the client's ~60s tick so a single missed/delayed tick (a slow network,
 *  a backgrounded tab throttled by the browser) doesn't flicker a real
 *  visitor out of the count. */
export const PRESENCE_WINDOW_SECONDS = 120;

/** How much older than the active window a row must be before the cleanup
 *  cron removes it outright. Generous — this is "stop the table growing
 *  forever," not the active-count boundary, which PRESENCE_WINDOW_SECONDS
 *  alone already governs at read time. */
export const PRESENCE_CLEANUP_AFTER_SECONDS = 600;

/**
 * Record one heartbeat and return the current counts in the same round
 * trip. organizationId may be null (a non-company page). Returns null on
 * any DB error (migration not applied yet, transient failure, etc.) — the
 * caller treats null exactly like "no data," never an exception surfaced
 * to the visitor.
 */
export async function recordHeartbeatAndCount(
  client: SupabaseClient,
  sessionId: string,
  organizationId: string | null
): Promise<PresenceCounts | null> {
  try {
    const { error: heartbeatError } = await client.rpc("presence_heartbeat", {
      p_session_id: sessionId,
      p_organization_id: organizationId,
    });
    if (heartbeatError) return null;

    const { data, error: countError } = await client.rpc("presence_counts", {
      p_organization_id: organizationId,
      p_window_seconds: PRESENCE_WINDOW_SECONDS,
    });
    if (countError || !data) return null;

    const row = (Array.isArray(data) ? data[0] : data) as { global_count: number; company_count: number } | undefined;
    if (!row) return null;
    return { globalCount: row.global_count, companyCount: row.company_count };
  } catch {
    return null;
  }
}

/** Hard-delete rows past the cleanup threshold. Returns the deleted count,
 *  or null on error (the cron route logs and reports it; a failed cleanup
 *  pass is not urgent — the next scheduled run tries again). */
export async function cleanupStalePresence(client: SupabaseClient): Promise<number | null> {
  try {
    const cutoff = new Date(Date.now() - PRESENCE_CLEANUP_AFTER_SECONDS * 1000).toISOString();
    const { data, error } = await client.from("presence_sessions").delete().lt("last_seen_at", cutoff).select("session_id");
    if (error) return null;
    return (data ?? []).length;
  } catch {
    return null;
  }
}
