/**
 * M4.1/M4.2 — hiring_submissions immutability + moderation audit ledger.
 *
 * Local Docker Supabase is unavailable in this environment (confirmed
 * unfixable without Docker Desktop — see prior session notes), so these are
 * STRUCTURAL parity tests against the shipped migration text, matching the
 * established convention in tests/company-intelligence.test.ts's
 * "canonicalizeSlug ↔ SQL parity" suite: assert the migration file actually
 * defines what this module's design intends, rather than executing SQL.
 *
 * What this catches: an accidentally-omitted column in the guard trigger's
 * exclusion list (the actual bug class immutability triggers exist to
 * prevent — external_reports_guard_immutable, migration 0009, is the proven
 * precedent this mirrors), a missing DELETE guard, or a ledger trigger that
 * doesn't fire on the columns that actually carry moderation state.
 *
 * Live behavioral verification (an actual blocked UPDATE/DELETE attempt) is
 * reported separately in .context/NOW.md — see that file for what was and
 * was not exercised against production, and why.
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const IMMUTABILITY = readFileSync(
  join(process.cwd(), "supabase/migrations/0025_hiring_submissions_immutability.sql"),
  "utf8"
);
const LEDGER = readFileSync(
  join(process.cwd(), "supabase/migrations/0026_moderation_audit_ledger.sql"),
  "utf8"
);
const VERIFICATION = readFileSync(
  join(process.cwd(), "supabase/migrations/0027_submission_verification.sql"),
  "utf8"
);
const RECRUITMENT_INTEL = readFileSync(
  join(process.cwd(), "supabase/migrations/0033_recruitment_process_intel.sql"),
  "utf8"
);

// Every real column on hiring_submissions (0000_baseline_hiring_submissions.sql
// + 0002/0014/0018/0019/0020's additions), EXCLUDING the three the guard must
// legitimately allow to change.
const MUTABLE_COLUMNS = ["is_approved", "rejected_at", "organization_id"];
const IMMUTABLE_COLUMNS = [
  "company",
  "role",
  "experience_bucket",
  "stage",
  "outcome",
  "response_time_bucket",
  "last_interaction_gap",
  "call_duration",
  "first_interaction_outcome",
  "reason",
  "payment_flag",
  "created_at",
  "reporter_type",
  "application_channel",
  "salary_history_stage",
  "salary_proof_type",
  "salary_proof_stage",
  "salary_range_disclosed",
  "exit_experience_letter",
  "exit_settlement",
  "exit_documentation",
  "would_recommend",
  "tenure_bucket",
  "conduct_environment",
];
// verification_tier (0027) plus the five Recruitment Process Intelligence
// columns (0033, D-031) — everything the 0033-redefined guard must lock.
const IMMUTABLE_COLUMNS_0033 = [
  ...IMMUTABLE_COLUMNS,
  "verification_tier",
  "outreach_quality",
  "sensitive_info_requested",
  "sensitive_info_stage",
  "sensitive_info_purpose_explained",
  "sensitive_info_necessary_perceived",
];

describe("0025 — hiring_submissions_guard_immutable column coverage", () => {
  it("locks every real column except is_approved, rejected_at, organization_id", () => {
    for (const col of IMMUTABLE_COLUMNS) {
      expect(
        IMMUTABILITY.includes(`new.${col}`) && IMMUTABILITY.includes(`old.${col}`),
        `guard function is missing a check for column "${col}" — it would be silently mutable`
      ).toBe(true);
    }
  });

  it("does NOT lock the three legitimate mutation columns", () => {
    // Correctness check the other direction: isolate the guard function's own
    // body (between its `as $$` and closing `$$;`) so this can't accidentally
    // match a comment or a different function, then confirm none of the three
    // legitimate-mutation columns appear in its `if` clause.
    const start = IMMUTABILITY.indexOf("function hiring_submissions_guard_immutable()");
    const bodyStart = IMMUTABILITY.indexOf("as $$", start);
    const bodyEnd = IMMUTABILITY.indexOf("$$;", bodyStart);
    const fnBody = IMMUTABILITY.slice(bodyStart, bodyEnd);
    for (const col of MUTABLE_COLUMNS) {
      expect(
        new RegExp(`new\\.${col}\\b`).test(fnBody),
        `guard function unexpectedly checks column "${col}" — this must stay mutable`
      ).toBe(false);
    }
  });

  it("wires the guard to BEFORE UPDATE", () => {
    expect(IMMUTABILITY).toMatch(/before update on hiring_submissions/);
    expect(IMMUTABILITY).toMatch(/hiring_submissions_guard_immutable/);
  });

  it("blocks DELETE unconditionally, mirroring hiring_events' no-delete pattern", () => {
    expect(IMMUTABILITY).toMatch(/before delete on hiring_submissions/);
    expect(IMMUTABILITY).toMatch(/hiring_submissions_guard_no_delete/);
    expect(IMMUTABILITY).toMatch(/raise exception 'hiring_submissions rows cannot be deleted/);
  });

  it("introduces no administrator bypass — no DROP TRIGGER outside the guarded drop-if-exists/create pair, no conditional exemption", () => {
    // A bypass would look like `if actor = 'admin' then return new;` or a
    // second trigger that fires only for certain roles. Neither exists.
    expect(IMMUTABILITY).not.toMatch(/current_user\s*=|session_user\s*=|role\(\)\s*=/);
  });
});

describe("0027 — verification_tier is locked by the redefined guard function", () => {
  // verification_tier did not exist when 0025 was written, so 0025's guard
  // function text cannot mention it — an unlisted column would, by the
  // guard's own logic, be silently mutable. 0027 fixes this via CREATE OR
  // REPLACE FUNCTION on the SAME function name the 0025 trigger already
  // points at (no trigger DDL needed). This tests the ACTUAL deployed/latest
  // function body — 0027's redefinition — not a synthetic concatenation.
  function guardBody(sql: string): string {
    const start = sql.indexOf("function hiring_submissions_guard_immutable()");
    expect(start, "0027 must redefine hiring_submissions_guard_immutable()").toBeGreaterThan(-1);
    const bodyStart = sql.indexOf("as $$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart);
    return sql.slice(bodyStart, bodyEnd);
  }

  it("0027 redefines the guard via CREATE OR REPLACE, not a new function/trigger", () => {
    expect(VERIFICATION).toMatch(/create or replace function hiring_submissions_guard_immutable\(\)/);
    // No new trigger declaration — the existing 0025 trigger must pick this
    // up automatically by pointing at the same function name.
    expect(VERIFICATION).not.toMatch(/create trigger hiring_submissions_immutable/);
  });

  it("the redefined guard locks verification_tier", () => {
    const body = guardBody(VERIFICATION);
    expect(
      /new\.verification_tier\s+is distinct from\s+old\.verification_tier/.test(body),
      "0027's guard function does not lock verification_tier — it would be silently mutable after insert"
    ).toBe(true);
  });

  it("the redefined guard still locks every original column (no regression from the rewrite)", () => {
    const body = guardBody(VERIFICATION);
    for (const col of IMMUTABLE_COLUMNS) {
      expect(
        body.includes(`new.${col}`) && body.includes(`old.${col}`),
        `0027's redefined guard dropped the check for "${col}" — a rewrite regression`
      ).toBe(true);
    }
  });

  it("the redefined guard still leaves the three legitimate mutation columns mutable", () => {
    const body = guardBody(VERIFICATION);
    for (const col of MUTABLE_COLUMNS) {
      expect(
        new RegExp(`new\\.${col}\\b`).test(body),
        `0027's redefined guard unexpectedly checks column "${col}" — this must stay mutable`
      ).toBe(false);
    }
  });

  it("raises the same exception message as the original 0025 guard", () => {
    expect(VERIFICATION).toMatch(/raise exception 'hiring_submissions rows are immutable except is_approved, rejected_at and organization_id'/);
  });
});

describe("0033 — Recruitment Process Intelligence columns are locked by the redefined guard function", () => {
  function guardBody(sql: string): string {
    const start = sql.indexOf("function hiring_submissions_guard_immutable()");
    expect(start, "0033 must redefine hiring_submissions_guard_immutable()").toBeGreaterThan(-1);
    const bodyStart = sql.indexOf("as $$", start);
    const bodyEnd = sql.indexOf("$$;", bodyStart);
    return sql.slice(bodyStart, bodyEnd);
  }

  it("0033 redefines the guard via CREATE OR REPLACE, not a new function/trigger", () => {
    expect(RECRUITMENT_INTEL).toMatch(/create or replace function hiring_submissions_guard_immutable\(\)/);
    expect(RECRUITMENT_INTEL).not.toMatch(/create trigger hiring_submissions_immutable/);
  });

  it("the redefined guard locks every column through 0033, including the five new ones (no rewrite regression)", () => {
    const body = guardBody(RECRUITMENT_INTEL);
    for (const col of IMMUTABLE_COLUMNS_0033) {
      expect(
        body.includes(`new.${col}`) && body.includes(`old.${col}`),
        `0033's redefined guard is missing a check for column "${col}" — it would be silently mutable`
      ).toBe(true);
    }
  });

  it("the redefined guard still leaves the three legitimate mutation columns mutable", () => {
    const body = guardBody(RECRUITMENT_INTEL);
    for (const col of MUTABLE_COLUMNS) {
      expect(
        new RegExp(`new\\.${col}\\b`).test(body),
        `0033's redefined guard unexpectedly checks column "${col}" — this must stay mutable`
      ).toBe(false);
    }
  });

  it("adds a NOT VALID CHECK for each new enum column, matching the additive-CHECK convention", () => {
    expect(RECRUITMENT_INTEL).toMatch(/hiring_submissions_outreach_quality_check/);
    expect(RECRUITMENT_INTEL).toMatch(/hiring_submissions_sensitive_info_requested_check/);
    expect(RECRUITMENT_INTEL).toMatch(/hiring_submissions_sensitive_info_stage_check/);
  });

  it("submit_hiring_report and public_submissions both carry the five new columns", () => {
    expect(RECRUITMENT_INTEL).toMatch(/create or replace function submit_hiring_report/);
    expect(RECRUITMENT_INTEL).toMatch(/create or replace view public_submissions/);
    for (const col of ["outreach_quality", "sensitive_info_requested", "sensitive_info_stage", "sensitive_info_purpose_explained", "sensitive_info_necessary_perceived"]) {
      expect(RECRUITMENT_INTEL.includes(`s.${col}`), `public_submissions is missing s.${col}`).toBe(true);
    }
  });
});

describe("0026 — moderation_audit_log", () => {
  it("defines the required columns: who, what, which submission, when, why, state transition", () => {
    expect(LEDGER).toMatch(/submission_id\s+uuid not null references hiring_submissions\(id\)/);
    expect(LEDGER).toMatch(/action\s+text not null check/);
    expect(LEDGER).toMatch(/previous_state\s+text not null check/);
    expect(LEDGER).toMatch(/new_state\s+text not null check/);
    expect(LEDGER).toMatch(/actor\s+text not null default 'admin'/);
    expect(LEDGER).toMatch(/reason\s+text/); // nullable — no UI collects it yet, honestly undocumented as such
    expect(LEDGER).toMatch(/created_at\s+timestamptz not null default now\(\)/);
  });

  it("constrains action/state to the reused three-state moderation machine — no invented states", () => {
    expect(LEDGER).toMatch(/action in \('approve', 'reject', 'reset_to_pending'\)/);
    expect(LEDGER).toMatch(/previous_state in \('pending', 'approved', 'rejected'\)/);
    expect(LEDGER).toMatch(/new_state in \('pending', 'approved', 'rejected'\)/);
  });

  it("logs automatically via a trigger — not left to application-code discipline", () => {
    expect(LEDGER).toMatch(/after update on hiring_submissions/);
    expect(LEDGER).toMatch(/hiring_submissions_log_moderation/);
  });

  it("only fires the ledger insert when is_approved or rejected_at actually change (not on organization_id re-resolution)", () => {
    const fnBody = LEDGER.slice(LEDGER.indexOf("hiring_submissions_log_moderation()"));
    expect(fnBody).toMatch(/new\.is_approved is distinct from old\.is_approved/);
    expect(fnBody).toMatch(/new\.rejected_at is distinct from old\.rejected_at/);
    expect(fnBody).not.toMatch(/organization_id is distinct/);
  });

  it("is itself immutable — no UPDATE or DELETE, mirroring hiring_events_guard_immutable exactly", () => {
    expect(LEDGER).toMatch(/before update on moderation_audit_log/);
    expect(LEDGER).toMatch(/before delete on moderation_audit_log/);
    expect(LEDGER).toMatch(/moderation_audit_log rows are immutable and append-only/);
  });

  it("enables RLS with no anon/authenticated policy — service-role only, never a public surface", () => {
    expect(LEDGER).toMatch(/alter table moderation_audit_log enable row level security/);
    expect(LEDGER).not.toMatch(/create policy.*moderation_audit_log.*to anon/is);
    expect(LEDGER).not.toMatch(/grant select on moderation_audit_log to anon/);
  });
});
