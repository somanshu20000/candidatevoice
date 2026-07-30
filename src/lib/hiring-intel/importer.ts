/**
 * External hiring intelligence — the ingestion pipeline.
 *
 *   RawExternalReport[]  →  normalize/validate  →  dedupe  →  resolve org
 *                                                              →  insert (pending)
 *
 * Source-agnostic: it knows nothing about Reddit or any specific source. It
 * takes already-fetched records (an adapter, in any language, produces them)
 * and the source key to attribute them to. Everything lands as `pending`;
 * moderation is a separate, human step.
 *
 * Idempotent: re-importing the same records is a no-op, because each is
 * deduped on (source, external_ref) and (source, content_hash) before insert.
 */

import { normalizeExternalReport } from "./normalize";
import type { ExternalReportStore } from "./store";
import type { ExternalImportReport, RawExternalReport, ValidationIssue } from "./types";

export interface ExternalImportOptions {
  store: ExternalReportStore;
  sourceKey: string;
  records: RawExternalReport[];
  /** Validate and dedupe but write nothing. */
  dryRun?: boolean;
}

export async function runExternalImport(options: ExternalImportOptions): Promise<ExternalImportReport> {
  const { store, sourceKey, records, dryRun = false } = options;

  const source = await store.getSource(sourceKey);
  if (!source) {
    throw new Error(`Unknown external source "${sourceKey}". Register it in external_sources first.`);
  }

  const report: ExternalImportReport = {
    sourceKey,
    total: records.length,
    created: 0,
    duplicate: 0,
    invalid: 0,
    dryRun,
    issues: [],
  };

  // Dedupe within THIS batch too, so a file containing the same report twice
  // does not insert it twice before the DB-level check ever runs.
  const seenHashes = new Set<string>();

  for (const raw of records) {
    const { normalized, issues } = normalizeExternalReport(raw);
    const named = typeof raw?.company === "string" && raw.company.trim() ? raw.company.trim() : "(unnamed)";
    const errorIssues = issues.filter((i: ValidationIssue) => i.severity === "error");

    if (!normalized) {
      report.invalid++;
      report.issues.push({ company: named, issues });
      continue;
    }
    if (issues.length > 0) report.issues.push({ company: named, issues });
    void errorIssues;

    if (seenHashes.has(normalized.contentHash)) {
      report.duplicate++;
      continue;
    }
    seenHashes.add(normalized.contentHash);

    if (dryRun) {
      report.created++; // "would create"
      continue;
    }

    const already = await store.exists(source.id, normalized.externalRef, normalized.contentHash);
    if (already) {
      report.duplicate++;
      continue;
    }

    const organizationId = await store.resolveOrganization(normalized.companySlug);
    await store.insertReport({ organizationId, sourceId: source.id, report: normalized });
    report.created++;
  }

  return report;
}
