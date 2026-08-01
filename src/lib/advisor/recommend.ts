/**
 * The Recommendation engine — rank companies by how well they fit ONE
 * candidate's priorities. Pure.
 *
 * This is deliberately NOT rankCompanies (src/lib/evidence, M7): that ranks by
 * HQS/quality, the same order for everyone. This ranks by personal fit, so two
 * candidates with different priorities get different orders over the same
 * companies — the entire point of the advisor. A thin-evidence company is not
 * force-ranked: it is listed as unrated (never buried, never given a fake
 * position), mirroring how the search ranking gates low-confidence companies.
 */

import type { BehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { computeFit } from "./fit";
import type { FitResult, FitTier, PreferenceVector } from "./types";

export interface RankCandidateCompany {
  organizationId: string;
  slug: string;
  displayName: string;
  fingerprint: BehaviouralFingerprint;
}

export interface RankedCompany {
  organizationId: string;
  slug: string;
  displayName: string;
  fit: FitResult;
}

export interface Recommendations {
  /** Companies with a real fit score, sorted best fit first. */
  ranked: RankedCompany[];
  /** Companies whose fit could not be scored (thin evidence, or no scorable
   *  priority) — surfaced so they are visible, but never given a rank. */
  unrated: RankedCompany[];
}

/**
 * Rank companies for a preference vector. Ties break by evidence weight
 * (effectiveN) so a better-supported company edges out an equally-fitting but
 * thinner one, then by displayName for a stable, deterministic order.
 */
export function rankByFit(vector: PreferenceVector, companies: RankCandidateCompany[]): Recommendations {
  const scored: RankedCompany[] = [];
  const unrated: RankedCompany[] = [];

  for (const c of companies) {
    const fit = computeFit(vector, c.fingerprint);
    const entry: RankedCompany = { organizationId: c.organizationId, slug: c.slug, displayName: c.displayName, fit };
    if (fit.score === null) unrated.push(entry);
    else scored.push(entry);
  }

  scored.sort((a, b) => {
    if (b.fit.score !== a.fit.score) return (b.fit.score as number) - (a.fit.score as number);
    if (b.fit.base.effectiveN !== a.fit.base.effectiveN) return b.fit.base.effectiveN - a.fit.base.effectiveN;
    return a.displayName.localeCompare(b.displayName);
  });

  return { ranked: scored, unrated };
}

/** Group ranked companies by tier, preserving rank order within each tier. */
export function groupByTier(ranked: RankedCompany[]): Record<FitTier, RankedCompany[]> {
  const groups: Record<FitTier, RankedCompany[]> = { best: [], good: [], stretch: [], avoid: [] };
  for (const c of ranked) {
    if (c.fit.tier) groups[c.fit.tier].push(c);
  }
  return groups;
}
