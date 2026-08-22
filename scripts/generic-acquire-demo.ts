/**
 * generic-acquire-demo.ts — staging acceptance command for the hardened
 * generic pipeline (Task 3, "harden generic pipeline, no live site").
 *
 * Exercises the full separated chain against SAFE targets only:
 *   Part A (live browser proof): real headless-Chromium fetch of
 *     example.com via generic/fetcher.ts, then generic/parser.ts run on the
 *     live HTML — correctly yields 0 review cards (it isn't a review page),
 *     proving fetch+parse work on live HTML and never fabricate.
 *   Part B (ingest proof): parse the committed representative fixture
 *     (tests/fixtures/generic-review-page.html) -> generic/extract.ts ->
 *     external_reports, moderation-pending, idempotent by content_hash.
 *
 * NO real third-party site is scraped. Rows are attributed to the `demo`
 * external source (enabled=false PERMANENTLY — structurally never public)
 * with source_url on example.com (D-013 convention). Run twice: Part B
 * writes zero rows the second time (content_hash idempotency, enforced
 * app-side because external_reports.content_hash has no unique constraint).
 *
 * Usage:
 *   npm run acquire:generic-demo -- --company "Verdant Softworks"
 *   (run again -> 0 new rows)
 */
import { readFileSync } from "fs";
import path from "path";
import { loadEnv, adminClient, parseArgs, c } from "./_shared";
import { fetchSingle } from "../src/lib/external-intel/generic/fetcher";
import { parseReviewPage, type ReviewSelectors } from "../src/lib/external-intel/generic/parser";
import { extractReports } from "../src/lib/external-intel/generic/extract";

loadEnv();

const DEMO_TARGET_URL = "https://example.com/";
const SELECTORS: ReviewSelectors = {
  card: "li.review-card", company: ".company", role: ".role", outcome: ".outcome",
  stage: ".stage", experience: ".experience", responseTime: ".response-time",
  lastGap: ".last-gap", reason: ".reason", reportedDate: ".reported-date",
  externalRefAttr: "data-review-id",
};

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const company = flags.get("company") ?? "(demo batch)";
  const supabase = adminClient();

  console.log(c.dim(`\n[DISCOVERY] company filter: "${company}" (informational — the fixture is the representative page)`));

  // --- Source eligibility ---------------------------------------------------
  const { data: source } = await supabase.from("external_sources").select("id, enabled, acquisition_enabled").eq("key", "demo").maybeSingle();
  if (!source) { console.error(c.red("'demo' source not registered.")); process.exit(1); }
  const src = source as { id: string; enabled: boolean; acquisition_enabled: boolean };
  if (src.enabled) { console.error(c.red("'demo' source is enabled=true — aborting to avoid a public write.")); process.exit(1); }
  if (!src.acquisition_enabled) { console.error(c.red("'demo' source acquisition_enabled=false — refusing.")); process.exit(1); }
  console.log(c.green(`[ELIGIBILITY] demo source ok (acquisition_enabled, enabled=false → never public)`));

  const runStart = new Date().toISOString();
  const { data: run } = await supabase.from("external_acquisition_runs")
    .insert({ source_key: "demo", company_query: company.slice(0, 200), status: "fetching", triggered_by: "manual", started_at: runStart })
    .select("id").single();
  const runId = (run as { id: string } | null)?.id ?? null;

  // --- Part A: real live browser fetch of the safe target -------------------
  console.log(c.dim(`[FETCH] real headless Chromium -> ${DEMO_TARGET_URL}`));
  const livePages = await fetchSingle(DEMO_TARGET_URL, { waitUntil: "domcontentloaded" });
  const live = livePages[0];
  const liveParse = parseReviewPage(live.html, SELECTORS);
  console.log(c.green(`[FETCH] ok — rendered ${live.html.length} bytes, rawHash ${live.rawHash.slice(0, 16)}…, review cards found on live page: ${liveParse.cardsFound} (expected 0 — example.com is not a review page)`));

  // --- Part B: parse representative fixture -> extract -----------------------
  const fixture = readFileSync(path.join(process.cwd(), "tests/fixtures/generic-review-page.html"), "utf8");
  const parsed = parseReviewPage(fixture, SELECTORS);
  console.log(c.dim(`[PARSE] representative fixture: ${parsed.cardsFound} cards`));

  const { extracted, droppedPartial, droppedNoDimension, dedupedInBatch } = extractReports({
    records: parsed.records,
    sourcePageUrl: `${DEMO_TARGET_URL}reviews/demo`,
    rawHtmlHash: live.rawHash,
    acquiredAt: live.fetchedAt,
  });
  console.log(c.green(`[EXTRACT] ${extracted.length} report(s); dropped ${droppedPartial} partial, ${droppedNoDimension} no-dimension; ${dedupedInBatch} in-batch dup`));

  // --- Validate + idempotent write (pending moderation) ---------------------
  if (runId) await supabase.from("external_acquisition_runs").update({ status: "extracted" }).eq("id", runId);

  let created = 0, duplicate = 0;
  const createdIds: string[] = [];
  for (const e of extracted) {
    const { data: existing } = await supabase.from("external_reports").select("id").eq("content_hash", e.contentHash).maybeSingle();
    if (existing) { duplicate++; continue; }

    const companySlug = e.report.company.toLowerCase().trim().replace(/\s+/g, "-");
    const { data: org } = await supabase.from("organizations").select("id").eq("slug", companySlug).maybeSingle();

    const { data: inserted, error } = await supabase.from("external_reports").insert({
      company: e.report.company,
      organization_id: (org as { id: string } | null)?.id ?? null,
      role: e.report.role, source_id: src.id, source_url: e.report.source_url,
      external_ref: e.report.external_ref, content_hash: e.contentHash,
      experience_bucket: e.report.experience_bucket, stage: e.report.stage, outcome: e.report.outcome,
      response_time_bucket: e.report.response_time_bucket, last_interaction_gap: e.report.last_interaction_gap,
      reason: e.report.reason, reported_month: e.report.reported_month,
      verification_status: "pending",
      extraction_version: e.report.extraction_version, extraction_confidence: e.report.extraction_confidence,
      fields_extracted: [{ field: "_provenance", value: e.provenance }],
    }).select("id").single();
    if (error) { console.error(c.red(`  insert failed: ${error.message}`)); continue; }
    created++;
    createdIds.push((inserted as { id: string }).id);
  }

  if (runId) await supabase.from("external_acquisition_runs").update({
    status: created > 0 ? "awaiting_moderation" : "completed",
    records_found: extracted.length, records_created: created, records_duplicate: duplicate,
    finished_at: new Date().toISOString(),
  }).eq("id", runId);

  console.log(c.green(`\n=== RESULT ===`));
  console.log(c.dim(`  command target:   ${DEMO_TARGET_URL} (live fetch) + representative fixture (parse)`));
  console.log(c.dim(`  records extracted: ${extracted.length}`));
  console.log(c.dim(`  created (pending): ${created}  ${createdIds.length ? "→ " + createdIds.join(", ") : ""}`));
  console.log(c.dim(`  duplicate (skipped, idempotent): ${duplicate}`));
  console.log(c.dim(`  acquisition_run:  ${runId ?? "(not recorded)"}`));
  if (extracted[0]) {
    const s = extracted[0];
    console.log(c.dim(`  sample record:    company=${s.report.company} outcome=${s.report.outcome ?? "-"} stage=${s.report.stage ?? "-"}`));
    console.log(c.dim(`    source_url:     ${s.report.source_url}`));
    console.log(c.dim(`    external_ref:   ${s.report.external_ref}`));
    console.log(c.dim(`    content_hash:   ${s.contentHash}`));
    console.log(c.dim(`    provenance:     ${JSON.stringify(s.provenance)}`));
  }
  console.log(c.dim(`\nAll rows: verification_status='pending' on the 'demo' source (enabled=false) — never public without an explicit moderation decision, and structurally excluded regardless.`));
  if (created === 0 && duplicate > 0) console.log(c.yellow(`\n✓ IDEMPOTENT: every extracted record already existed — zero duplicate rows written.`));
}

main().catch((err) => {
  console.error(c.red(`\ngeneric-acquire-demo failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
