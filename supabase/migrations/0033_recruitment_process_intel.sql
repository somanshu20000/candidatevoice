-- CandidateVoice migration: Recruitment Process Intelligence (D-031)
--
-- WHY THIS EXISTS
-- CandidateVoice's original complaint: candidates get recruiter outreach with
-- no evidence anyone looked at their profile, and companies run interview
-- processes that ask for personal documents without candidates having any
-- structured way to say so. This is the smallest vertical slice of that:
-- two of the four requested categories (outreach quality, information-request
-- behaviour), first-party only, same shape as every migration before it.
--
-- THE OTHER TWO CATEGORIES ARE MOSTLY ALREADY BUILT, NOT MISSING:
--   "Process quality" (recruiter/interviewer preparedness, clear role
--   description, salary expectations communicated, ghosting, time to
--   response) is already the `recruiter_professionalism`, ADD
--   `interviewer_preparedness` Likert facets (0004) plus `role_clarity`,
--   `compensation_clarity` (0017), plus the `ghosting`/`response_speed`
--   behavioural dimensions (src/lib/fingerprint/behavioural.ts). Adding new
--   columns for these would duplicate an existing, working measurement.
--   "Candidate time waste" (rounds, travel, rescheduling, virtual-interview
--   availability) is a genuinely new category, deliberately NOT built in this
--   pass — see DECISIONS.md D-031 for the explicit scope call.
--
-- OUTREACH QUALITY — ONE COLUMN, NOT FOUR.
-- The brief asks four separate questions ("did they review my profile",
-- "did the role match", "was it relevant", "was I an obvious mismatch") that
-- are really one candidate judgment on one ladder, exactly the same
-- collapsing technique salary_history_stage (0018) already uses for "were you
-- asked, and how early". Only meaningful for someone who was contacted BY the
-- company — a candidate who applied inbound simply leaves this null, same
-- "silence is not a value" rule as everywhere else in this table.
--
-- INFORMATION-REQUEST BEHAVIOUR — RECORD THE FACT, NEVER THE VERDICT.
-- Explicit product rule (do not relitigate without new evidence): this
-- schema records WHAT was asked for and WHEN, never WHETHER it was legal.
-- Aadhaar/PAN/bank-detail collection law varies by jurisdiction and purpose
-- (KYC for payroll after a written offer is ordinary; the same document
-- demanded at screening is what candidates report as coercive) — exactly the
-- same "jurisdiction-neutral, report what happened" rule 0018's
-- CompensationPanel already established for salary-history requests. Any
-- future legal-interpretation layer is a SEPARATE, explicitly sourced
-- addition — this migration/engine never encodes one.
-- `sensitive_info_necessary_perceived` is the one subjective field here, and
-- it is explicitly the CANDIDATE'S OWN judgment about their own experience —
-- "did YOU think this was reasonable" — never a platform-computed verdict.
--
-- NULL IS NOT AN ANSWER, same load-bearing rule as every enum column since
-- 0018: null = candidate did not answer (excluded from every metric); 'none'
-- is a real, counted answer ("nothing sensitive was ever asked for").
--
-- FIRST-PARTY ONLY, like every candidate-experience column since 0014:
-- external_reports has no equivalent and never will — a third-party forum
-- post cannot structurally know what stage a poster was asked for a PAN card.
--
-- Run order: after 0032.

alter table hiring_submissions
  add column if not exists outreach_quality text,
  add column if not exists sensitive_info_requested text,
  add column if not exists sensitive_info_stage text,
  add column if not exists sensitive_info_purpose_explained boolean,
  add column if not exists sensitive_info_necessary_perceived boolean;

-- Was the candidate contacted with evidence of research, or a mismatch?
-- Meaningful only for outreach the candidate did not initiate.
alter table hiring_submissions
  add constraint hiring_submissions_outreach_quality_check
  check (
    outreach_quality is null
    or outreach_quality = any (array['profile_reviewed_relevant', 'generic_outreach', 'obvious_mismatch'])
  ) not valid;

-- What category of sensitive personal information was requested, if any.
-- 'none' is a real, counted answer — not the same as null/unanswered.
alter table hiring_submissions
  add constraint hiring_submissions_sensitive_info_requested_check
  check (
    sensitive_info_requested is null
    or sensitive_info_requested = any (array['none', 'aadhaar', 'pan', 'bank_details', 'salary_slips', 'other'])
  ) not valid;

-- When it was requested. Same ladder shape as salary_proof_stage (0018): a
-- request after a written offer (for payroll/background-check purposes) is a
-- different practice than the same request at screening, before any offer
-- exists — this column lets that distinction be measured, not asserted.
alter table hiring_submissions
  add constraint hiring_submissions_sensitive_info_stage_check
  check (
    sensitive_info_stage is null
    or sensitive_info_stage = any (array['none', 'screening', 'interview', 'before_offer', 'after_offer'])
  ) not valid;

-- Redefine the view to carry the five new columns, appended at the end —
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
  s.sensitive_info_necessary_perceived
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- Redefine submit_hiring_report to insert the new columns. Signature
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
    sensitive_info_purpose_explained, sensitive_info_necessary_perceived
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
    (p_submission->>'sensitive_info_necessary_perceived')::boolean
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

-- Extend the M4 immutability guard (0025, last extended by 0027) to lock the
-- five new columns — content about what the candidate reported, not
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
  then
    raise exception 'hiring_submissions rows are immutable except is_approved, rejected_at and organization_id';
  end if;
  return new;
end;
$$;

-- Rollback:
--   create or replace function hiring_submissions_guard_immutable() ... (0027's body, minus the five new columns)
--   create or replace function submit_hiring_report(...) ... (0028's body, minus the five new columns)
--   create or replace view public_submissions ... (0028's select list, minus the five new columns)
--   alter table hiring_submissions
--     drop constraint if exists hiring_submissions_outreach_quality_check,
--     drop constraint if exists hiring_submissions_sensitive_info_requested_check,
--     drop constraint if exists hiring_submissions_sensitive_info_stage_check;
--   alter table hiring_submissions
--     drop column if exists outreach_quality,
--     drop column if exists sensitive_info_requested,
--     drop column if exists sensitive_info_stage,
--     drop column if exists sensitive_info_purpose_explained,
--     drop column if exists sensitive_info_necessary_perceived;
