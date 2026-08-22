/**
 * Browser acquisition primitive (Task: browser-capable acquisition layer).
 *
 * A thin, reusable wrapper around Playwright for the sources that
 * `resilientFetch` (src/lib/company-intelligence/http.ts) cannot handle:
 * JavaScript-rendered/lazy-loaded content that only exists after the page
 * runs client-side. This module is ACQUISITION ONLY — it returns rendered
 * HTML and nothing else. Parsing/extraction is a separate concern (the
 * caller's job), matching the existing adapter contract's own separation
 * (an adapter's `load()` returns RawExternalReport[], never touches the DB).
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   - No stealth/anti-detection plugins, no fingerprint spoofing, no
 *     residential proxies, no human-behavior simulation (randomized mouse
 *     movement, typing delays to evade bot detection). A page that blocks
 *     headless Chromium stays blocked — that block IS the site's access
 *     control, and circumventing it is explicitly out of scope.
 *   - No CAPTCHA solving.
 *   - Standard Playwright launch defaults: real Chromium, a clearly
 *     identifying User-Agent (same convention as resilientFetch's
 *     DEFAULT_USER_AGENT), no proxy configuration.
 *
 * ROBOTS.TXT — mirrors company-intelligence/http.ts's robotsAllows()
 * algorithm exactly (that function isn't exported; this is a small,
 * self-contained duplicate rather than a cross-module export for one
 * ~15-line function). A Disallow that covers the target path means this
 * module refuses to navigate there — checked BEFORE Playwright ever
 * launches a page for that URL, not after.
 */

import type { Browser, Page } from "playwright";

export const BROWSER_USER_AGENT =
  "CandidateVoice-BrowserAcquisition/1.0 (https://github.com/somanshu20000/candidatevoice; hiring-evidence-import bot; contact via repo issues)";

export class RobotsDisallowedError extends Error {}

const robotsCache = new Map<string, { disallow: string[]; allow: string[] }>();

async function robotsRules(origin: string): Promise<{ disallow: string[]; allow: string[] }> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const rules = { disallow: [] as string[], allow: [] as string[] };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (res.ok) {
      const text = (await res.text()).slice(0, 200_000);
      let inScope = false;
      for (const line of text.split(/\r?\n/)) {
        const clean = line.replace(/#.*$/, "").trim();
        if (!clean) continue;
        const idx = clean.indexOf(":");
        if (idx === -1) continue;
        const field = clean.slice(0, idx).trim().toLowerCase();
        const value = clean.slice(idx + 1).trim();
        if (field === "user-agent") inScope = value === "*";
        else if (inScope && field === "disallow" && value) rules.disallow.push(value);
        else if (inScope && field === "allow" && value) rules.allow.push(value);
      }
    }
  } catch {
    // No robots.txt, or it timed out -> treat as no restriction (same
    // fail-open-on-absence behaviour as company-intelligence/http.ts).
  }
  robotsCache.set(origin, rules);
  return rules;
}

export async function checkRobotsAllowed(rawUrl: string): Promise<boolean> {
  const url = new URL(rawUrl);
  const { disallow, allow } = await robotsRules(url.origin);
  const path = url.pathname || "/";
  const longestMatch = (rules: string[]) =>
    rules.filter((r) => path.startsWith(r)).reduce((max, r) => Math.max(max, r.length), -1);
  const dis = longestMatch(disallow);
  if (dis === -1) return true;
  return longestMatch(allow) >= dis;
}

export interface RenderedPage {
  html: string;
  finalUrl: string;
  fetchedAt: string;
  /** SHA-256 of the raw HTML — the canonicalization step lives with the
   *  caller (different extractors may want different normalization before
   *  hashing for idempotency), this is the raw-fetch fingerprint only. */
  rawHash: string;
}

export interface FetchRenderedPageOptions {
  timeoutMs?: number;
  /** Playwright's `waitUntil` — 'networkidle' for genuinely lazy-loaded
   *  content, 'domcontentloaded' for a faster, lighter check. */
  waitUntil?: "load" | "domcontentloaded" | "networkidle";
}

/**
 * Fetch a page's rendered HTML via a real, unmodified headless Chromium.
 * Throws RobotsDisallowedError if robots.txt disallows the path — checked
 * before any browser is launched. Throws on navigation failure/timeout;
 * never returns a partial/guessed result.
 */
export async function fetchRenderedPage(url: string, options: FetchRenderedPageOptions = {}): Promise<RenderedPage> {
  const allowed = await checkRobotsAllowed(url);
  if (!allowed) throw new RobotsDisallowedError(`robots.txt disallows ${url}`);

  const { chromium } = await import("playwright");
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: BROWSER_USER_AGENT });
    const page: Page = await context.newPage();
    const response = await page.goto(url, {
      timeout: options.timeoutMs ?? 20_000,
      waitUntil: options.waitUntil ?? "networkidle",
    });
    if (!response) throw new Error(`navigation to ${url} produced no response`);
    const html = await page.content();
    const finalUrl = page.url();
    const { createHash } = await import("crypto");
    const rawHash = createHash("sha256").update(html).digest("hex");
    return { html, finalUrl, fetchedAt: new Date().toISOString(), rawHash };
  } finally {
    if (browser) await browser.close();
  }
}
