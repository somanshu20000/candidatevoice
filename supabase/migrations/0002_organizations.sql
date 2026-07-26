-- CandidateVoice migration: canonical organizations + alias resolution
--
-- WHY THIS EXISTS
-- Two problems converge on the same missing table.
--
-- 1. docs/mvp-roadmap.md lists this as a launch blocker: the company is stored
--    as a free-text slug on every row, so "Google", "google inc" and
--    "Google LLC" become three unrelated companies. That fragments exactly the
--    aggregate the product exists to produce.
--
-- 2. The Organizational Fingerprint aggregates across every report for one
--    employer. Aggregating over a free-text column means the fingerprint is
--    only ever as trustworthy as the typing of whoever submitted last.
--
-- Design: `organizations` holds one canonical row per employer.
-- `organization_aliases` maps every observed spelling to it, so resolution is a
-- data operation a moderator can perform, not a code change.
-- `hiring_submissions.company` is deliberately LEFT IN PLACE as the raw
-- as-submitted value — evidence is immutable (ADR INV-3), so we annotate rather
-- than overwrite.
--
-- Run order: after 0001.

-- ---------------------------------------------------------------------------
-- 1. Slug canonicalization
-- ---------------------------------------------------------------------------
--    normalizeCompanySlug() in src/lib/company-slug.ts only lowercases, trims
--    and turns whitespace runs into hyphens. It strips NO punctuation and NO
--    diacritics, so hiring_submissions.company legitimately contains values
--    like `google-inc.`, `at&t`, `ernst-&-young`, `byju's`, `paytm-(one97)`
--    and `societe-generale` with accents intact.
--
--    That function must not change: hiring_submissions.company is immutable
--    evidence (ADR INV-3), and its output is baked into /company/[slug] URLs
--    and the HMAC-signed unlock cookie.
--
--    So canonicalization happens HERE instead — reducing any observed slug to
--    the restricted charset used for canonical organization slugs, without
--    touching the evidence that produced it.
create or replace function canonicalize_slug(p_slug text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(coalesce(p_slug, '')), '[^a-z0-9]+', '-', 'g'),
      '(^-+|-+$)', '', 'g'
    ),
    ''
  );
$$;

-- ---------------------------------------------------------------------------
-- 2. Canonical employer
-- ---------------------------------------------------------------------------
--    Identity only — no scores and no descriptive metadata. Imported metadata
--    (industry, locations, links, logo) lives in the Company Intelligence
--    tables added by 0005, deliberately in separate tables so third-party
--    facts can never be mistaken for first-party CandidateVoice evidence.
create table if not exists organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  display_name text not null,
  created_at   timestamptz not null default now(),

  -- Canonical slugs are always the output of canonicalize_slug(), so they are
  -- safe to hold to a strict shape. Observed spellings are NOT held to this
  -- shape — see the constraint note on organization_aliases below.
  constraint organizations_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint organizations_slug_length check (char_length(slug) between 1 and 100),
  constraint organizations_display_name_length check (char_length(display_name) between 1 and 200)
);

-- ---------------------------------------------------------------------------
-- 3. Alias -> canonical mapping
-- ---------------------------------------------------------------------------
--    CRITICAL CONSTRAINT NOTE. alias_slug is joined against the raw
--    hiring_submissions.company value, so its accepted domain must be a
--    SUPERSET of whatever that column can hold.
--
--    An earlier draft applied the same strict `^[a-z0-9]+(-[a-z0-9]+)*$` CHECK
--    here that organizations.slug uses. That was self-defeating: it made it
--    impossible to store `ernst-&-young` or `google-inc.` — precisely the
--    punctuated spellings this table exists to reconcile. Only a length bound
--    applies here, deliberately.
create table if not exists organization_aliases (
  alias_slug      text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  -- How the alias arose, so a moderator can tell an automatic canonicalization
  -- from a human judgement call.
  alias_source    text not null default 'observed'
    check (alias_source in ('observed','canonicalized','moderator','imported')),
  created_at      timestamptz not null default now(),

  constraint organization_aliases_slug_length check (char_length(alias_slug) between 1 and 200)
);

create index if not exists organization_aliases_org_idx
  on organization_aliases (organization_id);

-- ---------------------------------------------------------------------------
-- 4. Annotate submissions with the resolved organization
-- ---------------------------------------------------------------------------
--    Nullable on purpose. A brand-new company name can arrive before any
--    organization row exists; the submission is still valid evidence.
--    Aggregation falls back to matching on the raw `company` slug when
--    organization_id is null, so nothing is invisible while unresolved.
alter table hiring_submissions
  add column if not exists organization_id uuid references organizations(id);

create index if not exists hiring_submissions_organization_idx
  on hiring_submissions (organization_id)
  where is_approved = true;

-- ---------------------------------------------------------------------------
-- 5. Resolver: any observed slug -> organization id
-- ---------------------------------------------------------------------------
--    Tries the canonical slug, then the alias table, then the canonicalized
--    form of the input, so callers never need to know which shape they hold.
create or replace function resolve_organization(p_slug text)
returns uuid
language sql
stable
as $$
  select coalesce(
    (select id from organizations where slug = p_slug),
    (select organization_id from organization_aliases where alias_slug = p_slug),
    (select id from organizations where slug = canonicalize_slug(p_slug))
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------------
--    Both tables are public reference data — employer identity, which carries
--    no report content, no counts and no dates. Readable by everyone, writable
--    only by the service role (no insert/update/delete policy is declared for
--    anon/authenticated, so RLS denies those).
alter table organizations enable row level security;
alter table organization_aliases enable row level security;

drop policy if exists organizations_public_read on organizations;
create policy organizations_public_read
  on organizations for select
  to anon, authenticated
  using (true);

drop policy if exists organization_aliases_public_read on organization_aliases;
create policy organization_aliases_public_read
  on organization_aliases for select
  to anon, authenticated
  using (true);

revoke execute on function resolve_organization(text) from public;
grant execute on function resolve_organization(text) to anon, authenticated, service_role;
revoke execute on function canonicalize_slug(text) from public;
grant execute on function canonicalize_slug(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 7. Backfill — LOSSLESS
-- ---------------------------------------------------------------------------
--    An earlier draft filtered this on the strict slug regex, which silently
--    skipped every company whose name contains punctuation. Those employers
--    would never have received an organization row, and the failure produced no
--    error — the dedup feature would simply have been inoperative for most real
--    company names.
--
--    Instead: canonicalize every observed slug, create the canonical
--    organization, then record the original spelling as an alias wherever it
--    differs. Nothing is dropped.
--
--    Note the deliberate absence of an is_approved filter. Organization
--    identity is created at submit time (ADR §5.1 item 6) so the dedup lookup
--    can match every observed spelling — including one whose only submission is
--    still awaiting moderation. An organization row carries no report content,
--    count, date or outcome, so this discloses nothing about evidence.
insert into organizations (slug, display_name)
select distinct
  canonicalize_slug(company),
  initcap(replace(canonicalize_slug(company), '-', ' '))
from hiring_submissions
where canonicalize_slug(company) is not null
on conflict (slug) do nothing;

insert into organization_aliases (alias_slug, organization_id, alias_source)
select distinct
  s.company,
  o.id,
  'canonicalized'
from hiring_submissions s
join organizations o on o.slug = canonicalize_slug(s.company)
where s.company is distinct from o.slug
  and char_length(s.company) between 1 and 200
on conflict (alias_slug) do nothing;

update hiring_submissions s
set organization_id = resolve_organization(s.company)
where s.organization_id is null
  and resolve_organization(s.company) is not null;

-- Rollback:
--   alter table hiring_submissions drop column if exists organization_id;
--   drop function if exists resolve_organization(text);
--   drop table if exists organization_aliases;
--   drop table if exists organizations;
--   drop function if exists canonicalize_slug(text);
