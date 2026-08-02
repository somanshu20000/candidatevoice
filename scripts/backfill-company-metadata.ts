/**
 * Backfill company metadata for organizations already in the database.
 *
 * WHY THIS EXISTS
 * Every other enrichment entry point is driven by an EXTERNAL list — a CSV of
 * names (bulk-import), or a single page visit (the on-demand route). Neither
 * answers "which orgs already in our DB are missing metadata, or predate a
 * newer extractor?" This script does: it reads `organizations` directly and
 * enriches by org.
 *
 * It reuses enrichCompanyOnDemand verbatim — the SAME adapters, the SAME
 * resilientFetch hardening (SSRF/robots/rate-limit), the SAME runImport
 * provenance pipeline and the D1 confidence ratchet. It is not a new ingestion
 * path, just a new trigger over the existing one. In particular:
 *   - runImport's content-hash batch dedup makes re-running a no-op when
 *     nothing changed, so --refresh is cheap and idempotent.
 *   - the confidence ratchet (store.upgradedConfidence) means a re-enrich, which
 *     always writes `unverified`, can NEVER downgrade a row a prior verified
 *     import already raised. So --refresh is safe to run against verified data.
 *
 * Modes:
 *   (default)     enrich only orgs with NO company_profiles row (the truly bare).
 *   --refresh     re-enrich ALL orgs — use after adding a new extractor (e.g.
 *                 D2 industry / D3 logos / D4 careers) to backfill fields older
 *                 enrichment runs never captured.
 *   --only <slug> a single org, by slug (repeatable via comma list).
 *   --limit <n>   cap how many orgs are processed this run.
 *   --concurrency <n>  companies enriched in parallel (default 3). The per-host
 *                 rate-limit buckets in http.ts still serialise same-host calls,
 *                 so this only overlaps work across different hosts.
 *   --dry-run     list what WOULD be enriched, fetch nothing, write nothing.
 *
 * Usage:
 *   npm run companies:backfill
 *   npm run companies:backfill -- --refresh
 *   npm run companies:backfill -- --only stripe,vercel --refresh
 *   npm run companies:backfill -- --refresh --limit 50 --concurrency 4
 */

import { loadEnv, adminClient, parseArgs, c } from "./_shared";
import { createSupabaseCompanyStore } from "../src/lib/company-intelligence/store";
import { enrichCompanyOnDemand, type EnrichmentResult } from "../src/lib/company-intelligence/enrich";

interface OrgRow {
  id: string;
  slug: string;
  display_name: string;
}

/** Bounded-concurrency map that preserves input order in the result array. */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function run(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

async function main(): Promise<void> {
  loadEnv();
  const { flags, has } = parseArgs(process.argv.slice(2));
  const refresh = has("refresh");
  const dryRun = has("dry-run");
  const limit = flags.get("limit") ? Number(flags.get("limit")) : Infinity;
  const concurrency = flags.get("concurrency") ? Math.max(1, Number(flags.get("concurrency"))) : 3;
  const onlySlugs = flags.get("only")?.split(",").map((s) => s.trim()).filter(Boolean) ?? null;

  const client = adminClient();
  const store = createSupabaseCompanyStore(client);

  // Which orgs already have a profile row — the marker of "has metadata" for the
  // default (missing-only) mode. --refresh ignores this set entirely.
  const { data: profileRows, error: profileErr } = await client.from("company_profiles").select("organization_id");
  if (profileErr) throw new Error(`read company_profiles: ${profileErr.message}`);
  const hasProfile = new Set((profileRows ?? []).map((r) => (r as { organization_id: string }).organization_id));

  let orgQuery = client.from("organizations").select("id, slug, display_name").order("created_at", { ascending: true });
  if (onlySlugs) orgQuery = orgQuery.in("slug", onlySlugs);
  const { data: orgs, error: orgErr } = await orgQuery;
  if (orgErr) throw new Error(`read organizations: ${orgErr.message}`);

  let targets = (orgs ?? []) as OrgRow[];
  if (!refresh && !onlySlugs) targets = targets.filter((o) => !hasProfile.has(o.id));
  if (Number.isFinite(limit)) targets = targets.slice(0, limit);

  const mode = refresh ? "refresh (all orgs)" : onlySlugs ? "only (named slugs)" : "missing-only";
  console.log(c.bold(`\nBackfill company metadata — mode: ${mode}${dryRun ? c.yellow(" [DRY RUN]") : ""}`));
  console.log(c.dim(`${targets.length} organization(s) to process, concurrency ${concurrency}\n`));

  if (targets.length === 0) {
    console.log(c.green("Nothing to do — every targeted org already has metadata."));
    return;
  }

  if (dryRun) {
    for (const o of targets) console.log(`  ${c.dim("would enrich")} ${o.slug} ${c.dim(`(${o.display_name})`)}`);
    console.log(c.yellow("\nDry run — no network calls made, nothing written."));
    return;
  }

  const tally = { enriched: 0, no_entity: 0, error: 0, created: 0, updated: 0 };
  const results = await mapPool(targets, concurrency, async (o) => {
    const r: EnrichmentResult = await enrichCompanyOnDemand(store, o.display_name);
    const badge =
      r.status === "enriched" ? c.green("enriched") : r.status === "no_entity" ? c.yellow("no entity") : c.red("error");
    console.log(
      `  ${badge} ${o.slug} ${c.dim(`+${r.created}/~${r.updated}`)}` +
        (r.sourcesWritten.length ? c.dim(` [${r.sourcesWritten.join(", ")}]`) : "") +
        (r.status !== "enriched" && r.notes.length ? c.dim(` — ${r.notes[r.notes.length - 1]}`) : "")
    );
    return r;
  });

  for (const r of results) {
    tally[r.status] += 1;
    tally.created += r.created;
    tally.updated += r.updated;
  }

  console.log(c.bold("\nSummary"));
  console.log(`  ${c.green(String(tally.enriched))} enriched · ${c.yellow(String(tally.no_entity))} no entity · ${c.red(String(tally.error))} error`);
  console.log(c.dim(`  ${tally.created} rows created, ${tally.updated} updated`));
  console.log(
    c.dim(
      "  Note: 'updated 0' on an already-enriched org is expected — runImport's " +
        "content-hash dedup skips unchanged batches. Use --refresh after adding a new extractor."
    )
  );
}

main().catch((err) => {
  console.error(c.red(`\nBackfill failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
