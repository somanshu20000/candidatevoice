-- CandidateVoice migration: compensation transparency & privacy practices
--
-- WHY THIS EXISTS
-- Salary negotiation is an information-asymmetry problem: the employer knows
-- the band, the candidate knows only their own history. Asking for salary
-- history anchors the offer to the candidate's past instead of the role's
-- value. These four columns record what a company ACTUALLY DID during hiring,
-- so the asymmetry becomes measurable instead of anecdotal.
--
-- CANDIDATE-KNOWABLE, WHICH IS WHY THIS IS COLLECTABLE AT ALL.
-- Every value here is something the candidate directly experienced during the
-- process ("they asked for my payslip at screening"). That is the same test
-- that admitted compensation_clarity/work_arrangement_clarity in 0017 and that
-- excluded salary satisfaction / WLB / growth — those need having WORKED
-- somewhere, and remain out of scope (see the employee-sourced leadership /
-- work_culture dimensions).
--
-- FIRST-PARTY ONLY, like application_channel (0014), call_duration and
-- first_interaction_outcome before it: external_reports has no equivalent and
-- never will — a third-party forum post cannot structurally know at which
-- stage the poster was asked for a payslip. The Evidence Engine already models
-- this as reduced `coverage` (W1 field asymmetry), not as a bug.
--
-- NULL IS NOT "NO". This distinction is load-bearing:
--     NULL      the candidate did not answer  -> excluded from the metric entirely
--     'never'   the candidate answered: they were never asked  -> counts as good
-- Conflating the two would let silence manufacture either an accusation or a
-- clean record. Every aggregate over these columns MUST treat NULL as "not
-- eligible", never as a value. This is the schema-level half of the product
-- rule that we never infer a company's intent from a candidate's silence.
--
-- GENERIC DOCUMENT TYPES. 'tax_document' rather than 'form_16': Form 16 is
-- India-specific, and CandidateVoice's pilot market is India, but the schema
-- should not need a migration to cross a border. The UI labels it
-- region-appropriately; the stored value stays generic.
--
-- NULLABLE AND OPTIONAL AT THE FORM, for the same reason as 0014: a required
-- field fights the platform's real bottleneck (evidence acquisition). A
-- candidate who skips these still files a fully usable report.
--
-- Run order: after 0017.

alter table hiring_submissions
  add column if not exists salary_history_stage text,
  add column if not exists salary_proof_type text,
  add column if not exists salary_proof_stage text,
  add column if not exists salary_range_disclosed text;

-- At what point (if ever) was previous/current salary asked for?
-- Answers "does it ask" AND "how early" in one field: the earlier in the
-- process, the more the offer can be anchored to history rather than role value.
alter table hiring_submissions
  add constraint hiring_submissions_salary_history_stage_check
  check (
    salary_history_stage is null
    or salary_history_stage = any (array['never', 'application', 'screening', 'interview', 'offer'])
  );

-- What documentary PROOF of salary was demanded. An escalating invasiveness
-- ladder: a payslip is common practice; a bank statement or tax document is a
-- request for the candidate's wider financial records, which is a different
-- kind of ask entirely.
alter table hiring_submissions
  add constraint hiring_submissions_salary_proof_type_check
  check (
    salary_proof_type is null
    or salary_proof_type = any (array['none', 'payslip', 'bank_statement', 'tax_document'])
  );

-- When that proof was demanded. Requesting verification AFTER a written offer
-- (for payroll) is ordinary; demanding it during screening, before any offer
-- exists, is the practice candidates most often report as coercive.
alter table hiring_submissions
  add constraint hiring_submissions_salary_proof_stage_check
  check (
    salary_proof_stage is null
    or salary_proof_stage = any (array['none', 'screening', 'interview', 'before_offer', 'after_offer'])
  );

-- When the company disclosed ITS range — the other side of the asymmetry.
-- 'never' here is a fact the candidate observed, deliberately NOT phrased as
-- "refused": a range that never came up is not the same as a range the company
-- declined to give, and we do not infer intent from absence.
alter table hiring_submissions
  add constraint hiring_submissions_salary_range_disclosed_check
  check (
    salary_range_disclosed is null
    or salary_range_disclosed = any (array['in_posting', 'before_first', 'before_final', 'at_offer', 'never'])
  );

-- Redefine the view to carry the four new columns. Same shape, same filter,
-- same security_invoker + grants — only the select list changes. The new
-- columns are APPENDED at the very end: `create or replace view` treats a
-- column inserted at any other position as a RENAME of whatever currently
-- occupies that slot, which Postgres rejects (42P16). Learned in 0014.
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
  s.salary_range_disclosed
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- Redefine submit_hiring_report to insert the new columns. Signature UNCHANGED
-- (still 3 jsonb params) — the new fields arrive as optional keys on
-- p_submission, so the API caller needs no new RPC parameter. nullif('') keeps
-- an empty string from becoming a CHECK violation: absent stays NULL.
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
    salary_history_stage, salary_proof_type, salary_proof_stage, salary_range_disclosed
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
    nullif(p_submission->>'salary_range_disclosed', '')
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
--   create or replace view public_submissions ... (0014's select list, minus the four columns)
--   create or replace function submit_hiring_report(...) ... (0014's body, minus the four columns)
--   alter table hiring_submissions
--     drop constraint hiring_submissions_salary_history_stage_check,
--     drop constraint hiring_submissions_salary_proof_type_check,
--     drop constraint hiring_submissions_salary_proof_stage_check,
--     drop constraint hiring_submissions_salary_range_disclosed_check;
--   alter table hiring_submissions
--     drop column salary_history_stage, drop column salary_proof_type,
--     drop column salary_proof_stage, drop column salary_range_disclosed;
