-- CandidateVoice migration: saved companies for the anonymous candidate identity
--
-- WHY THIS EXISTS
-- Phase 2 of the product-experience audit's implementation sequence: "saved
-- companies," built on the identity that already works (candidate_profiles /
-- the cv_candidate cookie, migration 0015) rather than the dormant,
-- auth.users-based wishlist_items (migration 0004). That schema requires a
-- real login (email via Supabase Auth) and has never been wired to any
-- application code — resurrecting it would mean building actual account
-- authentication, a different product decision than "anonymous, Reddit-style
-- persistent identity." This table is the wishlist_items shape, minus every
-- auth.users-dependent column, keyed to the SAME opaque candidate identity
-- candidate_preferences already uses.
--
-- ============================================================================
-- THE INVARIANT THIS MIGRATION MUST NOT BREAK (docs/adr-0001-evidence-model.md §4.3)
-- ============================================================================
--   "candidate_id / candidate hash / pseudonym — even a hash is a linkage key
--    that correlates one person's reports = de-anonymization. Never."
--
-- This table references candidate_profiles(id) — internal to the candidate
-- graph, exactly like candidate_preferences.candidate_id — and organizations(id)
-- — an employer, never a person, the one value the account/candidate graphs and
-- the evidence graph are allowed to share (0004's own header states this
-- precedent). NOTHING here references hiring_submissions, submission_ratings
-- or submission_emotions. tests/account-evidence-disjointness.test.ts asserts
-- this by parsing the migration file, same mechanism as 0004/0015.
-- ============================================================================
--
-- Run order: after 0033.

create table if not exists candidate_saved_companies (
  candidate_id    uuid not null references candidate_profiles(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),

  primary key (candidate_id, organization_id)
);

create index if not exists candidate_saved_companies_candidate_idx
  on candidate_saved_companies (candidate_id, created_at desc);

-- RLS enabled, NO policy — service-role only, mirrors candidate_preferences
-- (0015) exactly. There is no auth.uid() to scope to; the opaque cv_candidate
-- cookie id, verified before every call, is the capability. Nothing here is
-- reachable by anon/authenticated.
alter table candidate_saved_companies enable row level security;

-- Rollback:
--   drop table if exists candidate_saved_companies;
