/**
 * On-demand company enrichment — the request-time path.
 *
 * The CLI importers (scripts/*) are the bulk path. This is the single-company
 * path a route handler calls when a visitor lands on a company that resolved to
 * an organization but has no metadata yet. It reuses the EXACT same adapters,
 * the same resilientFetch hardening, the same runImport provenance pipeline —
 * it is not a second ingestion system, just a different trigger.
 *
 * THE ONE DIFFERENCE FROM BULK: every record is persisted at confidence
 * `unverified`. That is the "provisional until verified" marker (it is already
 * a valid value in every metadata table's CHECK constraint and was previously
 * written by nothing). A later CLI import at a higher confidence
 * (`website_meta` → `official`) upgrades the row naturally, because store.ts
 * coalesces nulls and the last non-null writer wins.
 *
 * Mirrors scripts/bulk-import-companies.ts enrichOne, minus the CSV hints and
 * the cross-run githubExhausted flag (a single request has no batch to protect).
 */

import type { CompanyStore } from "./store";
import type { SourceAdapter, RawCompanyRecord, MetadataConfidence } from "./types";
import { runImport } from "./importer";
import {
  wikidataAdapter,
  wikipediaAdapter,
  githubOrgAdapter,
  websiteMetaAdapter,
} from "./adapters";
import { resolveVerifiedCompanyEntity, wikidataRecordFromEntity } from "./adapters/wikidata";
import { wikipediaRecordFromEntity } from "./adapters/wikipedia";
import { fetchGithubOrg, GithubRateLimitError } from "./adapters/github-org";
import { fetchWebsiteMeta } from "./adapters/website-meta";
import { RobotsDisallowedError, SsrfBlockedError } from "./http";

/** Provisional: one source, unchecked. The whole point of on-demand enrichment. */
const ON_DEMAND_CONFIDENCE: MetadataConfidence = "unverified";

/**
 * Wrap an adapter so runImport persists already-fetched records without
 * re-fetching, while keeping the real adapter's key and permitsRedistribution
 * flag so the licence gate and provenance attribution are identical to a live
 * import. Lifted from scripts/bulk-import-companies.ts so the script and this
 * module share one definition.
 */
export function passthrough(base: SourceAdapter, records: RawCompanyRecord[]): SourceAdapter {
  return {
    key: base.key,
    displayName: base.displayName,
    permitsRedistribution: base.permitsRedistribution,
    async load() {
      return records;
    },
  };
}

export type EnrichmentStatus = "enriched" | "no_entity" | "error";

export interface EnrichmentResult {
  status: EnrichmentStatus;
  /** Wikidata QID if one resolved, for logging/debug. */
  qid: string | null;
  /** Which source keys actually produced a record. */
  sourcesWritten: string[];
  created: number;
  updated: number;
  /** Human-readable trail — which sources hit, missed, or were skipped and why. */
  notes: string[];
}

function describeError(err: unknown): string {
  if (err instanceof RobotsDisallowedError) return "skipped: robots.txt disallows";
  if (err instanceof SsrfBlockedError) return `skipped: blocked address (${err.message})`;
  if (err instanceof GithubRateLimitError) return "github: rate limit exhausted";
  return err instanceof Error ? err.message : String(err);
}

/**
 * Fetch and persist a provisional profile for one company. Order matters:
 * Wikidata first (it yields the website + github handle the later steps need),
 * then Wikipedia (description), then the company's own website, then GitHub.
 * We only fetch the website/GitHub we DISCOVERED — never a guessed URL — so
 * this cannot be steered into fetching an arbitrary host.
 *
 * Never throws: every source is independently guarded, and a total failure
 * returns { status: "error" | "no_entity" } so the caller degrades to the
 * existing empty state rather than 500ing.
 */
export async function enrichCompanyOnDemand(
  store: CompanyStore,
  name: string
): Promise<EnrichmentResult> {
  const result: EnrichmentResult = { status: "enriched", qid: null, sourcesWritten: [], created: 0, updated: 0, notes: [] };
  const records: { sourceKey: string; record: RawCompanyRecord }[] = [];

  // 1. Wikidata — the anchor. Resolves to a VERIFIED BUSINESS entity or nothing
  //    (the geographic gate keeps a commune from importing as a company).
  let entity = null;
  try {
    entity = await resolveVerifiedCompanyEntity(name);
  } catch (err) {
    result.status = "error";
    result.notes.push(`wikidata: ${describeError(err)}`);
    return result;
  }

  if (!entity) {
    // Not an error — just nothing to show. The page keeps its empty state.
    result.status = "no_entity";
    result.notes.push("no verified business entity on Wikidata");
    return result;
  }

  result.qid = entity.qid;
  const wikidataRecord = wikidataRecordFromEntity(name, entity);
  records.push({ sourceKey: "wikidata", record: wikidataRecord });

  // 2. Wikipedia — description only.
  try {
    const wiki = await wikipediaRecordFromEntity(name, entity);
    if (wiki) records.push({ sourceKey: "wikipedia", record: wiki });
    else result.notes.push("no English Wikipedia article");
  } catch (err) {
    result.notes.push(`wikipedia: ${describeError(err)}`);
  }

  // 3. Official website — only the URL Wikidata gave us (P856). Never guessed.
  //    Never LinkedIn: even if a linkedin URL is among the discovered links we
  //    store it as a link_type but never crawl it. fetchWebsiteMeta is only
  //    ever handed the P856 official website here.
  const site = wikidataRecord.website;
  if (typeof site === "string" && site.length > 0) {
    try {
      const web = await fetchWebsiteMeta({ name, url: site });
      if (web) records.push({ sourceKey: "website_meta", record: web });
      else result.notes.push("website: no og:description");
    } catch (err) {
      result.notes.push(`website: ${describeError(err)}`);
    }
  } else {
    result.notes.push("website: no URL on Wikidata");
  }

  // 4. GitHub — only the handle Wikidata gave us (P2037).
  const handle = wikidataRecord.github_org;
  if (typeof handle === "string" && handle.length > 0) {
    try {
      const gh = await fetchGithubOrg({ name, org: handle });
      if (gh) records.push({ sourceKey: "github_org", record: gh });
      else result.notes.push(`github: no org "${handle}"`);
    } catch (err) {
      result.notes.push(`github: ${describeError(err)}`);
    }
  } else {
    result.notes.push("github: no handle on Wikidata");
  }

  // Persist one batch per source, each at 'unverified'. runImport applies the
  // licence gate + provenance rows + batch dedup — the same guarantees as bulk.
  const ADAPTERS: Record<string, SourceAdapter> = {
    wikidata: wikidataAdapter,
    wikipedia: wikipediaAdapter,
    website_meta: websiteMetaAdapter,
    github_org: githubOrgAdapter,
  };
  for (const sourceKey of ["wikidata", "wikipedia", "website_meta", "github_org"]) {
    const forSource = records.filter((r) => r.sourceKey === sourceKey).map((r) => r.record);
    if (forSource.length === 0) continue;
    try {
      const report = await runImport({
        store,
        adapter: passthrough(ADAPTERS[sourceKey], forSource),
        input: null,
        sourceKey,
        confidence: ON_DEMAND_CONFIDENCE,
      });
      result.created += report.created;
      result.updated += report.updated;
      if (report.created + report.updated > 0) result.sourcesWritten.push(sourceKey);
    } catch (err) {
      result.notes.push(`persist ${sourceKey}: ${describeError(err)}`);
    }
  }

  if (result.sourcesWritten.length === 0 && result.status === "enriched") {
    // Resolved an entity but nothing persisted (e.g. all sources errored).
    result.status = "error";
  }
  return result;
}
