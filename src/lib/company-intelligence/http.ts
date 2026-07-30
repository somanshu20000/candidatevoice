/**
 * Company Intelligence — resilient HTTP for the metadata adapters.
 *
 * One place that every adapter's outbound request goes through, so retries,
 * rate limiting, timeouts, an identifying User-Agent, and (for untrusted URLs)
 * SSRF + robots.txt enforcement are applied uniformly instead of re-implemented
 * per adapter. This is what makes a 1,000-company import safe to run against
 * third-party services rather than a way to get an IP blocked.
 *
 * Node-only (dns, AbortSignal.timeout). Imported by the adapters, which run
 * under tsx — never by the Next.js app runtime, which does not touch adapters.
 */

import { lookup } from "dns/promises";

export const DEFAULT_USER_AGENT =
  "CandidateVoice-CompanyIntelligence/1.0 (https://github.com/somanshu20000/candidatevoice; metadata-import bot; contact via repo issues)";

// --- Per-bucket rate limiting -----------------------------------------------
// A "bucket" is a logical rate-limit domain (e.g. "wdqs", "github"). Calls in a
// bucket are serialized so each waits at least `minInterval` after the previous
// one started, and a 429's Retry-After pauses the whole bucket. Different
// buckets run independently, so pacing WDQS conservatively does not slow GitHub.

interface BucketState {
  /** Resolves when the previous caller has finished scheduling — a simple mutex. */
  chain: Promise<void>;
  lastStartedAt: number;
  backoffUntil: number;
}

const buckets = new Map<string, BucketState>();

/** Conservative defaults. WDQS fair-use is ~1 req/s; GitHub unauth is 60/hr. */
export const BUCKET_MIN_INTERVAL_MS: Record<string, number> = {
  wikidata_api: 350,
  wdqs: 1200,
  wikipedia: 300,
  github: 800,
  web: 500,
};

function bucketFor(name: string): BucketState {
  let b = buckets.get(name);
  if (!b) {
    b = { chain: Promise.resolve(), lastStartedAt: 0, backoffUntil: 0 };
    buckets.set(name, b);
  }
  return b;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Acquire a slot in a bucket: waits behind other callers in the same bucket,
 * honors any active backoff, and enforces the minimum inter-call interval.
 * Returns once it is this caller's turn to fire the request.
 */
async function acquire(bucketName: string, minInterval: number): Promise<void> {
  const b = bucketFor(bucketName);
  // Chain onto the previous caller so scheduling is serialized within the bucket.
  let release!: () => void;
  const mine = new Promise<void>((res) => (release = res));
  const prior = b.chain;
  b.chain = prior.then(() => mine);
  await prior;

  const now = Date.now();
  const waitFor = Math.max(b.backoffUntil - now, b.lastStartedAt + minInterval - now, 0);
  if (waitFor > 0) await sleep(waitFor);
  b.lastStartedAt = Date.now();
  // Let the next caller schedule; the interval above already spaced us out.
  release();
}

/** A 429 pauses the entire bucket until the server-provided (or default) time. */
function applyBackoff(bucketName: string, retryAfterHeader: string | null, fallbackMs: number): number {
  const b = bucketFor(bucketName);
  let ms = fallbackMs;
  if (retryAfterHeader) {
    const asSeconds = Number(retryAfterHeader);
    if (Number.isFinite(asSeconds)) ms = asSeconds * 1000;
    else {
      const asDate = Date.parse(retryAfterHeader);
      if (Number.isFinite(asDate)) ms = Math.max(0, asDate - Date.now());
    }
  }
  ms = Math.min(ms, 60_000); // never park a bucket longer than a minute
  b.backoffUntil = Math.max(b.backoffUntil, Date.now() + ms);
  return ms;
}

// --- SSRF guard -------------------------------------------------------------
// website-meta.ts fetches a URL taken from Wikidata property P856, which anyone
// can edit. Without this, that is an arbitrary-GET primitive against whatever
// network the importer runs on (cloud metadata endpoints, internal services).

function ipIsPrivate(ip: string): boolean {
  // IPv6
  if (ip.includes(":")) {
    const v = ip.toLowerCase();
    if (v === "::1" || v === "::") return true;
    if (v.startsWith("fe80") || v.startsWith("fc") || v.startsWith("fd")) return true; // link-local, unique-local
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)/); // IPv4-mapped
    if (mapped) return ipIsPrivate(mapped[1]);
    return false;
  }
  // IPv4
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b, c] = parts;
  if (a === 10) return true;
  if (a === 127) return true; // loopback
  if (a === 0) return true;
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".localhost"];
const BLOCKED_HOSTS = new Set(["localhost", "metadata.google.internal"]);

/**
 * Reject a URL that is not a public http(s) endpoint. Resolves the hostname and
 * rejects if ANY resolved address is private — closing the "public name that
 * points at 10.x" bypass. Throws on rejection.
 */
async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error(`invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`blocked scheme: ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new Error(`blocked host: ${host}`);
  }
  // Host given as an IP literal.
  if (/^[\d.]+$/.test(host) || host.includes(":")) {
    if (ipIsPrivate(host)) throw new Error(`blocked private IP: ${host}`);
    return;
  }
  // Resolve and check every address.
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error(`DNS resolution failed: ${host}`);
  }
  for (const a of addrs) {
    if (ipIsPrivate(a.address)) throw new Error(`host ${host} resolves to private IP ${a.address}`);
  }
}

// --- robots.txt -------------------------------------------------------------
// The machine-readable expression of "this site's terms restrict automated
// access". Fetched once per origin and cached; a Disallow that covers the
// target path means we do not fetch it.

const robotsCache = new Map<string, { disallow: string[]; allow: string[] }>();

async function robotsRules(origin: string): Promise<{ disallow: string[]; allow: string[] }> {
  const cached = robotsCache.get(origin);
  if (cached) return cached;

  const rules = { disallow: [] as string[], allow: [] as string[] };
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": DEFAULT_USER_AGENT },
      signal: AbortSignal.timeout(6000),
      redirect: "follow",
    });
    if (res.ok) {
      const text = (await res.text()).slice(0, 200_000);
      // Collect rules from groups that apply to us: User-agent: * (we do not
      // claim a more specific token). A blank User-agent group resets scope.
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
    // No robots.txt, or it timed out → treat as no restriction.
  }
  robotsCache.set(origin, rules);
  return rules;
}

/** True when robots.txt permits fetching `path`. Longest matching rule wins. */
async function robotsAllows(url: URL): Promise<boolean> {
  const { disallow, allow } = await robotsRules(url.origin);
  const path = url.pathname || "/";
  const longestMatch = (rules: string[]) =>
    rules.filter((r) => path.startsWith(r)).reduce((max, r) => Math.max(max, r.length), -1);
  const dis = longestMatch(disallow);
  if (dis === -1) return true; // nothing disallows it
  return longestMatch(allow) >= dis; // an equal-or-longer Allow re-permits it
}

// --- The resilient request --------------------------------------------------

export interface ResilientOptions {
  /** Rate-limit domain. Defaults to "web". */
  bucket?: keyof typeof BUCKET_MIN_INTERVAL_MS | string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  /** Validate against SSRF and follow redirects manually, re-validating each hop. */
  guardSsrf?: boolean;
  /** Skip the request if the site's robots.txt disallows the path. */
  respectRobots?: boolean;
}

export class RobotsDisallowedError extends Error {}
export class SsrfBlockedError extends Error {}

/**
 * Fetch with pacing, retries, timeout, and (optionally) SSRF + robots checks.
 * Returns the final Response. Retries network errors, 429, and 5xx; returns
 * other non-2xx responses to the caller unchanged (they decide what a 404 means).
 */
export async function resilientFetch(url: string, options: ResilientOptions = {}): Promise<Response> {
  const bucket = options.bucket ?? "web";
  const minInterval = BUCKET_MIN_INTERVAL_MS[bucket] ?? BUCKET_MIN_INTERVAL_MS.web;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxRetries = options.retries ?? 3;
  const headers = { "User-Agent": DEFAULT_USER_AGENT, ...options.headers };

  if (options.respectRobots) {
    const allowed = await robotsAllows(new URL(url));
    if (!allowed) throw new RobotsDisallowedError(`robots.txt disallows ${url}`);
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await acquire(bucket, minInterval);
    try {
      const res = await doFetch(url, headers, timeoutMs, options.guardSsrf === true);
      if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
        if (attempt === maxRetries) return res;
        const backoff =
          res.status === 429
            ? applyBackoff(bucket, res.headers.get("retry-after"), 2000 * 2 ** attempt)
            : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
        await sleep(backoff);
        continue;
      }
      return res;
    } catch (err) {
      // SSRF / robots rejections are terminal — never retried.
      if (err instanceof SsrfBlockedError || err instanceof RobotsDisallowedError) throw err;
      lastError = err;
      if (attempt === maxRetries) throw err;
      await sleep(500 * 2 ** attempt + Math.floor(Math.random() * 250));
    }
  }
  throw lastError ?? new Error(`resilientFetch failed: ${url}`);
}

/** One fetch attempt, with SSRF-safe manual redirect following when requested. */
async function doFetch(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
  guardSsrf: boolean
): Promise<Response> {
  if (!guardSsrf) {
    return fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  }
  // Manual redirect handling so every hop is re-validated — `redirect: "follow"`
  // would let a public URL bounce to an internal one behind our back.
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    try {
      await assertPublicUrl(current);
    } catch (e) {
      throw new SsrfBlockedError(e instanceof Error ? e.message : String(e));
    }
    const res = await fetch(current, { headers, signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`too many redirects: ${url}`);
}
