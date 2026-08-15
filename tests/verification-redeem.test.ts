/**
 * M5.2a — src/lib/verification/redeem.ts: the combined verify+consume entry
 * point. Reuses the same minimal fake Supabase shape as
 * tests/verification-grants.test.ts (insert; delete().eq().gt().select()).
 *
 * True multi-threaded races aren't testable in single-threaded JS — the
 * concurrent-consumption guarantee itself comes from the single atomic SQL
 * DELETE statement in grants.ts, not from application-level locking (see
 * that file's header). What's tested here is the observable contract two
 * concurrent callers would see: exactly one succeeds, the other is told
 * "already_used" — matching the precedent in tests/company-requests.test.ts's
 * "concurrent-action race guard" block.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { redeemGrant } from "@/lib/verification/redeem";
import { generateNonce, signGrant } from "@/lib/verification/token";
import type { SupabaseClient } from "@supabase/supabase-js";

const ORIGINAL_SECRET = process.env.VERIFICATION_SECRET;

beforeEach(() => {
  process.env.VERIFICATION_SECRET = "test-secret-do-not-use-in-prod";
});
afterEach(() => {
  process.env.VERIFICATION_SECRET = ORIGINAL_SECRET;
});

type Row = { grant_hash: string; expires_at: string };

class FakeGrantsTable {
  private mode: "insert" | "delete" = "insert";
  private insertRow: Row | null = null;
  private eqFilter: [string, unknown] | null = null;
  private gtFilter: [string, unknown] | null = null;

  constructor(private db: { rows: Row[] }) {}

  insert(row: Row) {
    this.mode = "insert";
    this.insertRow = row;
    return this;
  }
  delete() {
    this.mode = "delete";
    return this;
  }
  eq(col: string, val: unknown) {
    this.eqFilter = [col, val];
    return this;
  }
  gt(col: string, val: unknown) {
    this.gtFilter = [col, val];
    return this;
  }
  select(_cols?: string) {
    return this;
  }

  private runInsert() {
    this.db.rows.push({ ...this.insertRow! });
    return { data: null, error: null };
  }
  private runDelete() {
    const matched = this.db.rows.filter((r) => {
      if (this.eqFilter && r[this.eqFilter[0] as keyof Row] !== this.eqFilter[1]) return false;
      if (this.gtFilter && !(r[this.gtFilter[0] as keyof Row] > (this.gtFilter[1] as string))) return false;
      return true;
    });
    this.db.rows = this.db.rows.filter((r) => !matched.includes(r));
    return { data: matched.map((r) => ({ ...r })), error: null };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(resolve: any, reject?: any) {
    const outcome = this.mode === "insert" ? this.runInsert() : this.runDelete();
    return Promise.resolve(outcome).then(resolve, reject);
  }
}

function fakeSupabase(db: { rows: Row[] }): SupabaseClient {
  return {
    from(_table: string) {
      return new FakeGrantsTable(db) as unknown as ReturnType<SupabaseClient["from"]>;
    },
  } as unknown as SupabaseClient;
}

async function issueRow(db: { rows: Row[] }, nonce: string, expiresAt = new Date(Date.now() + 900_000)) {
  const crypto = require("crypto");
  const grant_hash = crypto.createHash("sha256").update(nonce).digest("hex");
  db.rows.push({ grant_hash, expires_at: expiresAt.toISOString() });
}

describe("redeemGrant — valid grant end to end", () => {
  it("a freshly issued grant redeems successfully and returns organizationId + tier", async () => {
    const db = { rows: [] as Row[] };
    const nonce = generateNonce();
    await issueRow(db, nonce);
    const token = signGrant({
      nonce,
      organizationId: "org-abc",
      tier: "contact_domain",
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const result = await redeemGrant(fakeSupabase(db), token);
    expect(result).toEqual({ ok: true, organizationId: "org-abc", tier: "contact_domain" });
  });
});

describe("redeemGrant — invalid/expired tokens never consume", () => {
  it("an invalid signature is rejected without touching the store", async () => {
    const db = { rows: [] as Row[] };
    const result = await redeemGrant(fakeSupabase(db), "garbage.token");
    expect(result).toEqual({ ok: false, error: "invalid_or_expired" });
  });
});

describe("redeemGrant — wrong organization never consumes", () => {
  it("a token bound to org-A redeemed with expectedOrganizationId org-B fails, and the SAME token can still be redeemed correctly afterward", async () => {
    const db = { rows: [] as Row[] };
    const nonce = generateNonce();
    await issueRow(db, nonce);
    const token = signGrant({
      nonce,
      organizationId: "org-A",
      tier: "contact_domain",
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const mismatch = await redeemGrant(fakeSupabase(db), token, "org-B");
    expect(mismatch).toEqual({ ok: false, error: "organization_mismatch" });
    // The nonce row must still exist — a mismatch must never consume.
    expect(db.rows).toHaveLength(1);

    const retry = await redeemGrant(fakeSupabase(db), token, "org-A");
    expect(retry).toEqual({ ok: true, organizationId: "org-A", tier: "contact_domain" });
  });
});

describe("redeemGrant — successful consumption is single-use", () => {
  it("a second redemption of the same token fails as already_used", async () => {
    const db = { rows: [] as Row[] };
    const nonce = generateNonce();
    await issueRow(db, nonce);
    const token = signGrant({
      nonce,
      organizationId: "org-abc",
      tier: "attested",
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const first = await redeemGrant(fakeSupabase(db), token);
    expect(first.ok).toBe(true);

    const second = await redeemGrant(fakeSupabase(db), token);
    expect(second).toEqual({ ok: false, error: "already_used" });
  });

  it("simulated concurrent redemption: exactly one of two racing calls succeeds", async () => {
    const db = { rows: [] as Row[] };
    const nonce = generateNonce();
    await issueRow(db, nonce);
    const token = signGrant({
      nonce,
      organizationId: "org-abc",
      tier: "contact_domain",
      exp: Math.floor(Date.now() / 1000) + 900,
    });

    const supabase = fakeSupabase(db);
    const [a, b] = await Promise.all([redeemGrant(supabase, token), redeemGrant(supabase, token)]);
    const results = [a, b];
    const succeeded = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect((failed[0] as { error: string }).error).toBe("already_used");
  });
});
