/**
 * Wikipedia article title → Wikidata QID, via MediaWiki's own `pageprops` API
 * (not PixelRAG — PixelRAG never returns a QID, only a title/URL match). This
 * is the bridge that lets enrich.ts's PixelRAG fallback hand off to
 * wikidata.ts's EXISTING, already-verified business-type gate
 * (resolveCompanyEntityByQid) instead of trusting PixelRAG's match directly.
 */

import { resilientFetch } from "../company-intelligence/http";

interface PagePropsResponse {
  query?: {
    pages?: Record<string, { pageprops?: { "wikibase_item"?: string } }>;
  };
}

/** Extract an enwiki article title from a full Wikipedia URL, or null if the
 *  URL isn't an en.wikipedia.org article link. */
export function wikipediaTitleFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)wikipedia\.org$/i.test(u.hostname) || !u.hostname.startsWith("en.")) return null;
    const match = u.pathname.match(/^\/wiki\/(.+)$/);
    if (!match) return null;
    return decodeURIComponent(match[1]).replace(/_/g, " ");
  } catch {
    return null;
  }
}

/** Never throws — a lookup failure just means "no QID found," same as any
 *  other miss in this fallback chain. */
export async function qidFromWikipediaTitle(title: string): Promise<string | null> {
  try {
    const url =
      "https://en.wikipedia.org/w/api.php?action=query&prop=pageprops&ppprop=wikibase_item" +
      `&titles=${encodeURIComponent(title)}&format=json`;
    const res = await resilientFetch(url, { bucket: "wikipedia" });
    if (!res.ok) return null;
    const payload = (await res.json()) as PagePropsResponse;
    const pages = payload.query?.pages;
    if (!pages) return null;
    for (const page of Object.values(pages)) {
      const qid = page.pageprops?.wikibase_item;
      if (typeof qid === "string" && /^Q\d+$/.test(qid)) return qid;
    }
    return null;
  } catch {
    return null;
  }
}
