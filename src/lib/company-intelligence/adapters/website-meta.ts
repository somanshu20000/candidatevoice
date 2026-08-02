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
 * Only <meta> tags in the document head are read for the description. No body
 * content, no article text, no scraping of anything beyond the site's own
 * self-description.
 *
 * The one exception: findCareersLink scans the SAME already-fetched,
 * already-capped HTML for an anchor whose href or text suggests a careers
 * page — no second fetch, no extra network cost. SAME-ORIGIN ONLY (host must
 * equal, or be a subdomain of, the site being fetched, www-insensitive): a
 * hostile page could otherwise embed `<a href="https://evil.example">Careers</a>`
 * and get an attacker-controlled URL recorded as this company's careers link.
 *
 * KNOWN LIMITATION, live-verified rather than assumed: this finds a careers
 * link only when it appears as plain server-rendered <a> markup within the
 * first HEAD_SCAN_LIMIT bytes — it does not execute JavaScript (no headless
 * browser, by design — the same reason PixelRAG was rejected for company
 * enrichment). Confirmed working against real sites with server-rendered nav
 * (zerodha.com correctly resolves to https://careers.zerodha.com/); confirmed
 * silently absent-not-wrong on JS-hydrated marketing sites (stripe.com,
 * github.com, basecamp.com), where the nav simply isn't in the initial HTML.
 * A miss here is exactly that — a miss, never a fabricated link.
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

function normalizeHost(host: string): string {
  return host.replace(/^www\./i, "").toLowerCase();
}

function isSameOrSubdomain(host: string, baseHost: string): boolean {
  const h = normalizeHost(host);
  const b = normalizeHost(baseHost);
  return h === b || h.endsWith(`.${b}`);
}

/**
 * Find the first anchor whose href or visible text suggests a careers page,
 * resolved to an absolute same-origin URL. Bounded like readMetaTag: every
 * quantifier is delimited by a distinct character (`>`, a quote, `<`), and the
 * link-text capture is explicitly capped at 80 chars — no unbounded
 * backtracking on hostile HTML. Operates on the SAME capped `html` the
 * description was read from; never fetches anything itself.
 */
export function findCareersLink(html: string, baseUrl: string): string | null {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }

  const anchorPattern = /<a\s+[^>]*href=["']([^"'#][^"']*)["'][^>]*>([^<]{0,80})<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) !== null) {
    const [, href, text] = match;
    const looksLikeCareers = /career|jobs?\b|hiring|join.?us/i.test(href) || /career|jobs?\b|hiring|join us|we.?re hiring/i.test(text);
    if (!looksLikeCareers) continue;

    let resolved: URL;
    try {
      resolved = new URL(href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (!isSameOrSubdomain(resolved.hostname, base.hostname)) continue;

    return resolved.toString();
  }
  return null;
}

/**
 * Fetch one company site's self-description (and, opportunistically, its
 * careers link). Returns null when NEITHER is found. Rethrows
 * RobotsDisallowedError / SsrfBlockedError so the caller can distinguish "we
 * chose not to fetch this" from "nothing was there".
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
  const careersUrl = findCareersLink(head, input.url);
  if (!description && !careersUrl) return null;

  const record: RawCompanyRecord = { name: input.name };
  if (description) record.description = description;
  if (careersUrl) record.careers_url = careersUrl;
  return record;
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
