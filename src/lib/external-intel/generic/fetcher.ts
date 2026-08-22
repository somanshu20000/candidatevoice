/**
 * Generic acquisition FETCHER — owns Playwright and nothing else (Task 3,
 * "harden generic pipeline" scope). Strictly separated from parsing: this
 * module returns raw HTML strings + provenance; it never interprets them.
 * The parser (generic/parser.ts) takes those strings; the extractor
 * (generic/extract.ts) maps parsed output to the evidence contract. That
 * three-way split is the whole point — a change to how a site is laid out
 * touches only the parser, never this file.
 *
 * Builds on src/lib/external-intel/browser-fetch.ts (the single-page real
 * headless-Chromium primitive with the robots.txt gate) — this adds the
 * multi-page concerns a real listing source needs: pagination / infinite
 * scroll, inter-page rate limiting, retries with backoff, timeouts, and
 * deterministic pagination TERMINATION so a runaway loop can never happen.
 *
 * NO stealth, NO anti-detection, NO fingerprint spoofing, NO CAPTCHA
 * solving, NO residential proxies — inherited from browser-fetch.ts and
 * never added here. A site that blocks headless Chromium stays blocked;
 * that block is its access control.
 *
 * This module does NOT target any real third-party site. Its only wired
 * demo target is example.com (IANA reserved documentation domain), the same
 * safe convention D-034 established. A real, permitted source is wired only
 * when a human names one and owns its Q-2/ToS clearance.
 */

import { fetchRenderedPage, type RenderedPage } from "../browser-fetch";

export interface FetchedPage {
  url: string;
  html: string;
  fetchedAt: string;
  rawHash: string;
  pageIndex: number;
}

export interface PaginationStrategy {
  /** Max pages to ever fetch — a hard runaway backstop, always enforced. */
  maxPages: number;
  /**
   * Given the just-fetched page and its index, return the next URL to
   * fetch, or null to terminate. A strategy that returns a URL already
   * seen, or the same URL, terminates (dedup guard below) — so an
   * infinite-scroll/next-link that stops advancing ends the loop instead
   * of spinning. Pure: no I/O, easy to unit-test.
   */
  nextUrl: (page: FetchedPage) => string | null;
}

export interface FetchOptions {
  /** ms between consecutive page fetches — polite rate limiting. */
  minIntervalMs?: number;
  /** Per-page navigation timeout. */
  timeoutMs?: number;
  /** Retry attempts per page on transient failure (network error / timeout). */
  retries?: number;
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One page with retry + backoff on transient failure. Robots/terminal
 *  errors from browser-fetch propagate immediately (never retried). */
async function fetchOneWithRetry(url: string, opts: FetchOptions): Promise<RenderedPage> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchRenderedPage(url, { timeoutMs: opts.timeoutMs, waitUntil: opts.waitUntil });
    } catch (err) {
      // RobotsDisallowedError is terminal — a disallowed path is not a
      // transient failure and must not be retried.
      if (err instanceof Error && err.name === "RobotsDisallowedError") throw err;
      lastErr = err;
      if (attempt === retries) throw err;
      await sleep(400 * 2 ** attempt + Math.floor(Math.random() * 200));
    }
  }
  throw lastErr ?? new Error(`fetch failed: ${url}`);
}

/**
 * Fetch a paginated sequence of pages. Terminates on ANY of: strategy
 * returns null, maxPages reached, or the next URL was already fetched
 * (loop/no-advance guard). Rate-limited between pages. Returns every page
 * successfully fetched; a page that fails all retries aborts the whole
 * sequence (the caller decides whether a partial sequence is usable).
 */
export async function fetchPaginated(
  startUrl: string,
  strategy: PaginationStrategy,
  opts: FetchOptions = {}
): Promise<FetchedPage[]> {
  const minInterval = opts.minIntervalMs ?? 1000;
  const pages: FetchedPage[] = [];
  const seen = new Set<string>();
  let url: string | null = startUrl;
  let index = 0;

  while (url !== null && index < strategy.maxPages) {
    if (seen.has(url)) break; // loop / pagination no longer advancing -> terminate
    seen.add(url);
    if (index > 0) await sleep(minInterval); // polite pacing, never before the first

    const rendered = await fetchOneWithRetry(url, opts);
    const page: FetchedPage = {
      url,
      html: rendered.html,
      fetchedAt: rendered.fetchedAt,
      rawHash: rendered.rawHash,
      pageIndex: index,
    };
    pages.push(page);
    index += 1;
    url = strategy.nextUrl(page);
  }
  return pages;
}

/** Convenience: a single page as a one-element paginated sequence. */
export async function fetchSingle(url: string, opts: FetchOptions = {}): Promise<FetchedPage[]> {
  return fetchPaginated(url, { maxPages: 1, nextUrl: () => null }, opts);
}
