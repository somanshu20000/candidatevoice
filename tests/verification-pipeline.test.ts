/**
 * M5.3 — verification_tier threads verification → submission → approved
 * evidence. Two testable seams:
 *   1. normalize.ts carries the tier onto EvidenceItem (pure, unit-tested here).
 *   2. migration 0028 writes it (RPC) and exposes it (view) — structural parity
 *      tests against the migration text, matching the convention in
 *      tests/db-hiring-submissions-immutability.test.ts (local Docker Supabase
 *      is unavailable in this environment).
 *
 * The submit-route wiring (redeem a grant, stamp the tier, fail open) sits on
 * redeemGrant, already unit-tested in tests/verification-redeem.test.ts, and is
 * exercised by the production build; it is not re-tested here.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { normalizeFirstParty, normalizeExternal } from "@/lib/evidence/normalize";
import type { RawFirstPartyRow, RawExternalRow } from "@/lib/evidence/load";

function firstPartyRow(overrides: Partial<RawFirstPartyRow> = {}): RawFirstPartyRow {
  return {
    id: "s1",
    organization_id: "org-1",
    experience_bucket: "1-3",
    stage: "final",
    outcome: "offer",
    response_time_bucket: "0-3",
    last_interaction_gap: "0-7",
    call_duration: "5-15",
    first_interaction_outcome: "continued",
    reason: "skill_mismatch",
    payment_flag: false,
    reported_month: "2026-08",
    reporter_type: "candidate",
    application_channel: "referral",
    salary_history_stage: null,
    salary_proof_type: null,
    salary_proof_stage: null,
    salary_range_disclosed: null,
    exit_experience_letter: null,
    exit_settlement: null,
    exit_documentation: null,
    would_recommend: null,
    tenure_bucket: null,
    conduct_environment: null,
    verification_tier: "unverified",
    outreach_quality: null,
    sensitive_info_requested: null,
    sensitive_info_stage: null,
    sensitive_info_purpose_explained: null,
    sensitive_info_necessary_perceived: null,
    ...overrides,
  };
}

describe("normalize — verification_tier passthrough", () => {
  it("carries a recognized tier onto the EvidenceItem", () => {
    const [item] = normalizeFirstParty([firstPartyRow({ verification_tier: "contact_domain" })]);
    expect(item.verificationTier).toBe("contact_domain");
  });

  it("defaults an absent tier to 'unverified'", () => {
    const [item] = normalizeFirstParty([firstPartyRow({ verification_tier: null })]);
    expect(item.verificationTier).toBe("unverified");
  });

  it("drops an unrecognized tier to 'unverified' (bad data fails safe, never scores)", () => {
    const [item] = normalizeFirstParty([firstPartyRow({ verification_tier: "super_admin" })]);
    expect(item.verificationTier).toBe("unverified");
  });

  it("external evidence is always 'unverified' — a forum post carries no grant", () => {
    const ext: RawExternalRow = {
      id: "e1",
      organization_id: "org-1",
      source_key: "reddit",
      trust_weight: 0.3,
      experience_bucket: "1-3",
      stage: "final",
      outcome: "offer",
      response_time_bucket: "0-3",
      last_interaction_gap: "0-7",
      reason: "skill_mismatch",
      payment_flag: false,
      reported_month: "2026-08",
      extraction_confidence: 0.8,
    };
    const [item] = normalizeExternal([ext], 0.5);
    expect(item.verificationTier).toBe("unverified");
  });
});

describe("normalize — verification_tier NEVER affects weight (D-022)", () => {
  it("two first-party rows differing ONLY in tier get identical weight", () => {
    const [unverified] = normalizeFirstParty([firstPartyRow({ id: "a", verification_tier: "unverified" })]);
    const [verified] = normalizeFirstParty([firstPartyRow({ id: "b", verification_tier: "contact_domain" })]);
    expect(verified.weight).toBe(unverified.weight);
  });
});

describe("migration 0028 — writes and exposes verification_tier", () => {
  const SQL = readFileSync(
    join(process.cwd(), "supabase/migrations/0028_verification_pipeline.sql"),
    "utf8"
  );

  it("submit_hiring_report inserts verification_tier, defaulting to 'unverified'", () => {
    expect(SQL).toMatch(/create or replace function submit_hiring_report/);
    // The column appears in the INSERT column list AND the values list with a
    // coalesce to the safe default.
    expect(SQL).toMatch(/verification_tier\n\s*\)\s*values/s);
    expect(SQL).toMatch(/coalesce\(nullif\(p_submission->>'verification_tier', ''\), 'unverified'\)/);
  });

  it("public_submissions projects verification_tier", () => {
    expect(SQL).toMatch(/create or replace view public_submissions/);
    expect(SQL).toMatch(/s\.verification_tier/);
  });

  it("public_submissions STILL never projects a bare created_at (anonymity coarsening preserved)", () => {
    const viewStart = SQL.indexOf("create or replace view public_submissions");
    const viewBody = SQL.slice(viewStart, SQL.indexOf("grant select on public_submissions", viewStart));
    // created_at may appear only inside the date_trunc that produces reported_month.
    expect(/^\s*s\.created_at\s*,?\s*$/m.test(viewBody)).toBe(false);
    expect(viewBody).toContain("reported_month");
  });
});
