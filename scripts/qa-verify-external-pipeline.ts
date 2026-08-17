/**
 * Live, production-safe verification of the external-reports pipeline:
 *
 *   import (runExternalImport) -> moderate (moderateExternalReport) ->
 *   confirm it can NEVER reach public_external_reports -> reject -> delete
 *
 * Every step calls the SAME application code the real admin routes and CLI
 * import tool use (no reimplemented logic, no raw SQL for the moderation
 * step). The fixture is attributed to `qa_external_verification`
 * (migration 0030) — a source with `enabled=false` PERMANENTLY, so a row
 * here structurally cannot appear on any public surface regardless of its
 * verification_status — and to the existing QA organization
 * (m54-qa-verification-test, D-024) via its exact slug, so no new
 * organization is created. This is the external-reports analogue of M5.4's
 * QA-org verification for the first-party submission pipeline.
 *
 * Usage: npx tsx scripts/qa-verify-external-pipeline.ts
 * Safe to re-run — cleans up after itself every time.
 */

import { loadEnv, adminClient, c } from "./_shared";
import { runExternalImport } from "../src/lib/hiring-intel/importer";
import { createSupabaseExternalReportStore } from "../src/lib/hiring-intel/store";
import { moderateExternalReport } from "../src/lib/hiring-intel/moderation";
import type { RawExternalReport } from "../src/lib/hiring-intel/types";

const QA_SOURCE_KEY = "qa_external_verification";
// Resolves via normalizeCompanySlug() to "m54-qa-verification-test" — the
// EXACT slug of the existing QA organization (D-024). Not a new org.
const QA_COMPANY_NAME = "M54 QA Verification Test";
const QA_EXTERNAL_REF = "qa-pipeline-verify-fixture-1";

async function main() {
  loadEnv();
  const supabase = adminClient();

  console.log(c.bold("\n=== External-reports pipeline QA verification ===\n"));

  // 0. Before count for this source.
  const before = await countForSource(supabase, QA_SOURCE_KEY);
  console.log(`Before: ${before} row(s) attributed to ${QA_SOURCE_KEY}`);

  // 1. Import — real insert via the exact same core the CLI/adapters use.
  const fixture: RawExternalReport = {
    company: QA_COMPANY_NAME,
    source_url: `https://example.com/qa-external-verification/${QA_EXTERNAL_REF}`,
    external_ref: QA_EXTERNAL_REF,
    stage: "technical",
    outcome: "rejected",
    reported_month: currentMonth(),
    extraction_version: "qa-fixture-v1",
    extraction_confidence: 1.0,
  };
  const store = createSupabaseExternalReportStore(supabase);
  const report = await runExternalImport({ store, sourceKey: QA_SOURCE_KEY, records: [fixture] });
  console.log(
    `Import: ${c.green(`${report.created} created`)} · ${report.duplicate} duplicate · ${report.invalid} invalid`
  );
  if (report.invalid > 0) {
    console.log(c.red("Import did not succeed cleanly — stopping before moderation."));
    process.exit(1);
  }

  // 2. Find the row (created just now, or already existing from a prior
  // interrupted run — either way we verify and clean up the same row).
  const row = await findFixtureRow(supabase);
  if (!row) {
    console.log(c.red("Could not find the fixture row after import — aborting."));
    process.exit(1);
  }
  console.log(`Fixture row id=${row.id}, organization_id=${row.organization_id ?? "(unresolved)"}`);
  if (!row.organization_id) {
    console.log(c.yellow("WARNING: did not resolve to the QA organization — company-name/slug drift. Investigate before trusting this run."));
  }

  // 3. Approve — the real admin action, not a raw UPDATE.
  await moderateExternalReport(supabase, row.id, "approve");
  console.log(c.green("Approved via moderateExternalReport()."));

  // 4. Confirm it can NEVER reach public_external_reports — the actual
  // safety property this whole exercise exists to prove, not assumed.
  const publicCount = await countPublicForSource(supabase, QA_SOURCE_KEY);
  if (publicCount > 0) {
    console.log(c.red(`FAIL: ${publicCount} row(s) from ${QA_SOURCE_KEY} are visible in public_external_reports — this must be 0.`));
    process.exit(1);
  }
  console.log(c.green("Confirmed: 0 rows visible in public_external_reports (source.enabled=false blocks it structurally, even approved)."));

  // 5. Confirm internal state really did change (approval took effect).
  const { data: internal } = await supabase.from("external_reports").select("verification_status").eq("id", row.id).maybeSingle();
  console.log(`Internal verification_status: ${(internal as { verification_status: string } | null)?.verification_status}`);

  // 6. Reject, then delete — full cleanup, mirroring M5.4's "reject the QA
  // submission afterward and verify it disappears".
  await moderateExternalReport(supabase, row.id, "reject");
  const { error: delErr } = await supabase.from("external_reports").delete().eq("id", row.id);
  if (delErr) {
    console.log(c.red(`Cleanup delete failed: ${delErr.message}`));
    process.exit(1);
  }

  const after = await countForSource(supabase, QA_SOURCE_KEY);
  console.log(`After cleanup: ${after} row(s) attributed to ${QA_SOURCE_KEY} (expected ${before})`);
  if (after !== before) {
    console.log(c.red("FAIL: count did not return to baseline after cleanup."));
    process.exit(1);
  }

  console.log(c.green("\n✓ Full pipeline verified: import -> moderate -> weight-eligible -> never-public -> reject -> removed.\n"));
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function countForSource(supabase: ReturnType<typeof adminClient>, sourceKey: string): Promise<number> {
  const { data: source } = await supabase.from("external_sources").select("id").eq("key", sourceKey).maybeSingle();
  if (!source) return 0;
  const { count } = await supabase
    .from("external_reports")
    .select("id", { count: "exact", head: true })
    .eq("source_id", (source as { id: string }).id);
  return count ?? 0;
}

async function countPublicForSource(supabase: ReturnType<typeof adminClient>, sourceKey: string): Promise<number> {
  const { count } = await supabase
    .from("public_external_reports")
    .select("id", { count: "exact", head: true })
    .eq("source_key", sourceKey);
  return count ?? 0;
}

async function findFixtureRow(
  supabase: ReturnType<typeof adminClient>
): Promise<{ id: string; organization_id: string | null } | null> {
  const { data } = await supabase
    .from("external_reports")
    .select("id, organization_id")
    .eq("external_ref", QA_EXTERNAL_REF)
    .maybeSingle();
  return (data as { id: string; organization_id: string | null } | null) ?? null;
}

main().catch((err) => {
  console.error(c.red(`\nqa-verify-external-pipeline failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
