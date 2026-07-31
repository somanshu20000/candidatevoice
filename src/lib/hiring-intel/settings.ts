/**
 * Platform settings — the read/write path for database-backed business policy.
 *
 * Currently one value: the Global Bootstrap Multiplier (migration 0011). It is
 * read on every weighted aggregation, and changed by an operator through the
 * admin settings route — no redeploy, because it is policy, not config.
 *
 * The reader FAILS SAFE: any problem reading the setting collapses to
 * first-party-only (multiplier 0) rather than guessing, so an outage can never
 * make external evidence count by accident.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeGlobalMultiplier, FAILSAFE_GLOBAL_MULTIPLIER } from "./weighting";

export const GLOBAL_EXTERNAL_MULTIPLIER_KEY = "global_external_multiplier";

/**
 * The current Global Bootstrap Multiplier, normalized to [0,1]. Returns the
 * fail-safe (0) — not the launch default — if the row is missing, malformed, or
 * the query errors, so the safe direction (first-party only) is the default on
 * any uncertainty.
 */
export async function getGlobalExternalMultiplier(client: SupabaseClient): Promise<number> {
  try {
    const { data, error } = await client
      .from("platform_settings")
      .select("value")
      .eq("key", GLOBAL_EXTERNAL_MULTIPLIER_KEY)
      .maybeSingle();
    if (error || !data) return FAILSAFE_GLOBAL_MULTIPLIER;
    // value is jsonb; a bare JSON number deserializes to a JS number.
    return normalizeGlobalMultiplier(data.value);
  } catch {
    return FAILSAFE_GLOBAL_MULTIPLIER;
  }
}

/**
 * Set the Global Bootstrap Multiplier. Rejects anything outside [0,1] rather
 * than silently clamping — an operator typing 3 should be told, not have it
 * quietly become 1. Requires the service-role client (writes bypass RLS).
 */
export async function setGlobalExternalMultiplier(
  client: SupabaseClient,
  value: number,
  updatedBy: string
): Promise<void> {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`global_external_multiplier must be between 0 and 1, got ${value}`);
  }
  const { error } = await client
    .from("platform_settings")
    .update({ value: value as unknown as object, updated_at: new Date().toISOString(), updated_by: updatedBy })
    .eq("key", GLOBAL_EXTERNAL_MULTIPLIER_KEY);
  if (error) throw new Error(`setGlobalExternalMultiplier: ${error.message}`);
}
