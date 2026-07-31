-- CandidateVoice migration: platform_settings (business policy, not config)
--
-- WHY THIS EXISTS
-- The Global Bootstrap Multiplier — how much APPROVED external evidence counts
-- relative to a first-party submission — is business POLICY, not infrastructure
-- configuration. It changes on an operational schedule as the first-party
-- dataset grows:
--     launch 0.35  →  after 1k reports 0.25  →  after 10k 0.10  →  mature 0.00
-- Nobody should have to redeploy the app to make that call, so it lives in the
-- database, not an environment variable.
--
-- THE SUNSET SWITCH. Setting global_external_multiplier = 0 instantly makes the
-- product first-party-only: every external report's effective weight becomes 0
-- (see src/lib/hiring-intel/weighting.ts), so it contributes nothing to
-- fingerprints, HQS, search or analytics — while remaining in the database for
-- provenance and audit. No migration, no code change, no schema change, no
-- special case. That is the whole point of storing it here.
--
-- Deliberately GENERIC key/value so future policy values reuse it. Only
-- NON-SENSITIVE, publicly-observable policy belongs here — the multiplier
-- shapes public rankings, so it is public by nature. Anything secret must not
-- be stored in this table (its read policy is public).
--
-- Run order: after 0010.

create table if not exists platform_settings (
  key         text primary key,
  -- jsonb so a value can be a number now and a richer object later without a
  -- schema change. For the multiplier it is a bare JSON number.
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now(),
  -- Who last changed it. We have a single admin secret, not named admins, so
  -- this is free text ('admin', 'system') — an audit breadcrumb, not identity.
  updated_by  text,

  constraint platform_settings_key_format check (key ~ '^[a-z0-9_]+$'),
  constraint platform_settings_description_len check (description is null or char_length(description) <= 500)
);

alter table platform_settings enable row level security;

-- Public read: these values shape public output, so reading them discloses
-- nothing. Writes are service-role only (the admin settings route), which
-- bypasses RLS — no anon/authenticated write policy exists, so RLS denies it.
drop policy if exists platform_settings_public_read on platform_settings;
create policy platform_settings_public_read
  on platform_settings for select to anon, authenticated using (true);

-- Seed the launch default. Range 0..1 is enforced in the application setter and
-- the admin route; the read path also clamps and fail-safes, so a bad value can
-- never make external evidence count MORE than a first-party submission.
insert into platform_settings (key, value, description, updated_by)
values (
  'global_external_multiplier',
  '0.35'::jsonb,
  'How much APPROVED external evidence counts vs a first-party submission (1.0). Launch default 0.35; lower it as first-party data grows; 0 = first-party only.',
  'system (launch default)'
)
on conflict (key) do nothing;

-- Rollback:
--   drop table if exists platform_settings;
