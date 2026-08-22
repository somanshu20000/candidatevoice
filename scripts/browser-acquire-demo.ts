/**
 * browser-acquire-demo.ts — end-to-end acceptance demo for the browser
 * acquisition layer: discover -> source eligibility -> real Playwright fetch
 * -> extract -> validate -> external_reports (pending moderation).
 *
 * WHY THE DEMO SOURCE, NOT A REAL SITE
 * See src/lib/external-intel/adapters/browser-demo.ts's header: no
 * JS-rendered hiring-review source has cleared Q-2's legal/ToS gate today
 * (Glassdoor/AmbitionBox are proprietary-licensed and forbidden; Reddit —
 * the one cleared source — needs no browser at all). This script proves the
 * BROWSER LAYER genuinely works (a real headless-Chromium navigation, a real
 * robots.txt check, a real rendered-HTML hash) against example.com, and
 * writes through the exact same external_reports shape / idempotency
 * discipline a real source would use. The single external dependency
 * blocking a real site: Q-2 legal/ToS clearance for a JS-rendered source,
 * not a technical limitation of this script.
 *
 * SAFETY (same as scripts/seed-realistic-dataset.ts):
 *   - Writes only to the `demo` external_sources row (enabled=false
 *     PERMANENTLY — structurally can never reach public_external_reports).
 *   - Idempotent by content_hash: content_hash has NO unique constraint in
 *     the schema (confirmed via information_schema before writing this),
 *     so idempotency is enforced here, app-side, with a check-then-insert —
 *     same pattern the real importer (src/lib/hiring-intel/importer.ts) and
 *     seed-realistic-dataset.ts both already use.
 *   - Never writes is_approved/verification_status='approved' — every row
 *     lands 'pending', exactly where the real moderation queue expects it.
 *
 * Usage:
 *   tsx scripts/browser-acquire-demo.ts
 *   tsx scripts/browser-acquire-demo.ts   (run again — proves idempotency)
 */
import { createHash } from "crypto";
import { loadEnv, adminClient, c } from "./_shared";
import { browserDemoAdapter, BROWSER_DEMO_TARGET_URL } from "../src/lib/external-intel/adapters/browser-demo";
import type { RawExternalReport } from "../src/lib/hiring-intel/types";

loadEnv();

const DEMO_COMPANY = "Verdant Softworks"; // one of the fictional orgs seed-realistic-dataset.ts already created

function hashExternalContent(fields: {
  companySlug: string; role: string; experienceBucket: string; stage: string;
  outcome: string; responseTimeBucket: string; lastInteractionGap: string;
  reason: string; paymentFlag: string; reportedMonth: string;
}): string {
  const canonical = [
    fields.companySlug, fields.role, fields.experienceBucket, fields.stage,
    fields.outcome, fields.responseTimeBucket, fields.lastInteractionGap,
    fields.reason, fields.paymentFlag, fields.reportedMonth,
  ].join("");
  return createHash("sha256").update(canonical).digest("hex");
}

async function main() {
  const supabase = adminClient();
  const startedAt = new Date().toISOString();

  console.log(c.dim(`\n[1/6] DISCOVERY — target company: "${DEMO_COMPANY}"`));

  console.log(c.dim(`[2/6] SOURCE ELIGIBILITY — resolving 'demo' external_sources row`));
  const { data: source, error: sourceErr } = await supabase
    .from("external_sources").select("id, enabled, acquisition_enabled").eq("key", "demo").maybeSingle();
  if (sourceErr || !source) {
    console.error(c.red("  'demo' source not registered — run migration demo_external_source first."));
    process.exit(1);
  }
  const src = source as { id: string; enabled: boolean; acquisition_enabled: boolean };
  if (!src.acquisition_enabled) {
    console.error(c.red("  'demo' source has acquisition_enabled=false — refusing to acquire."));
    process.exit(1);
  }
  if (src.enabled) {
    console.error(c.red("  WARNING: 'demo' source has enabled=true — expected permanently false. Aborting rather than risk a public write."));
    process.exit(1);
  }
  console.log(c.green(`  ✓ eligible: acquisition_enabled=true, enabled=false (never publishable)`));

  // Insert an external_acquisition_runs row up front — 'queued' — so the run
  // is visible/auditable even if the fetch below fails, same as the real
  // orchestrator (src/lib/external-intel/orchestrator.ts) does.
  const { data: run, error: runErr } = await supabase
    .from("external_acquisition_runs")
    .insert({ source_key: "demo", company_query: DEMO_COMPANY, status: "queued", triggered_by: "manual", started_at: startedAt })
    .select("id").single();
  const runId = runErr || !run ? null : (run as { id: string }).id;

  console.log(c.dim(`[3/6] BROWSER FETCH — launching headless Chromium, navigating to ${BROWSER_DEMO_TARGET_URL}`));
  let records: RawExternalReport[];
  try {
    records = await browserDemoAdapter.load({ companyName: DEMO_COMPANY, variant: "rejected" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(c.red(`  browser fetch failed: ${message}`));
    if (runId) await supabase.from("external_acquisition_runs").update({ status: "failed", error_message: message.slice(0, 2000), finished_at: new Date().toISOString() }).eq("id", runId);
    process.exit(1);
  }
  if (records.length === 0) {
    console.error(c.red("  adapter returned zero records"));
    if (runId) await supabase.from("external_acquisition_runs").update({ status: "failed", error_message: "zero records", finished_at: new Date().toISOString() }).eq("id", runId);
    process.exit(1);
  }
  const record = records[0];
  const provenance = (record as RawExternalReport & { _browserProvenance?: Record<string, unknown> })._browserProvenance ?? null;
  console.log(c.green(`  ✓ real browser navigation complete — rendered HTML hash: ${String((provenance as Record<string, string> | null)?.rawHtmlHash ?? "").slice(0, 16)}…`));

  console.log(c.dim(`[4/6] EXTRACT — structured fields from the adapter's output`));
  const companySlug = record.company.toLowerCase().trim().replace(/\s+/g, "-");
  const experienceBucket = record.experience_bucket ?? "";
  const stage = record.stage ?? "";
  const outcome = record.outcome ?? "";
  const responseTimeBucket = record.response_time_bucket ?? "";
  const lastInteractionGap = record.last_interaction_gap ?? "";
  const reason = record.reason ?? "no_reason";
  const paymentFlag = String(record.payment_flag ?? false);
  const reportedMonth = record.reported_month ?? "";
  console.log(c.green(`  ✓ role=${record.role} stage=${stage} outcome=${outcome}`));

  console.log(c.dim(`[5/6] VALIDATE — canonical content hash + idempotency check`));
  const contentHash = hashExternalContent({
    companySlug, role: record.role ?? "", experienceBucket, stage, outcome,
    responseTimeBucket, lastInteractionGap, reason, paymentFlag, reportedMonth,
  });

  const { data: existing } = await supabase.from("external_reports").select("id, ingested_at").eq("content_hash", contentHash).maybeSingle();
  if (existing) {
    const row = existing as { id: string; ingested_at: string };
    console.log(c.yellow(`  ⏭  IDEMPOTENT SKIP — a record with this exact content_hash already exists (id=${row.id}, first ingested ${row.ingested_at}). No duplicate written.`));
    if (runId) await supabase.from("external_acquisition_runs").update({ status: "completed", records_found: 1, records_duplicate: 1, finished_at: new Date().toISOString() }).eq("id", runId);
    console.log(c.dim(`\nRun again with a different company to see a fresh insert, or this is exactly the proof: same logical record, zero duplicate rows.`));
    return;
  }

  const { data: orgMatch } = await supabase.from("organizations").select("id").eq("slug", companySlug).maybeSingle();

  console.log(c.dim(`[6/6] WRITE — external_reports (verification_status='pending', i.e. awaiting moderation)`));
  const { data: inserted, error: insertErr } = await supabase.from("external_reports").insert({
    company: record.company,
    organization_id: (orgMatch as { id: string } | null)?.id ?? null,
    role: record.role,
    source_id: src.id,
    source_url: record.source_url,
    external_ref: record.external_ref,
    content_hash: contentHash,
    experience_bucket: record.experience_bucket,
    stage: record.stage,
    outcome: record.outcome,
    response_time_bucket: record.response_time_bucket,
    last_interaction_gap: record.last_interaction_gap,
    reason: record.reason,
    payment_flag: record.payment_flag ?? false,
    reported_month: record.reported_month,
    verification_status: "pending",
    extraction_version: record.extraction_version,
    extraction_confidence: record.extraction_confidence,
    fields_extracted: provenance ? [{ field: "_browser_provenance", value: provenance }] : [],
  }).select("id, ingested_at").single();

  if (insertErr || !inserted) {
    console.error(c.red(`  insert failed: ${insertErr?.message}`));
    if (runId) await supabase.from("external_acquisition_runs").update({ status: "failed", error_message: insertErr?.message?.slice(0, 2000) ?? "insert failed", finished_at: new Date().toISOString() }).eq("id", runId);
    process.exit(1);
  }
  const row = inserted as { id: string; ingested_at: string };

  if (runId) {
    await supabase.from("external_acquisition_runs").update({
      status: "awaiting_moderation", organization_id: (orgMatch as { id: string } | null)?.id ?? null,
      records_found: 1, records_created: 1, finished_at: new Date().toISOString(),
    }).eq("id", runId);
  }

  console.log(c.green(`\n✓ external_reports row created:`));
  console.log(c.dim(`  id:               ${row.id}`));
  console.log(c.dim(`  source_url:       ${record.source_url}`));
  console.log(c.dim(`  external_ref:     ${record.external_ref}`));
  console.log(c.dim(`  content_hash:     ${contentHash}`));
  console.log(c.dim(`  verification_status: pending (awaiting moderation)`));
  console.log(c.dim(`  organization_id:  ${(orgMatch as { id: string } | null)?.id ?? "(unresolved — company_requests fallback not implemented in this demo)"}`));
  console.log(c.dim(`  provenance:       ${JSON.stringify(provenance)}`));
  console.log(c.dim(`  acquisition_run:  ${runId ?? "(not recorded)"}`));
  console.log(c.dim(`\nThis row is NOT public: it is attributed to the 'demo' source (enabled=false permanently) and verification_status='pending' — both independently required for src/lib/hiring-intel/store.ts's public_external_reports view to expose it.`));
}

main().catch((err) => {
  console.error(c.red(`\nbrowser-acquire-demo failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
