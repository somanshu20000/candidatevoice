/**
 * Company resolution — ranked candidate search + explicit-confirmation
 * support (migration 0021). This module NEVER decides which organization a
 * submission belongs to; it only ranks and returns candidates. The caller
 * (the submit flow) always requires a human to click "This is the company"
 * before an organization_id is usable — see docs and /api/submit.
 *
 * WHY THIS EXISTS. resolve_organization() (0002) is exact-match only
 * (canonical slug / alias / canonicalized input) and the old submit path
 * silently CREATED a new organization on any miss. Neither is acceptable for
 * a public-facing search: a near-miss should show candidates, not nothing or
 * a wrong auto-create.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface RankedCompanyCandidate {
  organizationId: string;
  displayName: string;
  slug: string;
  /** 0..1. Never used to auto-select — only to order/label candidates. */
  score: number;
  matchReason: "exact_slug" | "alias" | "domain" | "normalized_name" | "similar_name" | "similar_alias";
  /** From company_links(link_type='website'); null when not imported — never fabricated. */
  website: string | null;
  /** Always populated — /api/logo/[slug] itself falls back to a generated monogram. */
  logoUrl: string;
}

const CONFIDENT_MATCH_FLOOR = 0.85; // exact_slug / alias / domain / normalized_name
const SHOW_CANDIDATES_FLOOR = 0.4; // trigram similarity floor, matches the SQL function

export function confidenceTier(score: number): "confident" | "possible" | "none" {
  if (score >= CONFIDENT_MATCH_FLOOR) return "confident";
  if (score >= SHOW_CANDIDATES_FLOOR) return "possible";
  return "none";
}

interface RankedRow {
  organization_id: string;
  display_name: string;
  slug: string;
  score: number | string;
  match_reason: string;
}

/**
 * Search organizations by name, alias, or domain, ranked by confidence.
 * Returns [] on any error (a broken search must never look like "no
 * companies exist" vs. "the search failed" to the caller — the submit UI
 * distinguishes the two states itself using a separate `failed` flag it
 * derives from a thrown error; this function only throws, never swallows).
 */
export async function searchOrganizationsRanked(
  supabase: SupabaseClient,
  query: string,
  limit = 8
): Promise<RankedCompanyCandidate[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: RankedRow[] | null; error: { message: string } | null }>;
  }).rpc("search_organizations_ranked", { p_query: q, p_limit: limit });
  if (error) throw new Error(`searchOrganizationsRanked: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.organization_id);
  const { data: links } = await supabase
    .from("company_links")
    .select("organization_id, url")
    .eq("link_type", "website")
    .in("organization_id", ids);

  const websiteByOrg = new Map<string, string>();
  for (const l of (links ?? []) as { organization_id: string; url: string }[]) websiteByOrg.set(l.organization_id, l.url);

  return rows.map((r) => ({
    organizationId: r.organization_id,
    displayName: r.display_name,
    slug: r.slug,
    score: typeof r.score === "string" ? Number(r.score) : r.score,
    matchReason: r.match_reason as RankedCompanyCandidate["matchReason"],
    website: websiteByOrg.get(r.organization_id) ?? null,
    // /api/logo/[slug] already handles is_current lookup + graceful monogram
    // fallback — no need to duplicate that query here.
    logoUrl: `/api/logo/${encodeURIComponent(r.slug)}`,
  }));
}

/**
 * Re-verify a candidate organization_id actually exists. This is the
 * server-side check /api/submit MUST run before trusting a client-supplied
 * id — the ranked list shown to the user is advisory; this query is truth.
 */
export async function organizationExists(supabase: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await supabase.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (error) return false;
  return data !== null;
}

export interface CompanyRequestInput {
  requestedName: string;
  requestedDomain: string | null;
  requesterNote: string | null;
}

/**
 * "Company isn't listed" — writes to the moderation queue, never to
 * organizations directly. Best-effort: returns ok:false rather than
 * throwing, so a failure here never blocks the submission it's attached to.
 */
export async function createCompanyRequest(
  supabase: SupabaseClient,
  input: CompanyRequestInput
): Promise<{ ok: boolean }> {
  const name = input.requestedName.trim().slice(0, 200);
  if (!name) return { ok: false };
  const { error } = await supabase.from("company_requests").insert({
    requested_name: name,
    requested_domain: input.requestedDomain?.trim().slice(0, 200) || null,
    requester_note: input.requesterNote?.trim().slice(0, 500) || null,
  });
  return { ok: !error };
}
