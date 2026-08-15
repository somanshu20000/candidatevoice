/**
 * M5.2a — src/lib/verification/grants.ts. No existing fake covers
 * verification_grants's shape (insert; delete().eq().gt().select();
 * delete().lt().select()), so this builds the smallest purpose-built
 * in-memory fake for exactly those query shapes — matching the convention
 * established in tests/company-requests.test.ts's file header.
 */

import { describe, expect, it } from "vitest";
import { issueGrant, consumeGrant, purgeExpiredGrants } from "@/lib/verification/grants";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = { grant_hash: string; expires_at: string };

function makeDb(): { rows: Row[] } {
  return { rows: [] };
}

class FakeGrantsTable {
  private mode: "insert" | "delete" = "insert";
  private insertRow: Row | null = null;
  private eqFilter: [string, unknown] | null = null;
  private gtFilter: [string, unknown] | null = null;
  private ltFilter: [string, unknown] | null = null;

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
  lt(col: string, val: unknown) {
    this.ltFilter = [col, val];
    return this;
  }
  select(_cols?: string) {
    return this;
  }

  private runInsert(): { data: null; error: { message: string } | null } {
    if (this.db.rows.some((r) => r.grant_hash === this.insertRow!.grant_hash)) {
      return { data: null, error: { message: "duplicate key value violates unique constraint" } };
    }
    this.db.rows.push({ ...this.insertRow! });
    return { data: null, error: null };
  }

  private runDelete(): { data: Row[]; error: null } {
    const matched = this.db.rows.filter((r) => {
      if (this.eqFilter && r[this.eqFilter[0] as keyof Row] !== this.eqFilter[1]) return false;
      if (this.gtFilter && !(r[this.gtFilter[0] as keyof Row] > (this.gtFilter[1] as string))) return false;
      if (this.ltFilter && !(r[this.ltFilter[0] as keyof Row] < (this.ltFilter[1] as string))) return false;
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

const NONCE_A = "nonce-aaaa";
const NONCE_B = "nonce-bbbb";

function inFuture(ms = 15 * 60 * 1000): Date {
  return new Date(Date.now() + ms);
}
function inPast(ms = 15 * 60 * 1000): Date {
  return new Date(Date.now() - ms);
}

describe("issueGrant / consumeGrant", () => {
  it("issue then consume the same nonce succeeds exactly once", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inFuture());
    expect(db.rows).toHaveLength(1);

    const first = await consumeGrant(supabase, NONCE_A);
    expect(first).toBe(true);
    expect(db.rows).toHaveLength(0);
  });

  it("a second consumption of the same nonce fails (replay protection)", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inFuture());

    const first = await consumeGrant(supabase, NONCE_A);
    expect(first).toBe(true);

    const second = await consumeGrant(supabase, NONCE_A);
    expect(second).toBe(false);
  });

  it("consuming an expired grant fails and leaves the row (purgeable, not silently gone)", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inPast());

    const result = await consumeGrant(supabase, NONCE_A);
    expect(result).toBe(false);
    expect(db.rows).toHaveLength(1);
  });

  it("consuming an unknown nonce fails", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    const result = await consumeGrant(supabase, "never-issued");
    expect(result).toBe(false);
  });

  it("issuing two different nonces, consuming one leaves the other untouched", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inFuture());
    await issueGrant(supabase, NONCE_B, inFuture());

    await consumeGrant(supabase, NONCE_A);
    expect(db.rows).toHaveLength(1);

    const stillGood = await consumeGrant(supabase, NONCE_B);
    expect(stillGood).toBe(true);
  });

  it("stores only a hash of the nonce, never the nonce itself", async () => {
    const db = makeDb();
    await issueGrant(fakeSupabase(db), NONCE_A, inFuture());
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0].grant_hash).not.toBe(NONCE_A);
    expect(db.rows[0].grant_hash).not.toContain(NONCE_A);
  });
});

describe("purgeExpiredGrants", () => {
  it("removes only expired rows and leaves valid ones", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inPast());
    await issueGrant(supabase, NONCE_B, inFuture());

    const purged = await purgeExpiredGrants(supabase);
    expect(purged).toBe(1);
    expect(db.rows).toHaveLength(1);

    const stillGood = await consumeGrant(supabase, NONCE_B);
    expect(stillGood).toBe(true);
  });

  it("is a no-op when nothing is expired", async () => {
    const db = makeDb();
    const supabase = fakeSupabase(db);
    await issueGrant(supabase, NONCE_A, inFuture());
    const purged = await purgeExpiredGrants(supabase);
    expect(purged).toBe(0);
    expect(db.rows).toHaveLength(1);
  });
});
