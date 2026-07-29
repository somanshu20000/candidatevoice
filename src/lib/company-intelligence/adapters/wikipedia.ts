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
 * "Razorpay", got back the Wikipedia article for **Kunal Shah** — a person
 * who is merely mentioned on the page — because full-text relevance ranking
 * has no concept of "is this the same entity as the query." Instead this
 * reuses wikidata.ts's `resolveVerifiedCompanyEntity`, which verifies the
 * entity actually type-checks as a business before ever touching Wikipedia,
 * and follows its real `enwiki` sitelink rather than guessing a title from
 * the company name — live-verified necessary: Stripe's Wikidata sitelink is
 * "Stripe, Inc.", not "Stripe".
 *
 * Deliberately does NOT parse the Wikipedia infobox (founder, employee count,
 * headquarters text). An earlier draft did this with a regex over raw
 * infobox HTML — fragile, and RawCompanyRecord has no founder/employee_count
 * fields for the result to go into anyway. The REST summary endpoint returns
 * clean JSON with everything this subsystem can actually use: an extract and
 * the canonical article URL.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";
import { resolveVerifiedCompanyEntity } from "./wikidata";

const USER_AGENT =
  "CandidateVoice-CompanyIntelligence/1.0 (https://github.com/somanshu20000/candidatevoice; metadata-import bot)";

const REQUEST_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WikiSummary {
  extract?: string;
  content_urls?: { desktop?: { page?: string } };
}

async function fetchSummary(title: string): Promise<WikiSummary | null> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  return (await res.json()) as WikiSummary;
}

async function fetchOne(name: string): Promise<RawCompanyRecord | null> {
  const entity = await resolveVerifiedCompanyEntity(name);
  const title = entity?.binding.enwikiTitle?.value;
  // No verified business entity, or no English Wikipedia article for it
  // (a real, common case — Razorpay's Wikidata item exists and correctly
  // types as a business, but has no enwiki sitelink at all). Returning null
  // here is the honest outcome: no Wikipedia coverage, not a wrong guess.
  if (!title) return null;

  const summary = await fetchSummary(title);
  if (!summary) return null;

  const record: RawCompanyRecord = { name };
  if (summary.extract) record.description = summary.extract;
  const articleUrl = summary.content_urls?.desktop?.page;
  if (articleUrl) record.links = { wikipedia: articleUrl };
  // Deliberately NOT sourcing logo_url from the article thumbnail — Wikipedia's
  // lead image is often a building, founder portrait, or product photo, not the
  // company's actual logo. Wikidata's P154 property is purpose-built for logos
  // (see wikidata.ts); this adapter leaves logo_url unset rather than guess.

  return record;
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
      await sleep(REQUEST_DELAY_MS);
    }

    return records;
  },
};
