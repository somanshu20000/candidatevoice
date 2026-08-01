/**
 * Persistence for the candidate preference vector. The ONLY file in the
 * candidate layer that touches Supabase.
 *
 * Deliberately "dumb": it stores and returns whatever (dimension, weight) rows
 * it is given and knows nothing about which dimension keys are meaningful —
 * that authority lives in src/lib/advisor/preferences.ts, and validation
 * happens at the API boundary (src/app/api/advisor/preferences). Keeping the
 * store free of the vocabulary means new preference dimensions never require a
 * store change.
 *
 * Uses the service-role client: candidate_profiles / candidate_preferences have
 * RLS enabled with no policy (migration 0015), so nothing but the service role
 * reaches them. The opaque candidate id — proven via the signed cv_candidate
 * cookie before this is ever called — is the capability.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** One stored preference: a dimension key and its 1-5 weight. */
export interface PreferenceEntry {
  dimension: string;
  weight: number;
}

/**
 * Create a fresh anonymous candidate profile, returning its opaque id. The row
 * holds only the generated id + timestamps — no PII. Returns null on failure so
 * the caller can degrade rather than throw (the advisor is a convenience, never
 * load-bearing).
 */
export async function createCandidateProfile(client: SupabaseClient): Promise<string | null> {
  const { data, error } = await client
    .from("candidate_profiles")
    .insert({})
    .select("id")
    .single();
  if (error || !data) return null;
  return (data as { id: string }).id;
}

/** True if the candidate id names a real profile row (cheap existence check). */
export async function candidateProfileExists(client: SupabaseClient, candidateId: string): Promise<boolean> {
  const { data, error } = await client
    .from("candidate_profiles")
    .select("id")
    .eq("id", candidateId)
    .maybeSingle();
  return !error && data !== null;
}

/** Load a candidate's full preference vector as (dimension → weight) entries. */
export async function loadPreferences(client: SupabaseClient, candidateId: string): Promise<PreferenceEntry[]> {
  const { data, error } = await client
    .from("candidate_preferences")
    .select("dimension, weight")
    .eq("candidate_id", candidateId);
  if (error || !data) return [];
  return (data as { dimension: string; weight: number }[]).map((r) => ({
    dimension: r.dimension,
    weight: r.weight,
  }));
}

/**
 * Replace the candidate's preference vector with exactly `entries`
 * (delete-all-then-insert), so the stored vector always matches what was
 * submitted — a dimension the user cleared does not linger.
 *
 * Not transactional: the delete and insert are separate calls. A torn write
 * (delete applied, insert failed) leaves the vector empty, which the engine
 * handles gracefully (no preferences → no fit rather than a wrong fit) and
 * which the next PUT corrects. savePreferences is only ever called from a
 * single per-candidate PUT, so there is no concurrent-writer hazard. Returns
 * false on error; the caller reports it rather than pretending success.
 */
export async function savePreferences(
  client: SupabaseClient,
  candidateId: string,
  entries: PreferenceEntry[]
): Promise<boolean> {
  const now = new Date().toISOString();

  const { error: delError } = await client
    .from("candidate_preferences")
    .delete()
    .eq("candidate_id", candidateId);
  if (delError) return false;

  if (entries.length > 0) {
    const rows = entries.map((e) => ({
      candidate_id: candidateId,
      dimension: e.dimension,
      weight: e.weight,
      updated_at: now,
    }));
    const { error: insertError } = await client.from("candidate_preferences").insert(rows);
    if (insertError) return false;
  }

  // Touch the profile so a later staleness/extraction step can see recency.
  await client.from("candidate_profiles").update({ updated_at: now }).eq("id", candidateId);
  return true;
}
