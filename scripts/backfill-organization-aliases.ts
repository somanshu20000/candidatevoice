/**
 * M3.2 — backfill organization_aliases from data already held.
 *
 * WHY: organization_aliases has ~2 rows / 335 orgs, the biggest recall gap in
 * entity search (searchCompanies queries aliases but there are almost none).
 * This derives aliases from existing organizations + their website domains —
 * NO network, NO LinkedIn (D-005) — and inserts only the collision-safe ones.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. Prints the plan and writes nothing. Pass --apply to
 *     actually insert. There is no other way to write.
 *   - Idempotent: re-running after an apply produces zero new inserts (applied
 *     rows are read back as existing aliases).
 *   - Collision-safe: planAliasBackfill drops any alias that shadows a real
 *     org slug, duplicates an existing alias, or is ambiguous across orgs.
 *
 * HOW TO RUN AGAINST PRODUCTION (the eventual, deliberate step):
 *   1. npx tsx scripts/backfill-organization-aliases.ts
 *        -> inspect the dry-run diff. Confirm the inserts look right and the
 *           skipped/ambiguous list contains nothing that should have inserted.
 *   2. npx tsx scripts/backfill-organization-aliases.ts --apply
 *        -> inserts the planned rows via the service-role client.
 *   3. Re-run step 1 to confirm idempotency (expect 0 inserts).
 * Uses NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.
 */

import { adminClient, loadEnv, parseArgs, c } from "./_shared";
import { planAliasBackfill, type OrgAliasInput } from "../src/lib/company-intelligence/alias-derivation";

async function main() {
  loadEnv();
  const { has } = parseArgs(process.argv.slice(2));
  const apply = has("apply");
  const supabase = adminClient();

  // Organizations + their website domain (company_links.normalized_domain,
  // migration 0022 generated column). One query each, joined in memory.
  const [orgsRes, linksRes, aliasRes] = await Promise.all([
    supabase.from("organizations").select("id, slug, display_name"),
    supabase.from("company_links").select("organization_id, normalized_domain").eq("link_type", "website"),
    supabase.from("organization_aliases").select("alias_slug"),
  ]);

  if (orgsRes.error) throw new Error(`load organizations: ${orgsRes.error.message}`);
  if (linksRes.error) throw new Error(`load company_links: ${linksRes.error.message}`);
  if (aliasRes.error) throw new Error(`load organization_aliases: ${aliasRes.error.message}`);

  const domainByOrg = new Map<string, string>();
  for (const l of (linksRes.data ?? []) as { organization_id: string; normalized_domain: string | null }[]) {
    if (l.normalized_domain) domainByOrg.set(l.organization_id, l.normalized_domain);
  }

  const orgs = (orgsRes.data ?? []) as { id: string; slug: string; display_name: string }[];
  const inputs: OrgAliasInput[] = orgs.map((o) => ({
    organizationId: o.id,
    slug: o.slug,
    displayName: o.display_name,
    domain: domainByOrg.get(o.id) ?? null,
  }));

  const existingOrgSlugs = new Set(orgs.map((o) => o.slug));
  const existingAliasSlugs = new Set(
    ((aliasRes.data ?? []) as { alias_slug: string }[]).map((a) => a.alias_slug)
  );

  const plan = planAliasBackfill(inputs, existingOrgSlugs, existingAliasSlugs);

  console.log(c.bold(`\nAlias backfill plan (${apply ? c.red("APPLY") : c.green("DRY-RUN")})`));
  console.log(`  organizations:        ${orgs.length}`);
  console.log(`  existing aliases:     ${existingAliasSlugs.size}`);
  console.log(`  planned inserts:      ${c.green(String(plan.inserts.length))}`);
  console.log(`  skipped (collisions): ${c.yellow(String(plan.skipped.length))}\n`);

  const bySource = plan.inserts.reduce<Record<string, number>>((acc, i) => {
    acc[i.source] = (acc[i.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(c.dim(`  by source: ${JSON.stringify(bySource)}\n`));

  for (const i of plan.inserts.slice(0, 40)) {
    console.log(`  + ${i.aliasSlug.padEnd(28)} ${c.dim(`-> ${i.displayName} (${i.source})`)}`);
  }
  if (plan.inserts.length > 40) console.log(c.dim(`  … and ${plan.inserts.length - 40} more`));

  if (!apply) {
    console.log(c.green("\nDry run — nothing written. Re-run with --apply to insert.\n"));
    return;
  }

  // Insert in chunks. organization_aliases is (organization_id, alias_slug);
  // planned rows are already collision-checked, so a plain insert is safe.
  const rows = plan.inserts.map((i) => ({ organization_id: i.organizationId, alias_slug: i.aliasSlug }));
  const CHUNK = 200;
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("organization_aliases").insert(chunk);
    if (error) throw new Error(`insert aliases (chunk at ${i}): ${error.message}`);
    written += chunk.length;
  }
  console.log(c.green(`\nInserted ${written} aliases.\n`));
}

main().catch((err) => {
  console.error(c.red(`\nbackfill-organization-aliases failed: ${err.message}\n`));
  process.exit(1);
});
