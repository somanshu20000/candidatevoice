/**
 * M5.6 / V1.1 — migration 0029 closes the hiring-opportunity n=1 timing leak
 * (DECISIONS.md D-016, open question Q-5). Structural-parity tests against
 * the migration text, matching the established convention (local Docker
 * Supabase is unavailable in this environment — see
 * tests/db-hiring-submissions-immutability.test.ts's own header).
 *
 * What this proves: anon/authenticated can no longer SELECT the exact
 * timestamp columns directly off hiring_opportunities/hiring_events (column-
 * level GRANT, not just a view — RLS alone cannot hide a column), and the
 * public view exposes only month-coarsened values, mirroring
 * public_submissions.reported_month exactly.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const SQL = readFileSync(
  join(process.cwd(), "supabase/migrations/0029_hiring_opportunity_timing_leak.sql"),
  "utf8"
);

function executableSql(raw: string): string {
  return raw
    .split("\n")
    .map((line) => {
      const commentAt = line.indexOf("--");
      return commentAt === -1 ? line : line.slice(0, commentAt);
    })
    .join("\n")
    .toLowerCase()
    .replace(/[ \t]+/g, " ");
}

const EXEC = executableSql(SQL);

describe("0029 — column-level lockdown on hiring_opportunities", () => {
  it("revokes blanket SELECT from anon/authenticated", () => {
    expect(EXEC).toMatch(/revoke select on hiring_opportunities from anon, authenticated/);
  });

  it("grants back only the three columns that were never sensitive", () => {
    expect(EXEC).toMatch(
      /grant select \(id, organization_id, role_key\) on hiring_opportunities to anon, authenticated/
    );
  });

  it("never grants anon/authenticated column access to the exact-timestamp columns", () => {
    // A grant statement naming these columns explicitly would defeat the fix.
    const grantMatches = EXEC.match(/grant select \([^)]*\) on hiring_opportunities to anon, authenticated;/g) ?? [];
    for (const grant of grantMatches) {
      for (const col of ["first_observed_at", "last_activity_at", "observation_deadline_at", "created_at"]) {
        expect(grant.includes(col), `${grant} unexpectedly grants "${col}" to anon/authenticated`).toBe(false);
      }
    }
  });
});

describe("0029 — column-level lockdown on hiring_events", () => {
  it("revokes blanket SELECT from anon/authenticated", () => {
    expect(EXEC).toMatch(/revoke select on hiring_events from anon, authenticated/);
  });

  it("grants back only the non-identity, non-timestamp columns", () => {
    expect(EXEC).toMatch(
      /grant select \(id, hiring_opportunity_id, actor_type, event_type, payload, reported_month\)\s*\n?\s*on hiring_events to anon, authenticated/
    );
  });

  it("never grants anon/authenticated column access to submission_id or created_at", () => {
    const grantMatches = EXEC.match(/grant select \([^)]*\)\s*\n?\s*on hiring_events to anon, authenticated;/g) ?? [];
    for (const grant of grantMatches) {
      for (const col of ["submission_id", "created_at"]) {
        expect(grant.includes(col), `${grant} unexpectedly grants "${col}" to anon/authenticated`).toBe(false);
      }
    }
  });
});

describe("0029 — public_hiring_opportunities is coarsened, not exact", () => {
  function viewBody(): string {
    const start = EXEC.indexOf("create view public_hiring_opportunities");
    expect(start, "public_hiring_opportunities view not found").toBeGreaterThan(-1);
    const end = EXEC.indexOf("grant select on public_hiring_opportunities", start);
    return EXEC.slice(start, end);
  }

  it("projects first_observed_month / last_activity_month, not raw timestamps", () => {
    const body = viewBody();
    expect(body).toContain("first_observed_month");
    expect(body).toContain("last_activity_month");
    expect(body).toMatch(/to_char\(date_trunc\('month', first_observed_at/);
    expect(body).toMatch(/to_char\(date_trunc\('month', last_activity_at/);
  });

  it("never projects a bare first_observed_at / last_activity_at column (only inside date_trunc)", () => {
    const body = viewBody();
    expect(/^\s*first_observed_at\s*,?\s*$/m.test(body)).toBe(false);
    expect(/^\s*last_activity_at\s*,?\s*$/m.test(body)).toBe(false);
  });

  it("drops observation_deadline_at from the public view entirely", () => {
    const body = viewBody();
    expect(body).not.toContain("observation_deadline_at");
  });

  it("is NOT security_invoker — the view must read the now-column-restricted base columns as its owner", () => {
    const start = EXEC.indexOf("create view public_hiring_opportunities");
    const nextStatementEnd = EXEC.indexOf(";", EXEC.indexOf("from hiring_opportunities", start));
    const declaration = EXEC.slice(start, nextStatementEnd);
    expect(declaration).not.toMatch(/security_invoker\s*=\s*on/);
  });
});

describe("0029 — grants select on the redefined view", () => {
  it("still grants select on public_hiring_opportunities to anon and authenticated", () => {
    expect(EXEC).toMatch(/grant select on public_hiring_opportunities to anon, authenticated/);
  });
});
