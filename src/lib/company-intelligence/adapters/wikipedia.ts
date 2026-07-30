/**
 * Wikipedia adapter — the article summary, and nothing else.
 *
 * Licence: CC BY-SA 4.0 — redistribution is permitted ONLY with attribution
 * and a link back to the source article. See
 * supabase/migrations/0006_metadata_fetch_sources.sql (attribution_required =
 * true for this source). CompanyOverview.tsx renders a credit line under the
 * description whenever the resolved company_profiles row's winning source is
 * this one — that is the attribution obligation being discharged, not just a
 * database flag.
 *
 * ARTICLE RESOLUTION — this does NOT search Wikipedia directly. An earlier
 * version used Wikipedia's own full-text search API and, live-tested against
 * "Razorpay", got back the article for **Kunal Shah** — a person merely
 * mentioned on the page — because full-text relevance has no concept of "is
 * this the same entity as the query." Instead this reuses wikidata.ts's
 * `resolveVerifiedCompanyEntity`, which verifies the entity type-checks as a
 * business and follows its real `enwiki` sitelink (Stripe's sitelink is
 * "Stripe, Inc.", not "Stripe"). `wikipediaRecordFromEntity` takes an
 * already-resolved entity so the bulk importer resolves each company once.
 *
 * Deliberately does NOT parse the Wikipedia infobox — the REST summary endpoint
 * returns clean JSON with everything this subsystem can use: an extract and the
 * canonical article URL.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";
import { resilientFetch } from "../http";
import { resolveVerifiedCompanyEntity, type VerifiedCompanyEntity } from "./wikidata";

interface WikiSummary {
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await resilientFetch(url, { bucket: "wikipedia" });
  if (!res.ok) return null;
  return (await res.json()) as WikiSummary;
}

/**
 * Build a Wikipedia record from an ALREADY-RESOLVED entity — no Wikidata round
 * trip. Returns null when the entity has no English article (a real, common
 * case: Razorpay's Wikidata item exists and types as a business, but has no
 * enwiki sitelink), which is the honest outcome — no coverage, not a guess.
 */
export async function wikipediaRecordFromEntity(
  name: string,
  entity: VerifiedCompanyEntity
): Promise<RawCompanyRecord | null> {
  const title = entity.enwikiTitle;
  if (!title) return null;

  const summary = await fetchSummary(title);
  if (!summary) return null;

  const record: RawCompanyRecord = { name };
  if (summary.extract) record.description = summary.extract;
  const articleUrl = summary.content_urls?.desktop?.page;
  if (articleUrl) record.links = { wikipedia: articleUrl };
  return record;
}

async function fetchOne(name: string): Promise<RawCompanyRecord | null> {
  const entity = await resolveVerifiedCompanyEntity(name);
  if (!entity) return null;
  return wikipediaRecordFromEntity(name, entity);
}

export const wikipediaAdapter: SourceAdapter = {
  key: "wikipedia",
  displayName: "Wikipedia",
  permitsRedistribution: true,

  /** input: string[] of company display names. */
  async load(input: unknown): Promise<RawCompanyRecord[]> {
    if (!Array.isArray(input)) {
      throw new Error("wikipediaAdapter.load expects string[] of company names.");
    }
    const names = input as string[];
    const records: RawCompanyRecord[] = [];
    for (const name of names) {
      try {
        const record = await fetchOne(name);
        if (record) records.push(record);
      } catch (err) {
        console.error(`[wikipedia] failed for "${name}":`, err instanceof Error ? err.message : err);
      }
    }
    return records;
  },
};
