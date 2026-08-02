/**
 * "Companies like this one" — a READ-MODEL, not a stored graph.
 *
 * The product brief keeps asking for a knowledge graph (nodes, edges, edge
 * provenance, versioning, a query layer). At this scale that is the wrong
 * shape: "similar companies" is a query over tables we already have, computed
 * at read time, with provenance for free (every row it reads already carries
 * metadata_source_id + confidence). A materialised graph store would be a
 * second source of truth to keep in sync with the relational evidence model —
 * exactly the "parallel system / maintenance risk" to avoid. So this is a
 * function, not a subsystem.
 *
 * Signal, v1: shared taxonomy terms (industry / technology / category). This is
 * METADATA-derived, so it works even for companies with zero hiring reports —
 * the common case today. A candidate looking at Stripe wants "other payments /
 * fintech companies", and enrichment already knows that.
 *
 * Deliberately NOT here (yet): behavioural-fingerprint distance. It is a real
 * future refinement, but it needs every candidate company's fingerprint, which
 * means a bulk evidence load the company page does not currently do. Adding
 * that load to every page render for a signal that is empty until evidence
 * accumulates is the wrong trade now. When the company page already has
 * analytics in hand, blend it in here — the ranker below is written to make
 * that a widening, not a rewrite.
 *
 * Reads only public-RLS tables (company_taxonomy, taxonomy_terms,
 * organizations), so the anon/SSR client is sufficient — same as read.ts.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SimilarCompany {
  organizationId: string;
  slug: string;
  displayName: string;
  /** Human labels of the terms shared with the target, e.g. ["Fintech", "Payments"]. */
  sharedTerms: string[];
}

interface SimilarCandidate {
  organizationId: string;
  slug: string;
  displayName: string;
  sharedTerms: string[];
}

/**
 * Rank candidates by how many terms they share with the target, most first,
 * then alphabetically for a stable order. Pure — no I/O — so the ordering rule
 * is unit-testable and a future signal (fingerprint distance) can be folded in
 * here without touching the query. Candidates with zero shared terms are
 * dropped (they should never have been passed, but the guard keeps the
 * contract clean).
 */
export function rankSimilarCompanies(candidates: SimilarCandidate[], limit: number): SimilarCompany[] {
  return candidates
    .filter((c) => c.sharedTerms.length > 0)
    .sort((a, b) => b.sharedTerms.length - a.sharedTerms.length || a.displayName.localeCompare(b.displayName))
    .slice(0, limit)
    .map(({ organizationId, slug, displayName, sharedTerms }) => ({ organizationId, slug, displayName, sharedTerms }));
}

/**
 * Companies sharing at least one taxonomy term with `organizationId`, best
 * match first. Returns [] when the target has no terms (most companies today)
 * or nothing else shares one — an honest empty, never a guess.
 *
 * Four small public-read queries, mirroring read.ts's style (no nested-embed
 * assumptions): target terms → their labels → other orgs holding those terms →
 * those orgs' names. Assembled and ranked in memory.
 */
export async function loadSimilarCompanies(
  client: SupabaseClient,
  organizationId: string,
  limit = 6
): Promise<SimilarCompany[]> {
  // 1. The target's own term ids.
  const targetTerms = await client
    .from("company_taxonomy")
    .select("term_id")
    .eq("organization_id", organizationId);
  if (targetTerms.error || !targetTerms.data || targetTerms.data.length === 0) return [];
  const termIds = (targetTerms.data as { term_id: string }[]).map((r) => r.term_id);

  // 2. Labels for those terms (for the "why", and to skip the empty-label case).
  const termRows = await client.from("taxonomy_terms").select("id, label").in("id", termIds);
  if (termRows.error || !termRows.data) return [];
  const labelById = new Map((termRows.data as { id: string; label: string }[]).map((t) => [t.id, t.label]));

  // 3. Other organizations that also hold any of those terms.
  const shared = await client
    .from("company_taxonomy")
    .select("organization_id, term_id")
    .in("term_id", termIds)
    .neq("organization_id", organizationId);
  if (shared.error || !shared.data || shared.data.length === 0) return [];

  const sharedByOrg = new Map<string, Set<string>>();
  for (const row of shared.data as { organization_id: string; term_id: string }[]) {
    const set = sharedByOrg.get(row.organization_id) ?? new Set<string>();
    set.add(row.term_id);
    sharedByOrg.set(row.organization_id, set);
  }

  // 4. Names/slugs for those organizations.
  const orgIds = [...sharedByOrg.keys()];
  const orgs = await client.from("organizations").select("id, slug, display_name").in("id", orgIds);
  if (orgs.error || !orgs.data) return [];
  const orgById = new Map(
    (orgs.data as { id: string; slug: string; display_name: string }[]).map((o) => [o.id, o])
  );

  const candidates: SimilarCandidate[] = [];
  for (const [orgId, termSet] of sharedByOrg) {
    const org = orgById.get(orgId);
    if (!org) continue;
    const sharedTerms = [...termSet].map((id) => labelById.get(id)).filter((l): l is string => Boolean(l));
    if (sharedTerms.length === 0) continue;
    candidates.push({ organizationId: orgId, slug: org.slug, displayName: org.display_name, sharedTerms });
  }

  return rankSimilarCompanies(candidates, limit);
}
