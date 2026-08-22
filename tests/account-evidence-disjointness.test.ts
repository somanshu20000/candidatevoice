/**
 * Structural guarantee: the account graph and the evidence graph never touch.
 *
 * docs/adr-0001-evidence-model.md §4.3:
 *   "candidate_id / candidate hash / pseudonym — even a hash is a linkage key
 *    that correlates one person's reports = de-anonymization. Never."
 *
 * .github/pull_request_template.md blocks merge on:
 *   "No de-anonymization features added (no user identity linkable to
 *    submissions)"
 *
 * That is currently enforced by a human ticking a checkbox. This test enforces
 * it mechanically: adding a `user_id` to hiring_submissions, or a foreign key
 * from wishlist_items to a submission, fails the suite. The failure message is
 * the argument for why it should not be merged.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const MIGRATIONS_DIR = path.join(process.cwd(), "supabase/migrations");

/**
 * Strip `--` line comments. The migrations discuss the evidence tables at
 * length in their comments — that prose is documentation, not a reference, and
 * must not trip the check.
 */
function executableSql(filename: string): string {
  const raw = readFileSync(path.join(MIGRATIONS_DIR, filename), "utf8");
  return raw
    .split("\n")
    .map((line) => {
      const commentAt = line.indexOf("--");
      return commentAt === -1 ? line : line.slice(0, commentAt);
    })
    .join("\n")
    .toLowerCase()
    // Collapse runs of horizontal whitespace. Several statements are
    // column-aligned for readability ("alter table profiles      enable ..."),
    // which would otherwise defeat exact-substring assertions.
    .replace(/[ \t]+/g, " ");
}

function allMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

const EVIDENCE_TABLES = [
  "hiring_submissions",
  "submission_ratings",
  "submission_emotions",
  "submission_culture_themes",
];

const ACCOUNT_TABLES = ["profiles", "wishlist_items", "saved_comparisons"];

const ACCOUNT_MIGRATION = "0004_accounts_and_wishlist.sql";

const CANDIDATE_TABLES = ["candidate_profiles", "candidate_preferences"];

const CANDIDATE_MIGRATION = "0015_candidate_intelligence.sql";

const SAVED_COMPANIES_TABLES = ["candidate_saved_companies"];

const SAVED_COMPANIES_MIGRATION = "0034_candidate_saved_companies.sql";

/**
 * Migrations that legitimately carry an identity column (an account's
 * `user_id`, a candidate's `candidate_id`) yet must remain structurally
 * disjoint from evidence. Each is exempted from the blanket identity-column
 * scan below AND positively asserted here to reference no evidence table —
 * the same guarantee, split across two checks (see 0004 / 0015 / 0034 headers).
 */
const IDENTITY_MIGRATIONS = [ACCOUNT_MIGRATION, CANDIDATE_MIGRATION, SAVED_COMPANIES_MIGRATION];

describe("account migration never references evidence", () => {
  const sql = executableSql(ACCOUNT_MIGRATION);

  it.each(EVIDENCE_TABLES)(
    "does not reference %s in executable SQL",
    (table) => {
      expect(
        sql.includes(table),
        `${ACCOUNT_MIGRATION} references ${table}. Any path from an account to a ` +
          `submission is a linkage key and de-anonymizes the contributor.`
      ).toBe(false);
    }
  );

  it("declares its own tables", () => {
    for (const table of ACCOUNT_TABLES) {
      expect(sql).toContain(table);
    }
  });
});

describe("candidate intelligence migration never references evidence", () => {
  // The candidate preference vector stores priorities, never reports. It has an
  // opaque candidate_id (internal to the candidate graph) but MUST have no path
  // to a submission — otherwise setting preferences from the same browser that
  // filed an anonymous report would de-anonymize it. This is the DB half of the
  // guarantee; the FK check lives in the live-verification, but the parse check
  // fails CI the moment 0015 so much as names an evidence table.
  const sql = executableSql(CANDIDATE_MIGRATION);

  it.each(EVIDENCE_TABLES)(
    "does not reference %s in executable SQL",
    (table) => {
      expect(
        sql.includes(table),
        `${CANDIDATE_MIGRATION} references ${table}. A candidate profile must ` +
          `never be joinable to a hiring report — that link is the whole thing ` +
          `docs/adr-0001 §4.3 forbids.`
      ).toBe(false);
    }
  );

  it("does not reference auth.users — the candidate identity is anonymous, not an account", () => {
    expect(
      sql.includes("auth.users"),
      `${CANDIDATE_MIGRATION} references auth.users. The candidate layer is ` +
        `cookie-anonymous by design; tying it to an auth account would give it ` +
        `an identity the evidence layer must never be able to correlate.`
    ).toBe(false);
  });

  it("declares its own tables", () => {
    for (const table of CANDIDATE_TABLES) {
      expect(sql).toContain(table);
    }
  });

  it("enables RLS on every candidate table with no policy (service-role only)", () => {
    for (const table of CANDIDATE_TABLES) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
    }
    // No candidate row is reachable by anon/authenticated: access is mediated
    // entirely by API routes holding the opaque cookie id.
    const candidatePolicies = sql.match(/create policy/g) ?? [];
    expect(candidatePolicies).toHaveLength(0);
  });
});

describe("saved companies migration never references evidence (Phase 2, product-experience audit)", () => {
  // candidate_saved_companies references candidate_profiles(id) — internal to
  // the candidate graph, exactly like candidate_preferences.candidate_id —
  // and organizations(id), the one value the candidate/account/evidence
  // graphs are all allowed to share (an employer, never a person; see 0004's
  // own header for the precedent). It must reference NOTHING evidence-shaped.
  const sql = executableSql(SAVED_COMPANIES_MIGRATION);

  it.each(EVIDENCE_TABLES)(
    "does not reference %s in executable SQL",
    (table) => {
      expect(
        sql.includes(table),
        `${SAVED_COMPANIES_MIGRATION} references ${table}. A saved-company row must ` +
          `never be joinable to a hiring report — that link is the whole thing ` +
          `docs/adr-0001 §4.3 forbids.`
      ).toBe(false);
    }
  );

  it("does not reference auth.users — built on the anonymous candidate identity, not an account", () => {
    expect(
      sql.includes("auth.users"),
      `${SAVED_COMPANIES_MIGRATION} references auth.users. Saved companies deliberately ` +
        `extend the anonymous candidate_profiles identity (0015), not the dormant, ` +
        `auth.users-based wishlist_items (0004) — resurrecting that would mean ` +
        `building real login, a different product decision.`
    ).toBe(false);
  });

  it("references candidate_profiles — the same identity candidate_preferences uses", () => {
    expect(sql).toContain("references candidate_profiles(id)");
  });

  it("declares its own table", () => {
    for (const table of SAVED_COMPANIES_TABLES) {
      expect(sql).toContain(table);
    }
  });

  it("enables RLS with no policy (service-role only), mirroring candidate_preferences exactly", () => {
    for (const table of SAVED_COMPANIES_TABLES) {
      expect(sql).toContain(`alter table ${table} enable row level security`);
    }
    const policies = sql.match(/create policy/g) ?? [];
    expect(policies).toHaveLength(0);
  });
});

describe("evidence never carries an identity column", () => {
  // Column names that would correlate reports back to a person, whether
  // directly or via a hash. Checked across every migration so a later one
  // cannot quietly reintroduce what an earlier one refused.
  const FORBIDDEN_IDENTITY_COLUMNS = [
    "user_id",
    "candidate_id",
    "candidate_hash",
    "submitter_id",
    "submitter_hash",
    "author_id",
    "device_id",
    "session_id",
    "ip_address",
    "email",
  ];

  // Exempt the identity-bearing migrations: they legitimately contain user_id /
  // candidate_id ON THEIR OWN tables. Their disjointness from evidence is
  // guaranteed instead by the "never references evidence" blocks above — a
  // strictly stronger check than substring-scanning for column names.
  const evidenceMigrations = allMigrationFiles().filter(
    (f) => !IDENTITY_MIGRATIONS.includes(f)
  );

  it.each(evidenceMigrations)("%s adds no identity column", (file) => {
    const sql = executableSql(file);
    for (const column of FORBIDDEN_IDENTITY_COLUMNS) {
      expect(
        sql.includes(column),
        `${file} mentions "${column}". Evidence must carry nothing that ` +
          `identifies or correlates a contributor (ADR INV-1).`
      ).toBe(false);
    }
  });

  it("keeps auth entirely out of the evidence migrations", () => {
    for (const file of evidenceMigrations) {
      expect(
        executableSql(file).includes("auth.users"),
        `${file} references auth.users — evidence must not know about accounts.`
      ).toBe(false);
    }
  });
});

describe("account tables are private by construction", () => {
  const sql = executableSql(ACCOUNT_MIGRATION);

  it.each(ACCOUNT_TABLES)("enables row level security on %s", (table) => {
    expect(sql).toContain(`alter table ${table} enable row level security`);
  });

  it("scopes every account policy to the owner", () => {
    // Both clauses are required: `using` alone governs reads but would still
    // permit inserting a row owned by another user.
    const policyCount = (sql.match(/create policy/g) ?? []).length;
    const usingCount = (sql.match(/using \(user_id = auth\.uid\(\)\)/g) ?? []).length;
    const withCheckCount = (
      sql.match(/with check \(user_id = auth\.uid\(\)\)/g) ?? []
    ).length;

    expect(policyCount).toBe(ACCOUNT_TABLES.length);
    expect(usingCount).toBe(ACCOUNT_TABLES.length);
    expect(withCheckCount).toBe(ACCOUNT_TABLES.length);
  });

  it("grants anon no policy on any account table", () => {
    // With RLS on and no permissive policy, signed-out visitors cannot read
    // these tables at all — privacy by absence of a grant, not by filtering.
    const anonPolicies = sql.match(/create policy[\s\S]*?to anon/g) ?? [];
    expect(anonPolicies).toHaveLength(0);
  });
});

describe("M5.2a — verification_grants (INV-V) is structurally disjoint from evidence", () => {
  // See the M5.2 architecture decision §7 (INV-V): no verification artifact —
  // address, domain, OTP, document, IP, token, or nonce — may be stored on,
  // foreign-keyed to, or joinable with an evidence row. verification_grants
  // is deliberately content-free: sha256(nonce) + expires_at, nothing else.
  // The organization/tier binding lives only inside the signed grant TOKEN
  // (src/lib/verification/token.ts), never in this table.
  const VERIFICATION_MIGRATION = "0027_submission_verification.sql";
  const sql = executableSql(VERIFICATION_MIGRATION);

  function tableBody(name: string): string {
    const start = sql.indexOf(`create table if not exists ${name} (`);
    expect(start, `${name} table declaration not found in ${VERIFICATION_MIGRATION}`).toBeGreaterThan(-1);
    const end = sql.indexOf(");", start);
    return sql.slice(start, end);
  }

  it.each(EVIDENCE_TABLES)("verification_grants declaration does not reference %s", (table) => {
    const body = tableBody("verification_grants");
    expect(
      body.includes(table),
      `verification_grants references ${table} — this would be a linkage path from a verification artifact into evidence.`
    ).toBe(false);
  });

  it("verification_grants contains no identity or linkage columns", () => {
    const body = tableBody("verification_grants");
    const FORBIDDEN = ["email", "phone", "organization_id", "submission_id", "nonce", "address", "domain", "user_id", "ip_address"];
    for (const column of FORBIDDEN) {
      expect(
        body.includes(column),
        `verification_grants declaration mentions "${column}" — INV-V requires this table to hold only grant_hash + expires_at.`
      ).toBe(false);
    }
  });

  it("verification_grants declares exactly grant_hash and expires_at", () => {
    const body = tableBody("verification_grants");
    expect(body).toContain("grant_hash");
    expect(body).toContain("expires_at");
    // Count declared columns via comma-separated lines inside the parens —
    // a coarse but effective guard against a silently-added third column.
    const columnLines = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("create table"));
    expect(columnLines.length).toBeLessThanOrEqual(2);
  });

  it("verification_grants has RLS enabled and zero policies (service-role only)", () => {
    expect(sql).toContain("alter table verification_grants enable row level security");
    const policyBlocks = sql.match(/create policy[^;]*verification_grants/g) ?? [];
    expect(policyBlocks).toHaveLength(0);
  });

  it("the hiring_submissions verification_tier column stores only a coarse enum, never a raw identity value", () => {
    expect(sql).toMatch(/verification_tier text not null default 'unverified'/);
    expect(sql).toMatch(
      /check \(verification_tier in \('unverified', 'inbox_verified', 'contact_domain', 'attested'\)\)/
    );
  });
});

describe("public read surface is coarsened", () => {
  it("exposes reported_month and never created_at", () => {
    const sql = executableSql("0003_fingerprint_model.sql");
    const viewStart = sql.indexOf("create view public_submissions");
    expect(viewStart).toBeGreaterThan(-1);

    const viewBody = sql.slice(viewStart, sql.indexOf("grant select", viewStart));

    expect(viewBody).toContain("reported_month");
    // created_at may appear inside the date_trunc that produces the month, but
    // must never be projected as a bare selected column.
    expect(/^\s*s\.created_at\s*,?\s*$/m.test(viewBody)).toBe(false);
  });
});
