/**
 * External hiring intelligence — the moderation boundary.
 *
 * "Moderation is the trust boundary": nothing an acquisition adapter produces
 * influences the product until a human moves it from `pending` to `approved`
 * here. This module is that surface's read/write layer — richer than a plain
 * approve/reject, because a moderator needs the FULL explainability trail
 * (migration 0009) to judge an extracted claim, not just the claim itself.
 *
 * Kept separate from store.ts (the import-time insert path) because the query
 * shapes are genuinely different: store.ts does one insert per report;
 * this does a batched read of the pending queue plus duplicate/related lookups
 * across the whole table, and the three moderation actions
 * (approve/reject/archive) are all just verification_status transitions.
 *
 * verification_status is also the entire input the future weighting engine
 * needs for its "Moderator Confidence" term (approved=1.0, everything else=0)
 * — nothing here writes a redundant confidence column; that term is always
 * derivable from this one field.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type VerificationStatus = "pending" | "approved" | "rejected" | "archived";

export interface RelatedReportRef {
  id: string;
  sourceKey: string;
  status: VerificationStatus;
  stage: string | null;
  outcome: string | null;
  ingestedAt: string;
}

export interface ModerationQueueItem {
  id: string;
  company: string;
  organizationId: string | null;
  role: string | null;

  sourceKey: string;
  sourceName: string;
  trustWeight: number;
  sourceUrl: string;
  externalRef: string | null;
  contentHash: string;

  experienceBucket: string | null;
  stage: string | null;
  outcome: string | null;
  responseTimeBucket: string | null;
  lastInteractionGap: string | null;
  reason: string | null;
  paymentFlag: boolean | null;
  reportedMonth: string | null;

  extractionVersion: string | null;
  extractionConfidence: number | null;
  fieldsExtracted: string[];
  validationWarnings: { field: string; message: string }[];

  ingestedAt: string;

  /** Other rows (any source, any status) sharing this exact content hash. */
  duplicates: RelatedReportRef[];
  /** Other rows for the same resolved employer — context, not necessarily duplicates. */
  related: RelatedReportRef[];
}

interface RawRow {
  id: string;
  company: string;
  organization_id: string | null;
  role: string | null;
  source_id: string;
  source_url: string;
  external_ref: string | null;
  content_hash: string;
  experience_bucket: string | null;
  stage: string | null;
  outcome: string | null;
  response_time_bucket: string | null;
  last_interaction_gap: string | null;
  reason: string | null;
  payment_flag: boolean | null;
  reported_month: string | null;
  extraction_version: string | null;
  extraction_confidence: string | number | null;
  fields_extracted: string[] | null;
  validation_warnings: { field: string; message: string }[] | null;
  ingested_at: string;
  verification_status: VerificationStatus;
  external_sources: { key: string; display_name: string; trust_weight: string | number } | { key: string; display_name: string; trust_weight: string | number }[] | null;
}

function sourceOf(row: RawRow): { key: string; display_name: string; trust_weight: string | number } | null {
  return Array.isArray(row.external_sources) ? (row.external_sources[0] ?? null) : row.external_sources;
}

function toRef(row: RawRow, sourceKeyById: Map<string, string>): RelatedReportRef {
  return {
    id: row.id,
    sourceKey: sourceOf(row)?.key ?? sourceKeyById.get(row.source_id) ?? row.source_id,
    status: row.verification_status,
    stage: row.stage,
    outcome: row.outcome,
    ingestedAt: row.ingested_at,
  };
}

/**
 * Every pending external report, each carrying its full explainability trail
 * plus duplicate/related context — batched, not one query per row, so the
 * queue stays cheap regardless of how many reports are waiting.
 */
export async function listPendingExternalReports(client: SupabaseClient): Promise<ModerationQueueItem[]> {
  const { data, error } = await client
    .from("external_reports")
    .select(
      "id, company, organization_id, role, source_id, source_url, external_ref, content_hash, " +
        "experience_bucket, stage, outcome, response_time_bucket, last_interaction_gap, reason, payment_flag, reported_month, " +
        "extraction_version, extraction_confidence, fields_extracted, validation_warnings, ingested_at, verification_status, " +
        "external_sources:source_id (key, display_name, trust_weight)"
    )
    .eq("verification_status", "pending")
    .order("ingested_at", { ascending: false });
  if (error) throw new Error(`listPendingExternalReports: ${error.message}`);

  const pending = (data ?? []) as unknown as RawRow[];
  if (pending.length === 0) return [];

  const ids = pending.map((r) => r.id);
  const hashes = [...new Set(pending.map((r) => r.content_hash))];
  const orgIds = [...new Set(pending.map((r) => r.organization_id).filter((v): v is string => v !== null))];

  const [dupRes, relRes] = await Promise.all([
    hashes.length
      ? client
          .from("external_reports")
          .select(
            "id, source_id, content_hash, organization_id, company, role, source_url, external_ref, " +
              "stage, outcome, verification_status, ingested_at, external_sources:source_id (key, display_name, trust_weight)"
          )
          .in("content_hash", hashes)
      : Promise.resolve({ data: [], error: null }),
    orgIds.length
      ? client
          .from("external_reports")
          .select(
            "id, source_id, content_hash, organization_id, company, role, source_url, external_ref, " +
              "stage, outcome, verification_status, ingested_at, external_sources:source_id (key, display_name, trust_weight)"
          )
          .in("organization_id", orgIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (dupRes.error) throw new Error(`listPendingExternalReports duplicates: ${dupRes.error.message}`);
  if (relRes.error) throw new Error(`listPendingExternalReports related: ${relRes.error.message}`);

  const sourceKeyById = new Map<string, string>();
  for (const row of [...pending, ...((dupRes.data ?? []) as unknown as RawRow[])]) {
    const s = sourceOf(row);
    if (s) sourceKeyById.set(row.source_id, s.key);
  }

  // Populate the maps with EVERY matching row, including other pending ones.
  // Self-exclusion happens per-row below (`d.id !== row.id`), not here — the
  // common case is a fresh batch import where every candidate IS pending, so
  // excluding pending rows at this stage would mean no pending row could ever
  // be found as related-to by another. (Caught by testing: importing two
  // pending reports for the same employer produced relatedCount: 0 for both,
  // when each should have listed the other.)
  const byHash = new Map<string, RawRow[]>();
  for (const row of (dupRes.data ?? []) as unknown as RawRow[]) {
    const list = byHash.get(row.content_hash) ?? [];
    list.push(row);
    byHash.set(row.content_hash, list);
  }

  const byOrg = new Map<string, RawRow[]>();
  for (const row of (relRes.data ?? []) as unknown as RawRow[]) {
    if (!row.organization_id) continue;
    const list = byOrg.get(row.organization_id) ?? [];
    list.push(row);
    byOrg.set(row.organization_id, list);
  }

  return pending.map((row) => {
    const source = sourceOf(row);
    const dup = (byHash.get(row.content_hash) ?? [])
      .filter((d) => d.id !== row.id)
      .map((d) => toRef(d, sourceKeyById));
    const rel = (row.organization_id ? (byOrg.get(row.organization_id) ?? []) : [])
      .filter((d) => d.id !== row.id && d.content_hash !== row.content_hash)
      .slice(0, 5)
      .map((d) => toRef(d, sourceKeyById));

    return {
      id: row.id,
      company: row.company,
      organizationId: row.organization_id,
      role: row.role,
      sourceKey: source?.key ?? row.source_id,
      sourceName: source?.display_name ?? "Unknown source",
      trustWeight: source ? Number(source.trust_weight) : 0,
      sourceUrl: row.source_url,
      externalRef: row.external_ref,
      contentHash: row.content_hash,
      experienceBucket: row.experience_bucket,
      stage: row.stage,
      outcome: row.outcome,
      responseTimeBucket: row.response_time_bucket,
      lastInteractionGap: row.last_interaction_gap,
      reason: row.reason,
      paymentFlag: row.payment_flag,
      reportedMonth: row.reported_month,
      extractionVersion: row.extraction_version,
      extractionConfidence: row.extraction_confidence === null ? null : Number(row.extraction_confidence),
      fieldsExtracted: row.fields_extracted ?? [],
      validationWarnings: row.validation_warnings ?? [],
      ingestedAt: row.ingested_at,
      duplicates: dup,
      related: rel,
    };
  });
}

export type ModerationAction = "approve" | "reject" | "archive";

const TARGET_STATUS: Record<ModerationAction, VerificationStatus> = {
  approve: "approved",
  reject: "rejected",
  archive: "archived",
};

/**
 * Apply a moderation decision. Allowed from ANY current status — including
 * re-deciding an approved/rejected row (e.g. archiving something that turned
 * out to be wrong after all) — because the immutability trigger (migration
 * 0009) permits verification_status to change freely; only the extracted
 * content and provenance are locked.
 */
export async function moderateExternalReport(
  client: SupabaseClient,
  id: string,
  action: ModerationAction
): Promise<void> {
  const { error } = await client
    .from("external_reports")
    .update({ verification_status: TARGET_STATUS[action], reviewed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(`moderateExternalReport(${id}, ${action}): ${error.message}`);
}
