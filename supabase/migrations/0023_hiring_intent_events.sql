-- CandidateVoice migration: longitudinal hiring-intent / hiring-outcome
-- events (Milestone 2, candidate-side only)
--
-- WHY THIS EXISTS
-- Every existing table in this codebase is STATE, not EVENTS — a submission
-- row, an organization row, a verification_status enum that transitions in
-- place. This is the first genuine event-sourcing primitive: "how serious did
-- the company seem about hiring, and did it go anywhere" cannot be answered
-- by a single status column without losing the timeline that makes the answer
-- trustworthy (a company that goes silent for 40 days after 3 interviews
-- reads very differently from one that goes silent after a single screen).
--
-- SCOPE. Candidate-side only, as explicitly directed. No HR write path, no HR
-- authentication (none exists anywhere in this app — the only "auth" today is
-- a single shared ADMIN_SECRET with no per-user identity), no cron/scheduler
-- (none exists either — the 30-day inference is computed at read time, not by
-- a background job). Neither is invented here. Not integrated into HQS,
-- fingerprint, or the Evidence Engine — zero code path in
-- src/lib/evidence/*, src/lib/fingerprint/*, or src/utils/hqs.ts reads these
-- tables. No historical backfill.
--
-- Run order: after 0022.

-- ---------------------------------------------------------------------------
-- 1. Hiring opportunities — the parent container multiple candidate reports
--    for the same role at the same company attach to. Without this, "Google
--    Software Engineer" from 2024 and 2026 would falsely merge into one
--    timeline if events attached directly to (organization, role) instead.
-- ---------------------------------------------------------------------------
--    role_key is a SIMPLE normalization (lower, trim, collapse whitespace) —
--    this codebase has no job-title taxonomy to reuse (the "fingerprint" here
--    is the per-company BEHAVIOURAL fingerprint, unrelated). A fuller
--    role-normalization service is future work, not invented here.
create table if not exists hiring_opportunities (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references organizations(id),
  role_key               text not null,
  first_observed_at      timestamptz not null default now(),
  last_activity_at       timestamptz not null default now(),
  -- Pushed forward by every new candidate event attached to this opportunity
  -- (see hiring-events.ts's matching service). Crossing this without a new
  -- event is what makes staleInference() fire — computed at READ time, since
  -- no scheduler exists to do it proactively.
  observation_deadline_at timestamptz not null,
  created_at             timestamptz not null default now(),

  constraint hiring_opportunities_role_key_length check (char_length(role_key) between 1 and 200)
);

create index if not exists hiring_opportunities_org_role_idx
  on hiring_opportunities (organization_id, role_key, last_activity_at desc);

-- ---------------------------------------------------------------------------
-- 2. Hiring events — append-only, fully immutable. Every meaningful change is
--    a NEW row; nothing is ever updated in place, and a derived inference
--    (system_stale_inference) is its own event, never a mutation of an
--    earlier one. This is the literal implementation of "never overwrite
--    historical states."
-- ---------------------------------------------------------------------------
--    actor_type: ONLY 'candidate' and 'system' are legal values today.
--    'hr' is DELIBERATELY not yet a legal value — mirrors reporter_type's own
--    history exactly (migration 0000 reserved it as candidate-only; 0020
--    widened it once the product was ready). Widening this CHECK to admit
--    'hr' is a future migration, gated on organization-level authentication
--    existing at all (it does not today — see the scope note above). This is
--    a schema-level guarantee, not an application-code promise: no route, no
--    UI, no future refactor can silently start writing HR events without a
--    deliberate migration first.
create table if not exists hiring_events (
  id                     uuid primary key default gen_random_uuid(),
  hiring_opportunity_id  uuid not null references hiring_opportunities(id),
  actor_type             text not null check (actor_type in ('candidate', 'system')),
  -- Provenance only — traces an event back to the anonymous submission it
  -- came from, for moderation/audit. hiring_submissions rows carry no
  -- cross-linkable identity themselves (no candidate_id, no stored PII), so
  -- this FK introduces no new de-anonymization surface — it is the same
  -- anonymity envelope hiring_submissions already lives in, not a new one.
  submission_id          uuid references hiring_submissions(id),
  event_type             text not null check (event_type in (
    'role_reported',
    'interview_occurred',
    'candidate_perceived_intent',
    'candidate_outcome',
    'candidate_follow_up',
    'system_stale_inference'
  )),
  -- Typed and validated at the application layer (src/lib/hiring-intent/*),
  -- matching this codebase's existing validateOptionalEnum discipline rather
  -- than adding a new schema-validation dependency. Each event_type has an
  -- exact expected shape documented in src/lib/hiring-intent/events.ts.
  payload                jsonb not null default '{}'::jsonb,
  -- YYYY-MM only, mirroring public_submissions' own anonymity coarsening
  -- (migration 0003) — created_at (exact) is retained for internal ordering
  -- and the 30-day deadline arithmetic, but is NEVER exposed publicly; see
  -- public_hiring_events below. This is the "reported_month/public-safe
  -- dates" requirement, applied consistently with the rest of the schema.
  reported_month         text,
  created_at             timestamptz not null default now(),

  constraint hiring_events_reported_month_format check (reported_month is null or reported_month ~ '^\d{4}-\d{2}$')
);

create index if not exists hiring_events_opportunity_idx
  on hiring_events (hiring_opportunity_id, created_at asc);

-- Full immutability: no column may ever change after insert (stricter than
-- external_reports_guard_immutable, which still allows a moderation-state
-- transition — an event log has no moderation state, only new events).
create or replace function hiring_events_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hiring_events rows are immutable and append-only — insert a new event instead of updating this one';
  return old; -- unreachable; satisfies the plpgsql return requirement
end;
$$;

drop trigger if exists hiring_events_immutable on hiring_events;
create trigger hiring_events_immutable
  before update on hiring_events
  for each row execute function hiring_events_guard_immutable();

drop trigger if exists hiring_events_no_delete on hiring_events;
create trigger hiring_events_no_delete
  before delete on hiring_events
  for each row execute function hiring_events_guard_immutable();

-- ---------------------------------------------------------------------------
-- 3. Public read surface — aggregate only, exact timestamps and submission_id
--    stripped. Mirrors public_submissions' own shape and reasoning exactly.
-- ---------------------------------------------------------------------------
create or replace view public_hiring_events
with (security_invoker = on)
as
select
  e.id,
  e.hiring_opportunity_id,
  o.organization_id,
  e.actor_type,
  e.event_type,
  e.payload,
  e.reported_month
from hiring_events e
join hiring_opportunities o on o.id = e.hiring_opportunity_id;

create or replace view public_hiring_opportunities
with (security_invoker = on)
as
select
  id,
  organization_id,
  role_key,
  first_observed_at,
  last_activity_at,
  observation_deadline_at
from hiring_opportunities;

grant select on public_hiring_events to anon, authenticated;
grant select on public_hiring_opportunities to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. RLS — writes go through the service-role client only (the submit route),
--    exactly like hiring_submissions' own write path. No anon/authenticated
--    insert policy on either table; the public views above are the only
--    public-facing read surface.
-- ---------------------------------------------------------------------------
alter table hiring_opportunities enable row level security;
alter table hiring_events enable row level security;

-- Rollback:
--   drop view if exists public_hiring_opportunities;
--   drop view if exists public_hiring_events;
--   drop trigger if exists hiring_events_no_delete on hiring_events;
--   drop trigger if exists hiring_events_immutable on hiring_events;
--   drop function if exists hiring_events_guard_immutable();
--   drop table if exists hiring_events;
--   drop table if exists hiring_opportunities;
