/**
 * update-aliases.ts — manage the alias → canonical organization mapping.
 *
 * Usage:
 *   npm run companies:aliases -- --list google
 *   npm run companies:aliases -- --add "google-inc." --to google
 *   npm run companies:aliases -- --add "alphabet" --to google --source moderator
 *   npm run companies:aliases -- --merge google-llc --into google
 *   npm run companies:aliases -- --suggest        # unresolved slugs + likely canonical
 *
 * This is how the "Google / Google LLC / Google India → one organization"
 * consolidation (deliverable 7) is performed operationally: as data edits a
 * moderator makes, not a code change. It never rewrites hiring_submissions
 * (evidence is immutable); it only edits the organizations / alias tables that
 * resolution reads.
 */

import { adminClient, loadEnv, parseArgs, c } from "./_shared";
import { canonicalizeSlug } from "../src/lib/company-intelligence/normalize";
import type { SupabaseClient } from "@supabase/supabase-js";

async function orgIdForSlug(client: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await client.rpc("resolve_organization", { p_slug: slug });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

async function list(client: SupabaseClient, slug: string) {
  const orgId = await orgIdForSlug(client, slug);
  if (!orgId) {
    console.log(c.yellow(`No organization resolves from "${slug}".`));
    return;
  }
  const org = await client.from("organizations").select("slug, display_name").eq("id", orgId).single();
  const aliases = await client.from("organization_aliases").select("alias_slug, alias_source").eq("organization_id", orgId).order("alias_slug");
  console.log(c.bold(`\n${org.data?.display_name} `) + c.dim(`(${org.data?.slug})`));
  const rows = aliases.data ?? [];
  if (rows.length === 0) {
    console.log(c.dim("  no aliases"));
  } else {
    for (const a of rows) console.log(`  ${a.alias_slug} ${c.dim(`[${a.alias_source}]`)}`);
  }
}

async function add(client: SupabaseClient, aliasRaw: string, toSlug: string, source: string) {
  const orgId = await orgIdForSlug(client, toSlug);
  if (!orgId) throw new Error(`No organization resolves from --to "${toSlug}". Create it (import a record) first.`);
  // Store the alias as-given (it is joined against raw hiring_submissions.company),
  // but also register its canonical form so both spellings resolve.
  const forms = new Set([aliasRaw, canonicalizeSlug(aliasRaw)].filter((x): x is string => !!x));
  for (const alias of forms) {
    const { error } = await client
      .from("organization_aliases")
      .upsert({ alias_slug: alias, organization_id: orgId, alias_source: source }, { onConflict: "alias_slug" });
    if (error) throw new Error(`add alias "${alias}": ${error.message}`);
    console.log(c.green(`  + ${alias} → ${toSlug}`));
  }
}

async function merge(client: SupabaseClient, fromSlug: string, intoSlug: string) {
  const fromId = await orgIdForSlug(client, fromSlug);
  const intoId = await orgIdForSlug(client, intoSlug);
  if (!fromId) throw new Error(`No organization resolves from "${fromSlug}".`);
  if (!intoId) throw new Error(`No organization resolves from "${intoSlug}".`);
  if (fromId === intoId) {
    console.log(c.yellow("Both slugs already resolve to the same organization."));
    return;
  }

  // Re-point aliases, re-point evidence's organization_id (this is an annotation,
  // not evidence content, so it is safe to update), then alias the losing slug.
  await client.from("organization_aliases").update({ organization_id: intoId }).eq("organization_id", fromId);
  await client.from("hiring_submissions").update({ organization_id: intoId }).eq("organization_id", fromId);

  const losing = await client.from("organizations").select("slug").eq("id", fromId).single();
  if (losing.data?.slug) {
    await client.from("organization_aliases").upsert(
      { alias_slug: losing.data.slug, organization_id: intoId, alias_source: "moderator" },
      { onConflict: "alias_slug" }
    );
  }
  // The losing organization row is retained (no delete) so any URL still
  // pointing at it can be redirected; a follow-up can remove it once traffic
  // has drained. Report and stop here rather than hard-deleting.
  console.log(c.green(`  merged ${fromSlug} → ${intoSlug} (aliases + evidence re-pointed; old org row retained)`));
}

async function suggest(client: SupabaseClient) {
  // Submissions whose company slug does not yet resolve to any organization.
  const { data, error } = await client
    .from("hiring_submissions")
    .select("company")
    .is("organization_id", null)
    .eq("is_approved", true);
  if (error) throw new Error(error.message);

  const unresolved = [...new Set((data ?? []).map((r) => r.company))];
  if (unresolved.length === 0) {
    console.log(c.green("Every approved submission resolves to an organization."));
    return;
  }
  console.log(c.bold(`\n${unresolved.length} unresolved company slug(s):\n`));
  for (const slug of unresolved) {
    const canon = canonicalizeSlug(slug);
    const target = canon ? await orgIdForSlug(client, canon) : null;
    const hint = target ? c.green(`→ alias to "${canon}"`) : c.dim("→ no canonical match; import a record");
    console.log(`  ${slug.padEnd(40)} ${hint}`);
  }
}

async function main() {
  loadEnv();
  const { flags } = parseArgs(process.argv.slice(2));
  const client = adminClient();

  if (flags.has("list")) return list(client, flags.get("list")!);
  if (flags.has("suggest")) return suggest(client);
  if (flags.has("add")) return add(client, flags.get("add")!, flags.get("to") ?? "", flags.get("source") ?? "moderator");
  if (flags.has("merge")) return merge(client, flags.get("merge")!, flags.get("into") ?? "");

  console.error(
    "Usage:\n" +
      "  --list <slug>\n" +
      "  --add <alias> --to <canonical-slug> [--source moderator]\n" +
      "  --merge <from-slug> --into <canonical-slug>\n" +
      "  --suggest"
  );
  process.exit(2);
}

main().catch((err) => {
  console.error(c.red(`\nupdate-aliases failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
