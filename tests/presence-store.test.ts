/**
 * Live presence store (src/lib/presence/store.ts) — an in-memory fake
 * Supabase client, mirroring the established pattern in
 * tests/external-acquisition-orchestrator.test.ts (a minimal fake covering
 * exactly the calls the module under test makes directly).
 *
 * Covers: session creation/heartbeat, global counting, company-specific
 * counting, concurrent heartbeats (same session_id upserts to one row —
 * the migration test separately proves this is atomic at the DB level via
 * ON CONFLICT; this proves the store's calling contract matches), graceful
 * failure (a DB error never throws, callers get null), and stale-session
 * cleanup.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordHeartbeatAndCount, cleanupStalePresence, PRESENCE_CLEANUP_AFTER_SECONDS } from "@/lib/presence/store";

interface FakeSession {
  session_id: string;
  last_seen_at: string;
  organization_id: string | null;
}

function fakePresenceClient(opts: { failHeartbeat?: boolean; failCounts?: boolean } = {}) {
  const sessions = new Map<string, FakeSession>();

  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      if (fn === "presence_heartbeat") {
        if (opts.failHeartbeat) return { error: new Error("simulated failure") };
        const sessionId = String(args.p_session_id);
        sessions.set(sessionId, {
          session_id: sessionId,
          last_seen_at: new Date().toISOString(),
          organization_id: (args.p_organization_id as string | null) ?? null,
        });
        return { error: null };
      }
      if (fn === "presence_counts") {
        if (opts.failCounts) return { data: null, error: new Error("simulated failure") };
        const orgId = (args.p_organization_id as string | null) ?? null;
        const global_count = sessions.size;
        const company_count = orgId === null ? 0 : [...sessions.values()].filter((s) => s.organization_id === orgId).length;
        return { data: [{ global_count, company_count }], error: null };
      }
      throw new Error(`unexpected rpc: ${fn}`);
    },
    from: (table: string) => {
      if (table !== "presence_sessions") throw new Error(`unexpected table: ${table}`);
      return {
        delete: () => ({
          lt: (_col: string, cutoff: string) => ({
            select: async (_sel: string) => {
              const toDelete = [...sessions.values()].filter((s) => s.last_seen_at < cutoff);
              for (const s of toDelete) sessions.delete(s.session_id);
              return { data: toDelete, error: null };
            },
          }),
        }),
      };
    },
  };

  return { client: client as unknown as SupabaseClient, sessions };
}

describe("recordHeartbeatAndCount — session creation/heartbeat", () => {
  it("records a heartbeat and returns global+company counts in one call", async () => {
    const { client } = fakePresenceClient();
    const result = await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", "org-acme");
    expect(result).toEqual({ globalCount: 1, companyCount: 1 });
  });

  it("global counting: a session with no organization counts globally but never toward any company", async () => {
    const { client } = fakePresenceClient();
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);
    const result = await recordHeartbeatAndCount(client, "22222222-2222-2222-2222-222222222222", "org-acme");
    expect(result).toEqual({ globalCount: 2, companyCount: 1 });
  });

  it("company-specific counting: only sessions scoped to that exact organization count toward it", async () => {
    const { client } = fakePresenceClient();
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", "org-acme");
    await recordHeartbeatAndCount(client, "22222222-2222-2222-2222-222222222222", "org-other");
    const result = await recordHeartbeatAndCount(client, "33333333-3333-3333-3333-333333333333", "org-acme");
    expect(result).toEqual({ globalCount: 3, companyCount: 2 }); // 2 sessions scoped to org-acme, 3 total
  });

  it("concurrent heartbeats: two heartbeats for the SAME session_id upsert to one row, not two", async () => {
    const { client, sessions } = fakePresenceClient();
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", "org-acme");
    expect(sessions.size).toBe(1); // still one row — the second call updated it, not appended
    const result = await recordHeartbeatAndCount(client, "22222222-2222-2222-2222-222222222222", null);
    expect(result?.globalCount).toBe(2); // 2 distinct sessions, not 3
  });
});

describe("recordHeartbeatAndCount — graceful failure", () => {
  it("returns null (never throws) when the heartbeat RPC fails", async () => {
    const { client } = fakePresenceClient({ failHeartbeat: true });
    const result = await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);
    expect(result).toBeNull();
  });

  it("returns null (never throws) when the counts RPC fails", async () => {
    const { client } = fakePresenceClient({ failCounts: true });
    const result = await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);
    expect(result).toBeNull();
  });

  it("returns null on an unexpected exception rather than propagating it", async () => {
    const throwingClient = {
      rpc: async () => {
        throw new Error("network exploded");
      },
    } as unknown as SupabaseClient;
    const result = await recordHeartbeatAndCount(throwingClient, "11111111-1111-1111-1111-111111111111", null);
    expect(result).toBeNull();
  });
});

describe("cleanupStalePresence — stale-session cleanup / expiration", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("deletes only rows older than the cleanup threshold, keeps fresh ones", async () => {
    const { client, sessions } = fakePresenceClient();
    const now = new Date("2026-08-22T12:00:00.000Z");
    vi.setSystemTime(now);

    // A fresh session (well within the active window).
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);

    // A stale session — manually backdated past the cleanup threshold, the
    // way an abandoned tab's last real heartbeat would look.
    const staleCutoff = new Date(now.getTime() - (PRESENCE_CLEANUP_AFTER_SECONDS + 60) * 1000);
    sessions.set("22222222-2222-2222-2222-222222222222", {
      session_id: "22222222-2222-2222-2222-222222222222",
      last_seen_at: staleCutoff.toISOString(),
      organization_id: null,
    });

    const deleted = await cleanupStalePresence(client);
    expect(deleted).toBe(1);
    expect(sessions.has("11111111-1111-1111-1111-111111111111")).toBe(true); // fresh one survives
    expect(sessions.has("22222222-2222-2222-2222-222222222222")).toBe(false); // stale one is gone
  });

  it("returns 0 when nothing is stale, never an error", async () => {
    const { client } = fakePresenceClient();
    vi.setSystemTime(new Date("2026-08-22T12:00:00.000Z"));
    await recordHeartbeatAndCount(client, "11111111-1111-1111-1111-111111111111", null);
    const deleted = await cleanupStalePresence(client);
    expect(deleted).toBe(0);
  });

  it("returns null (never throws) on a query error", async () => {
    const throwingClient = {
      from: () => {
        throw new Error("db unavailable");
      },
    } as unknown as SupabaseClient;
    const deleted = await cleanupStalePresence(throwingClient);
    expect(deleted).toBeNull();
  });
});
