/**
 * Company Intelligence — the import pipeline.
 *
 *   adapter.load()  →  normalize  →  validate  →  batch-coherence
 *                                                      │
 *                            resolve/create org  ←─────┘
 *                                     │
 *                          persist profile + links + locations
 *                          + taxonomy + hiring regions + provenance
 *
 * Idempotent at two levels:
 *   • Batch: an identical input (same source, adapter, content hash) that has
 *     already completed is a no-op.
 *   • Row: every write is an upsert on a natural key, so re-importing updates
 *     in place rather than duplicating.
 *
 * The importer holds no Supabase reference — it works through CompanyStore, so
 * it runs unchanged against the real database or an in-memory fake in tests.
 */

import { createHash } from "crypto";
import { normalizeCompany } from "./normalize";
import { validateCompany, validateBatchCoherence } from "./validate";
import { fetchAndPersistLogo } from "./logo";
import type { CompanyStore, BatchCounts } from "./store";
import type {
  ImportReport,
  MetadataConfidence,
  NormalizedCompany,
  SourceAdapter,
  ValidationIssue,
} from "./types";

export interface ImportOptions {
  store: CompanyStore;
  adapter: SourceAdapter;
  /** Adapter-defined input passed straight to adapter.load(). */
  input: unknown;
  /** metadata_sources.key this run is attributed to. Defaults to the adapter key. */
  sourceKey?: string;
  /** Confidence stamped on every value this run writes. */
  confidence?: MetadataConfidence;
  /**
   * When true, validate and report but write nothing (no batch row, no upserts).
   * The default path for `validate-companies.ts`.
   */
  dryRun?: boolean;
}

/** Stable SHA-256 of the normalized record set — the batch idempotency key. */
function hashRecords(records: NormalizedCompany[]): string {
  // Sort by slug so record order in the input file does not change the hash.
  const canonical = [...records]
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((r) => ({
      slug: r.slug,
      aliasSlugs: [...r.aliasSlugs].sort(),
      legalName: r.legalName,
      description: r.description,
      foundedYear: r.foundedYear,
      sizeBand: r.sizeBand,
      stockSymbol: r.stockSymbol,
      stockExchange: r.stockExchange,
      links: [...r.links].sort((x, y) => x.linkType.localeCompare(y.linkType)),
      locations: [...r.locations].sort((x, y) => `${x.countryCode}${x.city}`.localeCompare(`${y.countryCode}${y.city}`)),
      taxonomy: [...r.taxonomy].sort((x, y) => `${x.kind}${x.key}`.localeCompare(`${y.kind}${y.key}`)),
      hiringRegionCodes: [...r.hiringRegionCodes].sort(),
    }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** Persist one validated record. Returns whether the organization was new. */
async function persistCompany(
  store: CompanyStore,
  company: NormalizedCompany,
  sourceId: string,
  confidence: MetadataConfidence,
  batchId: string
): Promise<"created" | "updated"> {
  // 1. Resolve or create the employer identity.
  let orgId = await store.resolveOrganization(company.slug);
  const isNewOrg = orgId === null;
  if (!orgId) orgId = await store.createOrganization(company.slug, company.displayName);

  // 2. Aliases.
  for (const aliasSlug of company.aliasSlugs) {
    await store.addAlias(aliasSlug, orgId, "imported");
  }

  // 3. Headquarters city (needed before the profile references it).
  let hqCityId: string | null = null;
  for (const loc of company.locations) {
    const cityId = await store.ensureCity(loc.city, loc.region, loc.countryCode);
    await store.upsertLocation({
      organizationId: orgId,
      cityId,
      isHeadquarters: loc.isHeadquarters,
      sourceId,
      confidence,
    });
    if (loc.isHeadquarters && hqCityId === null) hqCityId = cityId;
  }

  // 4. Scalar profile.
  const profileOutcome = await store.upsertProfile({
    organizationId: orgId,
    legalName: company.legalName,
    description: company.description,
    foundedYear: company.foundedYear,
    sizeBand: company.sizeBand,
    stockSymbol: company.stockSymbol,
    stockExchange: company.stockExchange,
    headquartersCityId: hqCityId,
    sourceId,
    confidence,
  });

  // 5. Links.
  for (const link of company.links) {
    await store.upsertLink({
      organizationId: orgId,
      linkType: link.linkType,
      url: link.url,
      sourceId,
      confidence,
    });
  }

  // 5.5. Logo. Decorative — a download/upload failure here must never fail an
  // import that otherwise succeeded, so it runs after the fields that matter
  // are already durably written, and fetchAndPersistLogo itself never throws.
  if (company.logoUrl) {
    await fetchAndPersistLogo(store, orgId, company.logoUrl, sourceId);
  }

  // 6. Taxonomy.
  for (const term of company.taxonomy) {
    const termId = await store.ensureTerm(term.kind, term.key, term.label);
    await store.upsertCompanyTaxonomy({
      organizationId: orgId,
      termId,
      isPrimary: term.isPrimary,
      sourceId,
      confidence,
    });
  }

  // 7. Hiring regions.
  for (const code of company.hiringRegionCodes) {
    await store.upsertHiringRegion({ organizationId: orgId, countryCode: code, sourceId, confidence });
  }

  // 8. Field-level provenance, so a later source's disagreement is answerable.
  const fields: [string, string | null][] = [
    ["legal_name", company.legalName],
    ["description", company.description],
    ["founded_year", company.foundedYear === null ? null : String(company.foundedYear)],
    ["size_band", company.sizeBand],
    ["stock_symbol", company.stockSymbol],
  ];
  for (const [fieldKey, valueText] of fields) {
    if (valueText === null) continue;
    await store.upsertFieldObservation({
      organizationId: orgId,
      fieldKey,
      valueText,
      sourceId,
      confidence,
      batchId,
    });
  }

  // A record that only touched an existing org is an update even if the org row
  // itself was new this run only when it truly created one.
  return isNewOrg || profileOutcome === "created" ? "created" : "updated";
}

/** Run the full pipeline. */
export async function runImport(options: ImportOptions): Promise<ImportReport> {
  const { store, adapter, input, dryRun = false } = options;
  const sourceKey = options.sourceKey ?? adapter.key;
  const confidence = options.confidence ?? "reported";

  // Licence gate: an adapter that may not republish cannot write. This is the
  // structural enforcement of the "only import what we may publish" rule.
  if (!adapter.permitsRedistribution) {
    throw new Error(
      `Adapter "${adapter.key}" declares permitsRedistribution=false; its data may be consulted but not persisted.`
    );
  }

  const source = await store.getSource(sourceKey);
  if (!source) {
    throw new Error(`Unknown metadata source "${sourceKey}". Register it in metadata_sources first.`);
  }
  if (!source.permitsRedistribution) {
    throw new Error(`Source "${sourceKey}" is marked permits_redistribution=false; refusing to persist its values.`);
  }

  // 1. Load + normalize.
  const raw = await adapter.load(input);
  const normalized: NormalizedCompany[] = [];
  const perRecordIssues: { name: string; issues: ValidationIssue[] }[] = [];
  let invalid = 0;

  for (const record of raw) {
    const company = normalizeCompany(record, sourceKey);
    if (!company) {
      invalid++;
      perRecordIssues.push({
        name: typeof record?.name === "string" ? record.name : "(unnamed)",
        issues: [{ field: "name", severity: "error", code: "unusable_record", message: "Record has no usable name/slug." }],
      });
      continue;
    }
    normalized.push(company);
  }

  // 2. Validate each + batch coherence (duplicates, alias conflicts).
  const coherence = validateBatchCoherence(normalized);
  const importable: NormalizedCompany[] = [];

  normalized.forEach((company, index) => {
    const result = validateCompany(company);
    const crossIssues = coherence.get(index) ?? [];
    const allIssues = [...result.issues, ...crossIssues];
    const hasError = allIssues.some((i) => i.severity === "error");

    if (allIssues.length > 0) {
      perRecordIssues.push({ name: company.displayName, issues: allIssues });
    }
    if (hasError) {
      invalid++;
    } else {
      importable.push(company);
    }
  });

  const contentHash = hashRecords(importable);

  const baseReport: ImportReport = {
    batchId: null,
    sourceKey,
    adapterKey: adapter.key,
    total: raw.length,
    created: 0,
    updated: 0,
    skipped: 0,
    invalid,
    issues: perRecordIssues,
    alreadyImported: false,
  };

  if (dryRun) return baseReport;

  // 3. Batch-level idempotency.
  const existing = await store.findCompletedBatch(source.id, adapter.key, contentHash);
  if (existing) {
    return { ...baseReport, batchId: existing, skipped: importable.length, alreadyImported: true };
  }

  // 4. Apply.
  const batchId = await store.createBatch(source.id, adapter.key, contentHash, raw.length);
  const counts: BatchCounts = { record: raw.length, created: 0, updated: 0, skipped: 0, invalid };

  try {
    for (const company of importable) {
      const outcome = await persistCompany(store, company, source.id, confidence, batchId);
      if (outcome === "created") counts.created++;
      else counts.updated++;
    }
    await store.finishBatch(batchId, "completed", counts);
  } catch (err) {
    await store.finishBatch(batchId, "failed", counts, err instanceof Error ? err.message : String(err));
    throw err;
  }

  return {
    ...baseReport,
    batchId,
    created: counts.created,
    updated: counts.updated,
    skipped: counts.skipped,
  };
}
