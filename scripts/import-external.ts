/**
 * import-external.ts — load a JSONL of canonical external reports into the
 * external_reports table as PENDING moderation rows.
 *
 * Usage:
 *   npm run external:import -- Data/external/reddit.jsonl --source reddit
 *   npm run external:import -- Data/external/reddit.jsonl --source reddit --dry-run
 *
 * This does NOT acquire or scrape anything. It consumes a JSONL file that an
 * acquisition adapter (e.g. scripts/reddit_ingest.py) already produced — one
 * RawExternalReport per line. Acquisition and ingestion are separated on
 * purpose: the adapter can be swapped or removed without touching this core,
 * and this core imposes the same validation, dedup and moderation gate on every
 * source regardless of where it came from.
 *
 * Everything lands as verification_status='pending'. Nothing becomes public
 * until a human approves it AND the source is enabled.
 */

import { readFileSync } from "fs";
import { runExternalImport } from "../src/lib/hiring-intel/importer";
import { createSupabaseExternalReportStore } from "../src/lib/hiring-intel/store";
import type { RawExternalReport } from "../src/lib/hiring-intel/types";
import { loadEnv, adminClient, parseArgs, requireFlag, c } from "./_shared";

function parseJsonl(text: string): RawExternalReport[] {
  const out: RawExternalReport[] = [];
  let bad = 0;
  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      out.push(JSON.parse(trimmed) as RawExternalReport);
    } catch {
      bad++;
    }
  });
  if (bad > 0) console.log(c.yellow(`  ${bad} line(s) were not valid JSON and were skipped`));
  return out;
}

async function main() {
  loadEnv();
  const { flags, positional, has } = parseArgs(process.argv.slice(2));
  const path = positional[0];
  if (!path) {
    console.error("Usage: npm run external:import -- <file.jsonl> --source <key> [--dry-run]");
    process.exit(2);
  }
  const sourceKey = requireFlag(flags, "source");
  const dryRun = has("dry-run");

  const records = parseJsonl(readFileSync(path, "utf8"));
  console.log(c.bold(`\nImporting ${records.length} external reports from ${path}`));
  console.log(c.dim(`source=${sourceKey}${dryRun ? " (dry run)" : ""} — everything lands as PENDING moderation\n`));

  const store = createSupabaseExternalReportStore(adminClient());
  const report = await runExternalImport({ store, sourceKey, records, dryRun });

  // Show a sample of validation issues without flooding the terminal.
  for (const rec of report.issues.slice(0, 15)) {
    for (const issue of rec.issues) {
      const tag = issue.severity === "error" ? c.red("ERROR") : c.yellow("warn ");
      console.log(`  ${tag} ${c.dim(rec.company)} · ${issue.field}: ${issue.message}`);
    }
  }
  if (report.issues.length > 15) console.log(c.dim(`  … and ${report.issues.length - 15} more with issues`));

  console.log("");
  console.log(
    `${c.green(`${report.created} ${dryRun ? "would create" : "created"}`)} · ` +
      `${c.dim(`${report.duplicate} duplicate`)} · ` +
      `${c.yellow(`${report.invalid} invalid`)} · ` +
      `${report.total} total`
  );
  console.log(
    dryRun
      ? c.yellow("\nDry run — nothing written.")
      : c.green("\n✓ imported as pending — approve in moderation before anything is public")
  );
}

main().catch((err) => {
  console.error(c.red(`\nimport-external failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
