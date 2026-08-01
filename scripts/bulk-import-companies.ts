/**
 * bulk-import-companies.ts — enrich and import a CSV of company names at scale.
 *
 * Usage:
 *   npm run companies:bulk -- Data/companies/tech-1000.csv
 *   npm run companies:bulk -- <file.csv> --limit 50 --concurrency 4
 *   npm run companies:bulk -- <file.csv> --fresh          # ignore checkpoint
 *   npm run companies:bulk -- <file.csv> --dry-run        # enrich, write nothing
 *   npm run companies:bulk -- <file.csv> --report out.json
 *
 * CSV: a `name` column is required. Optional `github_org` and `website` columns
 * seed those values directly, skipping discovery for them.
 *
 * WHAT THIS ADDS OVER fetch-company-metadata.ts
 *   * Resumable — every completed company is appended to a checkpoint file, so
 *     an interrupted run resumes instead of restarting. Essential at 1,000
 *     companies, where a run takes hours.
 *   * Honest failure accounting — the denominator is the INPUT count, and every
 *     company records WHY it produced what it did. A run where most fetches
 *     failed can no longer look identical to a clean one.
 *   * One Wikidata resolution per company instead of three (the entity is
 *     resolved once and reused by both the wikidata and wikipedia adapters).
 *   * Bounded concurrency. Because http.ts rate-limits per BUCKET, concurrent
 *     companies queue behind each other within a service but overlap ACROSS
 *     services — so this speeds up wall-clock without exceeding any one
 *     service's pacing.
 *   * Retries, backoff, timeouts, SSRF guarding and robots.txt — all inherited
 *     from http.ts.
 *
 * Persistence goes through runImport() with a passthrough adapter rather than
 * writing to the store directly, so the licence gate, per-source provenance,
 * field-level observations, batch idempotency and null-coalescing all still
 * apply exactly as they do for a normal import.
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "fs";
import { createHash } from "crypto";
import { dirname, resolve as resolvePath } from "path";
import { parseCsv } from "../src/lib/company-intelligence/csv";
import { runImport } from "../src/lib/company-intelligence/importer";
import { passthrough } from "../src/lib/company-intelligence/enrich";
import { createSupabaseCompanyStore } from "../src/lib/company-intelligence/store";
import {
  resolveVerifiedCompanyEntity,
  resolveCompanyEntityByQid,
  wikidataRecordFromEntity,
  wikidataAdapter,
} from "../src/lib/company-intelligence/adapters/wikidata";
import { wikipediaRecordFromEntity, wikipediaAdapter } from "../src/lib/company-intelligence/adapters/wikipedia";
import {
  fetchGithubOrg,
  githubOrgAdapter,
  githubTokenPresent,
  GithubRateLimitError,
} from "../src/lib/company-intelligence/adapters/github-org";
import { fetchWebsiteMeta, websiteMetaAdapter } from "../src/lib/company-intelligence/adapters/website-meta";
import { RobotsDisallowedError, SsrfBlockedError } from "../src/lib/company-intelligence/http";
import type { RawCompanyRecord, SourceAdapter, MetadataConfidence } from "../src/lib/company-intelligence/types";
import { loadEnv, adminClient, parseArgs, c } from "./_shared";

// --- Types ------------------------------------------------------------------

interface InputRow {
  name: string;
  githubOrg?: string;
  website?: string;
  /** Wikidata entity id (e.g. Q7624104). Bypasses ambiguous name search. */
  wikidataQid?: string;
}

type CompanyStatus = "enriched" | "no_entity" | "error";

interface Enrichment {
  name: string;
  status: CompanyStatus;
  qid: string | null;
  records: { sourceKey: string; record: RawCompanyRecord }[];
  /** Human-readable reasons things were absent or skipped. */
  notes: string[];
}

interface CheckpointLine {
  name: string;
  status: CompanyStatus;
  qid: string | null;
  sources: string[];
  notes: string[];
}

// --- Per-source confidence --------------------------------------------------
// Mirrors trust tiers in migration 0006. The orchestration order below runs
// lowest trust first so the highest-trust non-null value survives.

const SOURCE_ORDER: { key: string; adapter: SourceAdapter; confidence: MetadataConfidence }[] = [
  { key: "github_org", adapter: githubOrgAdapter, confidence: "reported" },
  { key: "wikipedia", adapter: wikipediaAdapter, confidence: "reported" },
  { key: "wikidata", adapter: wikidataAdapter, confidence: "cross_checked" },
  { key: "website_meta", adapter: websiteMetaAdapter, confidence: "official" },
];

// passthrough() now lives in src/lib/company-intelligence/enrich.ts so this
// script and the on-demand route share one definition.

// --- Enrichment -------------------------------------------------------------

/** True once GitHub's quota is exhausted; stops us hammering a dead endpoint. */
let githubExhausted = false;

function describeError(err: unknown): string {
  if (err instanceof RobotsDisallowedError) return "skipped: robots.txt disallows";
  if (err instanceof SsrfBlockedError) return `skipped: blocked address (${err.message})`;
  if (err instanceof GithubRateLimitError) return "github: rate limit exhausted";
  return err instanceof Error ? err.message : String(err);
}

async function enrichOne(row: InputRow): Promise<Enrichment> {
  const out: Enrichment = { name: row.name, status: "enriched", qid: null, records: [], notes: [] };

  // 1. One Wikidata resolution, reused by wikidata + wikipedia. A supplied QID
  //    skips name search, which is ambiguous for product-shaped company names.
  let entity = null;
  try {
    entity = row.wikidataQid
      ? await resolveCompanyEntityByQid(row.wikidataQid)
      : await resolveVerifiedCompanyEntity(row.name);
  } catch (err) {
    out.status = "error";
    out.notes.push(`wikidata: ${describeError(err)}`);
    return out;
  }

  if (!entity) {
    // Not a failure — nothing resolved to a *verified business* entity. Honest
    // outcome; better than importing the wrong entity (a French commune once
    // imported as "Vercel" before the geographic gate existed).
    out.status = "no_entity";
    out.notes.push(
      row.wikidataQid
        ? `supplied QID ${row.wikidataQid} is not a verified business entity`
        : "no verified business entity on Wikidata"
    );
  } else {
    out.qid = entity.qid;
    out.records.push({ sourceKey: "wikidata", record: wikidataRecordFromEntity(row.name, entity) });

    try {
      const wiki = await wikipediaRecordFromEntity(row.name, entity);
      if (wiki) out.records.push({ sourceKey: "wikipedia", record: wiki });
      else out.notes.push("no English Wikipedia article");
    } catch (err) {
      out.notes.push(`wikipedia: ${describeError(err)}`);
    }
  }

  // 2. GitHub — CSV hint wins, else Wikidata's P2037 handle.
  const wikidataRecord = out.records.find((r) => r.sourceKey === "wikidata")?.record;
  const handle = row.githubOrg ?? (wikidataRecord?.github_org as string | undefined);
  if (handle && !githubExhausted) {
    try {
      const gh = await fetchGithubOrg({ name: row.name, org: handle });
      if (gh) out.records.push({ sourceKey: "github_org", record: gh });
      else out.notes.push(`github: no org "${handle}"`);
    } catch (err) {
      if (err instanceof GithubRateLimitError) {
        githubExhausted = true;
        out.notes.push("github: rate limit exhausted — remaining companies skip GitHub");
      } else {
        out.notes.push(`github: ${describeError(err)}`);
      }
    }
  } else if (handle && githubExhausted) {
    out.notes.push("github: skipped (quota exhausted earlier in run)");
  } else {
    out.notes.push("github: no handle known");
  }

  // 3. Official website — CSV hint wins, else Wikidata's P856.
  const site = row.website ?? (wikidataRecord?.website as string | undefined);
  if (site) {
    try {
      const web = await fetchWebsiteMeta({ name: row.name, url: site });
      if (web) out.records.push({ sourceKey: "website_meta", record: web });
      else out.notes.push("website: no og:description");
    } catch (err) {
      out.notes.push(`website: ${describeError(err)}`);
    }
  } else {
    out.notes.push("website: no URL known");
  }

  return out;
}

/** Run `worker` over items with at most `limit` in flight, preserving order. */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i]);
    }
  });
  await Promise.all(runners);
  return results;
}

// --- Quality report ---------------------------------------------------------

interface Report {
  input: number;
  attempted: number;
  resumedFromCheckpoint: number;
  enriched: number;
  noEntity: number;
  errors: number;
  created: number;
  updated: number;
  invalid: number;
  coverage: Record<string, number>;
  bySource: Record<string, number>;
  noteHistogram: Record<string, number>;
  githubTokenPresent: boolean;
  githubExhausted: boolean;
}

function buildReport(
  inputCount: number,
  resumed: number,
  results: Enrichment[],
  totals: { created: number; updated: number; invalid: number }
): Report {
  const coverage: Record<string, number> = {
    description: 0,
    founded_year: 0,
    website: 0,
    github_org: 0,
    logo_url: 0,
    stock_symbol: 0,
  };
  const bySource: Record<string, number> = {};
  const noteHistogram: Record<string, number> = {};

  for (const r of results) {
    const merged: RawCompanyRecord = { name: r.name };
    for (const { sourceKey, record } of r.records) {
      bySource[sourceKey] = (bySource[sourceKey] ?? 0) + 1;
      Object.assign(merged, Object.fromEntries(Object.entries(record).filter(([, v]) => v != null)));
    }
    const mergedFields = merged as unknown as Record<string, unknown>;
    for (const field of Object.keys(coverage)) {
      if (mergedFields[field] != null) coverage[field]++;
    }
    for (const note of r.notes) {
      // Bucket by prefix so the histogram stays readable.
      const key = note.split(/[:(]/)[0].trim();
      noteHistogram[key] = (noteHistogram[key] ?? 0) + 1;
    }
  }

  return {
    input: inputCount,
    attempted: results.length,
    resumedFromCheckpoint: resumed,
    enriched: results.filter((r) => r.status === "enriched").length,
    noEntity: results.filter((r) => r.status === "no_entity").length,
    errors: results.filter((r) => r.status === "error").length,
    created: totals.created,
    updated: totals.updated,
    invalid: totals.invalid,
    coverage,
    bySource,
    noteHistogram,
    githubTokenPresent: githubTokenPresent(),
    githubExhausted,
  };
}

function printReport(r: Report, dryRun: boolean) {
  console.log("");
  console.log(c.bold("── Quality report ──────────────────────────────"));
  console.log(`  input rows            ${r.input}`);
  if (r.resumedFromCheckpoint > 0) {
    console.log(`  already done (resume) ${c.dim(String(r.resumedFromCheckpoint))}`);
  }
  console.log(`  attempted this run    ${r.attempted}`);
  console.log(
    `  ${c.green(`enriched ${r.enriched}`)} · ${c.yellow(`no entity ${r.noEntity}`)} · ${c.red(`errors ${r.errors}`)}`
  );
  if (!dryRun) {
    console.log(`  persisted             ${c.green(`${r.created} created`)} · ${r.updated} updated · ${c.yellow(`${r.invalid} invalid`)}`);
  }

  const pct = (n: number) => (r.attempted === 0 ? "—" : `${Math.round((n / r.attempted) * 100)}%`);
  console.log("");
  console.log("  field coverage (share of attempted companies):");
  for (const [field, n] of Object.entries(r.coverage)) {
    console.log(`    ${field.padEnd(14)} ${String(n).padStart(5)}  ${pct(n)}`);
  }

  console.log("");
  console.log("  records contributed per source:");
  for (const [src, n] of Object.entries(r.bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(14)} ${String(n).padStart(5)}`);
  }

  const notes = Object.entries(r.noteHistogram).sort((a, b) => b[1] - a[1]);
  if (notes.length) {
    console.log("");
    console.log("  gaps and skips:");
    for (const [note, n] of notes) console.log(`    ${String(n).padStart(5)}  ${note}`);
  }

  if (!r.githubTokenPresent) {
    console.log("");
    console.log(c.yellow("  GITHUB_TOKEN not set — GitHub is capped at 60 requests/hour."));
  }
  if (r.githubExhausted) {
    console.log(c.yellow("  GitHub quota was exhausted during this run; some companies have no GitHub data."));
  }
  console.log(c.bold("────────────────────────────────────────────────"));
}

// --- Main -------------------------------------------------------------------

function checkpointPathFor(csvPath: string): string {
  const hash = createHash("sha256").update(resolvePath(csvPath)).digest("hex").slice(0, 12);
  return resolvePath(dirname(csvPath), `.bulk-checkpoint-${hash}.jsonl`);
}

function readCheckpoint(path: string): Set<string> {
  if (!existsSync(path)) return new Set();
  const done = new Set<string>();
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as CheckpointLine;
      if (parsed.name) done.add(parsed.name);
    } catch {
      // A torn final line from an interrupted write — ignore it.
    }
  }
  return done;
}

async function main() {
  loadEnv();
  const { flags, positional, has } = parseArgs(process.argv.slice(2));
  const csvPath = positional[0];
  if (!csvPath) {
    console.error(
      "Usage: npm run companies:bulk -- <file.csv> [--limit N] [--concurrency N] [--chunk N] [--fresh] [--dry-run] [--report out.json]"
    );
    process.exit(2);
  }

  const concurrency = Math.max(1, Number(flags.get("concurrency") ?? 4));
  const chunkSize = Math.max(1, Number(flags.get("chunk") ?? 20));
  const limit = flags.get("limit") ? Number(flags.get("limit")) : Infinity;
  const dryRun = has("dry-run");
  const fresh = has("fresh");
  const reportPath = flags.get("report");

  // Parse input.
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const all: InputRow[] = rows
    .map((r) => ({
      name: (r.name ?? r.company ?? "").trim(),
      githubOrg: (r.github_org ?? "").trim() || undefined,
      website: (r.website ?? "").trim() || undefined,
      wikidataQid: (r.wikidata_qid ?? r.qid ?? "").trim() || undefined,
    }))
    .filter((r) => r.name.length > 0);

  if (all.length === 0) {
    console.error(`No usable rows in ${csvPath} (need a "name" column).`);
    process.exit(2);
  }

  const checkpointPath = checkpointPathFor(csvPath);
  const done = fresh ? new Set<string>() : readCheckpoint(checkpointPath);
  const todo = all.filter((r) => !done.has(r.name)).slice(0, limit === Infinity ? undefined : limit);

  console.log(c.bold(`\nBulk import: ${csvPath}`));
  console.log(
    c.dim(
      `${all.length} rows · ${done.size} already done · ${todo.length} to process · ` +
        `concurrency ${concurrency} · chunk ${chunkSize}${dryRun ? " · DRY RUN" : ""}`
    )
  );
  if (!githubTokenPresent()) {
    console.log(c.yellow("GITHUB_TOKEN not set — GitHub enrichment capped at 60/hour."));
  }
  console.log("");

  if (todo.length === 0) {
    console.log(c.green("Nothing to do — every row is already in the checkpoint."));
    console.log(c.dim(`(use --fresh to re-import from scratch; checkpoint: ${checkpointPath})`));
    process.exit(0);
  }

  const store = createSupabaseCompanyStore(adminClient());
  mkdirSync(dirname(checkpointPath), { recursive: true });

  const allResults: Enrichment[] = [];
  const totals = { created: 0, updated: 0, invalid: 0 };

  for (let start = 0; start < todo.length; start += chunkSize) {
    const chunk = todo.slice(start, start + chunkSize);
    const label = `${start + 1}-${Math.min(start + chunk.length, todo.length)} of ${todo.length}`;
    console.log(c.bold(`[${label}] enriching…`));

    const enriched = await mapPool(chunk, concurrency, enrichOne);
    allResults.push(...enriched);

    // Group this chunk's records by source, then persist one batch per source.
    if (!dryRun) {
      for (const { key, adapter, confidence } of SOURCE_ORDER) {
        const records = enriched.flatMap((e) => e.records.filter((r) => r.sourceKey === key).map((r) => r.record));
        if (records.length === 0) continue;
        try {
          const report = await runImport({
            store,
            adapter: passthrough(adapter, records),
            input: null,
            sourceKey: key,
            confidence,
          });
          totals.created += report.created;
          totals.updated += report.updated;
          totals.invalid += report.invalid;
        } catch (err) {
          console.error(c.red(`  persist ${key} failed: ${err instanceof Error ? err.message : String(err)}`));
        }
      }
    }

    // Checkpoint AFTER persistence, so an interrupted run re-does the chunk
    // rather than skipping companies whose data never landed.
    for (const e of enriched) {
      const line: CheckpointLine = {
        name: e.name,
        status: e.status,
        qid: e.qid,
        sources: e.records.map((r) => r.sourceKey),
        notes: e.notes,
      };
      appendFileSync(checkpointPath, JSON.stringify(line) + "\n", "utf8");
    }

    const ok = enriched.filter((e) => e.status === "enriched").length;
    console.log(c.dim(`  ${ok}/${chunk.length} enriched · running total created ${totals.created}, updated ${totals.updated}`));
  }

  const report = buildReport(all.length, done.size, allResults, totals);
  printReport(report, dryRun);

  if (reportPath) {
    writeFileSync(reportPath, JSON.stringify({ report, companies: allResults }, null, 2), "utf8");
    console.log(c.dim(`\nreport written to ${reportPath}`));
  }
  console.log(c.dim(`checkpoint: ${checkpointPath}`));
  console.log(dryRun ? c.yellow("\nDry run — nothing was written to the database.") : c.green("\n✓ bulk import complete"));
}

main().catch((err) => {
  console.error(c.red(`\nbulk-import-companies failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(2);
});
