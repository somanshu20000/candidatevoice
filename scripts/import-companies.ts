/**
 * import-companies.ts — import a seed file into the Company Intelligence tables.
 *
 * Usage:
 *   npm run companies:import -- Data/companies/seed.json
 *   npm run companies:import -- Data/companies/in-tech.csv --source manual --confidence official
 *   npm run companies:import -- Data/companies/seed.json --dry-run
 *
 * Idempotent: re-running an unchanged file is a no-op (batch content hash), and
 * every row is upserted, so partial re-runs converge rather than duplicate.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from
 * .env.local or the shell). The service-role key is server-only — never ship it.
 */

import { readFileSync } from "fs";
import { runImport } from "../src/lib/company-intelligence/importer";
import { createSupabaseCompanyStore } from "../src/lib/company-intelligence/store";
import { seedFileAdapter } from "../src/lib/company-intelligence/adapters/seed-file";
import { METADATA_CONFIDENCE_VALUES, type MetadataConfidence } from "../src/lib/company-intelligence/types";
import { loadEnv, adminClient, parseArgs, formatFromPath, c } from "./_shared";

async function main() {
  loadEnv();
  const { flags, positional, has } = parseArgs(process.argv.slice(2));
  const path = positional[0];
  if (!path) {
    console.error("Usage: npm run companies:import -- <file.json|file.csv> [--source <key>] [--confidence <level>] [--dry-run]");
    process.exit(2);
  }

  const sourceKey = flags.get("source") ?? "manual";
  const confidence = (flags.get("confidence") ?? "reported") as MetadataConfidence;
  if (!METADATA_CONFIDENCE_VALUES.includes(confidence)) {
    console.error(`Invalid --confidence "${confidence}". One of: ${METADATA_CONFIDENCE_VALUES.join(", ")}`);
    process.exit(2);
  }
  const dryRun = has("dry-run");

  const content = readFileSync(path, "utf8");

  const store = dryRun
    ? // A dry run never persists, but runImport still wants a store to type
      // against; only read methods could be called and they will not be.
      createSupabaseCompanyStore(adminClient())
    : createSupabaseCompanyStore(adminClient());

  console.log(c.bold(`\nImporting ${path}`));
  console.log(c.dim(`source=${sourceKey} confidence=${confidence}${dryRun ? " (dry run)" : ""}\n`));

  const report = await runImport({
    store,
    adapter: seedFileAdapter,
    input: { content, format: formatFromPath(path) },
    sourceKey,
    confidence,
    dryRun,
  });

  if (report.alreadyImported) {
    console.log(c.yellow(`Already imported — identical batch ${report.batchId} completed previously. Nothing to do.`));
    process.exit(0);
  }

  const errorRecords = report.issues.filter((r) => r.issues.some((i) => i.severity === "error"));
  const warnRecords = report.issues.filter((r) => r.issues.every((i) => i.severity !== "error") && r.issues.length > 0);

  for (const rec of errorRecords) {
    console.log(c.bold(rec.name));
    for (const issue of rec.issues) {
      const tag = issue.severity === "error" ? c.red("ERROR") : c.yellow("warn ");
      console.log(`  ${tag} ${c.dim(issue.field)}  ${issue.message}`);
    }
  }

  console.log("");
  console.log(
    `${c.green(`${report.created} created`)} · ` +
      `${c.green(`${report.updated} updated`)} · ` +
      `${c.yellow(`${report.invalid} invalid`)} · ` +
      `${c.dim(`${warnRecords.length} with warnings`)} · ` +
      `${report.total} total`
  );
  if (dryRun) {
    console.log(c.yellow("\nDry run — nothing was written."));
  } else if (report.batchId) {
    console.log(c.dim(`batch ${report.batchId}`));
    console.log(c.green("\n✓ import complete"));
  }
  process.exit(report.invalid > 0 && report.created + report.updated === 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nimport-companies failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
