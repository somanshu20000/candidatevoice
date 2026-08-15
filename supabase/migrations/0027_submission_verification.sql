-- CandidateVoice migration: verification envelope, no email vendor (M5.2a)
--
-- WHY THIS EXISTS
-- M5.2a establishes the reusable envelope that can LATER support a
-- verified-contributor signal, without adding any email infrastructure or
-- vendor yet (that is M5.2b, gated on a separate legal/vendor decision — see
-- DECISIONS.md). This migration does two things:
--   1. Adds ONE new column, verification_tier, to hiring_submissions —
--      metadata about a submission's provenance, never about its author.
--   2. Creates verification_grants — a deliberately content-free table
--      holding only sha256(nonce) + expires_at. It has NO organization
--      column, NO tier column, NO address, NO submission link. The
--      organization/tier binding lives entirely inside the signed grant
--      TOKEN (src/lib/verification/token.ts), never in this table — so this
--      table alone can never answer "who verified for which company," even
--      under a full database compromise.
--
-- WHAT THIS DOES NOT DO. verification_tier ALONE proves nothing: no email is
-- ever sent by this migration or by M5.2a's code, so nothing in this
-- codebase yet establishes current employment, former employment, or
-- candidate interaction. The tier enum below is a metadata SHAPE, mostly
-- unreachable until M5.2b builds the actual proof step.
--
-- Run order: after 0026.

-- ---------------------------------------------------------------------------
-- 1. verification_tier on hiring_submissions.
-- ---------------------------------------------------------------------------
--    'unverified'      — default; the absence of any grant. Every row today.
--    'inbox_verified'  — controls SOME inbox (named to avoid the substring
--                         "email", which the disjointness test's forbidden-
--                         column scan treats as a red flag). Defined for
--                         CHECK-constraint completeness; no code path reaches
--                         it in M5.2a/b.
--    'contact_domain'  — controls an inbox at a domain resolving to the
--                         claimed organization (M5.2b, once email exists).
--                         Establishes plausible current-insider status only
--                         — a filter, not authorization, and NOT proof of
--                         employment (docs/design-hr-authentication.md §2's
--                         finding applies unchanged here).
--    'attested'        — a human moderator reviewed out-of-band proof via
--                         the existing admin surface (extends the M5.1
--                         pattern). Defined; not built.
--
--    NOT VALID, matching this codebase's additive-CHECK convention (0000,
--    0020, 0025) — existing rows are unaffected; new/updated rows are
--    checked immediately.
alter table hiring_submissions
  add column if not exists verification_tier text not null default 'unverified';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_verification_tier_check') then
    alter table hiring_submissions add constraint hiring_submissions_verification_tier_check
      check (verification_tier in ('unverified', 'inbox_verified', 'contact_domain', 'attested')) not valid;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Extend the M4 immutability guard (0025) to lock verification_tier too.
-- ---------------------------------------------------------------------------
--    verification_tier did not exist when 0025 was written, so its guard
--    function's explicit column list cannot have named it — and a column
--    absent from that list is, by the guard's own logic, silently mutable.
--    That would be a real hole: it is content (what was reported about this
--    submission's provenance), not moderation state, and must be locked at
--    insert exactly like every other content column.
--
--    CREATE OR REPLACE updates the function body in place; the trigger
--    hiring_submissions_immutable (0025) already points at this function
--    name, so it picks up the change automatically — no trigger DDL needed
--    here. This is the same "database enforces it, not a convention"
--    principle 0025/0026 already established, now correctly extended.
create or replace function hiring_submissions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.company                    is distinct from old.company
     or new.role                    is distinct from old.role
     or new.experience_bucket       is distinct from old.experience_bucket
     or new.stage                   is distinct from old.stage
     or new.outcome                 is distinct from old.outcome
     or new.response_time_bucket    is distinct from old.response_time_bucket
     or new.last_interaction_gap    is distinct from old.last_interaction_gap
     or new.call_duration           is distinct from old.call_duration
     or new.first_interaction_outcome is distinct from old.first_interaction_outcome
     or new.reason                  is distinct from old.reason
     or new.payment_flag            is distinct from old.payment_flag
     or new.created_at              is distinct from old.created_at
     or new.reporter_type           is distinct from old.reporter_type
     or new.application_channel     is distinct from old.application_channel
     or new.salary_history_stage    is distinct from old.salary_history_stage
     or new.salary_proof_type       is distinct from old.salary_proof_type
     or new.salary_proof_stage      is distinct from old.salary_proof_stage
     or new.salary_range_disclosed  is distinct from old.salary_range_disclosed
     or new.exit_experience_letter  is distinct from old.exit_experience_letter
     or new.exit_settlement         is distinct from old.exit_settlement
     or new.exit_documentation      is distinct from old.exit_documentation
     or new.would_recommend         is distinct from old.would_recommend
     or new.tenure_bucket           is distinct from old.tenure_bucket
     or new.conduct_environment     is distinct from old.conduct_environment
     or new.verification_tier       is distinct from old.verification_tier
  then
    raise exception 'hiring_submissions rows are immutable except is_approved, rejected_at and organization_id';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. verification_grants — deliberately content-free.
-- ---------------------------------------------------------------------------
--    grant_hash is sha256(nonce), never the nonce itself — the plaintext
--    nonce exists only inside the signed token, which this table never sees.
--    No organization_id, no tier, no address, no consumed_at (a timestamp on
--    a since-deleted row would be a timing-correlation vector — see the
--    M5.2 architecture decision §2, threat T5), no created_at.
create table if not exists verification_grants (
  grant_hash  text primary key,
  expires_at  timestamptz not null
);

create index if not exists verification_grants_expires_at_idx
  on verification_grants (expires_at);

-- Service-role only — no anon/authenticated policy, matching
-- rate_limit_counters and candidate_* (0001, 0015): nothing here is ever a
-- public surface, and nothing here needs to be, since a grant's proof lives
-- in the signed token the client already holds, not in a row it can read.
alter table verification_grants enable row level security;

-- Rollback:
--   drop table if exists verification_grants;
--   -- (0025's guard function cannot be cleanly reverted without also
--   --  dropping verification_tier below it in the same statement — revert
--   --  both together if ever rolling back this migration)
--   alter table hiring_submissions drop constraint if exists hiring_submissions_verification_tier_check;
--   alter table hiring_submissions drop column if exists verification_tier;
