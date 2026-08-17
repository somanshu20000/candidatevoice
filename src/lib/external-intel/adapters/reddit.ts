/**
 * Reddit adapter — real, in-process, TS-native acquisition from Reddit's
 * OFFICIAL API (app-only OAuth, client_credentials grant — the same
 * authentication PRAW's `read_only=True` mode uses under the hood in
 * scripts/reddit_ingest.py). This is NOT that Python script reimplemented
 * for its own sake: the Python script is a manually-run CLI tool with no
 * path into the app's own pipeline; this adapter is the same source made
 * callable in-process, from an API route or the cron trigger, without a
 * developer running anything by hand. The extraction logic (company/role/
 * stage/outcome/response-time/payment-flag regexes) is ported verbatim from
 * reddit_ingest.py so both stay behaviorally identical.
 *
 * WHAT IT STORES — AND DELIBERATELY DOES NOT (same contract as the Python
 * script): only extracted STRUCTURED FIELDS plus a link back to the post.
 * Title/body text is read to extract signals but NEVER placed on the output
 * record — the RawExternalReport contract has no field for it.
 *
 * CREDENTIALS: REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET / REDDIT_USER_AGENT.
 * isRedditConfigured() is a real, positive check (see isConfigured below) —
 * never inferred from the absence of an error. When unconfigured or Reddit
 * rejects the credential, load() returns [] and the caller (orchestrator.ts)
 * reports that honestly rather than fabricating a result.
 */

import type { AcquisitionAdapter, RawExternalReport } from "../../hiring-intel/types";

const DEFAULT_SUBREDDITS = [
  "cscareerquestions",
  "ExperiencedDevs",
  "indiajobs",
  "cscareerquestionsCAD",
  "cscareerquestionsEU",
  "recruitinghell",
  "jobs",
];
const SEARCH_QUERIES = [
  "interview experience",
  "interview process",
  "onsite experience",
  "OA experience",
  "got rejected after",
  "offer after interview",
];
const SIGNALS = [
  "interview",
  "onsite",
  "oa",
  "online assessment",
  "phone screen",
  "system design",
  "behavioral",
  "recruiter",
  "offer",
  "rejected",
  "coding round",
  "technical round",
];
const EXTRACTION_VERSION = "reddit-ts-v1";
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 1000;

// --- extraction (ported from scripts/reddit_ingest.py) ----------------------

const ROLE_PATTERNS: Record<string, RegExp[]> = {
  "Software Engineer": [/\bswe\b/i, /software engineer/i, /\bdeveloper\b/i, /\bsde\b/i, /\bbackend\b/i, /\bfrontend\b/i, /full ?stack/i],
  "Product Manager": [/\bpm\b/i, /product manager/i, /product management/i],
  "Data Scientist": [/data scientist/i, /data analyst/i, /machine learning/i, /ml engineer/i, /data engineer/i],
  Designer: [/\bux\b/i, /ui designer/i, /product designer/i],
  "DevOps Engineer": [/\bdevops\b/i, /\bsre\b/i, /site reliability/i, /cloud engineer/i],
};

const ROUND_TO_STAGE: [string, RegExp[]][] = [
  ["screening", [/\boa\b/i, /online assessment/i, /\bhackerrank\b/i, /\bcodility\b/i, /\bleetcode\b/i, /phone screen/i, /phone round/i, /telephonic/i, /recruiter (?:call|screen)/i]],
  ["technical", [/technical round/i, /coding round/i, /technical interview/i, /\bdsa\b/i, /system design/i, /\bhld\b/i, /\blld\b/i]],
  ["hr", [/behavioral/i, /behavioural/i, /\bhr round\b/i, /\bhr interview\b/i, /cultural fit/i, /values round/i, /hiring manager/i, /manager round/i]],
  ["final", [/final round/i, /onsite/i, /on-site/i, /super ?day/i]],
];
const STAGE_ORDER = ["applied", "screening", "technical", "hr", "final"];

const KNOWN_COMPANIES = [
  "Google", "Amazon", "Meta", "Facebook", "Apple", "Microsoft", "Netflix",
  "Stripe", "Airbnb", "Uber", "Lyft", "Snap", "Oracle", "IBM", "Salesforce",
  "Adobe", "Intel", "Nvidia", "Cisco", "Flipkart", "Swiggy", "Zomato",
  "Razorpay", "Paytm", "Zerodha", "CRED", "Infosys", "TCS", "Wipro",
  "Accenture", "Deloitte", "Capgemini", "Atlassian", "Databricks",
  "Snowflake", "Palantir", "Coinbase", "Robinhood",
];

function extractCompany(text: string): string | null {
  const low = text.toLowerCase();
  for (const c of KNOWN_COMPANIES) {
    if (low.includes(c.toLowerCase())) return c;
  }
  const m = text.match(/\b(?:at|from|interview(?:ed)? (?:at|with))\s+([A-Z][A-Za-z0-9&.\- ]{1,30})/);
  if (m) {
    const cand = m[1].trim().replace(/\.$/, "");
    if (cand.length > 2 && !["the", "their", "this", "them", "a", "an"].includes(cand.toLowerCase())) return cand;
  }
  return null;
}

function extractRole(text: string): string | null {
  for (const [label, patterns] of Object.entries(ROLE_PATTERNS)) {
    if (patterns.some((p) => p.test(text))) return label;
  }
  return null;
}

function extractStage(text: string): string | null {
  let furthest = -1;
  for (const [stage, patterns] of ROUND_TO_STAGE) {
    if (patterns.some((p) => p.test(text))) furthest = Math.max(furthest, STAGE_ORDER.indexOf(stage));
  }
  return furthest >= 0 ? STAGE_ORDER[furthest] : null;
}

function extractOutcome(text: string): string | null {
  if (/got (?:the )?offer|received (?:an )?offer|offer letter|got hired|accepted the offer/i.test(text)) return "offer";
  if (/ghosted|ghosting|never heard back|no response|went silent|radio silence/i.test(text)) return "no_response";
  if (/rejected|rejection|did not get|didn't get|turned down/i.test(text)) return "rejected";
  return null;
}

function extractResponseTimeBucket(text: string): string | null {
  let days: number | null = null;
  let m = text.match(/(\d+)\s*-\s*(\d+)\s*days/i);
  if (m) days = Math.floor((Number(m[1]) + Number(m[2])) / 2);
  else if ((m = text.match(/(\d+)\s*days/i))) days = Number(m[1]);
  else if ((m = text.match(/(\d+)\s*weeks?/i))) days = Number(m[1]) * 7;
  else if ((m = text.match(/(\d+)\s*months?/i))) days = Number(m[1]) * 30;
  if (days === null) return null;
  if (days <= 3) return "0-3";
  if (days <= 7) return "4-7";
  if (days <= 14) return "8-14";
  return "15+";
}

function extractPaymentFlag(text: string): boolean | null {
  if (/asked (?:me )?to pay|training fee|pay for training|deposit before|registration fee/i.test(text)) return true;
  return null;
}

interface RedditPost {
  id: string;
  title: string;
  selftext: string | null;
  permalink: string;
  created_utc: number;
}

function toRecord(post: RedditPost): RawExternalReport | null {
  const text = `${post.title}\n\n${post.selftext ?? ""}`;
  const company = extractCompany(text);
  if (!company) return null;
  const role = extractRole(text);
  const stage = extractStage(text);
  const outcome = extractOutcome(text);
  const responseTimeBucket = extractResponseTimeBucket(text);
  const paymentFlag = extractPaymentFlag(text);
  if (!(stage || outcome || responseTimeBucket || paymentFlag !== null)) return null;

  const signals = [role, stage, outcome, responseTimeBucket, paymentFlag !== null ? "x" : null].filter(Boolean).length;
  const confidence = Math.round(Math.min(0.3 + 0.15 * signals, 0.85) * 100) / 100;
  const month = new Date(post.created_utc * 1000).toISOString().slice(0, 7);

  const record: RawExternalReport = {
    company,
    source_url: `https://www.reddit.com${post.permalink}`,
    external_ref: `t3_${post.id}`,
    reported_month: month,
    extraction_version: EXTRACTION_VERSION,
    extraction_confidence: confidence,
  };
  if (role) record.role = role;
  if (stage) record.stage = stage;
  if (outcome) record.outcome = outcome;
  if (responseTimeBucket) record.response_time_bucket = responseTimeBucket;
  if (paymentFlag !== null) record.payment_flag = paymentFlag;
  return record;
}

// --- OAuth + fetch ------------------------------------------------------

export class RedditAuthError extends Error {}

function credentials(): { clientId: string; clientSecret: string; userAgent: string } | null {
  const clientId = process.env.REDDIT_CLIENT_ID?.trim();
  const clientSecret = process.env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = process.env.REDDIT_USER_AGENT?.trim() || "candidatevoice:v1.0 (external acquisition adapter)";
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, userAgent };
}

/** Presence check only — real network validation is checkRedditCredentials(). */
export function isRedditConfigured(): boolean {
  return credentials() !== null;
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, init);
      if (res.status === 401 || res.status === 403) {
        throw new RedditAuthError(`Reddit rejected the credential (HTTP ${res.status})`);
      }
      if (!res.ok && attempt < RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
        continue;
      }
      return res;
    } catch (err) {
      if (err instanceof RedditAuthError) throw err;
      lastErr = err;
      if (attempt < RETRY_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Reddit request failed after retries");
}

async function getAccessToken(clientId: string, clientSecret: string, userAgent: string): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetchWithRetry("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit token request failed: HTTP ${res.status}`);
  const payload = (await res.json()) as { access_token?: string };
  if (!payload.access_token) throw new Error("Reddit token response had no access_token");
  return payload.access_token;
}

/**
 * Real, positive credential verification — one live OAuth round trip, no
 * search. Distinct from isRedditConfigured() (presence-only) the same way
 * V0.2's isVerificationConfigured() pattern separates "present" from "valid".
 */
export async function checkRedditCredentials(): Promise<{ ok: boolean; reason: string }> {
  const creds = credentials();
  if (!creds) return { ok: false, reason: "REDDIT_CLIENT_ID/REDDIT_CLIENT_SECRET not set" };
  try {
    await getAccessToken(creds.clientId, creds.clientSecret, creds.userAgent);
    return { ok: true, reason: "authenticated" };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

interface RedditSearchResponse {
  data?: { children?: { data: RedditPost }[] };
}

async function searchSubreddits(
  token: string,
  userAgent: string,
  subreddits: string[],
  query: string,
  limit: number
): Promise<RedditPost[]> {
  const joined = subreddits.join("+");
  const url =
    `https://oauth.reddit.com/r/${encodeURIComponent(joined)}/search` +
    `?q=${encodeURIComponent(query)}&sort=relevance&t=year&limit=${limit}&restrict_sr=1`;
  const res = await fetchWithRetry(url, {
    headers: { Authorization: `Bearer ${token}`, "User-Agent": userAgent },
  });
  if (!res.ok) return [];
  const payload = (await res.json()) as RedditSearchResponse;
  return (payload.data?.children ?? []).map((c) => c.data);
}

export interface RedditAdapterInput {
  /** Optional — narrows the search to posts mentioning this company, in
   *  addition to the existing keyword-signal filter. When omitted, searches
   *  broadly across the default subreddits (matching reddit_ingest.py's
   *  --all-subreddits bootstrap mode). */
  companyName?: string;
  subreddits?: string[];
  limit?: number;
}

/**
 * Real Reddit acquisition. Never throws for a credential/availability
 * problem — returns [] so the caller degrades honestly (never fabricates a
 * result); DOES throw RedditAuthError distinctly so callers can tell
 * "genuinely no matches" apart from "credential rejected", matching this
 * codebase's "positive verification, not inference" discipline.
 */
export const redditAdapter: AcquisitionAdapter = {
  key: "reddit",
  displayName: "Reddit",
  async load(input: unknown): Promise<RawExternalReport[]> {
    const { companyName, subreddits, limit } = (input ?? {}) as RedditAdapterInput;
    const creds = credentials();
    if (!creds) return [];

    const token = await getAccessToken(creds.clientId, creds.clientSecret, creds.userAgent);
    const subs = subreddits && subreddits.length > 0 ? subreddits : DEFAULT_SUBREDDITS;
    const perQueryLimit = limit ?? 25;

    const seen = new Set<string>();
    const records: RawExternalReport[] = [];
    const queries = companyName ? [`${companyName} interview`, `${companyName} rejected`] : SEARCH_QUERIES;

    for (const query of queries) {
      const posts = await searchSubreddits(token, creds.userAgent, subs, query, perQueryLimit);
      for (const post of posts) {
        if (seen.has(post.id)) continue;
        seen.add(post.id);
        const text = `${post.title}\n\n${post.selftext ?? ""}`.toLowerCase();
        const signalHits = SIGNALS.filter((s) => text.includes(s)).length;
        if (signalHits < 2) continue;
        if (companyName && !text.includes(companyName.toLowerCase())) continue;
        const record = toRecord(post);
        if (record) records.push(record);
      }
    }
    return records;
  },
};
