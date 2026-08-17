/**
 * The two acquisition adapters (src/lib/external-intel/adapters/{demo,reddit}.ts).
 * Both implement AcquisitionAdapter and are exercised through the SAME
 * runExternalImport core Reddit's Python script already used — these tests
 * cover adapter-specific behavior (extraction, credential gating,
 * determinism), not the shared import/validate/dedupe logic (already
 * covered by tests/external-import.test.ts and tests/reddit-pilot.test.ts).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { demoAdapter } from "@/lib/external-intel/adapters/demo";

describe("demoAdapter", () => {
  it("produces exactly one record, clearly labeled, never a real-looking source_url", async () => {
    const records = await demoAdapter.load({ companyName: "Acme Corp" });
    expect(records).toHaveLength(1);
    expect(records[0].source_url).toMatch(/^https:\/\/example\.com\//);
    expect(records[0].extraction_version).toBe("demo-v1");
    expect(records[0].company).toBe("Acme Corp");
  });

  it("is deterministic — same input produces the same content-relevant fields (proves dedupe is exercisable)", async () => {
    const first = await demoAdapter.load({ companyName: "Acme Corp" });
    const second = await demoAdapter.load({ companyName: "Acme Corp" });
    expect(first[0].external_ref).toBe(second[0].external_ref);
    expect(first[0].source_url).toBe(second[0].source_url);
    expect(first[0].stage).toBe(second[0].stage);
    expect(first[0].outcome).toBe(second[0].outcome);
  });

  it("supports distinct variants without colliding on external_ref", async () => {
    const rejected = await demoAdapter.load({ companyName: "Acme Corp", variant: "rejected" });
    const offer = await demoAdapter.load({ companyName: "Acme Corp", variant: "offer" });
    expect(rejected[0].external_ref).not.toBe(offer[0].external_ref);
    expect(rejected[0].outcome).toBe("rejected");
    expect(offer[0].outcome).toBe("offer");
  });

  it("returns [] for a missing company name — never fabricates a record", async () => {
    expect(await demoAdapter.load({})).toEqual([]);
    expect(await demoAdapter.load({ companyName: "  " })).toEqual([]);
  });

  it("never includes a title/body/author field — same contract discipline as every other source", async () => {
    const [record] = await demoAdapter.load({ companyName: "Acme Corp" });
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("title");
    expect(record).not.toHaveProperty("author");
  });
});

describe("redditAdapter", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env = { ...ORIGINAL_ENV };
    vi.resetModules();
  });

  it("isRedditConfigured() is false when credentials are absent", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const { isRedditConfigured } = await import("@/lib/external-intel/adapters/reddit");
    expect(isRedditConfigured()).toBe(false);
  });

  it("load() returns [] without any network call when credentials are absent — never fabricates", async () => {
    delete process.env.REDDIT_CLIENT_ID;
    delete process.env.REDDIT_CLIENT_SECRET;
    const { redditAdapter } = await import("@/lib/external-intel/adapters/reddit");
    const records = await redditAdapter.load({ companyName: "Acme" });
    expect(records).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checkRedditCredentials() performs a real OAuth round trip and reports failure honestly", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 401 });
    const { checkRedditCredentials } = await import("@/lib/external-intel/adapters/reddit");
    const result = await checkRedditCredentials();
    expect(result.ok).toBe(false);
    expect(fetch).toHaveBeenCalledWith("https://www.reddit.com/api/v1/access_token", expect.any(Object));
  });

  it("checkRedditCredentials() reports success on a real 200 + access_token", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: "tok" }),
    });
    const { checkRedditCredentials } = await import("@/lib/external-intel/adapters/reddit");
    const result = await checkRedditCredentials();
    expect(result.ok).toBe(true);
  });

  it("load() authenticates then searches and extracts structured fields, never the post body", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("access_token")) {
        return { ok: true, json: async () => ({ access_token: "tok" }) };
      }
      return {
        ok: true,
        json: async () => ({
          data: {
            children: [
              {
                data: {
                  id: "abc123",
                  title: "My Razorpay interview experience",
                  selftext: "Had a technical round, then got rejected after 10 days.",
                  permalink: "/r/cscareerquestions/comments/abc123/x/",
                  created_utc: 1717200000,
                },
              },
            ],
          },
        }),
      };
    });
    const { redditAdapter } = await import("@/lib/external-intel/adapters/reddit");
    const records = await redditAdapter.load({ companyName: "Razorpay", limit: 5 });
    expect(records.length).toBeGreaterThan(0);
    const record = records[0];
    expect(record.company).toBe("Razorpay");
    expect(record.external_ref).toBe("t3_abc123");
    expect(record.source_url).toBe("https://www.reddit.com/r/cscareerquestions/comments/abc123/x/");
    expect(record.stage).toBe("technical");
    expect(record.outcome).toBe("rejected");
    expect(record.response_time_bucket).toBe("8-14");
    expect(record).not.toHaveProperty("body");
    expect(record).not.toHaveProperty("title");
    expect(record).not.toHaveProperty("selftext");
  });

  it("filters out posts with fewer than 2 signal keywords — noise, not evidence", async () => {
    process.env.REDDIT_CLIENT_ID = "id";
    process.env.REDDIT_CLIENT_SECRET = "secret";
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("access_token")) return { ok: true, json: async () => ({ access_token: "tok" }) };
      return {
        ok: true,
        json: async () => ({
          data: { children: [{ data: { id: "x1", title: "Razorpay is a good company", selftext: "", permalink: "/r/x/x1/", created_utc: 1717200000 } }] },
        }),
      };
    });
    const { redditAdapter } = await import("@/lib/external-intel/adapters/reddit");
    const records = await redditAdapter.load({ companyName: "Razorpay" });
    expect(records).toEqual([]);
  });
});
