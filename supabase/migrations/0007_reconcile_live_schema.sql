-- CandidateVoice migration: reconcile the live schema with the repo's model
--
-- WHY THIS EXISTS
-- The live `hiring_submissions` table was created by hand in the Supabase SQL
-- Editor long before any migration in this repo existed, and it drifted from
-- what the application actually sends. Migration 0000 cannot correct that
-- drift on its own: every statement in it is guarded (`create table if not
-- exists`, `if not exists (select 1 from pg_constraint ...)`), and those guards
-- read "already exists" as "already correct". A constraint that exists under
-- the right NAME but the wrong DEFINITION is therefore skipped silently.
--
-- This migration is the explicit reconciliation. It is:
--   * IDEMPOTENT — safe to run repeatedly.
--   * A NO-OP ON A FRESH DATABASE — where 0000 created everything correctly,
--     every statement here finds the desired state already true.
--   * NON-DESTRUCTIVE — it drops no table and deletes no row.
--
-- Historical migrations 0000-0006 are deliberately NOT edited. Reproducing the
-- live database from a clean checkout means running 0000-0007 in order.
--
-- Run order: after 0006.

-- ---------------------------------------------------------------------------
-- 1. Missing moderation columns
-- ---------------------------------------------------------------------------
--    The live table predates the moderation model and had NEITHER column.
--    0000 declares both inside its CREATE TABLE, which never ran here, so
--    without this its RLS policy would reference columns that do not exist.
alter table hiring_submissions add column if not exists is_approved boolean not null default false;
alter table hiring_submissions add column if not exists rejected_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. `outcome` value set
-- ---------------------------------------------------------------------------
--    VERIFIED AGAINST APPLICATION CODE before changing:
--      src/types/index.ts:2          HiringOutcome = "rejected"|"no_response"|"offer"|"ongoing"
--      src/app/api/submit/route.ts:23 VALID_OUTCOMES = [... ,"ongoing"]
--      src/app/submit/page.tsx:296   <option value="ongoing">Ongoing</option>
--    The literal 'withdrawn' appears NOWHERE in the application. The live
--    constraint allowed 'withdrawn' and rejected 'ongoing' — i.e. it rejected
--    the only value the form can actually produce for that case.
--
--    Guarded on the DEFINITION, not just the name, so this is a no-op wherever
--    the constraint is already correct.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'hiring_submissions_outcome_check'
      and conrelid = 'public.hiring_submissions'::regclass
      and pg_get_constraintdef(oid) not like '%ongoing%'
  ) then
    alter table hiring_submissions drop constraint hiring_submissions_outcome_check;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'hiring_submissions_outcome_check'
      and conrelid = 'public.hiring_submissions'::regclass
  ) then
    alter table hiring_submissions add constraint hiring_submissions_outcome_check
      check (outcome in ('rejected','no_response','offer','ongoing'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. `payment_flag` type
-- ---------------------------------------------------------------------------
--    VERIFIED AGAINST APPLICATION CODE before changing:
--      src/types/index.ts:45          payment_flag: boolean
--      src/app/submit/page.tsx:111    payment_flag: form.payment_flag !== "no"   (boolean)
--      src/app/api/submit/route.ts:74 payment_flag: Boolean(body.payment_flag)
--      src/utils/hqs.ts:26            d.payment_flag === true
--    The live column was TEXT with a four-value CHECK. A boolean coerces to
--    'true'/'false', which that CHECK rejects — so every submission would have
--    failed at insert with a constraint violation.
--
--    The USING clause maps the old text vocabulary onto the boolean the app
--    expects: anything other than 'no' meant payment WAS requested.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'hiring_submissions'
      and column_name = 'payment_flag'
      and data_type <> 'boolean'
  ) then
    if exists (select 1 from pg_constraint where conname = 'hiring_submissions_payment_flag_check') then
      alter table hiring_submissions drop constraint hiring_submissions_payment_flag_check;
    end if;

    alter table hiring_submissions
      alter column payment_flag type boolean
      using (payment_flag is not null and payment_flag::text <> 'no');
    alter table hiring_submissions alter column payment_flag set default false;
    alter table hiring_submissions alter column payment_flag set not null;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Legacy RLS policies
-- ---------------------------------------------------------------------------
--    VERIFIED AGAINST APPLICATION CODE before dropping:
--      src/app/api/submit/route.ts writes via createAdminClient() (service
--      role, bypasses RLS), so no application path depends on anon INSERT.
--      Public reads go through 0000's hiring_submissions_public_read policy.
--
--    The two live policies were:
--      "Anyone can insert hiring_submissions"  INSERT to public, with_check true
--        -> let anyone write straight to the table, bypassing the rate limiter,
--           the sanitizer and the server-side enum allowlists entirely.
--      "Public read hiring_submissions"        SELECT to public, using true
--        -> published EVERY row, including unmoderated and rejected ones.
--
--    Both are additional PERMISSIVE policies, so leaving them in place would
--    OR them with 0000's correct policy and defeat it.
drop policy if exists "Anyone can insert hiring_submissions" on hiring_submissions;
drop policy if exists "Public read hiring_submissions" on hiring_submissions;

-- ---------------------------------------------------------------------------
-- 5. Legacy tables from a superseded architecture — NOT dropped
-- ---------------------------------------------------------------------------
--    The live database also carries `companies`, `submissions` and
--    `moderations` from an abandoned earlier design. They are empty and no
--    application code references them, but two of their columns contradict
--    this project's stated rules:
--      submissions.sentiment_score   — an AI-derived score; claude.md §3 states
--                                      "No AI services."
--      moderations.flagged_by        — CHECK allows 'hive', a third-party
--                                      moderation service; claude.md §6 states
--                                      "no third-party content service."
--    Dropping tables is irreversible, so this migration deliberately does NOT.
--    Recommended follow-up once confirmed unused:
--      drop table if exists moderations;
--      drop table if exists submissions;
--      drop table if exists companies;

-- Rollback: this migration corrects drift; reverting it restores known-broken
-- behaviour and is not recommended. To undo individual steps, see the inverse
-- of each guarded block above.
