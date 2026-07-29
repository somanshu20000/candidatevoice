/**
 * Company Intelligence — read model for the company profile page.
 *
 * Fetches the imported metadata bundle for one organization. Kept separate from
 * evidence reads (which live in the page and hqs.ts) so the two data families
 * never share a query. Returns null when no organization resolves — the caller
 * then knows to render the "no metadata yet" state, distinct from "no reports
 * yet".
 *
 * Takes an untyped SupabaseClient because the Company Intelligence tables are
 * not in the hand-authored Database type; the anon client is fine since every
 * table read here is public reference data.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinkType, MetadataConfidence, SizeBand } from "./types";

export interface CompanyLinkView {
  linkType: LinkType;
  url: string;
  confidence: MetadataConfidence;
  lastStatus: number | null;
}

export interface CompanyLocationView {
  city: string;
  region: string | null;
  countryCode: string;
  isHeadquarters: boolean;
}

export interface CompanyTermView {
  kind: "industry" | "tag" | "technology" | "business_category";
  label: string;
  isPrimary: boolean;
}

/**
 * Which source the resolved `description` on the profile came from. Exists so
 * the UI can satisfy an attribution obligation instead of merely storing it:
 * CC BY-SA (Wikipedia) requires a credit and a link back on redistribution,
 * and this is how CompanyOverview knows to render one. See
 * supabase/migrations/0006_metadata_fetch_sources.sql for the per-source
 * license/attribution_required record this is read from.
 */
export interface DescriptionSourceView {
  key: string;
  label: string;
  attributionRequired: boolean;
}

export interface CompanyProfileView {
  organizationId: string;
  slug: string;
  displayName: string;
  legalName: string | null;
  description: string | null;
  descriptionSource: DescriptionSourceView | null;
  foundedYear: number | null;
  sizeBand: SizeBand | null;
  stockSymbol: string | null;
  stockExchange: string | null;
  headquarters: CompanyLocationView | null;
  confidence: MetadataConfidence | null;
  observedAt: string | null;
  links: CompanyLinkView[];
  locations: CompanyLocationView[];
  terms: CompanyTermView[];
  hiringRegions: string[];
  /** Whether ANY imported metadata exists for this company. */
  hasMetadata: boolean;
}

interface CityJoin {
  name: string;
  region: string | null;
  country_code: string;
}

/** Load the metadata bundle for a resolved organization slug. */
export async function loadCompanyProfile(
  supabase: SupabaseClient,
  slug: string
): Promise<CompanyProfileView | null> {
  const { data: orgId, error: resolveError } = await supabase.rpc("resolve_organization", { p_slug: slug });
  if (resolveError || !orgId) return null;

  const { data: org } = await supabase
    .from("organizations")
    .select("id, slug, display_name")
    .eq("id", orgId)
    .maybeSingle();
  if (!org) return null;

  const [profileRes, linksRes, locationsRes, taxonomyRes, regionsRes] = await Promise.all([
    supabase
      .from("company_profiles")
      .select(
        "legal_name, description, founded_year, size_band, stock_symbol, stock_exchange, confidence, observed_at, headquarters_city_id, " +
          "cities:headquarters_city_id (name, region, country_code), " +
          "metadata_sources:metadata_source_id (key, display_name, attribution_required)"
      )
      .eq("organization_id", orgId)
      .maybeSingle(),
    supabase
      .from("company_links")
      .select("link_type, url, confidence, last_status")
      .eq("organization_id", orgId),
    supabase
      .from("company_locations")
      .select("is_headquarters, cities:city_id (name, region, country_code)")
      .eq("organization_id", orgId),
    supabase
      .from("company_taxonomy")
      .select("is_primary, taxonomy_terms:term_id (kind, label)")
      .eq("organization_id", orgId),
    supabase
      .from("company_hiring_regions")
      .select("country_code")
      .eq("organization_id", orgId),
  ]);

  interface SourceJoin {
    key: string;
    display_name: string;
    attribution_required: boolean;
  }

  const profile = profileRes.data as
    | {
        legal_name: string | null;
        description: string | null;
        founded_year: number | null;
        size_band: SizeBand | null;
        stock_symbol: string | null;
        stock_exchange: string | null;
        confidence: MetadataConfidence | null;
        observed_at: string | null;
        cities: CityJoin | CityJoin[] | null;
        metadata_sources: SourceJoin | SourceJoin[] | null;
      }
    | null;

  const hqCity = profile ? (Array.isArray(profile.cities) ? profile.cities[0] : profile.cities) : null;
  const descriptionSourceRow = profile
    ? Array.isArray(profile.metadata_sources)
      ? profile.metadata_sources[0]
      : profile.metadata_sources
    : null;

  const links: CompanyLinkView[] = ((linksRes.data ?? []) as Array<{ link_type: LinkType; url: string; confidence: MetadataConfidence; last_status: number | null }>).map((l) => ({
    linkType: l.link_type,
    url: l.url,
    confidence: l.confidence,
    lastStatus: l.last_status,
  }));

  const locations: CompanyLocationView[] = ((locationsRes.data ?? []) as Array<{ is_headquarters: boolean; cities: CityJoin | CityJoin[] | null }>).map((row) => {
    const city = Array.isArray(row.cities) ? row.cities[0] : row.cities;
    return {
      city: city?.name ?? "",
      region: city?.region ?? null,
      countryCode: city?.country_code ?? "",
      isHeadquarters: row.is_headquarters,
    };
  }).filter((l) => l.city !== "");

  const terms: CompanyTermView[] = ((taxonomyRes.data ?? []) as Array<{ is_primary: boolean; taxonomy_terms: { kind: CompanyTermView["kind"]; label: string } | { kind: CompanyTermView["kind"]; label: string }[] | null }>).map((row) => {
    const term = Array.isArray(row.taxonomy_terms) ? row.taxonomy_terms[0] : row.taxonomy_terms;
    return term ? { kind: term.kind, label: term.label, isPrimary: row.is_primary } : null;
  }).filter((t): t is CompanyTermView => t !== null);

  const hiringRegions = ((regionsRes.data ?? []) as Array<{ country_code: string }>).map((r) => r.country_code);

  const hasMetadata =
    profile !== null || links.length > 0 || locations.length > 0 || terms.length > 0 || hiringRegions.length > 0;

  return {
    organizationId: org.id,
    slug: org.slug,
    displayName: org.display_name,
    legalName: profile?.legal_name ?? null,
    description: profile?.description ?? null,
    descriptionSource:
      profile?.description && descriptionSourceRow
        ? {
            key: descriptionSourceRow.key,
            label: descriptionSourceRow.display_name,
            attributionRequired: descriptionSourceRow.attribution_required,
          }
        : null,
    foundedYear: profile?.founded_year ?? null,
    sizeBand: profile?.size_band ?? null,
    stockSymbol: profile?.stock_symbol ?? null,
    stockExchange: profile?.stock_exchange ?? null,
    headquarters: hqCity
      ? { city: hqCity.name, region: hqCity.region, countryCode: hqCity.country_code, isHeadquarters: true }
      : null,
    confidence: profile?.confidence ?? null,
    observedAt: profile?.observed_at ?? null,
    links,
    locations,
    terms,
    hiringRegions,
    hasMetadata,
  };
}
