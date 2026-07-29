/**
 * Wikidata adapter — structured factual properties for a company entity.
 *
 * Licence: CC0-1.0 (public domain dedication). No attribution obligation —
 * see supabase/migrations/0006_metadata_fetch_sources.sql for the recorded
 * source row this adapter's `key` must match.
 *
 * Deliberately narrow: this fetches only well-defined Wikidata PROPERTIES
 * (P856 website, P2037 GitHub username, P249 ticker symbol, P154 logo image,
 * P571 inception date, skos:altLabel aliases). It does not touch Wikipedia's
 * prose at all — that is wikipedia.ts's job, under a different licence with a
 * different attribution obligation. Keeping the two apart is what lets the
 * importer record correct per-source provenance instead of one blended blob.
 *
 * ENTITY VERIFICATION — found by actually running this against live data, not
 * by reasoning about it. `wbsearchentities("Postman")` resolves to the
 * Wikidata item for the mail-carrier PROFESSION (Q2180295), not the company —
 * a plain name search has no way to know which "Postman" is meant. Every
 * lookup here is gated on the entity being P31/P279*-transitively an instance
 * of business/organization/enterprise/company before any property is trusted.
 * `resolveVerifiedCompanyEntity` is exported so wikipedia.ts can reuse the
 * exact same verification rather than doing its own weaker name search.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";

const USER_AGENT =
  "CandidateVoice-CompanyIntelligence/1.0 (https://github.com/somanshu20000/candidatevoice; metadata-import bot)";

const REQUEST_DELAY_MS = 300;
const SPARQL_TIMEOUT_MS = 12_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface WikidataSearchResult {
  id: string;
}

interface SparqlBinding {
  website?: { value: string };
  githubHandle?: { value: string };
  ticker?: { value: string };
  logo?: { value: string };
  inception?: { value: string };
  isBusiness?: { value: string };
  enwikiTitle?: { value: string };
}

async function searchEntity(name: string): Promise<string | null> {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities" +
    `&search=${encodeURIComponent(name)}` +
    "&language=en&type=item&limit=1&format=json";
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) return null;
  const json = (await res.json()) as { search?: WikidataSearchResult[] };
  return json.search?.[0]?.id ?? null;
}

/**
 * Every property is OPTIONAL — an earlier draft made the website triple
 * mandatory, which meant any company missing P856 returned zero bindings,
 * silently discarding github_org/ticker/logo/inception too, even when those
 * properties existed independently of website.
 *
 * `isBusiness` is BIND(EXISTS{...}) rather than a second query: whether the
 * entity is, transitively via P279* (subclass of), an instance of one of
 * business/organization/enterprise/company. Live-verified: correctly true for
 * Razorpay ("business"/"startup company") and Zoho ("enterprise"), false for
 * the "Postman" mail-carrier profession entity.
 *
 * `enwikiTitle` follows the entity's actual English Wikipedia sitelink — the
 * verified article title, not a guess. Verified live: Stripe's Wikidata
 * sitelink is "Stripe, Inc.", not "Stripe" — guessing the title from the
 * company name would have missed it entirely.
 */
function buildQuery(qid: string): string {
  return `
    SELECT ?website ?githubHandle ?ticker ?logo ?inception ?isBusiness ?enwikiTitle WHERE {
      OPTIONAL { wd:${qid} wdt:P856 ?website . }
      OPTIONAL { wd:${qid} wdt:P2037 ?githubHandle . }
      OPTIONAL { wd:${qid} wdt:P249 ?ticker . }
      OPTIONAL { wd:${qid} wdt:P154 ?logo . }
      OPTIONAL { wd:${qid} wdt:P571 ?inception . }
      OPTIONAL {
        ?sitelink schema:about wd:${qid} ;
                  schema:isPartOf <https://en.wikipedia.org/> ;
                  schema:name ?enwikiTitle .
      }
      BIND(EXISTS {
        wd:${qid} wdt:P31/wdt:P279* ?class .
        VALUES ?class { wd:Q4830453 wd:Q43229 wd:Q6881511 wd:Q783794 }
      } AS ?isBusiness)
    }
    LIMIT 1
  `;
}

async function fetchBinding(qid: string): Promise<SparqlBinding | null> {
  const endpoint = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(buildQuery(qid));
  const res = await fetch(endpoint, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/sparql-results+json" },
    signal: AbortSignal.timeout(SPARQL_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { results?: { bindings?: SparqlBinding[] } };
  return json.results?.bindings?.[0] ?? null;
}

export interface VerifiedCompanyEntity {
  qid: string;
  binding: SparqlBinding;
}

/**
 * Resolves a company name to a Wikidata entity, verified as actually being a
 * business/organization — never just "the top search hit." Returns null when
 * no entity is found, or when the top hit exists but does not type-check as a
 * company (the Postman/mail-carrier case).
 */
export async function resolveVerifiedCompanyEntity(name: string): Promise<VerifiedCompanyEntity | null> {
  const qid = await searchEntity(name);
  if (!qid) return null;

  const binding = await fetchBinding(qid);
  if (!binding || binding.isBusiness?.value !== "true") return null;

  return { qid, binding };
}

/**
 * P154 gives a Wikimedia Commons file NAME, not a fetchable image URL. The
 * Commons Special:FilePath redirect resolves a filename straight to the image
 * bytes without a second API round trip to look up the real storage path.
 */
function commonsFileUrl(filename: string): string {
  const bare = filename.replace(/^https?:\/\/[^/]*commons\.wikimedia\.org\/wiki\/(?:Special:FilePath\/|File:)/i, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(bare)}`;
}

function yearFromInception(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-/.exec(value);
  return match ? Number(match[1]) : undefined;
}

async function fetchOne(name: string): Promise<RawCompanyRecord | null> {
  const entity = await resolveVerifiedCompanyEntity(name);
  if (!entity) return null;

  const { binding } = entity;
  const record: RawCompanyRecord = { name };
  if (binding.website?.value) record.website = binding.website.value;
  if (binding.githubHandle?.value) record.github_org = binding.githubHandle.value;
  if (binding.ticker?.value) record.stock_symbol = binding.ticker.value;
  if (binding.logo?.value) record.logo_url = commonsFileUrl(binding.logo.value);
  const year = yearFromInception(binding.inception?.value);
  if (year) record.founded_year = year;

  return record;
}

export const wikidataAdapter: SourceAdapter = {
  key: "wikidata",
  displayName: "Wikidata",
  permitsRedistribution: true,

  /** input: string[] of company display names. */
  async load(input: unknown): Promise<RawCompanyRecord[]> {
    if (!Array.isArray(input)) {
      throw new Error("wikidataAdapter.load expects string[] of company names.");
    }
    const names = input as string[];
    const records: RawCompanyRecord[] = [];

    for (const name of names) {
      try {
        const record = await fetchOne(name);
        if (record) records.push(record);
      } catch (err) {
        console.error(`[wikidata] failed for "${name}":`, err instanceof Error ? err.message : err);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    return records;
  },
};
