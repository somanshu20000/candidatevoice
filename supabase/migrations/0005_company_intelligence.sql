-- CandidateVoice migration: Company Intelligence (imported factual metadata)
--
-- ============================================================================
-- THE SEPARATION INVARIANT
-- ============================================================================
-- CandidateVoice's competitive advantage is FIRST-PARTY, STRUCTURED HIRING
-- EVIDENCE. Everything in this migration is THIRD-PARTY FACTUAL METADATA. The
-- two must never be confused, by a reader or by a query.
--
-- Enforced structurally, not by convention:
--
--   1. Metadata lives in its own tables. No column added here goes on
--      hiring_submissions, submission_ratings or submission_emotions.
--   2. No table here references an evidence table. The only shared value is
--      organization_id, which identifies an EMPLOYER, never a person and never
--      a report.
--   3. Every metadata row carries metadata_source_id + confidence +
--      observed_at. A value with no source cannot be stored.
--   4. Metadata never feeds a score. src/utils/hqs.ts and
--      src/lib/fingerprint/aggregate.ts read evidence only; nothing here is an
--      input to either.
--
-- WHAT MAY NEVER BE IMPORTED
-- Reviews, ratings, comments, opinions, interview experiences, forum or Reddit
-- posts, Glassdoor/AmbitionBox/Blind content, or any other user-generated
-- content. Only factual company metadata: identity, links, locations, size,
-- founding year, listing symbol, technologies, industries.
--
-- This is not merely documented. Column shapes are chosen so UGC does not fit:
-- `description` is capped at 600 characters and no table here has a body,
-- author, score, star, sentiment or timestamp-of-experience column. A schema
-- that cannot hold a review cannot accidentally publish one.
-- ============================================================================
--
-- Run order: after 0004.

-- ---------------------------------------------------------------------------
-- 1. Source registry
-- ---------------------------------------------------------------------------
--    Every imported fact traces to a row here. The licence and terms columns
--    are the legal record of WHY the import was permitted — populated when a
--    source is registered, reviewed before an adapter ships.
create table if not exists metadata_sources (
  id             uuid primary key default gen_random_uuid(),
  key            text not null unique,
  display_name   text not null,
  homepage_url   text,
  -- Licence under which the data is offered, e.g. 'CC0-1.0', 'CC-BY-4.0',
  -- 'ODbL-1.0', 'public-domain', 'proprietary-permitted'.
  license        text not null,
  terms_url      text,
  attribution_required boolean not null default false,
  -- Whether the licence permits us to republish the values, as opposed to
  -- merely consult them. Importers refuse sources where this is false.
  permits_redistribution boolean not null default false,
  -- Ranking used to break ties when two sources disagree about a field.
  -- 1 = the company itself (its own site), 2 = official registry,
  -- 3 = curated open dataset, 4 = everything else.
  trust_tier     smallint not null default 4 check (trust_tier between 1 and 4),
  notes          text,
  created_at     timestamptz not null default now(),

  constraint metadata_sources_key_format check (key ~ '^[a-z0-9_]+$'),
  constraint metadata_sources_notes_length check (notes is null or char_length(notes) <= 1000)
);

-- ---------------------------------------------------------------------------
-- 2. Controlled vocabularies
-- ---------------------------------------------------------------------------
--    Industries, tags, technologies and business categories share one shape, so
--    they share one table. Adding a new vocabulary is a new `kind`, not a new
--    table plus a new join table plus a new importer branch.
create table if not exists taxonomy_terms (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('industry','tag','technology','business_category')),
  key        text not null,
  label      text not null,
  parent_id  uuid references taxonomy_terms(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint taxonomy_terms_key_format check (key ~ '^[a-z0-9_]+$'),
  constraint taxonomy_terms_label_length check (char_length(label) between 1 and 120),
  unique (kind, key)
);

create index if not exists taxonomy_terms_kind_idx on taxonomy_terms (kind, key);

-- ---------------------------------------------------------------------------
-- 3. Geography
-- ---------------------------------------------------------------------------
create table if not exists countries (
  code       text primary key,
  name       text not null,
  constraint countries_code_format check (code ~ '^[A-Z]{2}$')
);

create table if not exists cities (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  region       text,
  country_code text not null references countries(code) on delete restrict,
  created_at   timestamptz not null default now(),

  constraint cities_name_length check (char_length(name) between 1 and 120),
  unique (country_code, region, name)
);

create index if not exists cities_country_idx on cities (country_code);

-- ---------------------------------------------------------------------------
-- 4. Company profile — scalar metadata, one row per organization
-- ---------------------------------------------------------------------------
create table if not exists company_profiles (
  organization_id uuid primary key references organizations(id) on delete cascade,

  legal_name      text,
  -- A factual one-paragraph description of what the company does. Capped at
  -- 600 characters BY DESIGN: long enough for "designs and manufactures
  -- consumer electronics", too short to hold a review or an opinion piece.
  description     text,
  founded_year    smallint,
  size_band       text check (size_band in (
                    '1-10','11-50','51-200','201-500','501-1000',
                    '1001-5000','5001-10000','10000+'
                  )),
  stock_symbol    text,
  stock_exchange  text,

  headquarters_city_id uuid references cities(id) on delete set null,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  -- Metadata confidence. DELIBERATELY DIFFERENT VOCABULARY from evidence
  -- confidence ('insufficient' | 'single' | 'corroborated' in
  -- src/lib/fingerprint/aggregate.ts). Sharing words across two unrelated
  -- confidence axes is how a reader ends up believing an imported fact was
  -- corroborated by candidates.
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  observed_at     timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint company_profiles_legal_name_length check (legal_name is null or char_length(legal_name) <= 200),
  constraint company_profiles_description_length check (description is null or char_length(description) <= 600),
  constraint company_profiles_founded_year_range check (founded_year is null or founded_year between 1600 and 2100),
  constraint company_profiles_symbol_format check (stock_symbol is null or stock_symbol ~ '^[A-Z0-9.\-]{1,12}$')
);

-- ---------------------------------------------------------------------------
-- 5. Official links
-- ---------------------------------------------------------------------------
--    Typed rather than a column per platform, so adding a platform is an enum
--    value rather than an ALTER TABLE plus a UI change plus an importer change.
create table if not exists company_links (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  link_type       text not null check (link_type in (
                    'website','careers','engineering_blog','github','linkedin',
                    'x','youtube','instagram','facebook','crunchbase',
                    'wikipedia','press','other'
                  )),
  url             text not null,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  -- Last time an automated check confirmed the URL resolves. NULL means never
  -- checked, which the UI must distinguish from "checked and working".
  last_checked_at timestamptz,
  last_status     smallint,
  observed_at     timestamptz not null default now(),

  constraint company_links_url_length check (char_length(url) between 4 and 500),
  constraint company_links_url_scheme check (url ~* '^https?://'),
  unique (organization_id, link_type, url)
);

create index if not exists company_links_org_idx on company_links (organization_id, link_type);

-- ---------------------------------------------------------------------------
-- 6. Offices
-- ---------------------------------------------------------------------------
create table if not exists company_locations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  city_id         uuid not null references cities(id) on delete restrict,
  is_headquarters boolean not null default false,
  -- Deliberately no street address column. Office-level granularity is all the
  -- product needs, and a street address is a needless precision to hold.
  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  observed_at     timestamptz not null default now(),

  unique (organization_id, city_id)
);

create index if not exists company_locations_org_idx on company_locations (organization_id);
create index if not exists company_locations_city_idx on company_locations (city_id);

-- ---------------------------------------------------------------------------
-- 7. Industries / tags / technologies / categories
-- ---------------------------------------------------------------------------
create table if not exists company_taxonomy (
  organization_id uuid not null references organizations(id) on delete cascade,
  term_id         uuid not null references taxonomy_terms(id) on delete cascade,
  is_primary      boolean not null default false,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  observed_at     timestamptz not null default now(),

  primary key (organization_id, term_id)
);

create index if not exists company_taxonomy_term_idx on company_taxonomy (term_id);

-- ---------------------------------------------------------------------------
-- 8. Hiring regions
-- ---------------------------------------------------------------------------
--    Where the company publicly advertises that it hires. A factual claim
--    drawn from their own careers page, NOT inferred from candidate reports —
--    inferring it from evidence would be exactly the mixing this migration
--    exists to prevent.
create table if not exists company_hiring_regions (
  organization_id uuid not null references organizations(id) on delete cascade,
  country_code    text not null references countries(code) on delete restrict,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  observed_at     timestamptz not null default now(),

  primary key (organization_id, country_code)
);

-- ---------------------------------------------------------------------------
-- 9. Logos
-- ---------------------------------------------------------------------------
--    CSP CONSTRAINT. next.config.js sets `img-src 'self' data:`, so a logo can
--    NOT be hot-linked from a third-party CDN and can NOT be served straight
--    from Supabase Storage (a different origin). Binaries live in Storage and
--    are served same-origin through a Next.js route handler, which keeps the
--    policy intact rather than widening it.
--
--    TRADEMARK. A logo is a trademark, used here for identification only.
--    source_url and license are recorded per asset so provenance is auditable
--    and a takedown can be actioned against a specific row.
--
--    VERSIONING. Rows are append-only; `is_current` marks the live asset. A
--    replaced logo is retained so a page rendered last month can be explained.
create table if not exists company_logos (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- Path within the Supabase Storage bucket. NULL while an import has recorded
  -- the source but the binary has not been fetched yet.
  storage_path    text,
  -- SHA-256 of the bytes. The idempotency key: an unchanged logo re-imports to
  -- the same hash and no new version is written.
  content_hash    text,
  mime_type       text check (mime_type is null or mime_type in ('image/png','image/svg+xml','image/webp','image/jpeg')),
  width           integer,
  height          integer,
  byte_size       integer,
  source_url      text,
  license         text,
  version         integer not null default 1,
  is_current      boolean not null default true,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  observed_at     timestamptz not null default now(),

  constraint company_logos_dimensions check (
    (width is null or width between 1 and 4096) and
    (height is null or height between 1 and 4096)
  ),
  constraint company_logos_byte_size check (byte_size is null or byte_size between 1 and 2097152),
  constraint company_logos_hash_format check (content_hash is null or content_hash ~ '^[a-f0-9]{64}$')
);

-- At most one current logo per organization.
create unique index if not exists company_logos_one_current_idx
  on company_logos (organization_id)
  where is_current;

create index if not exists company_logos_org_idx on company_logos (organization_id, version desc);

-- ---------------------------------------------------------------------------
-- 10. Field-level provenance
-- ---------------------------------------------------------------------------
--    company_profiles holds the RESOLVED value. This holds what every source
--    said, so a disagreement is answerable: which sources claimed which
--    founding year, when, and which one won.
--
--    Without this, a second source silently overwrites the first and the only
--    record of the conflict is gone.
create table if not exists company_field_observations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  field_key       text not null,
  value_text      text,

  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  confidence      text not null default 'reported'
    check (confidence in ('unverified','reported','cross_checked','official')),
  observed_at     timestamptz not null default now(),
  import_batch_id uuid,

  constraint company_field_observations_field_format check (field_key ~ '^[a-z0-9_.]+$'),
  constraint company_field_observations_value_length check (value_text is null or char_length(value_text) <= 1000),
  -- One current observation per (organization, field, source). Re-importing the
  -- same source updates in place rather than appending — this is the row-level
  -- half of import idempotency.
  unique (organization_id, field_key, metadata_source_id)
);

create index if not exists company_field_observations_org_idx
  on company_field_observations (organization_id, field_key);

-- ---------------------------------------------------------------------------
-- 11. Import batches — idempotency and audit
-- ---------------------------------------------------------------------------
create table if not exists import_batches (
  id             uuid primary key default gen_random_uuid(),
  metadata_source_id uuid not null references metadata_sources(id) on delete restrict,
  adapter_key    text not null,
  -- SHA-256 of the normalized input payload. Re-running an identical file is a
  -- no-op: the importer finds a completed batch with this hash and stops.
  content_hash   text not null,
  status         text not null default 'pending'
    check (status in ('pending','running','completed','failed','skipped')),
  record_count   integer not null default 0,
  created_count  integer not null default 0,
  updated_count  integer not null default 0,
  skipped_count  integer not null default 0,
  invalid_count  integer not null default 0,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  error_message  text,

  constraint import_batches_hash_format check (content_hash ~ '^[a-f0-9]{64}$'),
  constraint import_batches_adapter_format check (adapter_key ~ '^[a-z0-9_]+$'),
  constraint import_batches_error_length check (error_message is null or char_length(error_message) <= 4000)
);

create unique index if not exists import_batches_dedup_idx
  on import_batches (metadata_source_id, adapter_key, content_hash)
  where status = 'completed';

-- ---------------------------------------------------------------------------
-- 12. Import queue — staged records
-- ---------------------------------------------------------------------------
--    Records land here first, validated but not yet applied. This makes an
--    import inspectable before it touches company_profiles, and gives a failed
--    run something to resume from.
create table if not exists import_queue (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references import_batches(id) on delete cascade,
  -- The source's own identifier for the record, when it has one. Lets a
  -- re-import match rows even if the company name changed at the source.
  external_ref    text,
  raw_payload     jsonb not null,
  normalized      jsonb,
  status          text not null default 'pending'
    check (status in ('pending','valid','invalid','applied','skipped')),
  validation_errors jsonb not null default '[]'::jsonb,
  -- Set once alias resolution has matched the record to an employer.
  organization_id uuid references organizations(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists import_queue_batch_idx on import_queue (batch_id, status);

-- ---------------------------------------------------------------------------
-- 13. RLS
-- ---------------------------------------------------------------------------
--    Public reference data: readable by everyone, writable only by the service
--    role. Import machinery (batches, queue) is service-role only — a staged,
--    unvalidated record is not public.
alter table metadata_sources          enable row level security;
alter table taxonomy_terms            enable row level security;
alter table countries                 enable row level security;
alter table cities                    enable row level security;
alter table company_profiles          enable row level security;
alter table company_links             enable row level security;
alter table company_locations         enable row level security;
alter table company_taxonomy          enable row level security;
alter table company_hiring_regions    enable row level security;
alter table company_logos             enable row level security;
alter table company_field_observations enable row level security;
alter table import_batches            enable row level security;
alter table import_queue              enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'metadata_sources','taxonomy_terms','countries','cities',
    'company_profiles','company_links','company_locations',
    'company_taxonomy','company_hiring_regions','company_logos'
  ]
  loop
    execute format('drop policy if exists %I_public_read on %I', t, t);
    execute format(
      'create policy %I_public_read on %I for select to anon, authenticated using (true)',
      t, t
    );
  end loop;
end $$;

-- company_field_observations, import_batches and import_queue get NO policy.
-- With RLS enabled and no permissive policy, only the service role reaches
-- them. Provenance detail and staged records are operational data.

-- ---------------------------------------------------------------------------
-- 14. updated_at maintenance
-- ---------------------------------------------------------------------------
drop trigger if exists company_profiles_touch_updated_at on company_profiles;
create trigger company_profiles_touch_updated_at
  before update on company_profiles
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- 15. Seed: the one source that always exists
-- ---------------------------------------------------------------------------
--    'manual' covers values entered by a maintainer rather than imported. It is
--    trust tier 1 because a human typing a company's own website is at least as
--    reliable as any dataset, and it gives the importer a valid source_id
--    before any adapter is registered.
insert into metadata_sources (key, display_name, license, permits_redistribution, trust_tier, notes)
values (
  'manual',
  'Manual entry',
  'not-applicable',
  true,
  1,
  'Values entered directly by a maintainer. Not an automated import.'
)
on conflict (key) do nothing;

insert into countries (code, name) values
  ('IN','India'), ('US','United States'), ('GB','United Kingdom'),
  ('DE','Germany'), ('SG','Singapore'), ('AE','United Arab Emirates'),
  ('AU','Australia'), ('CA','Canada'), ('NL','Netherlands'), ('IE','Ireland')
on conflict (code) do nothing;

-- Rollback:
--   drop table if exists import_queue, import_batches, company_field_observations,
--     company_logos, company_hiring_regions, company_taxonomy, company_locations,
--     company_links, company_profiles, cities, countries, taxonomy_terms,
--     metadata_sources cascade;
