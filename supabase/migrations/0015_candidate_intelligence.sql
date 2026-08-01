-- CandidateVoice migration: candidate intelligence (preference vector)
--
-- WHY THIS EXISTS
-- The Candidate Intelligence Layer answers "given MY priorities, should I apply
-- here, and what am I giving up." That needs somewhere to keep a visitor's
-- preference vector (nine 1-5 priorities). The platform has no auth and no
-- server-side session — only the anonymous HMAC-signed unlock cookie — so this
-- introduces a SECOND anonymous identity: an opaque candidate id, minted into
-- its own signed httpOnly cookie (src/lib/candidate/cookie.ts), never the
-- unlock cookie.
--
-- ============================================================================
-- THE INVARIANT THIS MIGRATION MUST NOT BREAK (docs/adr-0001-evidence-model.md §4.3)
-- ============================================================================
--   "candidate_id / candidate hash / pseudonym — even a hash is a linkage key
--    that correlates one person's reports = de-anonymization. Never."
--
-- A candidate profile stores PREFERENCES, not reports, and has NO foreign key
-- and NO join path to hiring_submissions / submission_ratings /
-- submission_emotions. It cannot correlate a person to their anonymous reports
-- because nothing here points at a report. The `candidate_id` column below
-- references candidate_profiles (the preference owner) and nothing else — it is
-- internal to the candidate graph, exactly as organization_id is internal to
-- the employer graph.
--
-- This mirrors the account graph (0004): identity-bearing, but structurally
-- disjoint from evidence. tests/account-evidence-disjointness.test.ts parses
-- this file and fails CI if it ever references an evidence table.
--
-- Unlike 0004's `profiles` (auth.users-scoped), these tables are anonymous:
-- RLS is enabled with NO policy, so ONLY the service role reaches them — every
-- access is mediated by an API route that holds the opaque cookie id. There is
-- no auth.uid() to scope to.
--
-- Run order: after 0014.

-- ---------------------------------------------------------------------------
-- 1. Candidate profile — the opaque anonymous identity + future-proofing slots
-- ---------------------------------------------------------------------------
--    Empty of PII today: it holds only a generated id and timestamps. The
--    nullable source_text_hash / extracted / embedding_pending columns are the
--    slots a later, separately-approved milestone (resume/LinkedIn extraction,
--    embeddings) fills — so those land with no schema redesign (Part 9). Storing
--    resume text or extracted facts is explicitly NOT part of this migration.
create table if not exists candidate_profiles (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- Future: SHA-256 of the source text a profile was extracted from, so
  -- extraction re-runs only when the text changes ("one extraction, cached").
  source_text_hash  text,
  -- Future: structured facts from extraction. Never preferences (those are
  -- always explicit user input, in candidate_preferences below).
  extracted         jsonb,
  embedding_pending boolean not null default false,
  constraint candidate_profiles_source_hash_format
    check (source_text_hash is null or source_text_hash ~ '^[a-f0-9]{64}$')
);

-- ---------------------------------------------------------------------------
-- 2. Preference vector — one row per (candidate, dimension), each 1-5
-- ---------------------------------------------------------------------------
--    The set of valid dimension keys is validated in TypeScript
--    (src/lib/advisor/preferences.ts) rather than a SQL CHECK, so the vocabulary
--    can grow as experiential (Family B) dimensions come online without a
--    migration — the same pattern application_channel uses. The DB enforces only
--    shape: a lowercase key and a 1-5 weight.
create table if not exists candidate_preferences (
  candidate_id uuid not null references candidate_profiles(id) on delete cascade,
  dimension    text not null,
  weight       smallint not null check (weight between 1 and 5),
  updated_at   timestamptz not null default now(),
  primary key (candidate_id, dimension),
  constraint candidate_preferences_dimension_format check (dimension ~ '^[a-z0-9_]+$')
);

create index if not exists candidate_preferences_candidate_idx
  on candidate_preferences (candidate_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — anonymous, service-role only (no policy), like company_field_observations
-- ---------------------------------------------------------------------------
--    With RLS enabled and no permissive policy, neither anon nor authenticated
--    can read or write these tables directly. Access is only ever through an API
--    route using the service-role client, gated on possession of the opaque
--    candidate id in the cv_candidate cookie. The id IS the capability.
alter table candidate_profiles    enable row level security;
alter table candidate_preferences enable row level security;

-- Rollback:
--   drop table if exists candidate_preferences;
--   drop table if exists candidate_profiles;
