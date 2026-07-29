/**
 * GitHub Organization adapter.
 *
 * Licence: covered by GitHub's API Terms (not a content licence). Trust tier 4
 * — the lowest of the four built-in sources, per
 * supabase/migrations/0006_metadata_fetch_sources.sql: an org's self-written
 * bio is the least authoritative description of the four.
 *
 * Takes an EXPLICIT {name, org}[] input rather than discovering the GitHub
 * handle itself. An earlier draft had this adapter internally call Wikidata to
 * find the org handle — that couples two adapters together and makes neither
 * one independently testable. The orchestration script (scripts/
 * fetch-company-metadata.ts) runs wikidataAdapter first and passes its
 * discovered github_org values in here; this adapter only ever needs to know
 * "org X's GitHub handle is Y."
 *
 * The unauthenticated GitHub REST API caps out at 60 requests/hour per IP and
 * — the concrete bug this fixes — REJECTS every request with a 403 unless a
 * `User-Agent` header is present at all. Set GITHUB_TOKEN in the environment
 * to raise the limit to 5,000/hour; without it, this adapter still works, just
 * within the unauthenticated ceiling.
 */

import type { RawCompanyRecord, SourceAdapter } from "../types";

const USER_AGENT =
  "CandidateVoice-CompanyIntelligence/1.0 (https://github.com/somanshu20000/candidatevoice; metadata-import bot)";

const REQUEST_DELAY_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface GithubOrgInput {
  name: string;
  /** Bare org handle, e.g. "vercel" — not a full URL. */
  org: string;
}

interface GithubOrgResponse {
  description?: string | null;
  blog?: string | null;
  avatar_url?: string | null;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent": USER_AGENT,
    Accept: "application/vnd.github+json",
  };
  const token = process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchOne(input: GithubOrgInput): Promise<RawCompanyRecord | null> {
  const res = await fetch(`https://api.github.com/orgs/${encodeURIComponent(input.org)}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;

  const json = (await res.json()) as GithubOrgResponse;
  const record: RawCompanyRecord = {
    name: input.name,
    github_org: input.org,
  };
  if (json.description) record.description = json.description;
  if (json.blog && /^https?:\/\//i.test(json.blog)) {
    record.links = { engineering_blog: json.blog };
  }

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
        const record = await fetchOne(pair);
        if (record) records.push(record);
      } catch (err) {
        console.error(`[github_org] failed for "${pair.org}":`, err instanceof Error ? err.message : err);
      }
      await sleep(REQUEST_DELAY_MS);
    }

    return records;
  },
};
