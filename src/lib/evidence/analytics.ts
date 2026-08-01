/**
 * Cross-company analytics (ADR-0002 Part 5). Every surface here — rankings,
 * ghosting leaderboard, fastest-hiring — is computed from the SAME engine the
 * company page uses: load → normalize → weight → cap → fingerprint → HQS.
 * Nothing here computes a metric of its own; it only groups by company and
 * sorts.
 *
 * THE RANKING RULE (Part 5): a leaderboard without sample sizes is a
 * defamation surface. Only companies above the confidence gate are RANKED;
 * everything else is returned in `unranked` — listed, never hidden, never
 * silently dropped. Every row carries its EvidenceBase so the UI can show
 * "62 · 19 effective of 97" beside the number.
 *
 * Scale: loads all rows and groups in memory. Fine at hundreds of companies
 * (Part 8); the row cap in load.ts logs when that stops being true.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  loadAllFirstPartyRows,
  loadAllExternalRows,
  loadOrganizationsByIds,
} from "./load";
import { normalizeFirstParty, normalizeExternal } from "./normalize";
import { capSourceShare } from "./cap";
import { describeBase } from "./aggregate";
import { getGlobalExternalMultiplier } from "@/lib/hiring-intel/settings";
import type { EvidenceItem, EvidenceBase } from "./types";
import { buildBehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import type { BehaviouralDimensionScore, BehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { computeHqs } from "@/utils/hqs";
import type { HqsResult } from "@/utils/hqs";

/** One company's full analytic profile — HQS plus the dimensions the various
 *  leaderboards sort on, each with its own suppression state and base. */
export interface CompanyAnalytics {
  organizationId: string;
  slug: string;
  displayName: string;
  hqs: HqsResult | null;
  ghosting: BehaviouralDimensionScore;
  responseSpeed: BehaviouralDimensionScore;
  /** The full behavioural fingerprint — carried so consumers that need every
   *  dimension (the candidate advisor's fit ranking, the market baseline) reuse
   *  this one bulk load instead of re-reading every company. */
  fingerprint: BehaviouralFingerprint;
  base: EvidenceBase;
  /** True when HQS rendered (effectiveN ≥ gate) — only ranked companies. */
  ranked: boolean;
}

export interface AnalyticsResult {
  /** HQS-rankable companies, highest HQS first. */
  ranked: CompanyAnalytics[];
  /** Have evidence but below the confidence gate — listed, never ranked. */
  unranked: CompanyAnalytics[];
  globalMultiplier: number;
}

function groupByOrganization(items: EvidenceItem[]): Map<string, EvidenceItem[]> {
  const map = new Map<string, EvidenceItem[]>();
  for (const item of items) {
    const list = map.get(item.organizationId);
    if (list) list.push(item);
    else map.set(item.organizationId, [item]);
  }
  return map;
}

/**
 * Build analytics for every company that has any evidence. Single set of
 * bulk reads, grouped in memory, each company run through the same engine.
 */
export async function loadCompanyAnalytics(client: SupabaseClient): Promise<AnalyticsResult> {
  const [firstPartyRows, externalRows, globalMultiplier] = await Promise.all([
    loadAllFirstPartyRows(client),
    loadAllExternalRows(client),
    getGlobalExternalMultiplier(client),
  ]);

  const allItems: EvidenceItem[] = [
    ...normalizeFirstParty(firstPartyRows),
    ...normalizeExternal(externalRows, globalMultiplier),
  ];
  const byOrg = groupByOrganization(allItems);

  const orgIds = [...byOrg.keys()];
  const orgs = await loadOrganizationsByIds(client, orgIds);
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const companies: CompanyAnalytics[] = [];
  for (const [organizationId, rawItems] of byOrg) {
    const org = orgById.get(organizationId);
    if (!org) continue; // an org we can't name isn't linkable — skip rather than render a dead row

    // Same pipeline as loadEvidence: cap per-source share, then aggregate.
    const items = capSourceShare(rawItems);
    const fingerprint = buildBehaviouralFingerprint({ organizationId, items, base: describeBase(items), globalMultiplier });
    const hqs = computeHqs(fingerprint);

    companies.push({
      organizationId,
      slug: org.slug,
      displayName: org.displayName,
      hqs,
      ghosting: fingerprint.dimensions.find((d) => d.key === "ghosting")!,
      responseSpeed: fingerprint.dimensions.find((d) => d.key === "response_speed")!,
      fingerprint,
      base: fingerprint.base,
      ranked: hqs !== null,
    });
  }

  const ranked = companies
    .filter((c) => c.ranked && c.hqs !== null)
    .sort((a, b) => b.hqs!.score - a.hqs!.score);
  const unranked = companies
    .filter((c) => !c.ranked)
    .sort((a, b) => b.base.effectiveN - a.base.effectiveN);

  return { ranked, unranked, globalMultiplier };
}

/**
 * Ghosting leaderboard: companies where the ghosting dimension rendered,
 * WORST first (lowest ghosting score = most candidates ghosted). Only draws
 * from ranked companies — the same confidence gate; a "most ghosting"
 * board built on n=1 is exactly the defamation surface Part 5 warns about.
 */
export function ghostingLeaderboard(result: AnalyticsResult): CompanyAnalytics[] {
  return result.ranked
    .filter((c) => c.ghosting.score !== null)
    .sort((a, b) => a.ghosting.score! - b.ghosting.score!);
}

/**
 * Fastest-hiring: highest response-speed score first. Ranked companies only,
 * same reasoning.
 */
export function fastestHiring(result: AnalyticsResult): CompanyAnalytics[] {
  return result.ranked
    .filter((c) => c.responseSpeed.score !== null)
    .sort((a, b) => b.responseSpeed.score! - a.responseSpeed.score!);
}
