/**
 * Wikidata adapter — structured factual properties for a company entity.
 *
 * Licence: CC0-1.0 (public domain dedication). No attribution obligation —
 * see supabase/migrations/0006_metadata_fetch_sources.sql for the recorded
 * source row this adapter's `key` must match.
 *
 * Deliberately narrow: this fetches only well-defined Wikidata PROPERTIES
 * (P856 website, P2037 GitHub username, P249 ticker symbol, P154 logo image,
 * P571 inception date). It does not touch Wikipedia's prose at all — that is
 * wikipedia.ts's job, under a different licence with a different attribution
 * obligation. Keeping the two apart is what lets the importer record correct
 * per-source provenance instead of one blended blob.
 *
 * ENTITY VERIFICATION — found by running this against live data, not by
 * reasoning about it. `wbsearchentities("Postman")` resolves to the Wikidata
 * item for the mail-carrier PROFESSION (Q2180295), not the company. Every
 * lookup here is gated on the entity being P31/P279*-transitively an instance
 * of business/organization/enterprise/company before any property is trusted.
 * `resolveVerifiedCompanyEntity` is exported so wikipedia.ts (and the bulk
 * importer) reuse the same verified entity rather than resolving it again —
 * one WDQS round trip per company instead of three.
 *
 * All outbound requests go through resilientFetch (retry, rate limiting,
 * timeout, identifying User-Agent). WDQS in particular is paced conservatively
 * because its fair-use policy blocks IPs that hammer it.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";
import { resilientFetch } from "../http";

const SPARQL_TIMEOUT_MS = 12_000;

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
  isGeographic?: { value: string };
  enwikiTitle?: { value: string };
}

/** How many search candidates to consider. See searchEntities for why >1. */
const SEARCH_CANDIDATES = 5;

/**
 * Return up to SEARCH_CANDIDATES entity ids, in Wikidata's own relevance order.
 *
 * An earlier version took only the top hit (`limit=1`) and rejected the company
 * outright if that hit was not a business. Measured against a real batch, that
 * discarded legitimate employers whose name is also a common noun or a software
 * product: Okta, Redis, Sentry, Confluent, Docker and Grafana Labs all failed
 * that way — roughly half the batch — because the top hit is the product, the
 * word, or an unrelated item. Considering several candidates and taking the
 * first that type-checks as a business recovers them without loosening the gate.
 */
async function searchEntities(name: string): Promise<string[]> {
  const url =
    "https://www.wikidata.org/w/api.php?action=wbsearchentities" +
    `&search=${encodeURIComponent(name)}` +
    `&language=en&type=item&limit=${SEARCH_CANDIDATES}&format=json`;
  const res = await resilientFetch(url, { bucket: "wikidata_api" });
  if (!res.ok) return [];
  const json = (await res.json()) as { search?: WikidataSearchResult[] };
  return (json.search ?? []).map((s) => s.id).filter(Boolean);
}

/**
 * Every property is OPTIONAL — an earlier draft made the website triple
 * mandatory, which meant any company missing P856 returned zero bindings,
 * silently discarding github_org/ticker/logo/inception too.
 *
 * `isBusiness` is BIND(EXISTS{...}): whether the entity is, transitively via
 * P279* (subclass of), an instance of business/organization/enterprise/company.
 *
 * `isGeographic` is the NEGATIVE gate, and it exists because of a real bug
 * caught in production: searching "Vercel" returns the Wikidata item for
 * **Vercel-Villedieu-le-Camp, a commune in the Doubs department of France**,
 * which imported a French village's description and its 1962 founding year as
 * if it were the hosting company. A commune reaches wd:Q43229 (organization)
 * transitively via P279*, so the positive gate alone passes it. Places are
 * therefore excluded explicitly: administrative territorial entity, human
 * settlement, and geographic location cover communes, towns and regions.
 *
 * `enwikiTitle` follows the entity's real English Wikipedia sitelink — the
 * verified article title, not a guess (Stripe's sitelink is "Stripe, Inc.").
 */
function buildQuery(qids: string[]): string {
  const values = qids.map((q) => `wd:${q}`).join(" ");
  return `
    SELECT ?item ?website ?githubHandle ?ticker ?logo ?inception ?isBusiness ?isGeographic ?enwikiTitle WHERE {
      VALUES ?item { ${values} }
      OPTIONAL { ?item wdt:P856 ?website . }
      OPTIONAL { ?item wdt:P2037 ?githubHandle . }
      OPTIONAL { ?item wdt:P249 ?ticker . }
      OPTIONAL { ?item wdt:P154 ?logo . }
      OPTIONAL { ?item wdt:P571 ?inception . }
      OPTIONAL {
        ?sitelink schema:about ?item ;
                  schema:isPartOf <https://en.wikipedia.org/> ;
                  schema:name ?enwikiTitle .
      }
      BIND(EXISTS {
        ?item wdt:P31/wdt:P279* ?class .
        VALUES ?class { wd:Q4830453 wd:Q43229 wd:Q6881511 wd:Q783794 }
      } AS ?isBusiness)
      BIND(EXISTS {
        ?item wdt:P31/wdt:P279* ?place .
        VALUES ?place { wd:Q56061 wd:Q486972 wd:Q2221906 }
      } AS ?isGeographic)
    }
  `;
}

/**
 * One WDQS round trip that classifies AND fetches properties for every
 * candidate at once — so widening the candidate set costs no extra queries.
 * Returns bindings keyed by QID, keeping the first row per entity (a property
 * with several values yields several rows).
 */
async function fetchBindings(qids: string[]): Promise<Map<string, SparqlBinding>> {
  const out = new Map<string, SparqlBinding>();
  if (qids.length === 0) return out;

  const endpoint = "https://query.wikidata.org/sparql?format=json&query=" + encodeURIComponent(buildQuery(qids));
  const res = await resilientFetch(endpoint, {
    bucket: "wdqs",
    timeoutMs: SPARQL_TIMEOUT_MS,
    headers: { Accept: "application/sparql-results+json" },
  });
  if (!res.ok) return out;

  const json = (await res.json()) as {
    results?: { bindings?: (SparqlBinding & { item?: { value: string } })[] };
  };
  for (const row of json.results?.bindings ?? []) {
    const iri = row.item?.value;
    if (!iri) continue;
    const qid = iri.slice(iri.lastIndexOf("/") + 1);
    if (!out.has(qid)) out.set(qid, row);
  }
  return out;
}

export interface VerifiedCompanyEntity {
  qid: string;
  binding: SparqlBinding;
  /** The verified English Wikipedia article title, if the entity has one. */
  enwikiTitle: string | null;
}

/**
 * Resolve a company name to a Wikidata entity, verified as actually being a
 * business/organization — never just "the top search hit." Returns null when
 * no entity is found, or when the top hit does not type-check as a company.
 * This is the single WDQS round trip that wikidata + wikipedia both build on.
 */
/**
 * Resolve a KNOWN entity id, skipping name search entirely. Still applies the
 * business and non-place gates, so a bad id in a seed file cannot smuggle a
 * non-company through.
 *
 * This is the precise path: name search is inherently ambiguous for companies
 * whose name is also a product or a common noun (measured: Okta, Redis, Sentry,
 * Docker and Grafana Labs all fail name resolution even across five
 * candidates). A curated list built from a Wikidata query already carries ids,
 * so supplying `wikidata_qid` in the CSV removes the ambiguity rather than
 * guessing at it.
 */
export async function resolveCompanyEntityByQid(qid: string): Promise<VerifiedCompanyEntity | null> {
  if (!/^Q\d+$/.test(qid)) return null;
  const bindings = await fetchBindings([qid]);
  const binding = bindings.get(qid);
  if (!binding) return null;
  if (binding.isBusiness?.value !== "true") return null;
  if (binding.isGeographic?.value === "true") return null;
  return { qid, binding, enwikiTitle: binding.enwikiTitle?.value ?? null };
}

export async function resolveVerifiedCompanyEntity(name: string): Promise<VerifiedCompanyEntity | null> {
  const candidates = await searchEntities(name);
  if (candidates.length === 0) return null;

  const bindings = await fetchBindings(candidates);

  // Walk candidates in Wikidata's relevance order and take the first that is a
  // business and is NOT a place. Order matters: the most relevant qualifying
  // entity wins, so "Apple" prefers the company over an unrelated business
  // further down the list.
  for (const qid of candidates) {
    const binding = bindings.get(qid);
    if (!binding) continue;
    if (binding.isBusiness?.value !== "true") continue;
    // A place that inherits "organization" is still a place, not an employer.
    if (binding.isGeographic?.value === "true") continue;
    return { qid, binding, enwikiTitle: binding.enwikiTitle?.value ?? null };
  }
  return null;
}

/** P154 gives a Commons file NAME; Special:FilePath resolves it to the bytes. */
function commonsFileUrl(filename: string): string {
  const bare = filename.replace(/^https?:\/\/[^/]*commons\.wikimedia\.org\/wiki\/(?:Special:FilePath\/|File:)/i, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(bare)}`;
}

function yearFromInception(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const match = /^(\d{4})-/.exec(value);
  return match ? Number(match[1]) : undefined;
}

/** Map an already-resolved entity to a Wikidata record — no network call. */
export function wikidataRecordFromEntity(name: string, entity: VerifiedCompanyEntity): RawCompanyRecord {
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

async function fetchOne(name: string): Promise<RawCompanyRecord | null> {
  const entity = await resolveVerifiedCompanyEntity(name);
  if (!entity) return null;
  return wikidataRecordFromEntity(name, entity);
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
    }
    return records;
  },
};
