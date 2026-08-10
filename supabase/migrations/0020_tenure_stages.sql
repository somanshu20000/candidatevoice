-- CandidateVoice migration: tenure stages — employee & former-employee reports
--
-- WHY THIS EXISTS
-- Every report until now silently meant one relationship: "I interviewed here."
-- hiring_submissions models the HIRING PROCESS. But three relationships exist,
-- and we only heard from one. This migration turns on the other two, keyed off
-- the reporter_type column the baseline (0000) deliberately reserved for exactly
-- this moment:
--     candidate        interviewed here            (everything we already do)
--     employee         currently works here        (culture, would-recommend, conduct)
--     former_employee  used to work here           (exit letter, settlement, docs, conduct)
--
-- REPORTER_TYPE WIDENED, NOT REPLACED. The baseline created reporter_type as
-- `not null default 'candidate'` with a CHECK pinning it to 'candidate' only,
-- explicitly so that enabling employees later would be a value change, not a
-- schema migration of every aggregate. That day is today: we drop the
-- single-value CHECK and add the three-value one. Every existing row is already
-- 'candidate', so the new constraint validates with no data change.
--
-- SAME 0018 DISCIPLINE ON EVERY NEW COLUMN:
--   * nullable + CHECK-constrained + optional at the form
--   * FIRST-PARTY ONLY — a third-party forum post cannot structurally know
--     whether the poster got their relieving letter on time; external_reports
--     has no equivalent and never will (W1 field asymmetry, reduced coverage).
--   * NULL IS NOT "NO". NULL = did not answer -> excluded from the metric.
--     'na'/'none' = answered -> counts. Conflating them would let silence
--     manufacture an accusation or a clean record. Load-bearing everywhere.
--   * FACTS, NOT INTENT. 'not_received' is a fact the reporter observed; it is
--     deliberately NOT "withheld"/"refused" — we never infer a company's intent
--     from a candidate's or employee's report. Same rule as salary_range's
--     'never' in 0018.
--
-- THE CONDUCT COLUMN IS THE SHARP ONE. conduct_environment is a role-neutral,
-- structured psychological-safety scale — never free text, never about a named
-- person. It is the ONLY place in the schema touching harassment/toxicity, and
-- its aggregate is gated far harder than anything else (see conduct.ts:
-- CONDUCT_MIN_EFFECTIVE_N = 8, which is simultaneously the statistical and the
-- anonymity floor, because no company-size field exists yet). The schema stores
-- one honest enum; the product layer is where the gating and framing live.
--
-- Run order: after 0018.

-- 1. Widen reporter_type: candidate -> {candidate, employee, former_employee}.
alter table hiring_submissions
  drop constraint if exists hiring_submissions_reporter_type_check;
alter table hiring_submissions
  add constraint hiring_submissions_reporter_type_check
  check (reporter_type in ('candidate', 'employee', 'former_employee'));

-- 2. New tenure columns (all nullable, all optional at the form).
alter table hiring_submissions
  add column if not exists exit_experience_letter text,
  add column if not exists exit_settlement text,
  add column if not exists exit_documentation text,
  add column if not exists would_recommend text,
  add column if not exists tenure_bucket text,
  add column if not exists conduct_environment text;

-- former_employee: was the experience/relieving letter received, and when?
-- Timing fact, exactly like response_time_bucket. 'not_received' is a fact;
-- 'na' means it didn't apply (e.g. still within notice, or never requested).
alter table hiring_submissions
  add constraint hiring_submissions_exit_experience_letter_check
  check (
    exit_experience_letter is null
    or exit_experience_letter = any (array['on_time', 'delayed', 'not_received', 'na'])
  );

-- former_employee: full-and-final settlement timing. Same ladder — the India
-- pain point this whole stage exists to make measurable.
alter table hiring_submissions
  add constraint hiring_submissions_exit_settlement_check
  check (
    exit_settlement is null
    or exit_settlement = any (array['on_time', 'delayed', 'not_received', 'na'])
  );

-- former_employee: completeness of exit documentation (relieving letter, FnF
-- statement, PF/tax paperwork). 'none' is an answer; NULL is not.
alter table hiring_submissions
  add constraint hiring_submissions_exit_documentation_check
  check (
    exit_documentation is null
    or exit_documentation = any (array['complete', 'partial', 'none', 'na'])
  );

-- employee: would you recommend working here? The single headline culture
-- signal, alongside the sourceType:'employee' Likert facets (leadership,
-- work_culture) that this stage finally unlocks.
alter table hiring_submissions
  add constraint hiring_submissions_would_recommend_check
  check (
    would_recommend is null
    or would_recommend = any (array['yes', 'maybe', 'no'])
  );

-- employee/former_employee: how long they worked here. Mirrors experience_bucket's
-- buckets exactly, for cohorting ("people who stayed 3-5 years").
alter table hiring_submissions
  add constraint hiring_submissions_tenure_bucket_check
  check (
    tenure_bucket is null
    or tenure_bucket = any (array['0-1', '1-3', '3-5', '5-8', '8+'])
  );

-- employee/former_employee: workplace conduct environment. A role-neutral
-- psychological-safety scale, NOT an accusation field and NEVER about a named
-- person. 'serious_concerns' is the reporter's own experience of the
-- environment, aggregated only. See conduct.ts for the hard gating that governs
-- whether any aggregate of this column is ever allowed to render.
alter table hiring_submissions
  add constraint hiring_submissions_conduct_environment_check
  check (
    conduct_environment is null
    or conduct_environment = any (array['respectful', 'mostly_ok', 'some_concerns', 'serious_concerns', 'na'])
  );

-- 3. Redefine the view to carry the six new columns. Same shape, same filter,
-- same security_invoker + grants — only the select list grows. New columns are
-- APPENDED at the very end: create-or-replace treats a column inserted anywhere
-- else as a RENAME of whatever occupies that slot, which Postgres rejects
-- (42P16). Learned in 0014, held in 0018.
create or replace view public_submissions
with (security_invoker = on)
as
select
  s.id,
  s.organization_id,
  s.company,
  s.role,
  s.reporter_type,
  s.experience_bucket,
  s.stage,
  s.outcome,
  s.response_time_bucket,
  s.last_interaction_gap,
  s.call_duration,
  s.first_interaction_outcome,
  s.reason,
  s.payment_flag,
  to_char(date_trunc('month', s.created_at at time zone 'UTC'), 'YYYY-MM') as reported_month,
  s.application_channel,
  s.salary_history_stage,
  s.salary_proof_type,
  s.salary_proof_stage,
  s.salary_range_disclosed,
  s.exit_experience_letter,
  s.exit_settlement,
  s.exit_documentation,
  s.would_recommend,
  s.tenure_bucket,
  s.conduct_environment
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- 4. Redefine submit_hiring_report to insert the six new columns. Signature
-- UNCHANGED (still 3 jsonb params) — new fields arrive as optional keys on
-- p_submission. nullif('') keeps an empty string from becoming a CHECK
-- violation: absent stays NULL. reporter_type keeps its coalesce default of
-- 'candidate', so an old caller that never sends it is unaffected.
create or replace function submit_hiring_report(
  p_submission jsonb,
  p_ratings jsonb default '[]'::jsonb,
  p_emotions jsonb default '[]'::jsonb
) returns uuid
language plpgsql
as $$
declare
  v_submission_id uuid;
begin
  insert into hiring_submissions (
    company, role, organization_id, experience_bucket, stage, outcome,
    response_time_bucket, last_interaction_gap, call_duration,
    first_interaction_outcome, reason, payment_flag, is_approved, reporter_type,
    application_channel,
    salary_history_stage, salary_proof_type, salary_proof_stage, salary_range_disclosed,
    exit_experience_letter, exit_settlement, exit_documentation,
    would_recommend, tenure_bucket, conduct_environment
  ) values (
    p_submission->>'company',
    p_submission->>'role',
    nullif(p_submission->>'organization_id', '')::uuid,
    p_submission->>'experience_bucket',
    p_submission->>'stage',
    p_submission->>'outcome',
    p_submission->>'response_time_bucket',
    p_submission->>'last_interaction_gap',
    p_submission->>'call_duration',
    p_submission->>'first_interaction_outcome',
    p_submission->>'reason',
    coalesce((p_submission->>'payment_flag')::boolean, false),
    coalesce((p_submission->>'is_approved')::boolean, false),
    coalesce(p_submission->>'reporter_type', 'candidate'),
    nullif(p_submission->>'application_channel', ''),
    nullif(p_submission->>'salary_history_stage', ''),
    nullif(p_submission->>'salary_proof_type', ''),
    nullif(p_submission->>'salary_proof_stage', ''),
    nullif(p_submission->>'salary_range_disclosed', ''),
    nullif(p_submission->>'exit_experience_letter', ''),
    nullif(p_submission->>'exit_settlement', ''),
    nullif(p_submission->>'exit_documentation', ''),
    nullif(p_submission->>'would_recommend', ''),
    nullif(p_submission->>'tenure_bucket', ''),
    nullif(p_submission->>'conduct_environment', '')
  )
  returning id into v_submission_id;

  if jsonb_array_length(p_ratings) > 0 then
    insert into submission_ratings (submission_id, facet_key, rating)
    select v_submission_id, (elem->>'facet_key'), (elem->>'rating')::smallint
    from jsonb_array_elements(p_ratings) as elem;
  end if;

  if jsonb_array_length(p_emotions) > 0 then
    insert into submission_emotions (submission_id, emotion_key)
    select v_submission_id, (elem->>'emotion_key')
    from jsonb_array_elements(p_emotions) as elem;
  end if;

  return v_submission_id;
end;
$$;

-- Rollback:
--   create or replace view public_submissions ... (0018's select list, minus the six columns)
--   create or replace function submit_hiring_report(...) ... (0018's body, minus the six columns)
--   alter table hiring_submissions
--     drop constraint hiring_submissions_exit_experience_letter_check,
--     drop constraint hiring_submissions_exit_settlement_check,
--     drop constraint hiring_submissions_exit_documentation_check,
--     drop constraint hiring_submissions_would_recommend_check,
--     drop constraint hiring_submissions_tenure_bucket_check,
--     drop constraint hiring_submissions_conduct_environment_check;
--   alter table hiring_submissions
--     drop column exit_experience_letter, drop column exit_settlement,
--     drop column exit_documentation, drop column would_recommend,
--     drop column tenure_bucket, drop column conduct_environment;
--   alter table hiring_submissions drop constraint hiring_submissions_reporter_type_check;
--   alter table hiring_submissions add constraint hiring_submissions_reporter_type_check
--     check (reporter_type in ('candidate'));
