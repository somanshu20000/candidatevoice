-- CandidateVoice migration: wire verification_tier through the write + read
-- path (M5.3)
--
-- WHY THIS EXISTS
-- 0027 added hiring_submissions.verification_tier (the column) and the
-- content-free verification_grants table, but nothing WROTE the column and no
-- read surface EXPOSED it. This migration closes both ends of the pipeline so
-- a redeemed grant can actually reach approved evidence:
--   1. submit_hiring_report now writes verification_tier (defaulting to
--      'unverified'), exactly like every other optional field on p_submission.
--   2. public_submissions now projects verification_tier, so the Evidence
--      Engine's first-party loader can carry it onto EvidenceItem.
--
-- WHAT THIS DOES NOT CHANGE
-- verification_tier is provenance METADATA, never a weight (D-022). This
-- migration only moves the value through the pipeline; nothing here (and
-- nothing in src/lib/evidence) lets a tier alter an aggregate. Moderation is
-- untouched — the tier is stamped at insert and locked immutable by 0027's
-- guard, so it survives approval exactly as submitted.
--
-- The tier is still caller-asserted at the /api/verify/grant scaffolding
-- boundary (M5.2a) — no email is sent, so a 'contact_domain' tier does not yet
-- prove employment. This migration wires the plumbing; it does not add proof.
--
-- Run order: after 0027. Signature of submit_hiring_report is UNCHANGED (still
-- 3 jsonb params) — verification_tier arrives as an optional key on
-- p_submission, so an old caller that never sends it lands 'unverified'.

-- ---------------------------------------------------------------------------
-- 1. Redefine submit_hiring_report to write verification_tier.
-- ---------------------------------------------------------------------------
--    Full body repeated from 0020 (create-or-replace needs the whole
--    definition) with the single new column added. coalesce(..., 'unverified')
--    mirrors reporter_type's coalesce default: absent stays the safe default,
--    never a CHECK violation.
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
    verification_tier
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
    coalesce(nullif(p_submission->>'verification_tier', ''), 'unverified')
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

-- ---------------------------------------------------------------------------
-- 2. Expose verification_tier on the public read surface.
-- ---------------------------------------------------------------------------
--    Full select list repeated from 0020 with s.verification_tier appended.
--    STILL never projects created_at (only reported_month) — the anonymity
--    coarsening 0003 established is preserved; the tier is a coarse enum, not a
--    per-person identifier, so it is safe to expose at this boundary.
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
  s.verification_tier
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- Rollback:
--   create or replace view public_submissions ... (0020's select list, minus verification_tier)
--   create or replace function submit_hiring_report(...) ... (0020's body, minus verification_tier)
