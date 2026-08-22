-- CandidateVoice migration: culture themes (closed-enum, Phase 4 of the
-- product-experience audit)
--
-- WHY A CLOSED VOCABULARY, NOT FREE TEXT
-- The literal ask was "culture word clouds," which normally implies
-- tokenizing free text. This product has never collected free text about a
-- company and never will (docs/adr-0001 §1.5, D-013): a sentence is where a
-- recruiter's name, a colleague's identity, or a defamatory claim leaks in.
-- The honest translation is a self-selected, closed set of workplace-practice
-- tags — same shape and same justification as `emotions` (0003): "Self-
-- selected from a fixed list — NOT inferred." A frequency cloud over these
-- tags gives the same visual effect with zero free-text risk.
--
-- SAME SHAPE AS emotions / submission_emotions, DELIBERATELY.
-- Reference table (culture_themes) + evidence table (submission_culture_themes),
-- FK-enforced closed vocabulary, multi-select per submission. This is not a
-- new pattern; it is the existing 0003 pattern applied to a second closed
-- vocabulary. The aggregation reuses the exact reduction
-- src/lib/fingerprint/likert.ts's emotionShares() already established.
--
-- WHY EMPLOYEE/FORMER-EMPLOYEE ONLY (enforced at the wizard/route, not here)
-- Culture is "what it's like working there" — a candidate who only
-- interviewed cannot honestly answer it, the same reasoning that scopes
-- work_culture/leadership to sourceType 'employee' in taxonomy.ts and
-- would_recommend/conduct_environment to employee+former_employee in
-- culture.ts/conduct.ts. This migration does not need its own enforcement:
-- by construction, only the employee/former-employee wizard step renders the
-- picker, so no candidate submission ever writes a row here — the same
-- implicit-by-UI scoping submission_ratings/submission_emotions already rely
-- on for their own candidate-only facets.
--
-- NEVER ABOUT A NAMED PERSON. Every theme describes a workplace PRACTICE
-- ("long hours expected", "supportive managers") — never an individual, same
-- rule conduct.ts enforces for conduct_environment.
--
-- Run order: after 0034.

-- ---------------------------------------------------------------------------
-- 1. Reference: closed theme vocabulary
-- ---------------------------------------------------------------------------
create table if not exists culture_themes (
  key           text primary key,
  label         text not null,
  valence       text not null check (valence in ('positive','negative')),
  display_order smallint not null,

  constraint culture_themes_key_format check (key ~ '^[a-z0-9_]+$')
);

insert into culture_themes (key, label, valence, display_order) values
  ('supportive_managers',       'Supportive managers',           'positive', 1),
  ('transparent_communication', 'Transparent communication',     'positive', 2),
  ('good_work_life_balance',    'Good work-life balance',        'positive', 3),
  ('learning_opportunities',    'Learning opportunities',        'positive', 4),
  ('clear_career_growth',       'Clear career growth',           'positive', 5),
  ('recognizes_contributions',  'Recognizes contributions',      'positive', 6),
  ('collaborative_teams',       'Collaborative teams',           'positive', 7),
  ('high_autonomy',             'High autonomy',                 'positive', 8),
  ('long_hours_expected',       'Long hours expected',           'negative', 9),
  ('high_pressure_deadlines',   'High-pressure deadlines',       'negative', 10),
  ('frequent_reorgs',           'Frequent reorgs',                'negative', 11),
  ('bureaucratic_processes',    'Bureaucratic processes',        'negative', 12),
  ('unclear_expectations',      'Unclear expectations',          'negative', 13),
  ('limited_growth_paths',      'Limited growth paths',          'negative', 14)
on conflict (key) do update set
  label = excluded.label,
  valence = excluded.valence,
  display_order = excluded.display_order;

-- ---------------------------------------------------------------------------
-- 2. Evidence: theme selections, one row per (submission, theme)
-- ---------------------------------------------------------------------------
create table if not exists submission_culture_themes (
  submission_id uuid not null references hiring_submissions(id) on delete cascade,
  theme_key     text not null references culture_themes(key) on delete restrict,

  primary key (submission_id, theme_key)
);

create index if not exists submission_culture_themes_theme_idx
  on submission_culture_themes (theme_key);

-- ---------------------------------------------------------------------------
-- 3. RLS — mirrors submission_emotions exactly
-- ---------------------------------------------------------------------------
alter table culture_themes             enable row level security;
alter table submission_culture_themes  enable row level security;

drop policy if exists culture_themes_public_read on culture_themes;
create policy culture_themes_public_read
  on culture_themes for select to anon, authenticated using (true);

-- Evidence rows inherit the visibility of their parent submission — a theme
-- picked on a pending or rejected report must not be publicly readable before
-- (or after failing) moderation.
drop policy if exists submission_culture_themes_public_read on submission_culture_themes;
create policy submission_culture_themes_public_read
  on submission_culture_themes for select
  to anon, authenticated
  using (exists (
    select 1 from hiring_submissions s
    where s.id = submission_culture_themes.submission_id
      and s.is_approved = true
      and s.rejected_at is null
  ));

-- ---------------------------------------------------------------------------
-- 4. Extend submit_hiring_report to write theme selections atomically.
-- ---------------------------------------------------------------------------
--    A fourth jsonb param, p_culture_themes — an array of theme_key strings,
--    not objects (unlike p_ratings/p_emotions, a theme selection carries no
--    second field). Same atomic-with-the-submission shape as ratings/emotions
--    since 0013: a bad theme_key aborts the whole insert (the FK to
--    culture_themes), never leaves an orphaned submission.
--
--    CREATE OR REPLACE does NOT retire the old 3-arg signature — Postgres
--    resolves overloads by argument count/types, so a 4th parameter creates a
--    SECOND function rather than replacing the first, leaving
--    submit_hiring_report(jsonb) ambiguous between the two (learned live: a
--    call passing only p_submission failed with "not a unique function").
--    The 3-arg overload must be dropped explicitly before the 4-arg version
--    is created.
drop function if exists submit_hiring_report(jsonb, jsonb, jsonb);

create or replace function submit_hiring_report(
  p_submission jsonb,
  p_ratings jsonb default '[]'::jsonb,
  p_emotions jsonb default '[]'::jsonb,
  p_culture_themes jsonb default '[]'::jsonb
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

  if jsonb_array_length(p_culture_themes) > 0 then
    insert into submission_culture_themes (submission_id, theme_key)
    select v_submission_id, (elem #>> '{}')
    from jsonb_array_elements(p_culture_themes) as elem;
  end if;

  return v_submission_id;
end;
$$;

-- Rollback:
--   create or replace function submit_hiring_report(...) ... (0033's body, minus p_culture_themes)
--   drop table if exists submission_culture_themes;
--   drop table if exists culture_themes;
