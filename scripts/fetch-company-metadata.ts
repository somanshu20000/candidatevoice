/**
 * fetch-company-metadata.ts — populate Company Intelligence from public,
 * factual sources: Wikidata, Wikipedia, GitHub, and official company websites.
 *
 * Usage:
 *   npm run companies:fetch -- Data/companies/company-list.txt
 *   npm run companies:fetch -- Data/companies/company-list.txt --dry-run
 *
 * NEVER imports reviews, ratings, comments, interview experiences, forum
 * threads, or any other user-generated content — only the factual metadata
 * each adapter is documented to extract (see the docstring at the top of each
 * file under src/lib/company-intelligence/adapters/).
 *
 * SEQUENCING. Four runImport() calls, one per adapter, run in this exact
 * order:
 *
 *   wikidata → github_org → wikipedia → website_meta
 *
 * This matters for two reasons:
 *
 *   1. Chaining. github_org and website_meta need a GitHub handle / website
 *      URL to fetch, which only wikidata resolves. Each adapter takes that as
 *      EXPLICIT input (see their docstrings) rather than discovering it
 *      internally, so this script is the one place that wiring happens.
 *
 *   2. Trust order. Four sources can each supply a `description`. Running
 *      lowest-trust-tier first and highest last means the last non-null value
 *      wins in company_profiles (store.upsertProfile now coalesces nulls
 *      against the existing row, so a later adapter's absence of a field never
 *      erases an earlier adapter's value for it — see store.ts). Per
 *      migration 0006's trust tiers: github_org=4 (lowest), wikipedia=3,
 *      wikidata=2, website_meta=1 (highest, the company's own site). Running
 *      wikidata before github_org is an exception to strict tier order,
 *      because github_org's input DEPENDS on wikidata's output — but they
 *      barely overlap in fields (github_org contributes description +
 *      engineering_blog; wikidata contributes website/github link/stock
 *      symbol/founded_year/logo), so the ordering conflict is confined to
 *      `description`, where wikipedia and website_meta both still run after
 *      github_org and correctly take precedence.
 *
 * Every field-level provenance is preserved regardless of this ordering —
 * company_field_observations records one row per (org, field, source), so
 * "who said the founding year was 1998" is always answerable even though
 * company_profiles only shows the resolved value.
 */

import { readFileSync } from "fs";
import { runImport } from "../src/lib/company-intelligence/importer";
import { createSupabaseCompanyStore } from "../src/lib/company-intelligence/store";
import { wikidataAdapter } from "../src/lib/company-intelligence/adapters/wikidata";
import { githubOrgAdapter, type GithubOrgInput } from "../src/lib/company-intelligence/adapters/github-org";
import { wikipediaAdapter } from "../src/lib/company-intelligence/adapters/wikipedia";
import { websiteMetaAdapter, type WebsiteMetaInput } from "../src/lib/company-intelligence/adapters/website-meta";
import type { RawCompanyRecord } from "../src/lib/company-intelligence/types";
import { loadEnv, adminClient, parseArgs, c } from "./_shared";

function readCompanyList(path: string): string[] {
  const text = readFileSync(path, "utf8");
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function githubHandleFrom(record: RawCompanyRecord): string | null {
  // wikidataAdapter sets github_org to the bare handle (see its docstring);
  // normalizeGithub in normalize.ts is what turns a bare handle OR a full URL
  // into a canonical URL downstream, so accept either shape here too.
  if (!record.github_org) return null;
  const s = record.github_org.trim();
  if (!s) return null;
  return s.replace(/^https?:\/\/github\.com\//i, "").replace(/^@/, "").replace(/\/+$/, "");
}

async function main() {
  loadEnv();
  const { positional, has } = parseArgs(process.argv.slice(2));
  const path = positional[0];
  if (!path) {
    console.error("Usage: npm run companies:fetch -- <company-list.txt> [--dry-run]");
    process.exit(2);
  }
  const dryRun = has("dry-run");

  const names = readCompanyList(path);
  if (names.length === 0) {
    console.error(`No company names found in ${path}.`);
    process.exit(2);
  }

  console.log(c.bold(`\nFetching metadata for ${names.length} companies`));
  console.log(c.dim(`sources: wikidata -> github_org -> wikipedia -> website_meta${dryRun ? " (dry run)" : ""}\n`));

  const store = createSupabaseCompanyStore(adminClient());

  // --- 1. Wikidata — runs first; discovers website + github handle. ---------
  console.log(c.bold("1/4 wikidata"));
  const wikidataReport = await runImport({
    store,
    adapter: wikidataAdapter,
    input: names,
    confidence: "cross_checked",
    dryRun,
  });
  console.log(
    c.dim(`  ${wikidataReport.created} created · ${wikidataReport.updated} updated · ${wikidataReport.invalid} invalid`)
  );

  // Re-fetch what wikidata just produced so the next two adapters have real
  // input. This is a network call regardless of --dry-run: dry-run gates
  // WRITES (runImport's own dryRun flag), not reads, so a dry run still
  // exercises the full chain and reports what each downstream adapter would
  // have done.
  const wikidataRecords = await wikidataAdapter.load(names);
  const githubInputs: GithubOrgInput[] = [];
  const websiteInputs: WebsiteMetaInput[] = [];
  for (const record of wikidataRecords) {
    const handle = githubHandleFrom(record);
    if (handle) githubInputs.push({ name: record.name, org: handle });
    if (record.website) websiteInputs.push({ name: record.name, url: record.website });
  }

  // --- 2. GitHub — lowest trust tier for `description`, so it runs first
  //        among the description-bearing sources. -----------------------------
  console.log(c.bold(`2/4 github_org (${githubInputs.length} resolved)`));
  if (githubInputs.length > 0) {
    const githubReport = await runImport({
      store,
      adapter: githubOrgAdapter,
      input: githubInputs,
      confidence: "reported",
      dryRun,
    });
    console.log(
      c.dim(`  ${githubReport.created} created · ${githubReport.updated} updated · ${githubReport.invalid} invalid`)
    );
  } else {
    console.log(c.dim("  no GitHub orgs resolved via Wikidata, skipping"));
  }

  // --- 3. Wikipedia — CC BY-SA, attribution required on the description. ----
  console.log(c.bold("3/4 wikipedia"));
  const wikipediaReport = await runImport({
    store,
    adapter: wikipediaAdapter,
    input: names,
    confidence: "reported",
    dryRun,
  });
  console.log(
    c.dim(`  ${wikipediaReport.created} created · ${wikipediaReport.updated} updated · ${wikipediaReport.invalid} invalid`)
  );

  // --- 4. Official website — runs last: highest trust tier, so its
  //        description wins over Wikipedia's and GitHub's when present. ------
  console.log(c.bold(`4/4 website_meta (${websiteInputs.length} resolved)`));
  if (websiteInputs.length > 0) {
    const websiteReport = await runImport({
      store,
      adapter: websiteMetaAdapter,
      input: websiteInputs,
      confidence: "official",
      dryRun,
    });
    console.log(
      c.dim(`  ${websiteReport.created} created · ${websiteReport.updated} updated · ${websiteReport.invalid} invalid`)
    );
  } else {
    console.log(c.dim("  no websites resolved via Wikidata, skipping"));
  }

  console.log(dryRun ? c.yellow("\nDry run — nothing was written.") : c.green("\n✓ metadata fetch complete"));
}

main().catch((err) => {
  console.error(c.red(`\nfetch-company-metadata failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
