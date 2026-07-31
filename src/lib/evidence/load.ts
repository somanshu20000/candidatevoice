/**
 * Evidence Engine — the only file in this directory that touches Supabase.
 *
 * Reads through public_submissions and public_external_reports — TWO views
 * that already existed (migrations 0003 and 0009) and were read by ZERO
 * application code until now. Both were built for exactly this purpose:
 * public_submissions coarsens created_at to reported_month (closing the
 * anonymity leak every other first-party read path still has — ADR-0002 W2),
 * and public_external_reports pre-filters to approved+enabled and pre-joins
 * external_sources so this file needs no join logic of its own.
 *
 * Both views are anon-safe by RLS (security_invoker + their own public read
 * policies), so this can run with either the anon or admin client — callers
 * building a company page use the anon client, matching every other public
 * read path in this codebase (see src/lib/company-intelligence/read.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RawFirstPartyRow {
  id: string;
  organization_id: string | null;
  experience_bucket: string | null;
  stage: string | null;
  outcome: string | null;
  response_time_bucket: string | null;
  last_interaction_gap: string | null;
  call_duration: string | null;
  first_interaction_outcome: string | null;
  reason: string | null;
  payment_flag: boolean | null;
  reported_month: string | null;
}

export interface RawExternalRow {
  id: string;
  organization_id: string | null;
  source_key: string;
  trust_weight: number | string;
  experience_bucket: string | null;
  stage: string | null;
  outcome: string | null;
  response_time_bucket: string | null;
  last_interaction_gap: string | null;
  reason: string | null;
  payment_flag: boolean | null;
  reported_month: string | null;
  extraction_confidence: number | string | null;
}

const FIRST_PARTY_SELECT =
  "id, organization_id, experience_bucket, stage, outcome, response_time_bucket, " +
  "last_interaction_gap, call_duration, first_interaction_outcome, reason, payment_flag, reported_month";

const EXTERNAL_SELECT =
  "id, organization_id, source_key, trust_weight, experience_bucket, stage, outcome, " +
  "response_time_bucket, last_interaction_gap, reason, payment_flag, reported_month, extraction_confidence";

export async function loadFirstPartyRows(client: SupabaseClient, organizationId: string): Promise<RawFirstPartyRow[]> {
  const { data, error } = await client
    .from("public_submissions")
    .select(FIRST_PARTY_SELECT)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`loadFirstPartyRows(${organizationId}): ${error.message}`);
  return (data ?? []) as unknown as RawFirstPartyRow[];
}

export async function loadExternalRows(client: SupabaseClient, organizationId: string): Promise<RawExternalRow[]> {
  const { data, error } = await client
    .from("public_external_reports")
    .select(EXTERNAL_SELECT)
    .eq("organization_id", organizationId);
  if (error) throw new Error(`loadExternalRows(${organizationId}): ${error.message}`);
  return (data ?? []) as unknown as RawExternalRow[];
}

/**
 * Resolve a company slug to its organization id, exactly as
 * src/lib/company-intelligence/read.ts does for the same reason: the caller
 * has a URL slug, every evidence table is keyed on organization_id.
 */
export async function resolveOrganizationId(client: SupabaseClient, companySlug: string): Promise<string | null> {
  const { data, error } = await client.rpc("resolve_organization", { p_slug: companySlug });
  if (error) return null;
  return (data as string | null) ?? null;
}
