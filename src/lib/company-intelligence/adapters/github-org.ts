/**
 * GitHub Organization adapter.
 *
 * Licence: covered by GitHub's API Terms (not a content licence). Trust tier 4
 * — the lowest of the four built-in sources: an org's self-written bio is the
 * least authoritative description.
 *
 * Takes an EXPLICIT {name, org}[] input rather than discovering the handle
 * itself — the handle comes from wikidataAdapter's output via the orchestrator.
 *
 * RATE LIMITS. The unauthenticated GitHub REST API is 60 requests/HOUR per IP;
 * with GITHUB_TOKEN set it is 5,000/hour. An exhausted primary limit returns
 * 403 with `x-ratelimit-remaining: 0`, which is otherwise indistinguishable
 * from a 404 "no such org". `fetchGithubOrg` therefore throws a typed
 * GithubRateLimitError on exhaustion so the caller can report "rate limited"
 * rather than silently recording "no GitHub data" for hundreds of companies.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";
import { resilientFetch } from "../http";

export interface GithubOrgInput {
  name: string;
  /** Bare org handle, e.g. "vercel" — not a full URL. */
  org: string;
}

/** Thrown when the GitHub rate limit is exhausted (distinct from "not found"). */
export class GithubRateLimitError extends Error {}

interface GithubOrgResponse {
  description?: string | null;
  blog?: string | null;
  avatar_url?: string | null;
}

function ghHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/** True when an API GITHUB_TOKEN is configured (5,000/hr instead of 60/hr). */
export function githubTokenPresent(): boolean {
  return Boolean(process.env.GITHUB_TOKEN);
}

/**
 * Fetch one org's public profile. Returns null when the org does not exist.
 * Throws GithubRateLimitError when the rate limit is exhausted, so a large
 * import does not mistake "we ran out of quota" for "this company has no org".
 */
export async function fetchGithubOrg(input: GithubOrgInput): Promise<RawCompanyRecord | null> {
  const res = await resilientFetch(`https://api.github.com/orgs/${encodeURIComponent(input.org)}`, {
    bucket: "github",
    headers: ghHeaders(),
    timeoutMs: 10_000,
  });

  if (!res.ok) {
    if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
      throw new GithubRateLimitError(`GitHub rate limit exhausted (org ${input.org})`);
    }
    return null; // 404 and other non-2xx → no data for this org
  }

  const json = (await res.json()) as GithubOrgResponse;
  const record: RawCompanyRecord = { name: input.name, github_org: input.org };
  if (json.description) record.description = json.description;
  if (json.blog && /^https?:\/\//i.test(json.blog)) record.links = { engineering_blog: json.blog };
  return record;
}

export const githubOrgAdapter: SourceAdapter = {
  key: "github_org",
  displayName: "GitHub",
  permitsRedistribution: true,

  /** input: GithubOrgInput[] — explicit {name, org} pairs. */
  async load(input: unknown): Promise<RawCompanyRecord[]> {
    if (!Array.isArray(input)) {
      throw new Error("githubOrgAdapter.load expects GithubOrgInput[].");
    }
    const pairs = input as GithubOrgInput[];
    const records: RawCompanyRecord[] = [];
    for (const pair of pairs) {
      try {
        const record = await fetchGithubOrg(pair);
        if (record) records.push(record);
      } catch (err) {
        console.error(`[github_org] failed for "${pair.org}":`, err instanceof Error ? err.message : err);
      }
    }
    return records;
  },
};
