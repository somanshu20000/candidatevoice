/**
 * The acquisition pipeline orchestrator — the real, end-to-end vertical
 * slice:
 *
 *   company search -> detect unknown/sparse -> source eligibility check
 *   -> acquire permitted source -> structured extraction (adapter.load())
 *   -> provenance + content hash + validation + dedup (runExternalImport,
 *      UNCHANGED from D-028) -> moderation queue -> external_reports
 *
 * Every stage transition is persisted to external_acquisition_runs
 * (migration 0031) so an admin can see an attempt even when it produced
 * zero records — the one thing no existing table could show.
 *
 * WHAT THIS FILE DOES NOT DO: validate, dedupe, or insert evidence itself —
 * that is 100% delegated to runExternalImport (src/lib/hiring-intel/importer.ts),
 * exactly as every source already does. This file's only job is detecting
 * which company/source to run, checking eligibility, calling the adapter,
 * and recording what happened. Nothing here can bypass moderation: every
 * record this produces lands `verification_status='pending'`, identical to
 * a manual `npm run external:import` run.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchOrganizationsRanked, confidenceTier, createCompanyRequest } from "../company-intelligence/resolve";
import { findOrganizationByDomain } from "../company-intelligence/requests";
import { createSupabaseExternalReportStore } from "../hiring-intel/store";
import { runExternalImport } from "../hiring-intel/importer";
import type { AcquisitionAdapter } from "../hiring-intel/types";
import { redditAdapter } from "./adapters/reddit";
import { demoAdapter } from "./adapters/demo";

export const ADAPTERS: Record<string, AcquisitionAdapter> = {
  reddit: redditAdapter,
  demo: demoAdapter,
};

export type RunStatus =
  | "queued"
  | "fetching"
  | "extracted"
  | "validation_failed"
  | "awaiting_moderation"
  | "completed"
  | "failed";

export interface AcquisitionRunResult {
  runId: string;
  status: RunStatus;
  organizationId: string | null;
  /** Set when the company did not resolve confidently and a company_request
   *  was queued instead of running acquisition. */
  companyRequestCreated: boolean;
  recordsFound: number;
  recordsCreated: number;
  recordsDuplicate: number;
  recordsInvalid: number;
  errorMessage: string | null;
}

export interface RunAcquisitionInput {
  supabase: SupabaseClient;
  companyQuery: string;
  sourceKey: string;
  triggeredBy?: "manual" | "cron" | "api";
  /** Passed through to the adapter's load() as-is (e.g. {variant} for demo). */
  adapterInput?: Record<string, unknown>;
}

async function insertRun(
  supabase: SupabaseClient,
  fields: { sourceKey: string; companyQuery: string; triggeredBy: string }
): Promise<string> {
  const { data, error } = await supabase
    .from("external_acquisition_runs")
    .insert({ source_key: fields.sourceKey, company_query: fields.companyQuery, triggered_by: fields.triggeredBy, status: "queued" })
    .select("id")
    .single();
  if (error) throw new Error(`insertRun: ${error.message}`);
  return (data as { id: string }).id;
}

async function updateRun(
  supabase: SupabaseClient,
  runId: string,
  fields: Partial<{
    status: RunStatus;
    organization_id: string | null;
    records_found: number;
    records_created: number;
    records_duplicate: number;
    records_invalid: number;
    error_message: string | null;
    finished_at: string;
  }>
): Promise<void> {
  const { error } = await supabase.from("external_acquisition_runs").update(fields).eq("id", runId);
  if (error) throw new Error(`updateRun(${runId}): ${error.message}`);
}

/** Normalize a website URL to a bare domain — mirrors the exact logic
 *  already used in company-requests/create/route.ts and requests.ts. */
function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

const CONFIDENT_MATCH_FLOOR = 0.85;

/**
 * Stage 1-2: company search -> detect unknown/sparse. Returns the resolved
 * organizationId for a confidently-matched company, or null (meaning: not
 * found confidently, a company_request should be queued instead). `slug` is
 * returned alongside `displayName` because they serve DIFFERENT jobs below:
 * displayName is what gets searched/shown (readable), slug is what gets
 * written onto the acquired record's `company` field (guaranteed to
 * round-trip back through resolve_organization() — see rewriteToResolvableCompany).
 */
async function resolveCompany(
  supabase: SupabaseClient,
  companyQuery: string
): Promise<{ organizationId: string | null; displayName: string; slug: string | null }> {
  const candidates = await searchOrganizationsRanked(supabase, companyQuery, 3);
  const top = candidates[0];
  if (top && confidenceTier(top.score) === "confident" && top.score >= CONFIDENT_MATCH_FLOOR) {
    return { organizationId: top.organizationId, displayName: top.displayName, slug: top.slug };
  }
  return { organizationId: null, displayName: companyQuery, slug: null };
}

/**
 * BUG FOUND VIA LIVE ACCEPTANCE TESTING (not assumed): an adapter searches
 * using the organization's real display_name for good result quality, but
 * hiring-intel's own org-resolution (store.resolveOrganization ->
 * normalizeCompanySlug -> resolve_organization RPC) only lowercases and
 * hyphenates WHITESPACE — it does not strip punctuation. A display_name
 * containing parens/commas/em-dashes (confirmed live: the QA organization's
 * own "(QA TEST — M5.4 pipeline verification, safe to ignore)") does not
 * round-trip back to the same organization, so the resulting external_reports
 * row silently landed with organization_id=null — evidence that validated
 * and queued correctly, but could never be found on any company page.
 *
 * Fix: once we already have a CONFIDENT organizationId, rewrite every
 * record's `company` field to that organization's own `slug` — verbatim,
 * unchanged. A slug fed back into normalizeCompanySlug is unchanged (already
 * lowercase, already hyphenated, no whitespace to touch), so it always
 * resolves to itself. RawExternalReport/normalizeExternalReport/
 * runExternalImport are NOT modified — this only changes what this
 * orchestrator hands them.
 */
function rewriteToResolvableCompany<T extends { company: string }>(records: T[], slug: string): T[] {
  return records.map((r) => ({ ...r, company: slug }));
}

/**
 * The full vertical slice. Never throws for an ordinary pipeline outcome
 * (ineligible source, adapter returning nothing, all-invalid records) — those
 * are all reported via the returned status/errorMessage and persisted to
 * external_acquisition_runs. Only a genuine infrastructure failure (DB
 * unreachable) propagates.
 */
export async function runAcquisition(input: RunAcquisitionInput): Promise<AcquisitionRunResult> {
  const { supabase, companyQuery, sourceKey, triggeredBy = "manual", adapterInput } = input;
  const trimmedQuery = companyQuery.trim();

  const runId = await insertRun(supabase, { sourceKey, companyQuery: trimmedQuery, triggeredBy });

  const fail = async (message: string): Promise<AcquisitionRunResult> => {
    await updateRun(supabase, runId, { status: "failed", error_message: message.slice(0, 2000), finished_at: new Date().toISOString() });
    return {
      runId,
      status: "failed",
      organizationId: null,
      companyRequestCreated: false,
      recordsFound: 0,
      recordsCreated: 0,
      recordsDuplicate: 0,
      recordsInvalid: 0,
      errorMessage: message,
    };
  };

  if (!trimmedQuery) return fail("companyQuery is required");

  const adapter = ADAPTERS[sourceKey];
  if (!adapter) return fail(`Unknown source "${sourceKey}" — no adapter registered`);

  // --- Stage: eligibility check (acquisition_enabled gate). ---------------
  const { data: sourceRow, error: sourceErr } = await supabase
    .from("external_sources")
    .select("acquisition_enabled")
    .eq("key", sourceKey)
    .maybeSingle();
  if (sourceErr) return fail(`external_sources lookup failed: ${sourceErr.message}`);
  if (!sourceRow) return fail(`Source "${sourceKey}" is not registered in external_sources`);
  if (!(sourceRow as { acquisition_enabled: boolean }).acquisition_enabled) {
    return fail(`Source "${sourceKey}" has acquisition_enabled=false — refusing to acquire (Q-2 gate)`);
  }

  // --- Stage: company search -> detect unknown/sparse. ---------------------
  const { organizationId, displayName, slug } = await resolveCompany(supabase, trimmedQuery);
  await updateRun(supabase, runId, { organization_id: organizationId });

  if (!organizationId) {
    // Unknown company: queue a company_request instead of acquiring blind —
    // never invent an organization. Reuses the EXACT same collision-checked
    // path the public "Add this company" flow uses.
    let domain: string | null = null;
    try {
      const urlMatch = trimmedQuery.match(/^https?:\/\//) ? trimmedQuery : null;
      if (urlMatch) domain = normalizeDomain(urlMatch);
    } catch {
      domain = null;
    }
    if (domain) {
      const existingByDomain = await findOrganizationByDomain(supabase, domain);
      if (existingByDomain) {
        await updateRun(supabase, runId, {
          status: "failed",
          organization_id: existingByDomain,
          error_message: "Domain already resolves to an existing organization — not a genuinely unknown company",
          finished_at: new Date().toISOString(),
        });
        return {
          runId,
          status: "failed",
          organizationId: existingByDomain,
          companyRequestCreated: false,
          recordsFound: 0,
          recordsCreated: 0,
          recordsDuplicate: 0,
          recordsInvalid: 0,
          errorMessage: "Domain collision — use the resolved organization instead",
        };
      }
    }
    const result = await createCompanyRequest(supabase, {
      requestedName: displayName,
      requestedDomain: domain,
      requesterNote: `Auto-queued by external acquisition orchestrator (source=${sourceKey})`,
    });
    await updateRun(supabase, runId, {
      status: result.ok ? "completed" : "failed",
      error_message: result.ok ? null : "createCompanyRequest failed",
      finished_at: new Date().toISOString(),
    });
    return {
      runId,
      status: result.ok ? "completed" : "failed",
      organizationId: null,
      companyRequestCreated: result.ok,
      recordsFound: 0,
      recordsCreated: 0,
      recordsDuplicate: 0,
      recordsInvalid: 0,
      errorMessage: result.ok ? null : "Could not queue company_request",
    };
  }

  // --- Stage: acquire (adapter.load()). ------------------------------------
  await updateRun(supabase, runId, { status: "fetching" });
  let records;
  try {
    records = await adapter.load({ companyName: displayName, ...adapterInput });
  } catch (err) {
    return fail(`Adapter "${sourceKey}" threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  await updateRun(supabase, runId, { status: "extracted", records_found: records.length });
  if (records.length === 0) {
    await updateRun(supabase, runId, { status: "completed", finished_at: new Date().toISOString() });
    return {
      runId,
      status: "completed",
      organizationId,
      companyRequestCreated: false,
      recordsFound: 0,
      recordsCreated: 0,
      recordsDuplicate: 0,
      recordsInvalid: 0,
      errorMessage: null,
    };
  }

  // --- Stage: validate + dedupe + insert as PENDING (D-028's UNCHANGED
  //     core — this is the moderation boundary; nothing bypasses it). -------
  // organizationId is already confidently resolved (the eligibility branch
  // above never reaches here otherwise) — rewrite `company` to the org's own
  // slug so runExternalImport's internal re-resolution actually lands on the
  // SAME organization, instead of silently orphaning the record (see
  // rewriteToResolvableCompany's comment for how this was found).
  const resolvableRecords = slug ? rewriteToResolvableCompany(records, slug) : records;
  const store = createSupabaseExternalReportStore(supabase);
  const report = await runExternalImport({ store, sourceKey, records: resolvableRecords });

  const finalStatus: RunStatus =
    report.created > 0 ? "awaiting_moderation" : report.invalid === report.total ? "validation_failed" : "completed";

  await updateRun(supabase, runId, {
    status: finalStatus,
    records_created: report.created,
    records_duplicate: report.duplicate,
    records_invalid: report.invalid,
    finished_at: new Date().toISOString(),
  });

  return {
    runId,
    status: finalStatus,
    organizationId,
    companyRequestCreated: false,
    recordsFound: records.length,
    recordsCreated: report.created,
    recordsDuplicate: report.duplicate,
    recordsInvalid: report.invalid,
    errorMessage: null,
  };
}
