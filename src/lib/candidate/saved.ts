/**
 * Persistence for saved companies (Phase 2, product-experience audit).
 * Mirrors src/lib/candidate/store.ts's preferences functions exactly — same
 * service-role client (candidate_saved_companies has RLS enabled with no
 * policy, migration 0034), same "the proven cv_candidate cookie id is the
 * capability" model, same file that owns createCandidateProfile /
 * candidateProfileExists so callers never talk to candidate_profiles directly.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SavedCompanyEntry {
  organizationId: string;
  createdAt: string;
}

/** List a candidate's saved companies, most recently saved first. */
export async function loadSavedCompanies(client: SupabaseClient, candidateId: string): Promise<SavedCompanyEntry[]> {
  const { data, error } = await client
    .from("candidate_saved_companies")
    .select("organization_id, created_at")
    .eq("candidate_id", candidateId)
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as { organization_id: string; created_at: string }[]).map((r) => ({
    organizationId: r.organization_id,
    createdAt: r.created_at,
  }));
}

/** True if this exact (candidate, organization) pair is already saved. */
export async function isCompanySaved(client: SupabaseClient, candidateId: string, organizationId: string): Promise<boolean> {
  const { data, error } = await client
    .from("candidate_saved_companies")
    .select("candidate_id")
    .eq("candidate_id", candidateId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  return !error && data !== null;
}

/**
 * Save a company. Idempotent (upsert on the composite PK) — saving twice is
 * not an error, it's the same state. Returns false on any DB error; the
 * caller reports it rather than pretending success, same contract as
 * savePreferences.
 */
export async function saveCompany(client: SupabaseClient, candidateId: string, organizationId: string): Promise<boolean> {
  const { error } = await client
    .from("candidate_saved_companies")
    .upsert({ candidate_id: candidateId, organization_id: organizationId }, { onConflict: "candidate_id,organization_id" });
  return !error;
}

/** Unsave a company. Idempotent — unsaving something not saved is a no-op success. */
export async function unsaveCompany(client: SupabaseClient, candidateId: string, organizationId: string): Promise<boolean> {
  const { error } = await client
    .from("candidate_saved_companies")
    .delete()
    .eq("candidate_id", candidateId)
    .eq("organization_id", organizationId);
  return !error;
}
