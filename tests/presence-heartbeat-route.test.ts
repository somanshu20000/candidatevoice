/**
 * /api/presence/heartbeat — route-level tests (Task: "invalid/tampered
 * requests", "rate limiting", "bot/admin exclusion", "privacy invariants",
 * "graceful failure"). Mirrors the vi.mock module-boundary pattern already
 * established in tests/external-acquisition-orchestrator.test.ts: mock the
 * Supabase/rate-limit boundaries, exercise the real route handler.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ rpc: rpcMock }),
}));

const rateLimitMock = vi.fn(async (..._args: unknown[]) => false);
vi.mock("@/lib/rate-limit", () => ({
  checkAndRecordRateLimit: (...args: unknown[]) => rateLimitMock(...args),
}));

import { POST } from "@/app/api/presence/heartbeat/route";

function makeRequest(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/presence/heartbeat", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", "user-agent": "Mozilla/5.0 (real browser)", ...headers },
  });
}

const VALID_SESSION = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  rpcMock.mockReset();
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue(false);
});

describe("POST /api/presence/heartbeat — bot/admin exclusion", () => {
  it("hides (never records, never queries the DB) for a known bot User-Agent", async () => {
    const res = await POST(makeRequest({ session_id: VALID_SESSION }, { "user-agent": "Googlebot/2.1" }));
    const json = await res.json();
    expect(json).toEqual({ show_global: false, global_count: null, show_company: false, company_count: null });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("hides for a missing User-Agent", async () => {
    const res = await POST(makeRequest({ session_id: VALID_SESSION }, { "user-agent": "" }));
    const json = await res.json();
    expect(json.show_global).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/presence/heartbeat — invalid/tampered requests", () => {
  it("rejects a malformed JSON body with 400, never crashes", async () => {
    const res = await POST(makeRequest("{not valid json"));
    expect(res.status).toBe(400);
  });

  it("rejects a missing session_id with 400", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a non-UUID session_id (tampered/spoofed) with 400", async () => {
    const res = await POST(makeRequest({ session_id: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects a session_id that is a number, not a string (type-tampered)", async () => {
    const res = await POST(makeRequest({ session_id: 12345 }));
    expect(res.status).toBe(400);
  });

  it("structurally cannot accept a client-submitted count — the body shape has no count field the route ever reads", async () => {
    // Even if a tampered client sends one, it's simply ignored: the route
    // only ever reads session_id/company_slug from the body.
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "presence_heartbeat") return { error: null };
      if (fn === "presence_counts") return { data: [{ global_count: 5, company_count: 0 }], error: null };
      return { data: null, error: null };
    });
    const res = await POST(makeRequest({ session_id: VALID_SESSION, global_count: 999999, count: 999999 }));
    const json = await res.json();
    expect(json.global_count).toBe(5); // the fabricated 999999 was never read
  });
});

describe("POST /api/presence/heartbeat — rate limiting", () => {
  it("returns 429 and hides when the IP is rate-limited", async () => {
    rateLimitMock.mockResolvedValue(true);
    const res = await POST(makeRequest({ session_id: VALID_SESSION }));
    expect(res.status).toBe(429);
    const json = await res.json();
    expect(json.show_global).toBe(false);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/presence/heartbeat — graceful failure", () => {
  it("hides (200, not 500) when the store fails open due to a DB error", async () => {
    rpcMock.mockResolvedValue({ error: new Error("db down") });
    const res = await POST(makeRequest({ session_id: VALID_SESSION }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ show_global: false, global_count: null, show_company: false, company_count: null });
  });
});

describe("POST /api/presence/heartbeat — company scoping", () => {
  it("resolves company_slug server-side via resolve_organization, never trusts a client id", async () => {
    rpcMock.mockImplementation(async (fn: string, args: Record<string, unknown>) => {
      if (fn === "resolve_organization") {
        expect(args.p_slug).toBe("acme-corp");
        return { data: "org-uuid-acme" };
      }
      if (fn === "presence_heartbeat") {
        expect(args.p_organization_id).toBe("org-uuid-acme");
        return { error: null };
      }
      if (fn === "presence_counts") return { data: [{ global_count: 10, company_count: 3 }], error: null };
      return { data: null, error: null };
    });
    const res = await POST(makeRequest({ session_id: VALID_SESSION, company_slug: "acme-corp" }));
    const json = await res.json();
    expect(json.company_count).toBe(3);
  });

  it("an unresolvable slug is simply not company-scoped, never an error", async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === "resolve_organization") return { data: null };
      if (fn === "presence_heartbeat") return { error: null };
      if (fn === "presence_counts") return { data: [{ global_count: 10, company_count: 0 }], error: null };
      return { data: null, error: null };
    });
    const res = await POST(makeRequest({ session_id: VALID_SESSION, company_slug: "does-not-exist" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.show_company).toBe(false);
    expect(json.company_count).toBeNull();
  });
});
