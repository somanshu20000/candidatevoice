/**
 * The orchestrator (src/lib/external-intel/orchestrator.ts) — the real
 * vertical slice: company search -> detect unknown/sparse -> source
 * eligibility -> acquire -> extract -> validate/dedupe (runExternalImport,
 * UNCHANGED) -> moderation queue, with every stage transition persisted to
 * external_acquisition_runs.
 *
 * Mocks the company-resolution layer (search/company_requests — already
 * covered by tests/company-requests.test.ts) and uses a REAL in-memory
 * ExternalReportStore (mirroring tests/external-import.test.ts's own
 * pattern) so runExternalImport's real validate/dedupe logic runs
 * unmodified. Only the raw Supabase calls orchestrator.ts makes directly
 * (external_acquisition_runs, external_sources eligibility) are faked here.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { RawExternalReport } from "../src/lib/hiring-intel/types";
import type { AcquisitionAdapter } from "../src/lib/hiring-intel/types";

vi.mock("@/lib/company-intelligence/resolve", () => ({
  searchOrganizationsRanked: vi.fn(),
  confidenceTier: (score: number) => (score >= 0.85 ? "confident" : score >= 0.4 ? "possible" : "none"),
  createCompanyRequest: vi.fn(),
}));
vi.mock("@/lib/company-intelligence/requests", () => ({
  findOrganizationByDomain: vi.fn(async () => null),
}));

import { searchOrganizationsRanked, createCompanyRequest } from "@/lib/company-intelligence/resolve";
import { runAcquisition, ADAPTERS } from "@/lib/external-intel/orchestrator";

// Messy display_name on purpose — mirrors the REAL QA organization's own
// display_name ("(QA TEST — M5.4 pipeline verification, safe to ignore)"),
// which is exactly what surfaced the company-field/slug bug this file's
// "round-trips through the org's own slug" test guards against.
const KNOWN_ORG = {
  organizationId: "org-razorpay",
  displayName: "(Razorpay — real name, safe to ignore, punctuation.)",
  slug: "razorpay",
  score: 1.0,
  matchReason: "exact_slug",
  website: null,
  logoUrl: "",
};

interface FakeRow {
  [key: string]: unknown;
}

/** Minimal in-memory Supabase fake covering exactly the tables orchestrator.ts
 *  and hiring-intel/store.ts touch directly. */
function fakeSupabase(opts: {
  sourceEligible: boolean | "missing";
  existingReports?: FakeRow[];
}) {
  const runs: FakeRow[] = [];
  const externalReports: FakeRow[] = opts.existingReports ? [...opts.existingReports] : [];
  let runCounter = 0;

  const client = {
    from(table: string) {
      if (table === "external_acquisition_runs") {
        return {
          insert(row: FakeRow) {
            const id = `run-${++runCounter}`;
            runs.push({ id, ...row });
            return {
              select() {
                return { single: async () => ({ data: { id }, error: null }) };
              },
            };
          },
          update(fields: FakeRow) {
            return {
              eq: (_col: string, id: string) => {
                const row = runs.find((r) => r.id === id);
                if (row) Object.assign(row, fields);
                return Promise.resolve({ error: null });
              },
            };
          },
        };
      }
      if (table === "external_sources") {
        return {
          select() {
            return {
              eq: (_col: string, key: string) => ({
                maybeSingle: async () => {
                  if (opts.sourceEligible === "missing") return { data: null, error: null };
                  return { data: { id: `src-${key}`, key, enabled: false, acquisition_enabled: opts.sourceEligible }, error: null };
                },
              }),
            };
          },
        };
      }
      if (table === "external_reports") {
        return {
          select() {
            return {
              eq(colA: string, valA: unknown) {
                return {
                  eq: (colB: string, valB: unknown) => ({
                    limit: () => ({
                      then: undefined,
                      // emulate the two-step .eq().eq().limit() chain used by store.ts's exists()
                      data: externalReports.filter((r) => r[colA] === valA && r[colB] === valB),
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
          insert: async (row: FakeRow) => {
            externalReports.push({ id: `report-${externalReports.length + 1}`, ...row });
            return { error: null };
          },
        };
      }
      throw new Error(`fakeSupabase: unhandled table "${table}"`);
    },
    // Slug-aware: resolves "razorpay" back to org-razorpay, exactly like the
    // real resolve_organization() RPC resolves an org's own exact slug —
    // this is what makes the round-trip regression test below meaningful.
    rpc: async (fn: string, args: { p_slug?: string }) => {
      if (fn === "resolve_organization" && args?.p_slug === "razorpay") {
        return { data: "org-razorpay", error: null };
      }
      return { data: null, error: null };
    },
  };

  return { client, runs, externalReports };
}

const demoRecord: RawExternalReport = {
  company: "Razorpay",
  source_url: "https://example.com/demo/razorpay",
  external_ref: "demo-razorpay-1",
  stage: "technical",
  outcome: "rejected",
  reported_month: "2026-06",
  extraction_version: "demo-v1",
  extraction_confidence: 1,
};

const fakeAdapter: AcquisitionAdapter = {
  key: "fake",
  displayName: "Fake",
  load: vi.fn(async () => [demoRecord]),
};

beforeEach(() => {
  vi.clearAllMocks();
  ADAPTERS.fake = fakeAdapter;
});

describe("runAcquisition — unknown company", () => {
  it("queues a company_request instead of acquiring blind, never invents an organization", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (createCompanyRequest as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

    const { client } = fakeSupabase({ sourceEligible: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Totally Unknown Co", sourceKey: "fake" });

    expect(result.organizationId).toBeNull();
    expect(result.companyRequestCreated).toBe(true);
    expect(result.status).toBe("completed");
    expect(fakeAdapter.load).not.toHaveBeenCalled(); // never acquires for an unresolved company
    expect(createCompanyRequest).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ requestedName: "Totally Unknown Co" })
    );
  });
});

describe("runAcquisition — source eligibility gate", () => {
  it("refuses when the source is not registered at all", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    const { client } = fakeSupabase({ sourceEligible: "missing" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/not registered/);
    expect(fakeAdapter.load).not.toHaveBeenCalled();
  });

  it("refuses when acquisition_enabled=false — the Q-2 gate, never silently bypassed", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    const { client } = fakeSupabase({ sourceEligible: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/acquisition_enabled=false/);
    expect(fakeAdapter.load).not.toHaveBeenCalled();
  });
});

describe("runAcquisition — adapter failure handling", () => {
  it("reports a thrown adapter error as status=failed, never crashes the caller", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    ADAPTERS.fake = { key: "fake", displayName: "Fake", load: vi.fn(async () => { throw new Error("network down"); }) };
    const { client } = fakeSupabase({ sourceEligible: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });
    expect(result.status).toBe("failed");
    expect(result.errorMessage).toMatch(/network down/);
  });

  it("reports status=completed with zero records when the adapter finds nothing", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    ADAPTERS.fake = { key: "fake", displayName: "Fake", load: vi.fn(async () => []) };
    const { client } = fakeSupabase({ sourceEligible: true });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });
    expect(result.status).toBe("completed");
    expect(result.recordsFound).toBe(0);
  });
});

describe("runAcquisition — end to end, known company with sparse evidence", () => {
  it("acquires, extracts, validates, and lands the record awaiting moderation — never public", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    ADAPTERS.fake = fakeAdapter;
    const { client, externalReports, runs } = fakeSupabase({ sourceEligible: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });

    expect(result.status).toBe("awaiting_moderation");
    expect(result.recordsCreated).toBe(1);
    expect(result.organizationId).toBe("org-razorpay");

    // Real content_hash/source_url/external_ref/provenance made it into the store.
    expect(externalReports).toHaveLength(1);
    expect(externalReports[0].source_url).toBe(demoRecord.source_url);
    expect(externalReports[0].external_ref).toBe(demoRecord.external_ref);
    expect(externalReports[0].content_hash).toMatch(/^[a-f0-9]{64}$/);

    // REGRESSION (found via live acceptance testing against production):
    // the adapter searched using the org's messy display_name, but the
    // inserted row's `company` must be rewritten to the org's own SLUG so
    // hiring-intel's internal re-resolution actually lands on the SAME
    // organization — not silently null. This is the one assertion that
    // would have caught the bug before it ever reached production.
    expect(externalReports[0].company).toBe("razorpay");
    expect(externalReports[0].organization_id).toBe("org-razorpay");
    // verification_status is never set by the caller — it defaults to pending
    // at the DB level (migration 0008); the insert payload deliberately omits it.
    expect(externalReports[0]).not.toHaveProperty("verification_status");

    // The run row reflects the full stage trail.
    expect(runs[0].status).toBe("awaiting_moderation");
    expect(runs[0].records_created).toBe(1);
  });

  it("second run of the same input is idempotent — reports duplicate, inserts nothing new", async () => {
    (searchOrganizationsRanked as ReturnType<typeof vi.fn>).mockResolvedValue([KNOWN_ORG]);
    ADAPTERS.fake = fakeAdapter;
    const { client, externalReports } = fakeSupabase({ sourceEligible: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const first = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const second = await runAcquisition({ supabase: client as any, companyQuery: "Razorpay", sourceKey: "fake" });

    expect(first.recordsCreated).toBe(1);
    expect(second.recordsCreated).toBe(0);
    expect(second.recordsDuplicate).toBe(1);
    expect(second.status).toBe("completed");
    expect(externalReports).toHaveLength(1); // no duplicate row
  });
});
