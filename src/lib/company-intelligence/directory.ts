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
import { searchOrganizationsRanked, type RankedCompanyCandidate } from "./resolve";

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
/** Same embed, plus `id` — needed only to map profile rows back onto the
 *  ranked RPC's organization_id order (the RPC itself returns no profile data). */
const ORG_SELECT_WITH_ID = "id, " + ORG_SELECT;

interface OrgRowWithId extends OrgRow {
  id: string;
}

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
 * Strips the characters that have meaning in a PostgREST `.or()` filter
 * (comma, parens, wildcards, backslash) so a search string can never break
 * out of the filter it is placed in. Pure — unit-tested directly
 * (tests/search-entity.test.ts) without needing a database.
 *
 * Only the substring pass needs this: the ranked RPC receives the raw query
 * as a parameterized argument (not string-interpolated SQL), so stripping it
 * would only weaken domain/URL matches like "razorpay.com" for no safety gain.
 */
export function sanitizeSubstringQuery(rawQuery: string): string {
  return rawQuery.replace(/[%,()*\\]/g, "").trim();
}

/**
 * Substring match over display_name/slug/alias — the ORIGINAL search, kept as
 * a second pass (see searchCompanies below). Alone it has no typo tolerance
 * and no domain matching, which is exactly the gap search_organizations_ranked
 * (migration 0022) closes — but it still catches short, mid-word substrings
 * ("tech" inside "Kodehash Tech") that trigram similarity's 0.4 floor does not
 * reliably clear. Neither search subsumes the other at this data size.
 *
 * Throws on a query error rather than silently degrading to zero matches —
 * the original implementation ignored `.error` entirely (`data ?? []`), which
 * made a genuine outage indistinguishable from "no companies match". This
 * mirrors resolve.ts's own `searchOrganizationsRanked`, which already throws
 * on error; searchCompanies (below) decides what a partial-vs-total failure
 * across both passes should do.
 */
async function searchCompaniesBySubstring(
  supabase: SupabaseClient,
  safeQuery: string,
  limit: number
): Promise<CompanyListItem[]> {
  const namePattern = `%${safeQuery}%`;
  // alias_slug and organizations.slug are slug-shaped (lowercase, hyphenated),
  // so match them against the normalized form of the query.
  const slugPattern = `%${normalizeCompanySlug(safeQuery)}%`;

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

  if (nameRes.error) throw new Error(`searchCompaniesBySubstring (name/slug): ${nameRes.error.message}`);
  if (aliasRes.error) throw new Error(`searchCompaniesBySubstring (alias): ${aliasRes.error.message}`);

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

  return [...bySlug.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/**
 * Attach profile detail (description, founded_year) to ranked RPC candidates
 * and convert them to CompanyListItem, preserving the RPC's score order.
 * search_organizations_ranked (0022) returns no profile data of its own — this
 * is the one extra query M3.1 adds, mirroring how resolve.ts:71-78 already
 * attaches company_links.website to the same candidates.
 *
 * A ranked candidate is NEVER dropped because this (separate) profile lookup
 * finds no row or errors outright — the RPC already verified the organization
 * exists and already returned its real slug/displayName, so a missing profile
 * falls back to those known values with description/foundedYear left null
 * (never fabricated), rather than silently discarding a confirmed match.
 */
async function rankedCandidatesToListItems(
  supabase: SupabaseClient,
  candidates: RankedCompanyCandidate[]
): Promise<CompanyListItem[]> {
  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.organizationId);
  const { data, error } = await supabase.from("organizations").select(ORG_SELECT_WITH_ID).in("id", ids);
  if (error) {
    console.error("[searchCompanies] profile lookup for ranked candidates failed:", error);
  }
  const rows = (data ?? []) as unknown as OrgRowWithId[];
  const itemById = new Map(rows.map((row) => [row.id, toItem(row)]));

  // Order follows the RPC's own candidate order (its score order), not the
  // profile lookup's return order.
  return candidates.map(
    (c) =>
      itemById.get(c.organizationId) ?? {
        slug: c.slug,
        displayName: c.displayName,
        description: null,
        foundedYear: null,
      }
  );
}

/**
 * Merge ranked RPC hits with substring-only hits: RPC order wins (exact
 * slug/alias 1.0 → domain 0.95 → normalized name 0.85 → trigram 0.4–0.84),
 * and any substring match not already covered by the RPC is appended below
 * every ranked hit, in its own alphabetical order. Pure — no I/O — so the
 * merge itself is unit-testable without a database (tests/search-entity.test.ts).
 *
 * Evidence never enters this ordering — a zero-report company must still be
 * findable by name (M3 §6: evidence is a badge, never a search-rank key).
 */
export function mergeRankedAndSubstring(
  ranked: CompanyListItem[],
  substring: CompanyListItem[],
  limit: number
): CompanyListItem[] {
  const rankedSlugs = new Set(ranked.map((r) => r.slug));
  const substringOnly = substring.filter((s) => !rankedSlugs.has(s.slug));
  return [...ranked, ...substringOnly].slice(0, limit);
}

/**
 * Decide the outcome once both passes have run. Pure — the actual I/O and
 * error-catching happens in searchCompanies below; this is the testable
 * decision of what those two outcomes MEAN.
 *
 * Throws only when BOTH passes failed — a genuine outage, not "no companies
 * found". A single working pass still returns real (if partial) results
 * rather than being hidden behind a thrown error: that would turn a
 * degraded-but-useful search into a harder failure than it actually is.
 * This mirrors the "an outage and a genuinely-empty result must not look
 * alike" rule already enforced elsewhere in this codebase (e.g. BrowsePage).
 */
export function resolveSearchOutcome(
  rankedFailed: boolean,
  substringFailed: boolean,
  ranked: CompanyListItem[],
  substring: CompanyListItem[],
  limit: number
): CompanyListItem[] {
  if (rankedFailed && substringFailed) {
    throw new Error("searchCompanies: both the ranked and substring search passes failed");
  }
  return mergeRankedAndSubstring(ranked, substring, limit);
}

/**
 * Search organizations by display name, canonical slug, alias, or domain —
 * ranked. Two passes, merged (see mergeRankedAndSubstring):
 *
 *   1. search_organizations_ranked (migration 0022, via resolve.ts) — typo-
 *      tolerant, domain-aware, scored. This is the primary ranking.
 *   2. The original substring `.ilike` match — a safety net for short/mid-word
 *      substrings the RPC's 0.4 trigram floor can miss (M3.1 finding: swapping
 *      the RPC in as a full replacement would regress queries like "tech").
 *
 * ERROR HANDLING (see resolveSearchOutcome): each pass's failure is caught
 * independently. If only one pass fails, the other's real results are still
 * returned — a degraded search, not a hidden one. If BOTH fail, this throws
 * rather than returning [] — a genuine outage must not render as "no
 * companies match", which is exactly what the original `.ilike`-only
 * implementation did (it never checked `.error` at all). Existing callers
 * already handle a thrown error correctly: app/companies/page.tsx renders a
 * distinct "temporarily unavailable" state, and CompanySearch.tsx already
 * wraps its call in a try/catch.
 */
export async function searchCompanies(
  supabase: SupabaseClient,
  rawQuery: string,
  limit = 24
): Promise<CompanyListItem[]> {
  const q = rawQuery.trim();
  if (!q) return [];

  const safe = sanitizeSubstringQuery(q);

  let rankedFailed = false;
  let substringFailed = false;

  const [rankedCandidates, substringItems] = await Promise.all([
    searchOrganizationsRanked(supabase, q, limit).catch((err) => {
      console.error("[searchCompanies] ranked search failed:", err);
      rankedFailed = true;
      return [] as RankedCompanyCandidate[];
    }),
    // A query that is only metacharacters (e.g. "%%%") sanitizes to "" — that
    // is a legitimate zero-eligible-substrings case, not a failure, so the
    // substring pass is skipped rather than run against an empty pattern.
    safe
      ? searchCompaniesBySubstring(supabase, safe, limit).catch((err) => {
          console.error("[searchCompanies] substring search failed:", err);
          substringFailed = true;
          return [] as CompanyListItem[];
        })
      : Promise.resolve([] as CompanyListItem[]),
  ]);

  const rankedItems = await rankedCandidatesToListItems(supabase, rankedCandidates);
  return resolveSearchOutcome(rankedFailed, substringFailed, rankedItems, substringItems, limit);
}
