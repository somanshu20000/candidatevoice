-- CandidateVoice migration: baseline `hiring_submissions` + explicit RLS
--
-- WHY THIS EXISTS
-- Until now the repository contained no `create table hiring_submissions`
-- anywhere. The table was created by hand in the Supabase SQL Editor and its
-- shape survived only as prose in docs/schema.md. Likewise, docs/schema.md and
-- claude.md both assert "RLS is enabled on hiring_submissions", but no
-- `enable row level security` or `create policy` statement for that table
-- existed in version control — so the claim was unverifiable from the repo.
--
-- Every migration that follows (organizations, the fingerprint model) takes a
-- foreign key against this table. Building those on an unversioned, hand-made
-- table means a fresh environment cannot be reproduced from the repo at all.
-- This migration closes that gap.
--
-- SAFE ON AN EXISTING DATABASE. Everything is guarded (if not exists / drop
-- policy if exists). Against the live project this is close to a no-op: the
-- table already exists, so `create table if not exists` does nothing, and the
-- policies are (re)declared to match what the docs always claimed was true.
-- Against an empty project it builds the table from scratch.
--
-- Run order: after 0001.

-- 1. The table itself. Column list matches docs/schema.md plus `rejected_at`,
--    which migration 0001 added. `create table if not exists` deliberately does
--    NOT reconcile drift on an existing table — if the live table differs from
--    this definition, Postgres silently keeps the live one. Verify with:
--      select column_name, data_type, is_nullable
--      from information_schema.columns
--      where table_name = 'hiring_submissions' order by ordinal_position;
create table if not exists hiring_submissions (
  id                        uuid primary key default gen_random_uuid(),
  company                   text not null,
  role                      text not null,
  experience_bucket         text not null,
  stage                     text not null,
  outcome                   text not null,
  response_time_bucket      text not null,
  last_interaction_gap      text not null,
  call_duration             text not null,
  first_interaction_outcome text not null,
  reason                    text not null,
  payment_flag              boolean not null default false,
  is_approved               boolean not null default false,
  created_at                timestamptz not null default now(),
  rejected_at               timestamptz
);

-- 2. Value-set constraints.
--
--    These enums are currently enforced ONLY by TypeScript allowlists in
--    src/app/api/submit/route.ts. That is a single point of failure: any future
--    write path (a script, a manual insert, a second API route) bypasses them
--    entirely and can put arbitrary text into a column the aggregation engine
--    assumes is closed. hqs.ts, for instance, maps response_time_bucket through
--    a lookup and silently substitutes 50 for anything unrecognised — bad data
--    would score rather than fail.
--
--    Added as NOT VALID so the migration cannot fail on pre-existing rows that
--    predate the constraint. New and updated rows are checked immediately.
--    Once you have confirmed existing data conforms, promote them with:
--      alter table hiring_submissions validate constraint <name>;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_stage_check') then
    alter table hiring_submissions add constraint hiring_submissions_stage_check
      check (stage in ('applied','screening','technical','hr','final')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_outcome_check') then
    alter table hiring_submissions add constraint hiring_submissions_outcome_check
      check (outcome in ('rejected','no_response','offer','ongoing')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_experience_bucket_check') then
    alter table hiring_submissions add constraint hiring_submissions_experience_bucket_check
      check (experience_bucket in ('0-1','1-3','3-5','5-8','8+')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_response_time_check') then
    alter table hiring_submissions add constraint hiring_submissions_response_time_check
      check (response_time_bucket in ('0-3','4-7','8-14','15+')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_last_gap_check') then
    alter table hiring_submissions add constraint hiring_submissions_last_gap_check
      check (last_interaction_gap in ('0-7','8-14','15-30','30+')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_call_duration_check') then
    alter table hiring_submissions add constraint hiring_submissions_call_duration_check
      check (call_duration in ('<2','2-5','5-15','15+','na')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_first_interaction_check') then
    alter table hiring_submissions add constraint hiring_submissions_first_interaction_check
      check (first_interaction_outcome in ('continued','rejected_immediately','na')) not valid;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_reason_check') then
    alter table hiring_submissions add constraint hiring_submissions_reason_check
      check (reason in ('experience_mismatch','skill_mismatch','culture_fit','no_reason','other')) not valid;
  end if;
end $$;

-- 3. `reporter_type` — carries the candidate/employee distinction from day one.
--
--    Employee reporting is NOT enabled and is deliberately out of scope: it is
--    a different domain object with a materially sharper re-identification and
--    defamation profile than an anonymous candidate report. The column exists
--    now purely so that adding it later is a value change rather than a
--    migration of every aggregate and index. Until then the CHECK keeps the
--    only writable value as 'candidate'.
alter table hiring_submissions
  add column if not exists reporter_type text not null default 'candidate';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'hiring_submissions_reporter_type_check') then
    alter table hiring_submissions add constraint hiring_submissions_reporter_type_check
      check (reporter_type in ('candidate')) not valid;
  end if;
end $$;

-- 4. RLS. This is the part that was documented but never version-controlled.
--
--    Public (anon) may read approved, non-rejected rows and nothing else.
--    No insert/update/delete policy exists for anon, so with RLS on, all writes
--    are denied to it. Every write path in the app already goes through the
--    service-role key (src/lib/supabase/server.ts createAdminClient), which
--    bypasses RLS by design.
alter table hiring_submissions enable row level security;

drop policy if exists hiring_submissions_public_read on hiring_submissions;
create policy hiring_submissions_public_read
  on hiring_submissions for select
  to anon, authenticated
  using (is_approved = true and rejected_at is null);

-- 5. Query-shape indexes.
--    The company page filters on (company, is_approved); browse and the home
--    feed order by created_at within that filter. 0001 already covers the
--    pending-moderation queue.
create index if not exists hiring_submissions_company_approved_idx
  on hiring_submissions (company, is_approved)
  where is_approved = true;

create index if not exists hiring_submissions_approved_created_idx
  on hiring_submissions (created_at desc)
  where is_approved = true;

-- Rollback:
--   drop index if exists hiring_submissions_approved_created_idx;
--   drop index if exists hiring_submissions_company_approved_idx;
--   drop policy if exists hiring_submissions_public_read on hiring_submissions;
--   alter table hiring_submissions disable row level security;
--   alter table hiring_submissions drop column if exists reporter_type;
--   (constraints: alter table hiring_submissions drop constraint <name>;)
