/**
 * Live presence migration (0036) — structural parity tests, mirroring the
 * established convention in tests/db-hiring-submissions-immutability.test.ts
 * and tests/account-evidence-disjointness.test.ts (local Docker Supabase is
 * unavailable in this environment, so these assert the migration file
 * actually defines what the design intends, rather than executing SQL).
 *
 * Covers: privacy invariants (no PII/identity column, no evidence-table
 * reference), concurrent-heartbeat atomicity (ON CONFLICT, the same
 * mechanism rate_limit_increment already uses under identical concurrency
 * pressure), RLS/no-policy (service-role only), and the active-window /
 * cleanup-window shape.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATION = readFileSync(
  path.join(process.cwd(), "supabase/migrations/0036_live_presence.sql"),
  "utf8"
);

function executableSql(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      return at === -1 ? line : line.slice(0, at);
    })
    .join("\n")
    .toLowerCase();
}

const SQL = executableSql(MIGRATION);

describe("privacy invariants (Task: 'privacy invariants')", () => {
  // Same forbidden-identity-column list as
  // tests/account-evidence-disjointness.test.ts, plus presence-specific PII
  // this feature must never collect per its own stated requirements.
  const FORBIDDEN = [
    "user_id", "candidate_id", "candidate_hash", "email", "ip_address",
    "device_id", "user_agent", "geo", "latitude", "longitude",
  ];

  it.each(FORBIDDEN)("does not add a %s column", (term) => {
    expect(SQL.includes(term), `0036 mentions "${term}" — presence must carry no PII/identity`).toBe(false);
  });

  it("references no evidence table — presence is structurally disjoint from the truth layer", () => {
    for (const table of ["hiring_submissions", "submission_ratings", "submission_emotions", "submission_culture_themes", "external_reports"]) {
      expect(SQL.includes(table), `0036 references ${table} — presence must never touch evidence`).toBe(false);
    }
  });

  it("references no candidate-identity table — disjoint from the anonymous candidate graph too", () => {
    for (const table of ["candidate_profiles", "candidate_preferences", "candidate_saved_companies"]) {
      expect(SQL.includes(table)).toBe(false);
    }
  });

  it("the only foreign key is to organizations — an employer, never a person", () => {
    expect(SQL).toMatch(/organization_id\s+uuid references organizations\(id\)/);
  });
});

describe("RLS — service-role only, mirroring rate_limit_counters/candidate_preferences", () => {
  it("enables RLS on presence_sessions", () => {
    expect(SQL).toContain("alter table presence_sessions enable row level security");
  });

  it("defines no anon/authenticated policy — nothing here is a public read/write surface", () => {
    expect(SQL).not.toMatch(/create policy/);
  });
});

describe("concurrent-heartbeat atomicity (Task: 'concurrent heartbeats')", () => {
  it("presence_heartbeat is a single atomic upsert (ON CONFLICT), same mechanism as rate_limit_increment", () => {
    const fnStart = SQL.indexOf("function presence_heartbeat");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = SQL.slice(fnStart, SQL.indexOf("$$;", fnStart));
    expect(fnBody).toMatch(/insert into presence_sessions/);
    expect(fnBody).toMatch(/on conflict \(session_id\) do update/);
  });

  it("session_id is the primary key — the conflict target that serializes concurrent writes for the same session", () => {
    expect(SQL).toMatch(/session_id\s+uuid primary key/);
  });
});

describe("counting (Task: 'global counting', 'company-specific counting', 'expiration')", () => {
  it("presence_counts filters by a time window, not the whole table", () => {
    const fnStart = SQL.indexOf("function presence_counts");
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = SQL.slice(fnStart, SQL.indexOf("$$;", fnStart));
    expect(fnBody).toMatch(/last_seen_at > now\(\) - make_interval/);
    // Two independent counts in one call: global (no organization filter)
    // and company (filtered), proven by two separate count(*) subqueries.
    expect((fnBody.match(/count\(\*\)/g) ?? []).length).toBe(2);
    expect(fnBody).toMatch(/organization_id = p_organization_id/);
  });

  it("defaults the active window to 120 seconds (~2 minutes, matching the stated 'active' definition)", () => {
    expect(SQL).toMatch(/p_window_seconds integer default 120/);
  });
});

describe("stale-session cleanup (Task: 'stale-session cleanup')", () => {
  it("has an index on last_seen_at so a cleanup DELETE and the count queries are both cheap", () => {
    expect(SQL).toMatch(/create index if not exists presence_sessions_last_seen_idx\s+on presence_sessions \(last_seen_at\)/);
  });
});
