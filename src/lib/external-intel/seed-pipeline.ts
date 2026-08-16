/**
 * Case 1 orchestrator — known company, sparse evidence → discover a permitted
 * external source → extract → run through the EXISTING hiring-intel import
 * pipeline (normalize/validate/dedupe/persist-as-pending). This is the
 * production-viable skeleton D-027 describes: every stage is real and wired,
 * and the pipeline is honest about the one stage genuinely blocked on a human
 * decision (a permitted, credentialed source — Q-2) rather than faking it.
 *
 * Writes nothing on its own — runExternalImport (unmodified) is what
 * persists, always to `pending`, always subject to the same moderation
 * boundary every other external report goes through.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseExternalReportStore } from "../hiring-intel/store";
import { runExternalImport } from "../hiring-intel/importer";
import { discoverPermittedSource } from "./web-discovery";
import { extractReportsFromSource } from "./extract";

export interface SeedDiscoveryOutcome {
  ran: boolean;
  reason: string;
  sourceKey?: string;
  created?: number;
  duplicate?: number;
}

export async function runExternalSeedDiscovery(
  supabase: SupabaseClient,
  organizationSlug: string,
  companyName: string
): Promise<SeedDiscoveryOutcome> {
  const discovery = await discoverPermittedSource(supabase, organizationSlug);
  if (!discovery.found) {
    return { ran: false, reason: discovery.reason };
  }

  const extraction = await extractReportsFromSource(discovery.source, companyName);
  if (extraction.reports.length === 0) {
    return { ran: false, reason: extraction.reason ?? "extraction produced no reports", sourceKey: discovery.source.key };
  }

  const store = createSupabaseExternalReportStore(supabase);
  const report = await runExternalImport({ store, sourceKey: discovery.source.key, records: extraction.reports });
  return {
    ran: true,
    reason: "imported via existing hiring-intel pipeline",
    sourceKey: discovery.source.key,
    created: report.created,
    duplicate: report.duplicate,
  };
}
