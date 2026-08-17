-- CandidateVoice migration: external acquisition run tracking
--
-- WHY THIS EXISTS
-- external_reports.verification_status (migration 0008) tracks PER-RECORD
-- state (pending/approved/rejected/archived) — but a single acquisition
-- attempt can produce zero, one, or many records, and "zero records found"
-- is invisible today: no row exists anywhere to show an attempt happened.
-- An admin watching the pipeline needs to see the ATTEMPT, not just its
-- surviving output. This is genuinely new information, not a duplicate of
-- any existing table — it is scoped as tightly as possible: one row per
-- acquisition run, no evidence content, no duplication of external_reports'
-- own fields beyond aggregate counts.
--
-- STATUS VALUES map directly to the pipeline stages:
--   queued              -> row inserted, adapter not yet called
--   fetching            -> adapter.load() in flight
--   extracted           -> adapter returned records, about to validate/import
--   validation_failed   -> every record failed validation (0 created)
--   awaiting_moderation -> at least one record landed pending
--   completed           -> ran cleanly, nothing new (0 created, e.g. all duplicate)
--   failed              -> threw (ineligible source, adapter error, etc.) — see error_message
--
-- Run order: after 0030.

create table if not exists external_acquisition_runs (
  id                uuid primary key default gen_random_uuid(),
  source_key        text not null,
  company_query     text not null,
  organization_id   uuid references organizations(id) on delete set null,
  status            text not null default 'queued'
    check (status in ('queued','fetching','extracted','validation_failed','awaiting_moderation','completed','failed')),
  records_found     int not null default 0,
  records_created   int not null default 0,
  records_duplicate int not null default 0,
  records_invalid   int not null default 0,
  error_message     text,
  triggered_by      text not null default 'manual' check (triggered_by in ('manual','cron','api')),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,

  constraint external_acquisition_runs_query_length check (char_length(company_query) between 1 and 200),
  constraint external_acquisition_runs_error_length check (error_message is null or char_length(error_message) <= 2000)
);

create index if not exists external_acquisition_runs_recent_idx
  on external_acquisition_runs (started_at desc);

create index if not exists external_acquisition_runs_org_idx
  on external_acquisition_runs (organization_id)
  where organization_id is not null;

-- Service-role only, matching moderation_audit_log/rate_limit_counters — this
-- is operations tooling, never a public surface, and it names no evidence.
alter table external_acquisition_runs enable row level security;

-- Rollback:
--   drop table if exists external_acquisition_runs;
