/**
 * validate-companies.ts — check a seed file without touching the database.
 *
 * Usage:
 *   npm run companies:validate -- data/companies/seed.json
 *   npm run companies:validate -- data/companies/seed.csv --strict
 *
 * Exit code 1 if any record has an error-severity issue (or, with --strict, any
 * warning), so it can gate a commit or CI step. Reads no secrets and makes no
 * network calls — pure shape/value validation via the same code the importer
 * uses, so "valid here" means "will not be rejected by the importer".
 */

import { readFileSync } from "fs";
import { normalizeCompany } from "../src/lib/company-intelligence/normalize";
import { validateCompany, validateBatchCoherence } from "../src/lib/company-intelligence/validate";
import { seedFileAdapter } from "../src/lib/company-intelligence/adapters/seed-file";
import type { NormalizedCompany, ValidationIssue } from "../src/lib/company-intelligence/types";
import { parseArgs, formatFromPath, c } from "./_shared";

async function main() {
  const { positional, has } = parseArgs(process.argv.slice(2));
  const path = positional[0];
  if (!path) {
    console.error("Usage: npm run companies:validate -- <file.json|file.csv> [--strict]");
    process.exit(2);
  }
  const strict = has("strict");

  const content = readFileSync(path, "utf8");
  const raw = await seedFileAdapter.load({ content, format: formatFromPath(path) });

  const normalized: NormalizedCompany[] = [];
  const issuesByName: { name: string; issues: ValidationIssue[] }[] = [];
  let errors = 0;
  let warnings = 0;

  for (const record of raw) {
    const company = normalizeCompany(record, "seed_file");
    if (!company) {
      errors++;
      issuesByName.push({
        name: typeof record?.name === "string" ? record.name : "(unnamed)",
        issues: [{ field: "name", severity: "error", code: "unusable_record", message: "No usable name/slug." }],
      });
      continue;
    }
    normalized.push(company);
  }

  const coherence = validateBatchCoherence(normalized);

  normalized.forEach((company, i) => {
    const result = validateCompany(company);
    const all = [...result.issues, ...(coherence.get(i) ?? [])];
    if (all.length === 0) return;
    issuesByName.push({ name: company.displayName, issues: all });
    for (const issue of all) {
      if (issue.severity === "error") errors++;
      else warnings++;
    }
  });

  console.log(c.bold(`\nValidated ${raw.length} record(s) from ${path}`));
  console.log(`${c.green(`${raw.length - errors} importable`)} · ${c.red(`${errors} error(s)`)} · ${c.yellow(`${warnings} warning(s)`)}\n`);

  for (const entry of issuesByName) {
    if (entry.issues.length === 0) continue;
    console.log(c.bold(entry.name));
    for (const issue of entry.issues) {
      const tag = issue.severity === "error" ? c.red("ERROR") : c.yellow("warn ");
      console.log(`  ${tag} ${c.dim(issue.field)}  ${issue.message}`);
    }
  }

  const failed = errors > 0 || (strict && warnings > 0);
  console.log("");
  console.log(failed ? c.red("✗ validation failed") : c.green("✓ validation passed"));
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nvalidate-companies failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
