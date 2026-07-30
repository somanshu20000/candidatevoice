/**
 * Official website adapter — OpenGraph/meta description from the company's
 * own site.
 *
 * Licence: not an open licence at all — this is the company's own factual
 * self-description. Trust tier 1, the highest of the four built-in sources
 * (supabase/migrations/0006_metadata_fetch_sources.sql): nobody is more
 * authoritative on a company's own facts than the company. The orchestrator
 * runs this adapter LAST for exactly that reason — combined with the
 * null-coalescing behaviour in store.upsertProfile, its non-null `description`
 * wins over Wikipedia's or GitHub's when several are present.
 *
 * Takes an EXPLICIT {name, url}[] input: the URL comes from wikidataAdapter's
 * output via the orchestrator, not from this adapter reaching into another.
 *
 * TWO SAFETY PROPERTIES, both enforced in http.ts rather than here:
 *
 *  1. SSRF. The URL originates from Wikidata property P856, which ANY
 *     anonymous internet user can edit. Fetching it unguarded is an
 *     arbitrary-GET primitive against whatever network the importer runs on
 *     (cloud metadata endpoints at 169.254.169.254, internal services on
 *     10.x/192.168.x, loopback). `guardSsrf` resolves the hostname, rejects
 *     any private/loopback/link-local address, and re-validates every redirect
 *     hop — a public URL cannot bounce to an internal one.
 *
 *  2. Terms that prohibit automated extraction. `respectRobots` reads the
 *     site's own robots.txt — the machine-readable expression of that
 *     restriction — and skips the fetch when the path is disallowed, surfacing
 *     a typed RobotsDisallowedError so the caller can report "skipped:
 *     robots.txt" instead of silently recording "no data".
 *
 * Only <meta> tags in the document head are read. No body content, no article
 * text, no scraping of anything beyond the site's own self-description.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";
import { resilientFetch, RobotsDisallowedError, SsrfBlockedError } from "../http";

/** Cap on the bytes scanned for meta tags. Bounds both memory and regex work. */
const HEAD_SCAN_LIMIT = 50_000;

export interface WebsiteMetaInput {
  name: string;
  url: string;
}

/**
 * Read one <meta> tag's content by name or property, handling both attribute
 * orderings since real-world markup is inconsistent.
 *
 * The `[^>]` classes are bounded by the tag delimiter and the input is capped
 * at HEAD_SCAN_LIMIT, so neither pattern can backtrack catastrophically on
 * hostile HTML.
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

/**
 * Fetch one company site's self-description. Returns null when there is no
 * usable description. Rethrows RobotsDisallowedError / SsrfBlockedError so the
 * caller can distinguish "we chose not to fetch this" from "nothing was there".
 */
export async function fetchWebsiteMeta(input: WebsiteMetaInput): Promise<RawCompanyRecord | null> {
  const res = await resilientFetch(input.url, {
    bucket: "web",
    timeoutMs: 8_000,
    guardSsrf: true,
    respectRobots: true,
  });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return null;

  // Bound the body before it becomes a string: a hostile server can otherwise
  // stream hundreds of MB into memory before the timeout fires.
  const head = await readCapped(res, HEAD_SCAN_LIMIT);
  const description = readMetaTag(head, "og:description") ?? readMetaTag(head, "description");
  if (!description) return null;

  return { name: input.name, description };
}

/** Read at most `limit` bytes of the body, then stop pulling from the stream. */
async function readCapped(res: Response, limit: number): Promise<string> {
  const body = res.body;
  if (!body) return (await res.text()).slice(0, limit);

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  try {
    while (out.length < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return out.slice(0, limit);
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
        const record = await fetchWebsiteMeta(pair);
        if (record) records.push(record);
      } catch (err) {
        // Robots/SSRF refusals are expected outcomes, not failures to retry.
        const label =
          err instanceof RobotsDisallowedError
            ? "skipped (robots.txt)"
            : err instanceof SsrfBlockedError
              ? "skipped (blocked address)"
              : err instanceof Error
                ? err.message
                : String(err);
        console.error(`[website_meta] ${pair.url}: ${label}`);
      }
    }
    return records;
  },
};
