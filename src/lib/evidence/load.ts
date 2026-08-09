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
  /** Which of the three relationships this report is (migration 0019).
   *  Defaults to 'candidate' at the DB level. */
  reporter_type: string | null;
  /** First-party only (migration 0014) — no column on external_reports. */
  application_channel: string | null;
  /** Compensation transparency & privacy, first-party only (migration 0018).
   *  null = unanswered (excluded from metrics), NOT "no". */
  salary_history_stage: string | null;
  salary_proof_type: string | null;
  salary_proof_stage: string | null;
  salary_range_disclosed: string | null;
  /** Tenure-stage practices, first-party only (migration 0019). Same rule:
   *  null = unanswered (excluded), NOT "no". */
  exit_experience_letter: string | null;
  exit_settlement: string | null;
  exit_documentation: string | null;
  would_recommend: string | null;
  tenure_bucket: string | null;
  conduct_environment: string | null;
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
  "id, organization_id, reporter_type, experience_bucket, stage, outcome, response_time_bucket, " +
  "last_interaction_gap, call_duration, first_interaction_outcome, reason, payment_flag, reported_month, " +
  "application_channel, salary_history_stage, salary_proof_type, salary_proof_stage, salary_range_disclosed, " +
  "exit_experience_letter, exit_settlement, exit_documentation, would_recommend, tenure_bucket, conduct_environment";

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

/** Hard ceiling on rows pulled by the cross-company analytics loaders. At this
 *  scale (hundreds of companies) the load-everything approach is fine per
 *  ADR-0002 Part 8; the cap is a backstop so a data explosion degrades to a
 *  partial, LOGGED result rather than an unbounded query. When it bites, the
 *  rollup migration (Part 8) is overdue. */
export const ANALYTICS_ROW_CAP = 50_000;

/**
 * All approved first-party rows across every company, for cross-company
 * analytics (M6). Ordered so the cap, if it bites, drops the OLDEST evidence
 * rather than an arbitrary slice.
 */
export async function loadAllFirstPartyRows(client: SupabaseClient): Promise<RawFirstPartyRow[]> {
  const { data, error } = await client
    .from("public_submissions")
    .select(FIRST_PARTY_SELECT)
    .not("organization_id", "is", null)
    .order("reported_month", { ascending: false })
    .limit(ANALYTICS_ROW_CAP);
  if (error) throw new Error(`loadAllFirstPartyRows: ${error.message}`);
  const rows = (data ?? []) as unknown as RawFirstPartyRow[];
  if (rows.length === ANALYTICS_ROW_CAP) {
    console.warn(`[evidence/analytics] first-party rows hit the ${ANALYTICS_ROW_CAP} cap — rankings are partial; the rollup migration is overdue.`);
  }
  return rows;
}

export async function loadAllExternalRows(client: SupabaseClient): Promise<RawExternalRow[]> {
  const { data, error } = await client
    .from("public_external_reports")
    .select(EXTERNAL_SELECT)
    .not("organization_id", "is", null)
    .order("reported_month", { ascending: false })
    .limit(ANALYTICS_ROW_CAP);
  if (error) throw new Error(`loadAllExternalRows: ${error.message}`);
  const rows = (data ?? []) as unknown as RawExternalRow[];
  if (rows.length === ANALYTICS_ROW_CAP) {
    console.warn(`[evidence/analytics] external rows hit the ${ANALYTICS_ROW_CAP} cap — rankings are partial; the rollup migration is overdue.`);
  }
  return rows;
}

export interface OrganizationRow {
  id: string;
  slug: string;
  displayName: string;
}

/**
 * Resolve a set of organization ids to their slug + display name for
 * rendering ranking rows. Chunked to stay under URL length limits on the
 * `in` filter. Returns whatever it can; a missing org just won't be linkable.
 */
export async function loadOrganizationsByIds(client: SupabaseClient, ids: string[]): Promise<OrganizationRow[]> {
  const unique = [...new Set(ids)];
  const CHUNK = 200;
  const out: OrganizationRow[] = [];
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await client.from("organizations").select("id, slug, display_name").in("id", chunk);
    if (error) continue; // best-effort — a chunk failure just costs those names
    for (const row of data ?? []) {
      const r = row as Record<string, unknown>;
      out.push({ id: String(r.id), slug: String(r.slug), displayName: String(r.display_name ?? r.slug) });
    }
  }
  return out;
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

/**
 * A single external report shaped for DISPLAY, not aggregation — carries the
 * source link and human-readable source name the company page's "External"
 * section needs (ADR-0002 Part 6: "clearly labelled · source-linked ·
 * unverified badge · visually distinct"). Deliberately separate from the
 * EvidenceItem the engine weights: the engine never needs source_url, and a
 * display surface never needs the weight.
 */
export interface ExternalReportDisplayRow {
  id: string;
  sourceKey: string;
  sourceName: string;
  sourceUrl: string;
  role: string | null;
  stage: string | null;
  outcome: string | null;
  reason: string | null;
  reportedMonth: string | null;
  extractionConfidence: number | string | null;
}

const EXTERNAL_DISPLAY_SELECT =
  "id, source_key, source_name, source_url, role, stage, outcome, reason, reported_month, extraction_confidence";

/**
 * Load approved external reports for a company, shaped for display. Same view
 * (public_external_reports → approved + enabled only), different projection.
 * Returns [] on any error rather than throwing — the External section is
 * supplementary and must never take down the page.
 */
export async function loadExternalDisplayRows(client: SupabaseClient, organizationId: string): Promise<ExternalReportDisplayRow[]> {
  const { data, error } = await client
    .from("public_external_reports")
    .select(EXTERNAL_DISPLAY_SELECT)
    .eq("organization_id", organizationId)
    .order("reported_month", { ascending: false });
  if (error) return [];
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      sourceKey: String(row.source_key),
      sourceName: String(row.source_name ?? row.source_key),
      sourceUrl: String(row.source_url),
      role: (row.role as string | null) ?? null,
      stage: (row.stage as string | null) ?? null,
      outcome: (row.outcome as string | null) ?? null,
      reason: (row.reason as string | null) ?? null,
      reportedMonth: (row.reported_month as string | null) ?? null,
      extractionConfidence: (row.extraction_confidence as number | string | null) ?? null,
    };
  });
}
