/**
 * Official website adapter — OpenGraph/meta description from the company's
 * own site.
 *
 * Licence: not an open licence at all — this is the company's own factual
 * self-description. Trust tier 1, the highest of the four built-in sources
 * (supabase/migrations/0006_metadata_fetch_sources.sql): nobody is more
 * authoritative on a company's own facts than the company. The orchestration
 * script runs this adapter LAST for exactly that reason — combined with the
 * null-coalescing fix in store.upsertProfile, its non-null `description`
 * value wins over Wikipedia's or GitHub's when all three are present.
 *
 * Takes an EXPLICIT {name, url}[] input, the same reasoning as
 * github-org.ts: the URL comes from wikidataAdapter's output via the
 * orchestration script, not from this adapter reaching out to another source
 * itself.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";

const REQUEST_DELAY_MS = 200;
const FETCH_TIMEOUT_MS = 8_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WebsiteMetaInput {
  name: string;
  url: string;
}

/**
 * Reads a single <meta> tag's content by name or property attribute, handling
 * both attribute orderings ("name before content" and "content before name")
 * since real-world markup is not consistent about it.
 */
function readMetaTag(html: string, key: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return match[1];
  }
  return null;
}

async function fetchOne(input: WebsiteMetaInput): Promise<RawCompanyRecord | null> {
  let html: string;
  try {
    const res = await fetch(input.url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) return null;
    html = await res.text();
  } catch {
    return null;
  }

  // Only the <head> is needed and HTML can be large; cap what we scan.
  const head = html.slice(0, 50_000);
  const description = readMetaTag(head, "og:description") ?? readMetaTag(head, "description");
  if (!description) return null;

  return { name: input.name, description };
}

export const websiteMetaAdapter: SourceAdapter = {
  key: "website_meta",
  displayName: "Official website",
  permitsRedistribution: true,

  /** input: WebsiteMetaInput[] — explicit {name, url} pairs. */
  async load(input: unknown): Promise<RawCompanyRecord[]> {
    if (!Array.isArray(input)) {
      throw new Error("websiteMetaAdapter.load expects WebsiteMetaInput[].");
    }
    const pairs = input as WebsiteMetaInput[];
    const records: RawCompanyRecord[] = [];

    for (const pair of pairs) {
      try {
        const record = await fetchOne(pair);
        if (record) records.push(record);
      } catch (err) {
        console.error(`[website_meta] failed for "${pair.url}":`, err instanceof Error ? err.message : err);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    return records;
  },
};
