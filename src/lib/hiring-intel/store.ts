/**
 * External hiring intelligence — persistence boundary.
 *
 * The importer talks to this interface, never to Supabase directly, so the
 * pipeline is testable against an in-memory fake and every table name lives in
 * one file. Reuses resolve_organization() (migration 0002) so an external
 * report attaches to the SAME canonical employer a first-party submission would
 * — the one identifier the two families legitimately share.
 *
 * Every row is inserted with verification_status left at its 'pending' default:
 * nothing an importer writes is publicly visible until a human approves it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NormalizedExternalReport } from "./types";

export interface ExternalSourceRow {
  id: string;
  key: string;
  enabled: boolean;
  trustWeight: number;
}

export interface ExternalReportInsert {
  organizationId: string | null;
  sourceId: string;
  report: NormalizedExternalReport;
}

export interface ExternalReportStore {
  getSource(key: string): Promise<ExternalSourceRow | null>;
  resolveOrganization(slug: string): Promise<string | null>;
  /** True when this source already has a row with the same external_ref or content hash. */
  exists(sourceId: string, externalRef: string | null, contentHash: string): Promise<boolean>;
  insertReport(input: ExternalReportInsert): Promise<void>;
}

export function createSupabaseExternalReportStore(client: SupabaseClient): ExternalReportStore {
  return {
    async getSource(key) {
      const { data, error } = await client
        .from("external_sources")
        .select("id, key, enabled, trust_weight")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`getSource(${key}): ${error.message}`);
      if (!data) return null;
      return { id: data.id, key: data.key, enabled: data.enabled, trustWeight: Number(data.trust_weight) };
    },

    async resolveOrganization(slug) {
      const { data, error } = await client.rpc("resolve_organization", { p_slug: slug });
      if (error) throw new Error(`resolveOrganization(${slug}): ${error.message}`);
      return (data as string | null) ?? null;
    },

    async exists(sourceId, externalRef, contentHash) {
      // Match either unique key: same original post (external_ref) or same
      // extracted content (content_hash).
      const orClause = externalRef
        ? `external_ref.eq.${externalRef},content_hash.eq.${contentHash}`
        : `content_hash.eq.${contentHash}`;
      const { data, error } = await client
        .from("external_reports")
        .select("id")
        .eq("source_id", sourceId)
        .or(orClause)
        .limit(1);
      if (error) throw new Error(`exists check: ${error.message}`);
      return (data?.length ?? 0) > 0;
    },

    async insertReport({ organizationId, sourceId, report }) {
      const { error } = await client.from("external_reports").insert({
        company: report.company,
        organization_id: organizationId,
        role: report.role,
        source_id: sourceId,
        source_url: report.sourceUrl,
        external_ref: report.externalRef,
        content_hash: report.contentHash,
        experience_bucket: report.experienceBucket,
        stage: report.stage,
        outcome: report.outcome,
        response_time_bucket: report.responseTimeBucket,
        last_interaction_gap: report.lastInteractionGap,
        reason: report.reason,
        payment_flag: report.paymentFlag,
        reported_month: report.reportedMonth,
        // Explainability trail (migration 0009). Once written, these are
        // immutable — the DB trigger rejects any later change to them.
        extraction_version: report.extractionVersion,
        extraction_confidence: report.extractionConfidence,
        fields_extracted: report.fieldsExtracted,
        validation_warnings: report.validationWarnings,
        // verification_status defaults to 'pending' — do not set it here.
      });
      if (error) throw new Error(`insertReport(${report.company}): ${error.message}`);
    },
  };
}
