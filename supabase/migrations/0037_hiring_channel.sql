-- CandidateVoice migration: hiring channel + payment attribution (D-037)
--
-- WHY THIS EXISTS
-- Two candidate-process stratifiers, requested together: who the employing
-- intermediary was (direct company HR, a consultancy/agency, a referral), and
-- — separately — who requested payment when payment_flag (0002, required) is
-- true. These are deliberately two independent facts, never combined into an
-- accusation. This migration adds nothing that infers or displays a verdict
-- like "consultancies charge candidates" — it records what happened, exactly
-- the "FACT, never a verdict" rule 0033/D-031 established for sensitive-info
-- requests.
--
-- HIRING_CHANNEL IS NOT APPLICATION_CHANNEL.
-- application_channel (0014) already answers "how did you find/apply to this
-- role" (referral / recruiter_outreach / job_board / company_website / other)
-- — discovery route. hiring_channel answers a different question: who the
-- employing intermediary was. A candidate can apply via a job board
-- (application_channel) and still be hired through a staffing agency
-- (hiring_channel) — these are not the same axis and neither subsumes the
-- other. Two columns, two wizard questions, distinct wording.
--
-- CONSULTANCY AND AGENCY ARE ONE VALUE, NOT TWO.
-- The source brief listed hired_through_consultancy and
-- hired_through_recruitment_agency separately but the UI wording it specified
-- ("Recruitment consultancy / agency") never lets a respondent distinguish
-- them. A distinction the form cannot collect is unmeasurable — collapsed to
-- one value, consultancy_agency, same collapsing technique
-- salary_history_stage (0018) and outreach_quality (0033) both already use.
--
-- PAYMENT_REQUESTED_BY IS ATTRIBUTION, NOT A SECOND "DID IT HAPPEN" FIELD.
-- payment_flag (0002, required boolean) already answers WHETHER payment was
-- requested and already feeds a live, corroboration-gated metric
-- (PAYMENT_RISK_MIN_SOURCES = 2, src/lib/fingerprint/behavioural.ts) — that
-- gate is untouched by this migration. payment_requested_by answers only BY
-- WHOM, and is meaningful only when payment_flag = true. 'not_sure' lives
-- here (not on payment_flag) because "payment was requested, unsure by whom"
-- is a real, common report that does not change the answer to payment_flag.
--
-- NULL IS NOT AN ANSWER, same load-bearing rule as every enum column since
-- 0018: null = candidate did not answer (excluded from every metric).
-- "Prefer not to say" is deliberately NOT an enum value — the wizard's
-- existing idiom (see salary_history_stage) is an empty-string option that
-- maps to null, exactly like every other optional field. Adding a literal
-- prefer_not_to_say value would be redundant with null and would need its
-- own metric-exclusion carve-out everywhere null already gets one for free.
--
-- FIRST-PARTY ONLY, like application_channel and every 0033 column:
-- external_reports has no equivalent — a third-party forum post cannot
-- structurally know who the candidate's employer-of-record was.
--
-- Run order: after 0036.

alter table hiring_submissions
  add column if not exists hiring_channel text,
  add column if not exists payment_requested_by text;

-- Who the employing intermediary was. Meaningful for every candidate report,
-- not gated on payment_flag.
alter table hiring_submissions
  add constraint hiring_submissions_hiring_channel_check
  check (
    hiring_channel is null
    or hiring_channel = any (array['company_direct', 'consultancy_agency', 'referral', 'other'])
  ) not valid;

-- Who requested payment, if payment_flag is true. Not cross-validated against
-- payment_flag at the DB — the application layer gates the wizard question on
-- payment_flag = true, but a null payment_requested_by alongside
-- payment_flag = true is not an inconsistency worth a CHECK: it is simply
-- "asked whether payment was requested, did not answer who by," same as any
-- other unanswered follow-up in this table.
alter table hiring_submissions
  add constraint hiring_submissions_payment_requested_by_check
  check (
    payment_requested_by is null
    or payment_requested_by = any (array['company', 'consultancy_agency', 'other', 'not_sure'])
  ) not valid;

-- Redefine the view to carry the two new columns, appended at the end —
-- inserting mid-list makes create-or-replace read as a column RENAME, which
-- Postgres rejects (42P16, learned in 0014).
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
  s.conduct_environment,
  s.verification_tier,
  s.outreach_quality,
  s.sensitive_info_requested,
  s.sensitive_info_stage,
  s.sensitive_info_purpose_explained,
  s.sensitive_info_necessary_perceived,
  s.hiring_channel,
  s.payment_requested_by
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- Redefine submit_hiring_report to insert the two new columns. Signature
-- unchanged (still 3 jsonb params) — the fields arrive as optional keys on
-- p_submission, same as every column added since 0018.
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
    would_recommend, tenure_bucket, conduct_environment,
    verification_tier,
    outreach_quality, sensitive_info_requested, sensitive_info_stage,
    sensitive_info_purpose_explained, sensitive_info_necessary_perceived,
    hiring_channel, payment_requested_by
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
    nullif(p_submission->>'conduct_environment', ''),
    coalesce(nullif(p_submission->>'verification_tier', ''), 'unverified'),
    nullif(p_submission->>'outreach_quality', ''),
    nullif(p_submission->>'sensitive_info_requested', ''),
    nullif(p_submission->>'sensitive_info_stage', ''),
    (p_submission->>'sensitive_info_purpose_explained')::boolean,
    (p_submission->>'sensitive_info_necessary_perceived')::boolean,
    nullif(p_submission->>'hiring_channel', ''),
    nullif(p_submission->>'payment_requested_by', '')
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

-- Extend the M4 immutability guard (0025, last extended by 0033) to lock the
-- two new columns — content about what the candidate reported, not
-- moderation state, so it is locked at insert exactly like every other
-- content column. CREATE OR REPLACE updates the function body in place; the
-- existing hiring_submissions_immutable trigger already points at this
-- function name, so no trigger DDL is needed here.
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
     or new.outreach_quality        is distinct from old.outreach_quality
     or new.sensitive_info_requested is distinct from old.sensitive_info_requested
     or new.sensitive_info_stage    is distinct from old.sensitive_info_stage
     or new.sensitive_info_purpose_explained is distinct from old.sensitive_info_purpose_explained
     or new.sensitive_info_necessary_perceived is distinct from old.sensitive_info_necessary_perceived
     or new.hiring_channel          is distinct from old.hiring_channel
     or new.payment_requested_by    is distinct from old.payment_requested_by
  then
    raise exception 'hiring_submissions rows are immutable except is_approved, rejected_at and organization_id';
  end if;
  return new;
end;
$$;

-- Rollback:
--   create or replace function hiring_submissions_guard_immutable() ... (0033's body, minus hiring_channel/payment_requested_by)
--   create or replace function submit_hiring_report(...) ... (0033's body, minus hiring_channel/payment_requested_by)
--   create or replace view public_submissions ... (0033's select list, minus hiring_channel/payment_requested_by)
--   alter table hiring_submissions
--     drop constraint if exists hiring_submissions_hiring_channel_check,
--     drop constraint if exists hiring_submissions_payment_requested_by_check;
--   alter table hiring_submissions
--     drop column if exists hiring_channel,
--     drop column if exists payment_requested_by;
