import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import { canonicalizeSlug, normalizeCompany } from "../src/lib/company-intelligence/normalize";
import { validateCompany, validateBatchCoherence } from "../src/lib/company-intelligence/validate";
import { runImport } from "../src/lib/company-intelligence/importer";
import { seedFileAdapter } from "../src/lib/company-intelligence/adapters/seed-file";
import { parseCsv } from "../src/lib/company-intelligence/csv";
import type { CompanyStore, BatchCounts } from "../src/lib/company-intelligence/store";
import type { NormalizedCompany } from "../src/lib/company-intelligence/types";

// ---------------------------------------------------------------------------
// canonicalizeSlug MUST match the SQL canonicalize_slug() in
// 0002_organizations.sql, or a record resolves to a different organization in
// TypeScript than in Postgres. We cannot run Postgres here, so we assert the
// TS output against a table of expected values that encodes the SQL semantics
// (lower → non-alnum runs to '-' → trim '-' → null if empty), and separately
// assert the migration still defines the function the way this table assumes.
// ---------------------------------------------------------------------------
describe("canonicalizeSlug ↔ SQL parity", () => {
  const cases: [string, string | null][] = [
    ["Google", "google"],
    ["Google Inc.", "google-inc"],
    ["AT&T", "at-t"],
    ["Ernst & Young", "ernst-young"],
    ["Byju's", "byju-s"],
    ["Paytm (One97)", "paytm-one97"],
    ["Amazon.com", "amazon-com"],
    ["Yahoo!", "yahoo"],
    ["Company - Name", "company-name"],
    ["  spaced  out  ", "spaced-out"],
    ["---leading-trailing---", "leading-trailing"],
    ["!!!", null],
    ["", null],
    ["Société Générale", "societe-generale"],
    ["Nestlé", "nestle"],
  ];

  it.each(cases)("canonicalizeSlug(%j) === %j", (input, expected) => {
    expect(canonicalizeSlug(input)).toBe(expected);
  });

  it("the SQL migration still defines canonicalize_slug with the semantics this table assumes", () => {
    const sql = readFileSync(join(process.cwd(), "supabase/migrations/0002_organizations.sql"), "utf8");
    // The function folds non-alphanumerics to '-' and trims leading/trailing '-'.
    expect(sql).toMatch(/regexp_replace\(lower\(coalesce\(p_slug, ''\)\), '\[\^a-z0-9\]\+', '-', 'g'\)/);
    expect(sql).toMatch(/'\(\^-\+\|-\+\$\)', '', 'g'/);
    // And the alias column must NOT carry the strict slug-format CHECK (the bug
    // the review caught) — only a length bound.
    expect(sql).not.toMatch(/organization_aliases_slug_format/);
    expect(sql).toMatch(/organization_aliases_slug_length/);
  });
});

describe("normalizeCompany", () => {
  it("normalizes a full record", () => {
    const c = normalizeCompany(
      {
        name: "Razorpay",
        aliases: ["Razorpay Software Private Limited"],
        founded_year: "2014",
        size_band: "1001-5000",
        stock_symbol: "rzp",
        website: "razorpay.com",
        github_org: "@razorpay",
        linkedin: "razorpay",
        industry: "Financial Services",
        technologies: ["Go", "React"],
        locations: [{ city: "Bengaluru", region: "Karnataka", country: "in", headquarters: true }],
        hiring_regions: ["in"],
      },
      "seed_file"
    )!;

    expect(c.slug).toBe("razorpay");
    expect(c.aliasSlugs).toEqual(["razorpay-software-private-limited"]);
    expect(c.foundedYear).toBe(2014);
    expect(c.stockSymbol).toBe("RZP");
    expect(c.links.find((l) => l.linkType === "website")?.url).toBe("https://razorpay.com/");
    expect(c.links.find((l) => l.linkType === "github")?.url).toBe("https://github.com/razorpay");
    expect(c.locations[0]).toMatchObject({ city: "Bengaluru", countryCode: "IN", isHeadquarters: true });
    expect(c.taxonomy.find((t) => t.kind === "industry")).toMatchObject({ key: "financial_services", isPrimary: true });
    expect(c.hiringRegionCodes).toEqual(["IN"]);
  });

  it("returns null when the name cannot produce a slug", () => {
    expect(normalizeCompany({ name: "!!!" }, "seed_file")).toBeNull();
    expect(normalizeCompany({ name: "   " }, "seed_file")).toBeNull();
  });

  it("truncates a description to 600 chars (no room for a review)", () => {
    const long = "x".repeat(1000);
    const c = normalizeCompany({ name: "Acme", description: long }, "seed_file")!;
    expect(c.description).toHaveLength(600);
  });
});

describe("validateCompany", () => {
  const base = (): NormalizedCompany =>
    normalizeCompany({ name: "Acme", website: "https://acme.com", description: "A thing." }, "seed_file")!;

  it("passes a clean record", () => {
    expect(validateCompany(base()).valid).toBe(true);
  });

  it("rejects an out-of-range founded year", () => {
    const c = { ...base(), foundedYear: 3200 };
    const r = validateCompany(c);
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.code === "founded_year_range")).toBe(true);
  });

  it("warns on a record with no links", () => {
    const c = { ...base(), links: [] };
    const r = validateCompany(c);
    expect(r.valid).toBe(true); // warning, not error
    expect(r.issues.some((i) => i.code === "no_links" && i.severity === "warning")).toBe(true);
  });
});

describe("validateBatchCoherence", () => {
  it("flags two records that canonicalize to the same slug", () => {
    const a = normalizeCompany({ name: "Google" }, "seed_file")!;
    const b = normalizeCompany({ name: "google" }, "seed_file")!;
    const issues = validateBatchCoherence([a, b]);
    expect(issues.get(1)?.some((i) => i.code === "duplicate_company")).toBe(true);
  });
});

describe("seedFileAdapter", () => {
  it("parses JSON", async () => {
    const records = await seedFileAdapter.load({
      content: JSON.stringify([{ name: "A" }, { name: "B" }]),
      format: "json",
    });
    expect(records.map((r) => r.name)).toEqual(["A", "B"]);
  });

  it("parses CSV with quoted fields containing commas", () => {
    const rows = parseCsv('name,description\nAcme,"Payments, and more"\n');
    expect(rows[0]).toEqual({ name: "Acme", description: "Payments, and more" });
  });

  it("parses the shipped example files", async () => {
    const json = readFileSync(join(process.cwd(), "data/companies/example.json"), "utf8");
    const csv = readFileSync(join(process.cwd(), "data/companies/example.csv"), "utf8");
    const fromJson = await seedFileAdapter.load({ content: json, format: "json" });
    const fromCsv = await seedFileAdapter.load({ content: csv, format: "csv" });
    expect(fromJson.length).toBe(2);
    expect(fromCsv.length).toBe(2);
    expect(fromJson[0].name).toBe("Razorpay");
    expect(fromCsv[0].name).toBe("Razorpay");
  });
});

// ---------------------------------------------------------------------------
// In-memory CompanyStore fake — lets the importer be exercised end-to-end with
// no database, and lets us assert idempotency directly.
// ---------------------------------------------------------------------------
function createFakeStore() {
  const orgs = new Map<string, { id: string; displayName: string }>(); // slug -> org
  const aliases = new Map<string, string>(); // alias -> orgId
  const profiles = new Map<string, unknown>();
  const completedBatches = new Set<string>();
  let seq = 0;
  const id = (p: string) => `${p}-${++seq}`;

  const calls = { createOrg: 0, upsertProfile: 0, upsertLink: 0, addAlias: 0 };

  const store: CompanyStore = {
    async getSource(key) {
      return { id: "src-1", key, permitsRedistribution: true, trustTier: 1 };
    },
    async findCompletedBatch(_s, _a, hash) {
      return completedBatches.has(hash) ? "batch-existing" : null;
    },
    async createBatch(_s, _a, hash) {
      return id(`batch-${hash.slice(0, 6)}`);
    },
    async finishBatch(batchId, status) {
      if (status === "completed") completedBatches.add(lastHash);
      void batchId;
    },
    async resolveOrganization(slug) {
      return orgs.get(slug)?.id ?? aliases.get(slug) ?? null;
    },
    async createOrganization(slug, displayName) {
      calls.createOrg++;
      const orgId = id("org");
      orgs.set(slug, { id: orgId, displayName });
      return orgId;
    },
    async addAlias(alias, orgId) {
      calls.addAlias++;
      aliases.set(alias, orgId);
    },
    async upsertProfile(input) {
      calls.upsertProfile++;
      const existed = profiles.has(input.organizationId);
      profiles.set(input.organizationId, input);
      return existed ? "updated" : "created";
    },
    async upsertLink() {
      calls.upsertLink++;
    },
    async ensureCity() {
      return id("city");
    },
    async upsertLocation() {},
    async ensureTerm() {
      return id("term");
    },
    async upsertCompanyTaxonomy() {},
    async upsertHiringRegion() {},
    async upsertFieldObservation() {},
  };

  // capture the hash finishBatch should mark complete — runImport calls
  // createBatch(hash) then finishBatch(batchId); we stash the hash via a proxy.
  let lastHash = "";
  const origCreate = store.createBatch;
  store.createBatch = async (s, a, hash, count) => {
    lastHash = hash;
    return origCreate(s, a, hash, count);
  };

  return { store, orgs, calls, completedBatches };
}

describe("runImport", () => {
  const input = {
    content: JSON.stringify([
      { name: "Razorpay", website: "https://razorpay.com", description: "Payments." },
      { name: "Zerodha", website: "https://zerodha.com", description: "Broking." },
    ]),
    format: "json" as const,
  };

  it("creates organizations and profiles on first run", async () => {
    const { store, calls } = createFakeStore();
    const report = await runImport({ store, adapter: seedFileAdapter, input, sourceKey: "manual" });
    expect(report.created).toBe(2);
    expect(report.updated).toBe(0);
    expect(report.invalid).toBe(0);
    expect(calls.createOrg).toBe(2);
  });

  it("is idempotent — an identical second run is a no-op", async () => {
    const { store } = createFakeStore();
    await runImport({ store, adapter: seedFileAdapter, input, sourceKey: "manual" });
    const second = await runImport({ store, adapter: seedFileAdapter, input, sourceKey: "manual" });
    expect(second.alreadyImported).toBe(true);
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
  });

  it("dry run writes nothing", async () => {
    const { store, calls } = createFakeStore();
    const report = await runImport({ store, adapter: seedFileAdapter, input, sourceKey: "manual", dryRun: true });
    expect(report.batchId).toBeNull();
    expect(calls.createOrg).toBe(0);
    expect(calls.upsertProfile).toBe(0);
  });

  it("refuses an adapter that may not redistribute", async () => {
    const { store } = createFakeStore();
    const blocked = { ...seedFileAdapter, permitsRedistribution: false };
    await expect(
      runImport({ store, adapter: blocked, input, sourceKey: "manual" })
    ).rejects.toThrow(/permitsRedistribution/);
  });
});
