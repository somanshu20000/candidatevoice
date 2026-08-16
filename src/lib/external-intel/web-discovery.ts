/**
 * Case 1 (known company, sparse evidence) — step 1: does a PERMITTED external
 * source exist at all? `external_sources` (migration 0008) is the single
 * registry of feed types this codebase is allowed to acquire from; it is
 * global, not per-company — reddit/glassdoor/ambitionbox/linkedin are all
 * registered but `acquisition_enabled=false` for every one today (Q-2,
 * DECISIONS.md). This module reads that registry honestly: it returns a real
 * source only when one is genuinely permitted, and a clear reason otherwise —
 * it never invents a source to make the pipeline look wired when it isn't.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiscoveredSource {
  id: string;
  key: string;
  displayName: string;
  trustWeight: number;
}

export type DiscoveryResult =
  | { found: true; source: DiscoveredSource }
  | { found: false; reason: string };

/**
 * Returns the first source with acquisition permission, or explains why none
 * is available. `organizationSlug` is accepted (not yet used to filter) so
 * the signature is stable once a source becomes genuinely company-scoped —
 * today every acquisition-enabled source would be usable for any company.
 */
export async function discoverPermittedSource(
  supabase: SupabaseClient,
  _organizationSlug: string
): Promise<DiscoveryResult> {
  const { data, error } = await supabase
    .from("external_sources")
    .select("id, key, display_name, acquisition_enabled, trust_weight")
    .eq("acquisition_enabled", true)
    .order("trust_weight", { ascending: false })
    .limit(1);

  if (error) return { found: false, reason: `external_sources query failed: ${error.message}` };

  const row = (data ?? [])[0] as
    | { id: string; key: string; display_name: string; trust_weight: number | string }
    | undefined;

  if (!row) {
    return {
      found: false,
      reason:
        "no external source has acquisition_enabled=true — every registered source " +
        "(reddit, glassdoor, ambitionbox, linkedin) is currently gated on a permission/" +
        "credential decision that has not been made (DECISIONS.md Q-2). This is a genuine " +
        "human gate, not a bug: enabling one requires a real licensed/credentialed source, " +
        "which this pipeline correctly refuses to fabricate.",
    };
  }

  return {
    found: true,
    source: {
      id: row.id,
      key: row.key,
      displayName: row.display_name,
      trustWeight: typeof row.trust_weight === "string" ? Number(row.trust_weight) : row.trust_weight,
    },
  };
}
