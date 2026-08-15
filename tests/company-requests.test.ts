/**
 * M5.1 — company-request moderation (src/lib/company-intelligence/requests.ts).
 *
 * requests.ts talks to Supabase directly (no CompanyStore abstraction like
 * importer.ts has), so there is no existing fake to reuse. This file builds
 * the smallest possible in-memory fake — exactly the query shapes
 * requests.ts and resolve.ts's organizationExists actually issue — rather
 * than mocking a general Supabase client. `resolve_organization` is modelled
 * realistically (slug lookup against the fake `organizations` table), so a
 * company created by one promote() call is genuinely visible to the next
 * call's D-009 re-resolve — the exact scenario that guards against duplicates.
 */

import { describe, expect, it } from "vitest";
import { canonicalizeSlug } from "@/lib/company-intelligence/normalize";
import {
  listPendingCompanyRequests,
  promoteCompanyRequest,
  mergeCompanyRequest,
  rejectCompanyRequest,
} from "@/lib/company-intelligence/requests";
import type { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Minimal fake Supabase client — see file header.
// ---------------------------------------------------------------------------
type Row = Record<string, unknown>;
interface FakeDB {
  tables: Record<string, Row[]>;
  idSeq: number;
}

function makeDb(): FakeDB {
  return { tables: { company_requests: [], organizations: [], company_links: [] }, idSeq: 0 };
}

function nextId(db: FakeDB, table: string): string {
  db.idSeq++;
  return `${table}-${db.idSeq}`;
}

class FakeTable {
  private filters: [string, unknown][] = [];
  private limitN: number | null = null;
  private mode: "select" | "update" | "upsert" = "select";
  private patch: Row | null = null;
  private upsertRow: Row | null = null;
  private upsertConflictCol: string | null = null;

  constructor(private db: FakeDB, private table: string) {}

  select(_cols?: string) {
    if (this.mode !== "update") this.mode = "select";
    return this;
  }
  eq(col: string, val: unknown) {
    this.filters.push([col, val]);
    return this;
  }
  order(_col?: string, _opts?: unknown) {
    return this;
  }
  limit(n: number) {
    this.limitN = n;
    return this;
  }
  update(patch: Row) {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  upsert(row: Row, opts: { onConflict: string; ignoreDuplicates?: boolean }) {
    this.mode = "upsert";
    this.upsertRow = row;
    this.upsertConflictCol = opts.onConflict;
    return this;
  }

  private matches(row: Row): boolean {
    return this.filters.every(([c, v]) => row[c] === v);
  }
  private runSelect(): Row[] {
    let out = (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    return out.map((r) => ({ ...r }));
  }
  private runUpdate(): Row[] {
    const matched = (this.db.tables[this.table] ?? []).filter((r) => this.matches(r));
    for (const r of matched) Object.assign(r, this.patch);
    return matched.map((r) => ({ ...r }));
  }
  private runUpsert(): { error: null } {
    const rows = (this.db.tables[this.table] ??= []);
    const exists = rows.some((r) => r[this.upsertConflictCol!] === this.upsertRow![this.upsertConflictCol!]);
    if (!exists) rows.push({ id: nextId(this.db, this.table), ...this.upsertRow });
    return { error: null };
  }

  async single() {
    const result = this.mode === "update" ? this.runUpdate() : this.runSelect();
    if (result.length !== 1) return { data: null, error: { message: "not found or not unique" } };
    return { data: result[0], error: null };
  }
  async maybeSingle() {
    const result = this.mode === "update" ? this.runUpdate() : this.runSelect();
    return result.length === 0 ? { data: null, error: null } : { data: result[0], error: null };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(resolve: any, reject?: any) {
    const outcome =
      this.mode === "upsert" ? this.runUpsert() : { data: this.mode === "update" ? this.runUpdate() : this.runSelect(), error: null };
    return Promise.resolve(outcome).then(resolve, reject);
  }
}

function fakeSupabase(db: FakeDB): SupabaseClient {
  return {
    from(table: string) {
      return new FakeTable(db, table) as unknown as ReturnType<SupabaseClient["from"]>;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      if (fn === "resolve_organization") {
        const org = (db.tables.organizations ?? []).find((r) => r.slug === args.p_slug);
        return Promise.resolve({ data: (org?.id as string | undefined) ?? null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: `fakeSupabase: unhandled rpc ${fn}` } });
    },
  } as unknown as SupabaseClient;
}

function seedRequest(db: FakeDB, overrides: Partial<Row> = {}): string {
  const id = nextId(db, "company_requests");
  db.tables.company_requests.push({
    id,
    requested_name: "Acme Corp",
    requested_domain: null,
    requester_note: null,
    status: "pending",
    resolved_organization_id: null,
    created_at: new Date(2026, 0, 1).toISOString(),
    reviewed_at: null,
    ...overrides,
  });
  return id;
}

function seedOrg(db: FakeDB, slug: string, displayName: string): string {
  const id = nextId(db, "organizations");
  db.tables.organizations.push({ id, slug, display_name: displayName });
  return id;
}

// ---------------------------------------------------------------------------

describe("listPendingCompanyRequests", () => {
  // Ordering (oldest-first via .order("created_at")) is a real Postgres
  // behavior this in-memory fake does not model — see the file header.
  // What's testable here, and load-bearing, is the status filter itself.
  it("returns only pending requests, excluding other statuses", async () => {
    const db = makeDb();
    seedRequest(db, { requested_name: "Pending One", status: "pending" });
    seedRequest(db, { requested_name: "Pending Two", status: "pending" });
    seedRequest(db, { requested_name: "AlreadyApproved", status: "approved" });
    seedRequest(db, { requested_name: "AlreadyRejected", status: "rejected" });
    const rows = await listPendingCompanyRequests(fakeSupabase(db));
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
    expect(new Set(rows.map((r) => r.requestedName))).toEqual(new Set(["Pending One", "Pending Two"]));
  });

  it("returns an empty array when there is nothing pending", async () => {
    const db = makeDb();
    seedRequest(db, { status: "rejected" });
    expect(await listPendingCompanyRequests(fakeSupabase(db))).toEqual([]);
  });
});

describe("promoteCompanyRequest — exactly-one-org creation", () => {
  it("creates exactly one organization and marks the request approved", async () => {
    const db = makeDb();
    const reqId = seedRequest(db, { requested_name: "Brand New Startup" });
    const supabase = fakeSupabase(db);

    const result = await promoteCompanyRequest(supabase, reqId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.slug).toBe(canonicalizeSlug("Brand New Startup"));
    expect(db.tables.organizations).toHaveLength(1);
    expect(db.tables.organizations[0].slug).toBe(canonicalizeSlug("Brand New Startup"));

    const updated = db.tables.company_requests.find((r) => r.id === reqId)!;
    expect(updated.status).toBe("approved");
    expect(updated.resolved_organization_id).toBe(result.organizationId);
    expect(updated.reviewed_at).not.toBeNull();
  });

  it("rejects a name that cannot be turned into a valid slug, creating no organization", async () => {
    const db = makeDb();
    const reqId = seedRequest(db, { requested_name: "!!!" });
    const result = await promoteCompanyRequest(fakeSupabase(db), reqId);
    expect(result.ok).toBe(false);
    expect(db.tables.organizations).toHaveLength(0);
  });

  it("fails on an unknown or already-resolved request id", async () => {
    const db = makeDb();
    const missing = await promoteCompanyRequest(fakeSupabase(db), "does-not-exist");
    expect(missing.ok).toBe(false);

    const reqId = seedRequest(db, { status: "rejected" });
    const alreadyDone = await promoteCompanyRequest(fakeSupabase(db), reqId);
    expect(alreadyDone.ok).toBe(false);
    expect(db.tables.organizations).toHaveLength(0);
  });
});

describe("promoteCompanyRequest — D-009 duplicate protection", () => {
  it("refuses to promote when the slug already resolves to an existing organization (never creates a second)", async () => {
    const db = makeDb();
    const existingOrgId = seedOrg(db, "acme-corp", "Acme Corp");
    const reqId = seedRequest(db, { requested_name: "Acme Corp" }); // same name -> same slug
    const supabase = fakeSupabase(db);

    const result = await promoteCompanyRequest(supabase, reqId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.existingOrganizationId).toBe(existingOrgId);
    expect(db.tables.organizations).toHaveLength(1); // still just the pre-existing one
    // The request itself is left untouched (still pending) — the admin must
    // explicitly choose merge, promotion never silently resolves it either way.
    const untouched = db.tables.company_requests.find((r) => r.id === reqId)!;
    expect(untouched.status).toBe("pending");
  });

  it("refuses to promote when the requested domain already belongs to an existing organization", async () => {
    const db = makeDb();
    const existingOrgId = seedOrg(db, "some-other-slug", "Totally Different Legal Name");
    db.tables.company_links.push({ organization_id: existingOrgId, normalized_domain: "acme.com" });
    const reqId = seedRequest(db, { requested_name: "Acme (New Name)", requested_domain: "https://www.acme.com/careers" });

    const result = await promoteCompanyRequest(fakeSupabase(db), reqId);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.existingOrganizationId).toBe(existingOrgId);
    expect(db.tables.organizations).toHaveLength(1);
  });

  it("the SECOND of two requests for the same company is blocked after the first promotes it (real duplicate-race scenario)", async () => {
    const db = makeDb();
    const reqA = seedRequest(db, { requested_name: "Same Company" });
    const reqB = seedRequest(db, { requested_name: "Same Company" });
    const supabase = fakeSupabase(db);

    const first = await promoteCompanyRequest(supabase, reqA);
    expect(first.ok).toBe(true);

    const second = await promoteCompanyRequest(supabase, reqB);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("unreachable");
    expect(second.existingOrganizationId).toBe((first as { organizationId: string }).organizationId);

    // The load-bearing assertion: still exactly ONE organization, not two.
    expect(db.tables.organizations).toHaveLength(1);
  });
});

describe("promoteCompanyRequest — concurrent-action race guard", () => {
  it("a request already resolved by another admin action cannot be promoted again", async () => {
    const db = makeDb();
    const reqId = seedRequest(db, { requested_name: "Race Co" });
    const supabase = fakeSupabase(db);

    // Simulate a second admin's reject having already landed between this
    // admin loading the queue and clicking Promote.
    await rejectCompanyRequest(supabase, reqId);

    const result = await promoteCompanyRequest(supabase, reqId);
    expect(result.ok).toBe(false);
    expect(db.tables.organizations).toHaveLength(0);
  });
});

describe("mergeCompanyRequest — creates zero organizations", () => {
  it("links the request to an existing organization and creates nothing", async () => {
    const db = makeDb();
    const existingOrgId = seedOrg(db, "razorpay", "Razorpay");
    const reqId = seedRequest(db, { requested_name: "Razorpay Software Pvt Ltd" }); // a near-miss name
    const supabase = fakeSupabase(db);

    const result = await mergeCompanyRequest(supabase, reqId, existingOrgId);

    expect(result.ok).toBe(true);
    expect(db.tables.organizations).toHaveLength(1); // unchanged — no second org

    const updated = db.tables.company_requests.find((r) => r.id === reqId)!;
    expect(updated.status).toBe("merged");
    expect(updated.resolved_organization_id).toBe(existingOrgId);
    expect(updated.reviewed_at).not.toBeNull();
  });

  it("refuses to merge into an organization id that does not exist", async () => {
    const db = makeDb();
    const reqId = seedRequest(db);
    const result = await mergeCompanyRequest(fakeSupabase(db), reqId, "nonexistent-org-id");
    expect(result.ok).toBe(false);
    expect(db.tables.organizations).toHaveLength(0);
    const untouched = db.tables.company_requests.find((r) => r.id === reqId)!;
    expect(untouched.status).toBe("pending");
  });

  it("refuses to merge an already-resolved request", async () => {
    const db = makeDb();
    const orgId = seedOrg(db, "acme-corp", "Acme Corp");
    const reqId = seedRequest(db, { status: "merged", resolved_organization_id: orgId });
    const result = await mergeCompanyRequest(fakeSupabase(db), reqId, orgId);
    expect(result.ok).toBe(false);
  });
});

describe("rejectCompanyRequest", () => {
  it("sets status rejected and reviewed_at, touches no organization", async () => {
    const db = makeDb();
    const reqId = seedRequest(db);
    const result = await rejectCompanyRequest(fakeSupabase(db), reqId);
    expect(result.ok).toBe(true);
    expect(db.tables.organizations).toHaveLength(0);
    const updated = db.tables.company_requests.find((r) => r.id === reqId)!;
    expect(updated.status).toBe("rejected");
    expect(updated.reviewed_at).not.toBeNull();
    expect(updated.resolved_organization_id).toBeNull();
  });

  it("refuses to reject a request that is no longer pending", async () => {
    const db = makeDb();
    const reqId = seedRequest(db, { status: "approved" });
    const result = await rejectCompanyRequest(fakeSupabase(db), reqId);
    expect(result.ok).toBe(false);
  });
});
