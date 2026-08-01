-- CandidateVoice migration: application_channel (the Evidence Match cohort field)
--
-- WHY THIS EXISTS
-- The Evidence Engine can already filter/aggregate by any collected candidate
-- attribute — that's the whole point of weightedRate/weightedShare taking a
-- predicate. `experience_bucket` was the only such attribute on the candidate
-- side. This adds a second: HOW they applied. It directly answers the
-- product's own worked example ("40% had referrals") honestly — as a real
-- correlation over real reports, never an invented ATS weight.
--
-- FIRST-PARTY ONLY, DELIBERATELY. Like call_duration and
-- first_interaction_outcome before it, external_reports has no equivalent
-- column and never will: a third-party forum post cannot structurally know
-- how the poster applied. This is the same W1 field-asymmetry the Evidence
-- Engine already handles via reduced `coverage` — not a bug to work around.
--
-- NULLABLE AND OPTIONAL AT THE FORM. Adding a required field to the submit
-- flow fights the platform's own stated bottleneck (evidence acquisition,
-- not engineering) by adding friction. A candidate who skips it still submits
-- a fully usable report; cohort filtering on this field simply excludes them
-- from that one slice, exactly like any other missing field already does.
--
-- Run order: after 0013.

alter table hiring_submissions
  add column if not exists application_channel text;

alter table hiring_submissions
  add constraint hiring_submissions_application_channel_check
  check (
    application_channel is null
    or application_channel = any (array['referral', 'recruiter_outreach', 'job_board', 'company_website', 'other'])
  );

-- Redefine the view to carry the new column. Same shape, same filter
-- (is_approved and rejected_at is null), same security_invoker + grants —
-- only the select list changes. application_channel is appended at the END
-- of the select list, not placed near payment_flag where it reads more
-- naturally: `create or replace view` treats a column inserted at any other
-- position as a RENAME of the existing column occupying that slot, which
-- Postgres rejects (42P16). New columns must always append.
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
  s.application_channel
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- Redefine submit_hiring_report (0013) to insert the new column. Signature is
-- UNCHANGED (still 3 jsonb params) — application_channel arrives as an
-- optional key on p_submission, exactly like every other field, so the API
-- caller does not need a new RPC parameter.
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
    application_channel
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
    nullif(p_submission->>'application_channel', '')
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
--   create or replace view public_submissions ... (0003's original select list, minus application_channel)
--   create or replace function submit_hiring_report(...) ... (0013's original body, minus application_channel)
--   alter table hiring_submissions drop constraint hiring_submissions_application_channel_check;
--   alter table hiring_submissions drop column application_channel;
