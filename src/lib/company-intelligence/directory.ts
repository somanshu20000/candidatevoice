/**
 * Company Intelligence — directory read model.
 *
 * Powers the company index (/companies), the search box, and the companies
 * grid on /browse. These are the surfaces that make an imported organization
 * REACHABLE — before this, a company existed in the database but no page
 * linked to it, so it could only be found by typing its exact URL.
 *
 * Every function takes a SupabaseClient so the same query works from a server
 * component (anon, cookie-aware) and a client component (browser anon). Every
 * table read here is public reference data under RLS, so the anon client is
 * sufficient. Nothing here reads evidence — this is employer identity only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeCompanySlug } from "@/lib/company-slug";

export interface CompanyListItem {
  slug: string;
  displayName: string;
  description: string | null;
  foundedYear: number | null;
}

/** company_profiles is embedded through its organization_id FK; PostgREST may
 *  return a to-one embed as an object or a single-element array. */
interface ProfileEmbed {
  description: string | null;
  founded_year: number | null;
}

interface OrgRow {
  slug: string;
  display_name: string;
  company_profiles: ProfileEmbed | ProfileEmbed[] | null;
}

function toItem(row: OrgRow): CompanyListItem {
  const profile = Array.isArray(row.company_profiles)
    ? row.company_profiles[0] ?? null
    : row.company_profiles;
  return {
    slug: row.slug,
    displayName: row.display_name,
    description: profile?.description ?? null,
    foundedYear: profile?.founded_year ?? null,
  };
}

const ORG_SELECT = "slug, display_name, company_profiles(description, founded_year)";

/**
 * A single page of the alphabetical company directory. `total` is the full
 * count for pagination. Used by /companies when there is no search query.
 */
export async function listCompanies(
  supabase: SupabaseClient,
  opts: { limit: number; offset: number }
): Promise<{ items: CompanyListItem[]; total: number }> {
  const { data, count, error } = await supabase
    .from("organizations")
    .select(ORG_SELECT, { count: "exact" })
    .order("display_name", { ascending: true })
    .range(opts.offset, opts.offset + opts.limit - 1);

  if (error) throw new Error(`listCompanies: ${error.message}`);
  return {
    items: ((data ?? []) as OrgRow[]).map(toItem),
    total: count ?? 0,
  };
}

/**
 * Search organizations by display name, canonical slug, AND alias. The alias
 * match is what lets "Alphabet" find Google or "Stripe, Inc." find Stripe —
 * the whole reason organization_aliases exists. Results are de-duplicated by
 * slug, preferring the row that carries profile detail.
 *
 * The raw query is stripped of the characters that have meaning in a PostgREST
 * `.or()` filter (comma, parens, wildcards, backslash) before interpolation,
 * so a search string can never break out of the filter it is placed in.
 */
export async function searchCompanies(
  supabase: SupabaseClient,
  rawQuery: string,
  limit = 24
): Promise<CompanyListItem[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  // Neutralize PostgREST filter metacharacters. What remains is a plain
  // substring to match, which is all a name search needs.
  const safe = q.replace(/[%,()*\\]/g, "").trim();
  if (!safe) return [];

  const namePattern = `%${safe}%`;
  // alias_slug and organizations.slug are slug-shaped (lowercase, hyphenated),
  // so match them against the normalized form of the query.
  const slugPattern = `%${normalizeCompanySlug(safe)}%`;

  const [nameRes, aliasRes] = await Promise.all([
    supabase
      .from("organizations")
      .select(ORG_SELECT)
      .or(`display_name.ilike.${namePattern},slug.ilike.${slugPattern}`)
      .order("display_name", { ascending: true })
      .limit(limit),
    supabase
      .from("organization_aliases")
      .select("organizations(" + ORG_SELECT + ")")
      .ilike("alias_slug", slugPattern)
      .limit(limit),
  ]);

  const bySlug = new Map<string, CompanyListItem>();

  for (const row of (nameRes.data ?? []) as OrgRow[]) {
    const item = toItem(row);
    bySlug.set(item.slug, item);
  }

  // Alias hits embed the organization one level down. Only add ones not
  // already matched by name, so a company matched both ways keeps its
  // (profile-bearing) name-match entry.
  for (const row of (aliasRes.data ?? []) as unknown as { organizations: OrgRow | OrgRow[] | null }[]) {
    const org = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
    if (!org) continue;
    const item = toItem(org);
    if (!bySlug.has(item.slug)) bySlug.set(item.slug, item);
  }

  return [...bySlug.values()]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}
