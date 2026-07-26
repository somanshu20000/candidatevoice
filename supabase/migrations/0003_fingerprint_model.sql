-- CandidateVoice migration: Organizational Fingerprint model
--
-- WHY THIS EXISTS
-- The product needs to express an employer's hiring behaviour as a set of
-- evidenced dimensions rather than a star rating. That requires structured,
-- per-facet observations that can be counted, corroborated and trended.
--
-- SHAPE OF THE MODEL
--   fingerprint_dimensions  reference: the six fingerprint nodes
--   fingerprint_facets      reference: the questions that roll up into a node
--   emotions                reference: the closed emotion vocabulary
--   submission_ratings      evidence:  one 1-5 rating per (submission, facet)
--   submission_emotions     evidence:  one row per (submission, emotion)
--
-- WHY NORMALIZED RATHER THAN WIDE COLUMNS
-- Thirteen `cx_respect smallint` columns on hiring_submissions would make every
-- new facet a schema migration and every "how many people answered this one?"
-- a hand-written count. A facet table plus a ratings table makes the taxonomy
-- queryable data, keeps typed CHECK constraints (unlike a JSONB payload, which
-- docs/adr-0001-evidence-model.md §7 trap #2 explicitly warns against), and
-- leaves hiring_submissions — and therefore src/utils/hqs.ts — untouched.
--
-- WHY EVERY RATING IS OPTIONAL
-- A candidate who never got a take-home cannot rate assignment reasonableness,
-- and one who never reached an offer cannot rate negotiation conduct. Forcing a
-- value would manufacture evidence. The consequence is that evidence counts
-- differ per facet, which is precisely why the UI must show a count and a
-- confidence next to every number rather than a bare score.
--
-- Run order: after 0003.

-- ---------------------------------------------------------------------------
-- 1. Reference: dimensions (the six nodes of the fingerprint)
-- ---------------------------------------------------------------------------
create table if not exists fingerprint_dimensions (
  key           text primary key,
  label         text not null,
  description   text not null,
  -- Who is able to witness this dimension at all. A candidate cannot honestly
  -- report on internal politics or psychological safety; an employee can.
  source_type   text not null check (source_type in ('candidate','employee','both')),
  -- How the dimension is measured. 'likert' rolls up facet ratings;
  -- 'emotion' aggregates a distribution over the emotion vocabulary.
  measurement   text not null check (measurement in ('likert','emotion')),
  display_order smallint not null,

  constraint fingerprint_dimensions_key_format check (key ~ '^[a-z0-9_]+$')
);

-- ---------------------------------------------------------------------------
-- 2. Reference: facets (the individual rated questions)
-- ---------------------------------------------------------------------------
create table if not exists fingerprint_facets (
  key           text primary key,
  dimension_key text not null references fingerprint_dimensions(key) on delete restrict,
  label         text not null,
  prompt        text not null,
  -- Anchored endpoints. An unlabelled 1-5 scale means different things to
  -- different people, which makes the aggregate meaningless. Every scale states
  -- what 1 and 5 actually are, and those strings are rendered on the form.
  anchor_low    text not null,
  anchor_high   text not null,
  display_order smallint not null,

  constraint fingerprint_facets_key_format check (key ~ '^[a-z0-9_]+$')
);

create index if not exists fingerprint_facets_dimension_idx
  on fingerprint_facets (dimension_key, display_order);

-- ---------------------------------------------------------------------------
-- 3. Reference: emotion vocabulary (closed set, self-reported)
-- ---------------------------------------------------------------------------
--    Self-selected from a fixed list — NOT inferred. claude.md §3 and §6 and
--    the ADR §3 all forbid AI scoring, and a candidate ticking "Ignored" is
--    direct testimony, whereas a model inferring sentiment from prose is a
--    derived guess about which no evidence claim can be made.
create table if not exists emotions (
  key           text primary key,
  label         text not null,
  valence       text not null check (valence in ('positive','negative')),
  display_order smallint not null,

  constraint emotions_key_format check (key ~ '^[a-z0-9_]+$')
);

-- ---------------------------------------------------------------------------
-- 4. Evidence: ratings
-- ---------------------------------------------------------------------------
create table if not exists submission_ratings (
  submission_id uuid     not null references hiring_submissions(id) on delete cascade,
  facet_key     text     not null references fingerprint_facets(key) on delete restrict,
  rating        smallint not null check (rating between 1 and 5),

  primary key (submission_id, facet_key)
);

-- Aggregation reads every rating for a facet across a company, so the facet
-- side needs its own index (the PK only serves submission-first lookups).
create index if not exists submission_ratings_facet_idx
  on submission_ratings (facet_key, rating);

-- ---------------------------------------------------------------------------
-- 5. Evidence: emotions
-- ---------------------------------------------------------------------------
create table if not exists submission_emotions (
  submission_id uuid not null references hiring_submissions(id) on delete cascade,
  emotion_key   text not null references emotions(key) on delete restrict,

  primary key (submission_id, emotion_key)
);

create index if not exists submission_emotions_emotion_idx
  on submission_emotions (emotion_key);

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
alter table fingerprint_dimensions enable row level security;
alter table fingerprint_facets     enable row level security;
alter table emotions               enable row level security;
alter table submission_ratings     enable row level security;
alter table submission_emotions    enable row level security;

-- Reference tables are public.
drop policy if exists fingerprint_dimensions_public_read on fingerprint_dimensions;
create policy fingerprint_dimensions_public_read
  on fingerprint_dimensions for select to anon, authenticated using (true);

drop policy if exists fingerprint_facets_public_read on fingerprint_facets;
create policy fingerprint_facets_public_read
  on fingerprint_facets for select to anon, authenticated using (true);

drop policy if exists emotions_public_read on emotions;
create policy emotions_public_read
  on emotions for select to anon, authenticated using (true);

-- Evidence rows inherit the visibility of their parent submission. Without
-- this, ratings attached to an unmoderated submission would be publicly
-- readable before a human ever reviewed it — leaking the content of pending
-- and rejected reports.
drop policy if exists submission_ratings_public_read on submission_ratings;
create policy submission_ratings_public_read
  on submission_ratings for select
  to anon, authenticated
  using (exists (
    select 1 from hiring_submissions s
    where s.id = submission_ratings.submission_id
      and s.is_approved = true
      and s.rejected_at is null
  ));

drop policy if exists submission_emotions_public_read on submission_emotions;
create policy submission_emotions_public_read
  on submission_emotions for select
  to anon, authenticated
  using (exists (
    select 1 from hiring_submissions s
    where s.id = submission_emotions.submission_id
      and s.is_approved = true
      and s.rejected_at is null
  ));

-- ---------------------------------------------------------------------------
-- 7. Public read surface — coarsened time
-- ---------------------------------------------------------------------------
--    docs/adr-0001-evidence-model.md §7 trap #7 names this as a live, unfixed
--    leak: "Publishing exact per-row created_at -> the live fingerprint leak.
--    Coarsen at the boundary." An exact timestamp plus company plus role at low
--    volume identifies a person. INV-2 calls coarseness "the anonymity
--    guarantee, not a preference."
--
--    This view is that boundary. It exposes reported_month (YYYY-MM) and does
--    not select created_at at all, so no query built on it can leak precision
--    by accident. created_at stays on the base table for ordering and audit.
--
--    security_invoker makes the view run under the querying role's RLS rather
--    than the view owner's, so anon reading this view is still subject to the
--    hiring_submissions policy. Requires Postgres 15+ (Supabase default).
drop view if exists public_submissions;
create view public_submissions
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
  to_char(date_trunc('month', s.created_at at time zone 'UTC'), 'YYYY-MM') as reported_month
from hiring_submissions s
where s.is_approved = true
  and s.rejected_at is null;

grant select on public_submissions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. Seed the taxonomy
-- ---------------------------------------------------------------------------
--    Mirrored in TypeScript at src/lib/fingerprint/taxonomy.ts. The two must
--    agree; tests/fingerprint-taxonomy.test.ts asserts it.
--
--    ON CONFLICT DO UPDATE so re-running this migration corrects labels and
--    ordering without duplicating rows or orphaning existing ratings.

insert into fingerprint_dimensions (key, label, description, source_type, measurement, display_order) values
  ('professionalism',      'Professionalism',      'Conduct of the people running the process — recruiters, interviewers, and whoever handles the offer.', 'candidate', 'likert',  1),
  ('candidate_experience', 'Candidate Experience', 'How the process treated the person going through it: respect, fairness, communication and feedback.',  'candidate', 'likert',  2),
  ('hiring_process',       'Hiring Process',       'The structure of the process itself — clarity of the role, pacing, assignments and technical rigour.', 'candidate', 'likert',  3),
  ('emotional_climate',    'Emotional Climate',    'How candidates report feeling during and after the process, self-selected from a fixed vocabulary.',  'candidate', 'emotion', 4),
  ('leadership',           'Leadership',           'Manager behaviour, ownership, accountability and decision quality. Requires evidence from inside.',   'employee',  'likert',  5),
  ('work_culture',         'Work Culture',         'Collaboration, learning, bureaucracy, balance and psychological safety. Requires evidence from inside.', 'employee', 'likert',  6)
on conflict (key) do update set
  label = excluded.label,
  description = excluded.description,
  source_type = excluded.source_type,
  measurement = excluded.measurement,
  display_order = excluded.display_order;

insert into fingerprint_facets (key, dimension_key, label, prompt, anchor_low, anchor_high, display_order) values
  -- Professionalism
  ('recruiter_professionalism', 'professionalism', 'Recruiter conduct',       'How did the recruiter conduct themselves?',                'Unprofessional or misleading', 'Consistently professional', 1),
  ('interviewer_preparedness',  'professionalism', 'Interviewer preparation', 'Were your interviewers prepared?',                          'Had not read anything',        'Well prepared',             2),
  ('punctuality',               'professionalism', 'Punctuality',             'Did interviews happen when they were scheduled?',           'Late, moved or no-showed',     'On time as scheduled',      3),
  ('negotiation_conduct',       'professionalism', 'Offer conduct',           'How was the offer or salary discussion handled?',           'Pressuring or evasive',        'Straightforward and clear', 4),

  -- Candidate Experience
  ('respect',                   'candidate_experience', 'Respect',        'Were you treated with respect?',                               'Dismissive or rude',           'Consistently respectful',   1),
  ('fairness',                  'candidate_experience', 'Fairness',       'Was the evaluation fair and relevant to the role?',             'Arbitrary or biased',          'Fair and job-relevant',     2),
  ('communication',             'candidate_experience', 'Communication',  'How clear and timely was communication?',                       'Silence or confusion',         'Clear and prompt',          3),
  ('feedback_quality',          'candidate_experience', 'Feedback',       'What was the quality of the feedback you received?',            'None, or entirely generic',    'Specific and useful',       4),
  ('transparency',              'candidate_experience', 'Transparency',   'How open were they about the role, process and pay?',           'Withheld or misleading',       'Open and upfront',          5),

  -- Hiring Process
  ('role_clarity',              'hiring_process', 'Role clarity',      'Was the role clearly defined?',                                    'Vague or kept shifting',       'Clearly defined throughout', 1),
  ('process_efficiency',        'hiring_process', 'Pacing',            'Was the process an appropriate length for the role?',              'Dragged out or stalled',       'Well paced',                 2),
  ('assignment_reasonableness', 'hiring_process', 'Assignment scope',  'If there was a take-home or assignment, was it reasonable?',       'Excessive or unpaid real work','Reasonable in scope',        3),
  ('technical_depth',           'hiring_process', 'Technical rigour',  'How relevant and rigorous was the technical evaluation?',          'Superficial or irrelevant',    'Rigorous and relevant',      4)
on conflict (key) do update set
  dimension_key = excluded.dimension_key,
  label = excluded.label,
  prompt = excluded.prompt,
  anchor_low = excluded.anchor_low,
  anchor_high = excluded.anchor_high,
  display_order = excluded.display_order;

insert into emotions (key, label, valence, display_order) values
  ('appreciated', 'Appreciated', 'positive', 1),
  ('respected',   'Respected',   'positive', 2),
  ('excited',     'Excited',     'positive', 3),
  ('motivated',   'Motivated',   'positive', 4),
  ('confused',    'Confused',    'negative', 5),
  ('stressed',    'Stressed',    'negative', 6),
  ('frustrated',  'Frustrated',  'negative', 7),
  ('ignored',     'Ignored',     'negative', 8),
  ('angry',       'Angry',       'negative', 9),
  ('burned_out',  'Burned out',  'negative', 10)
on conflict (key) do update set
  label = excluded.label,
  valence = excluded.valence,
  display_order = excluded.display_order;

-- Rollback:
--   drop view if exists public_submissions;
--   drop table if exists submission_emotions;
--   drop table if exists submission_ratings;
--   drop table if exists emotions;
--   drop table if exists fingerprint_facets;
--   drop table if exists fingerprint_dimensions;
