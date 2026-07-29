/**
 * Company Intelligence — persistence boundary.
 *
 * The importer talks to this interface, never to Supabase directly. That keeps
 * the pipeline logic testable against an in-memory fake and confines every
 * table name and upsert clause to one file. A future move off Supabase touches
 * only createSupabaseCompanyStore, not the importer.
 *
 * Every write is an UPSERT keyed by a natural unique constraint declared in
 * migration 0005, so re-importing the same source is idempotent at the row
 * level: values are updated in place rather than duplicated.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetadataConfidence } from "./types";

export interface SourceRow {
  id: string;
  key: string;
  permitsRedistribution: boolean;
  trustTier: number;
}

export interface BatchCounts {
  record: number;
  created: number;
  updated: number;
  skipped: number;
  invalid: number;
}

export interface CompanyStore {
  getSource(key: string): Promise<SourceRow | null>;

  findCompletedBatch(sourceId: string, adapterKey: string, contentHash: string): Promise<string | null>;
  createBatch(sourceId: string, adapterKey: string, contentHash: string, recordCount: number): Promise<string>;
  finishBatch(batchId: string, status: "completed" | "failed", counts: BatchCounts, error?: string): Promise<void>;

  resolveOrganization(slug: string): Promise<string | null>;
  createOrganization(slug: string, displayName: string): Promise<string>;
  addAlias(aliasSlug: string, organizationId: string, source: "canonicalized" | "moderator" | "imported" | "observed"): Promise<void>;

  upsertProfile(input: ProfileUpsert): Promise<"created" | "updated">;
  upsertLink(input: LinkUpsert): Promise<void>;
  ensureCity(name: string, region: string | null, countryCode: string): Promise<string>;
  upsertLocation(input: LocationUpsert): Promise<void>;
  ensureTerm(kind: string, key: string, label: string): Promise<string>;
  upsertCompanyTaxonomy(input: TaxonomyUpsert): Promise<void>;
  upsertHiringRegion(input: HiringRegionUpsert): Promise<void>;
  upsertFieldObservation(input: FieldObservationUpsert): Promise<void>;
}

export interface ProfileUpsert {
  organizationId: string;
  legalName: string | null;
  description: string | null;
  foundedYear: number | null;
  sizeBand: string | null;
  stockSymbol: string | null;
  stockExchange: string | null;
  headquartersCityId: string | null;
  sourceId: string;
  confidence: MetadataConfidence;
}

export interface LinkUpsert {
  organizationId: string;
  linkType: string;
  url: string;
  sourceId: string;
  confidence: MetadataConfidence;
}

export interface LocationUpsert {
  organizationId: string;
  cityId: string;
  isHeadquarters: boolean;
  sourceId: string;
  confidence: MetadataConfidence;
}

export interface TaxonomyUpsert {
  organizationId: string;
  termId: string;
  isPrimary: boolean;
  sourceId: string;
  confidence: MetadataConfidence;
}

export interface HiringRegionUpsert {
  organizationId: string;
  countryCode: string;
  sourceId: string;
  confidence: MetadataConfidence;
}

export interface FieldObservationUpsert {
  organizationId: string;
  fieldKey: string;
  valueText: string | null;
  sourceId: string;
  confidence: MetadataConfidence;
  batchId: string;
}

/** Supabase-backed implementation. Uses the service-role client (RLS-bypassing). */
export function createSupabaseCompanyStore(client: SupabaseClient): CompanyStore {
  const must = <T>(data: T | null, context: string): T => {
    if (data === null || data === undefined) throw new Error(`[company-store] ${context} returned no row`);
    return data;
  };

  return {
    async getSource(key) {
      const { data, error } = await client
        .from("metadata_sources")
        .select("id, key, permits_redistribution, trust_tier")
        .eq("key", key)
        .maybeSingle();
      if (error) throw new Error(`getSource(${key}): ${error.message}`);
      if (!data) return null;
      return {
        id: data.id,
        key: data.key,
        permitsRedistribution: data.permits_redistribution,
        trustTier: data.trust_tier,
      };
    },

    async findCompletedBatch(sourceId, adapterKey, contentHash) {
      const { data, error } = await client
        .from("import_batches")
        .select("id")
        .eq("metadata_source_id", sourceId)
        .eq("adapter_key", adapterKey)
        .eq("content_hash", contentHash)
        .eq("status", "completed")
        .maybeSingle();
      if (error) throw new Error(`findCompletedBatch: ${error.message}`);
      return data?.id ?? null;
    },

    async createBatch(sourceId, adapterKey, contentHash, recordCount) {
      const { data, error } = await client
        .from("import_batches")
        .insert({
          metadata_source_id: sourceId,
          adapter_key: adapterKey,
          content_hash: contentHash,
          status: "running",
          record_count: recordCount,
        })
        .select("id")
        .single();
      if (error) throw new Error(`createBatch: ${error.message}`);
      return must(data, "createBatch").id;
    },

    async finishBatch(batchId, status, counts, errorMessage) {
      const { error } = await client
        .from("import_batches")
        .update({
          status,
          record_count: counts.record,
          created_count: counts.created,
          updated_count: counts.updated,
          skipped_count: counts.skipped,
          invalid_count: counts.invalid,
          finished_at: new Date().toISOString(),
          error_message: errorMessage ?? null,
        })
        .eq("id", batchId);
      if (error) throw new Error(`finishBatch: ${error.message}`);
    },

    async resolveOrganization(slug) {
      const { data, error } = await client.rpc("resolve_organization", { p_slug: slug });
      if (error) throw new Error(`resolveOrganization(${slug}): ${error.message}`);
      return (data as string | null) ?? null;
    },

    async createOrganization(slug, displayName) {
      // ON CONFLICT DO NOTHING then re-select, so a concurrent creator does not
      // cause a hard failure.
      const { error: insertError } = await client
        .from("organizations")
        .upsert({ slug, display_name: displayName }, { onConflict: "slug", ignoreDuplicates: true });
      if (insertError) throw new Error(`createOrganization(${slug}): ${insertError.message}`);
      const { data, error } = await client
        .from("organizations")
        .select("id")
        .eq("slug", slug)
        .single();
      if (error) throw new Error(`createOrganization re-select(${slug}): ${error.message}`);
      return must(data, "createOrganization").id;
    },

    async addAlias(aliasSlug, organizationId, source) {
      const { error } = await client
        .from("organization_aliases")
        .upsert(
          { alias_slug: aliasSlug, organization_id: organizationId, alias_source: source },
          { onConflict: "alias_slug", ignoreDuplicates: true }
        );
      if (error) throw new Error(`addAlias(${aliasSlug}): ${error.message}`);
    },

    async upsertProfile(input) {
      // Read the existing row first. A blind upsert would write every field
      // this call supplies, including null — so a second adapter that only
      // knows `description` would silently erase a `founded_year` an earlier,
      // higher-quality adapter had already set. Once there is more than one
      // real adapter contributing to the same organization, that is not a
      // hypothetical: it is what happens on the very next import run.
      //
      // Policy: a null here never overwrites a non-null already on the row.
      // Two different non-null values still resolve by import order (the
      // caller sequences adapters from lowest to highest trust_tier); this
      // only prevents *absence* of data from destroying previously-known data.
      const existing = await client
        .from("company_profiles")
        .select("legal_name, description, founded_year, size_band, stock_symbol, stock_exchange, headquarters_city_id")
        .eq("organization_id", input.organizationId)
        .maybeSingle();
      if (existing.error) throw new Error(`upsertProfile read(${input.organizationId}): ${existing.error.message}`);
      const prev = existing.data;
      const outcome: "created" | "updated" = prev ? "updated" : "created";

      const coalesce = <T>(next: T | null, current: T | null | undefined): T | null =>
        next !== null ? next : (current ?? null);

      const { error } = await client.from("company_profiles").upsert(
        {
          organization_id: input.organizationId,
          legal_name: coalesce(input.legalName, prev?.legal_name),
          description: coalesce(input.description, prev?.description),
          founded_year: coalesce(input.foundedYear, prev?.founded_year),
          size_band: coalesce(input.sizeBand, prev?.size_band),
          stock_symbol: coalesce(input.stockSymbol, prev?.stock_symbol),
          stock_exchange: coalesce(input.stockExchange, prev?.stock_exchange),
          headquarters_city_id: coalesce(input.headquartersCityId, prev?.headquarters_city_id),
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
        },
        { onConflict: "organization_id" }
      );
      if (error) throw new Error(`upsertProfile(${input.organizationId}): ${error.message}`);
      return outcome;
    },

    async upsertLink(input) {
      const { error } = await client.from("company_links").upsert(
        {
          organization_id: input.organizationId,
          link_type: input.linkType,
          url: input.url,
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
        },
        { onConflict: "organization_id,link_type,url" }
      );
      if (error) throw new Error(`upsertLink(${input.organizationId}/${input.linkType}): ${error.message}`);
    },

    async ensureCity(name, region, countryCode) {
      // The unique key is (country_code, region, name), and region is nullable,
      // so a null-safe match is needed on read.
      let query = client
        .from("cities")
        .select("id")
        .eq("country_code", countryCode)
        .eq("name", name);
      query = region === null ? query.is("region", null) : query.eq("region", region);
      const found = await query.maybeSingle();
      if (found.error) throw new Error(`ensureCity read(${name}): ${found.error.message}`);
      if (found.data) return found.data.id;

      const { data, error } = await client
        .from("cities")
        .insert({ name, region, country_code: countryCode })
        .select("id")
        .single();
      if (error) throw new Error(`ensureCity insert(${name}): ${error.message}`);
      return must(data, "ensureCity").id;
    },

    async upsertLocation(input) {
      const { error } = await client.from("company_locations").upsert(
        {
          organization_id: input.organizationId,
          city_id: input.cityId,
          is_headquarters: input.isHeadquarters,
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
        },
        { onConflict: "organization_id,city_id" }
      );
      if (error) throw new Error(`upsertLocation(${input.organizationId}): ${error.message}`);
    },

    async ensureTerm(kind, key, label) {
      const found = await client
        .from("taxonomy_terms")
        .select("id")
        .eq("kind", kind)
        .eq("key", key)
        .maybeSingle();
      if (found.error) throw new Error(`ensureTerm read(${kind}/${key}): ${found.error.message}`);
      if (found.data) return found.data.id;

      const { data, error } = await client
        .from("taxonomy_terms")
        .insert({ kind, key, label })
        .select("id")
        .single();
      if (error) throw new Error(`ensureTerm insert(${kind}/${key}): ${error.message}`);
      return must(data, "ensureTerm").id;
    },

    async upsertCompanyTaxonomy(input) {
      const { error } = await client.from("company_taxonomy").upsert(
        {
          organization_id: input.organizationId,
          term_id: input.termId,
          is_primary: input.isPrimary,
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
        },
        { onConflict: "organization_id,term_id" }
      );
      if (error) throw new Error(`upsertCompanyTaxonomy(${input.organizationId}): ${error.message}`);
    },

    async upsertHiringRegion(input) {
      const { error } = await client.from("company_hiring_regions").upsert(
        {
          organization_id: input.organizationId,
          country_code: input.countryCode,
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
        },
        { onConflict: "organization_id,country_code" }
      );
      if (error) throw new Error(`upsertHiringRegion(${input.organizationId}): ${error.message}`);
    },

    async upsertFieldObservation(input) {
      const { error } = await client.from("company_field_observations").upsert(
        {
          organization_id: input.organizationId,
          field_key: input.fieldKey,
          value_text: input.valueText,
          metadata_source_id: input.sourceId,
          confidence: input.confidence,
          import_batch_id: input.batchId,
          observed_at: new Date().toISOString(),
        },
        { onConflict: "organization_id,field_key,metadata_source_id" }
      );
      if (error) throw new Error(`upsertFieldObservation(${input.organizationId}/${input.fieldKey}): ${error.message}`);
    },
  };
}
