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
];

const ACCOUNT_TABLES = ["profiles", "wishlist_items", "saved_comparisons"];

const ACCOUNT_MIGRATION = "0004_accounts_and_wishlist.sql";

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

  const evidenceMigrations = allMigrationFiles().filter(
    (f) => f !== ACCOUNT_MIGRATION
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
