/**
 * Evidence Engine — single entry point. Everything upstream (M2 Fingerprint,
 * M3 HQS, M6 Analytics, M7 Search) calls this and nothing else; no consumer
 * should ever import load.ts/normalize.ts directly.
 *
 * Caching (ADR-0002 Part 2: wrap in React `cache()`) is deferred to M5, where
 * the company page actually calls this more than once per request — adding it
 * now would be unverifiable (no caller yet to prove the dedup works) and, if
 * the per-request client isn't itself request-scoped, would silently no-op
 * rather than cache. Revisit there against the real client-passing pattern.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadFirstPartyRows, loadExternalRows, resolveOrganizationId } from "./load";
import { normalizeFirstParty, normalizeExternal } from "./normalize";
import { describeBase } from "./aggregate";
import { capSourceShare } from "./cap";
import { getGlobalExternalMultiplier } from "@/lib/hiring-intel/settings";
import type { EvidenceItem, EvidenceSet } from "./types";

/**
 * Resolve a company slug to its full weighted EvidenceSet, or null if the
 * slug doesn't resolve to any organization. An organization with zero
 * evidence still returns a set (empty items, zeroed base) — "no reports yet"
 * is a valid, renderable state, not an error.
 */
export async function loadEvidence(client: SupabaseClient, companySlug: string): Promise<EvidenceSet | null> {
  const organizationId = await resolveOrganizationId(client, companySlug);
  if (organizationId === null) return null;

  const [firstPartyRows, externalRows, globalMultiplier] = await Promise.all([
    loadFirstPartyRows(client, organizationId),
    loadExternalRows(client, organizationId),
    getGlobalExternalMultiplier(client),
  ]);

  // Cap any single external source's weighted share before anything reads the
  // set, so the company page and the rankings agree on every number.
  const items: EvidenceItem[] = capSourceShare([
    ...normalizeFirstParty(firstPartyRows),
    ...normalizeExternal(externalRows, globalMultiplier),
  ]);

  return {
    organizationId,
    items,
    base: describeBase(items),
    globalMultiplier,
  };
}

export type { EvidenceItem, EvidenceSet, EvidenceBase, EvidenceFamily, MetricResult } from "./types";
export { weightedRate, weightedMean, weightedShare, kishEffectiveN, describeBase } from "./aggregate";
export { loadExternalDisplayRows, type ExternalReportDisplayRow } from "./load";
export {
  loadFacetRatings,
  loadFacetEmotions,
  type RawFacetRating,
  type RawEmotionSelection,
} from "./load";
export { minimalEvidenceItem } from "./synthetic";
export { capSourceShare, DEFAULT_MAX_SOURCE_SHARE } from "./cap";
export {
  loadCompanyAnalytics,
  ghostingLeaderboard,
  fastestHiring,
  type CompanyAnalytics,
  type AnalyticsResult,
} from "./analytics";
export {
  searchRank,
  rankCompanies,
  confidenceFactor,
  freshnessFactor,
  CONFIDENCE_SATURATION_N,
  FRESHNESS_HALF_LIFE_MONTHS,
  type RankedCompany,
  type SearchRankInputs,
} from "./rank";
export {
  filterByCohort,
  scopeToCohort,
  isEmptyCohort,
  describeCohort,
  parseExperienceBucket,
  parseApplicationChannel,
  EXPERIENCE_BUCKET_LABELS,
  APPLICATION_CHANNEL_LABELS,
  type CohortFilter,
} from "./cohort";
export { inspectEvidence, type EvidenceInspection, type InspectionBand } from "./inspector";
