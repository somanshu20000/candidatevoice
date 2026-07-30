-- CandidateVoice migration: external hiring-intelligence reports
--
-- WHY THIS EXISTS
-- A deliberate, bounded reversal of the "no external UGC" rule, as a COLD-START
-- BOOTSTRAP ONLY. External, publicly-sourced hiring reports (initially Reddit)
-- seed the database so a visitor finds value before first-party submissions
-- reach critical mass. As traffic grows, external acquisition is reduced and
-- first-party candidate submissions become the primary, then preferred, source.
--
-- THE ONE INVARIANT THIS MIGRATION PROTECTS
-- An external report is a THIRD-PARTY claim (someone on Reddit said X about a
-- company), not first-party candidate testimony. It must never be mistaken for,
-- or silently commingled with, a `hiring_submissions` row — the entire product
-- trust model rests on "these are real candidates' structured reports". So this
-- is a SEPARATE table family, provably disjoint from evidence:
--
--   * No foreign key to hiring_submissions / submission_ratings / submission_emotions.
--     The only identifier shared with the evidence side is organization_id,
--     which names an EMPLOYER — never a person, never a first-party report.
--   * Its own moderation gate (verification_status), its own provenance columns.
--   * No post body column, by design: only extracted STRUCTURED FIELDS plus a
--     link back to the source are stored. A schema that cannot hold the original
--     post text cannot republish copyrighted user content or a defamatory
--     paragraph. (Product decision: structured facts + source link only.)
--   * No third-party author identifier. We do not store who on Reddit said it.
--
-- SCORING. External reports feed the Hiring Quality Score, but DOWN-WEIGHTED and
-- FLAGGED (product decision): external_sources.trust_weight scales their
-- contribution, and the UI labels them as external/unverified. The blending
-- logic is a separate, later application change; this migration only provides
-- the columns it needs (the same scoreable enums as hiring_submissions, plus a
-- per-source weight).
--
-- REMOVABILITY. A source can be turned off (external_sources.enabled=false) or
-- fully removed (delete from external_reports where source_id=...) with no
-- change to the rest of the app, which reads normalized rows regardless of
-- origin. That is what makes external acquisition a phase, not a dependency.
--
-- Run order: after 0007.

-- ---------------------------------------------------------------------------
-- 1. Source registry
-- ---------------------------------------------------------------------------
--    One row per acquisition source. The licence/terms columns are the legal
--    record of why ingesting from it is permitted and how it must be attributed.
create table if not exists external_sources (
  id                   uuid primary key default gen_random_uuid(),
  key                  text not null unique,
  display_name         text not null,
  kind                 text not null check (kind in ('forum','review_site','social','curated','other')),
  homepage_url         text,
  terms_url            text,
  license              text,
  attribution_required boolean not null default true,
  -- Turn a source off without deleting its rows. Phase-2/3 wind-down flips this.
  enabled              boolean not null default true,
  -- How much an approved report from this source counts toward a blended score,
  -- relative to a first-party submission (1.0). Bootstrap default: a third.
  trust_weight         numeric not null default 0.30 check (trust_weight >= 0 and trust_weight <= 1),
  notes                text,
  created_at           timestamptz not null default now(),

  constraint external_sources_key_format check (key ~ '^[a-z0-9_]+$'),
  constraint external_sources_notes_length check (notes is null or char_length(notes) <= 1000)
);

-- ---------------------------------------------------------------------------
-- 2. External reports — structured, sourced, moderated, DISJOINT from evidence
-- ---------------------------------------------------------------------------
create table if not exists external_reports (
  id               uuid primary key default gen_random_uuid(),

  -- Employer. `company` is the raw as-extracted name (mirrors
  -- hiring_submissions.company); organization_id is the resolved canonical
  -- employer, nullable until resolution. This is the ONLY column family shared
  -- with the evidence side, and it names an employer, not a person.
  company          text not null,
  organization_id  uuid references organizations(id) on delete set null,
  role             text,

  -- Provenance.
  source_id        uuid not null references external_sources(id) on delete restrict,
  -- Link back to the original — this is the attribution, and the reason we can
  -- store facts without storing the post: the source stays one click away.
  source_url       text not null,
  -- Stable id from the source (e.g. a Reddit post id) for exact dedup.
  external_ref     text,
  -- SHA-256 of the normalized structured fields, for content-level dedup /
  -- idempotent re-import.
  content_hash     text not null,

  -- Structured, scoreable fields. Same closed vocabularies as hiring_submissions
  -- so the blended score can run one estimator over both families. All NULLABLE:
  -- extraction from a forum post is imperfect, and a missing field must read as
  -- "unknown", never as a fabricated value.
  experience_bucket         text check (experience_bucket is null or experience_bucket in ('0-1','1-3','3-5','5-8','8+')),
  stage                     text check (stage is null or stage in ('applied','screening','technical','hr','final')),
  outcome                   text check (outcome is null or outcome in ('rejected','no_response','offer','ongoing')),
  response_time_bucket      text check (response_time_bucket is null or response_time_bucket in ('0-3','4-7','8-14','15+')),
  last_interaction_gap      text check (last_interaction_gap is null or last_interaction_gap in ('0-7','8-14','15-30','30+')),
  reason                    text check (reason is null or reason in ('experience_mismatch','skill_mismatch','culture_fit','no_reason','other')),
  payment_flag              boolean,

  -- Coarsened original date (YYYY-MM), never an exact timestamp — same anonymity
  -- posture as the public evidence view.
  reported_month   text check (reported_month is null or reported_month ~ '^\d{4}-\d{2}$'),

  -- Moderation. Nothing is public until a human approves it, exactly like
  -- first-party submissions.
  verification_status text not null default 'pending'
    check (verification_status in ('pending','approved','rejected')),
  reviewed_at      timestamptz,
  ingested_at      timestamptz not null default now(),

  constraint external_reports_company_length check (char_length(company) between 1 and 200),
  constraint external_reports_role_length check (role is null or char_length(role) <= 120),
  constraint external_reports_url_scheme check (source_url ~* '^https?://'),
  constraint external_reports_url_length check (char_length(source_url) between 4 and 500),
  constraint external_reports_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  -- Dedup: the same post, and the same structured content, import once per source.
  unique (source_id, external_ref),
  unique (source_id, content_hash)
);

create index if not exists external_reports_org_idx
  on external_reports (organization_id)
  where verification_status = 'approved';

create index if not exists external_reports_company_idx
  on external_reports (company)
  where verification_status = 'approved';

create index if not exists external_reports_pending_idx
  on external_reports (verification_status, ingested_at)
  where verification_status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table external_sources enable row level security;
alter table external_reports enable row level security;

-- The source registry is public reference data (names, licences, weights).
drop policy if exists external_sources_public_read on external_sources;
create policy external_sources_public_read
  on external_sources for select to anon, authenticated using (true);

-- Public reads see APPROVED reports only. Pending/rejected rows are invisible to
-- anon and authenticated alike — no policy grants them, so RLS denies them.
-- Every write is service-role (the importer / moderation), which bypasses RLS.
drop policy if exists external_reports_public_read on external_reports;
create policy external_reports_public_read
  on external_reports for select
  to anon, authenticated
  using (verification_status = 'approved');

-- ---------------------------------------------------------------------------
-- 4. Public read surface — coarsened, internal ids withheld
-- ---------------------------------------------------------------------------
--    Exposes the source label and link but not external_ref (which could be
--    used to enumerate original posts / their authors) or exact ingest time.
drop view if exists public_external_reports;
create view public_external_reports
with (security_invoker = on)
as
select
  r.id,
  r.organization_id,
  r.company,
  r.role,
  s.key          as source_key,
  s.display_name as source_name,
  s.trust_weight,
  r.source_url,
  r.experience_bucket,
  r.stage,
  r.outcome,
  r.response_time_bucket,
  r.last_interaction_gap,
  r.reason,
  r.payment_flag,
  r.reported_month
from external_reports r
join external_sources s on s.id = r.source_id
where r.verification_status = 'approved'
  and s.enabled = true;

grant select on public_external_reports to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Seed the Reddit source (DISABLED and un-attributed until reviewed)
-- ---------------------------------------------------------------------------
--    Registered so the importer has a source row to attribute to, but enabled =
--    false: no external report is publicly visible until a human both approves
--    the row AND enables the source. Nothing here scrapes or imports anything.
insert into external_sources (key, display_name, kind, homepage_url, terms_url, license, attribution_required, enabled, trust_weight, notes)
values (
  'reddit',
  'Reddit',
  'forum',
  'https://www.reddit.com',
  'https://redditinc.com/policies/data-api-terms',
  'reddit-api-terms',
  true,
  false,
  0.30,
  'Bootstrap cold-start source. Structured fields + source link only; never the post body, never the author. Disabled until reviewed; approved rows only become public once this source is enabled.'
)
on conflict (key) do nothing;

-- Rollback:
--   drop view if exists public_external_reports;
--   drop table if exists external_reports;
--   drop table if exists external_sources;
