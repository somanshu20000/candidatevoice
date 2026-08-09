-- CandidateVoice migration: company discovery + explicit confirmation
--
-- WHY THIS EXISTS
-- resolve_organization() (0002) is exact-match only: canonical slug, alias, or
-- canonicalized input. organization_aliases holds 2 rows across 334 companies.
-- A candidate searching "TCS" finds it (that IS the seed's display_name); a
-- candidate searching "Tata Consultancy Services" finds nothing, and a submit
-- with no match silently CREATES a new organization from raw text
-- (resolveOrCreateOrganization, src/app/api/submit/route.ts) — exactly the
-- "silently chooses/creates" failure mode this migration exists to close.
--
-- WHAT THIS DOES NOT DO
-- No LinkedIn, no scraping. Every new signal here is either already flowing
-- through the existing enrichment pipeline (company_links.website, imported by
-- website-meta.ts; the Wikidata QID, already fetched by wikidata.ts and
-- previously discarded) or a zero-dependency Postgres extension (pg_trgm).
--
-- Run order: after 0020.

-- ---------------------------------------------------------------------------
-- 1. Trigram similarity — the fuzzy-match layer resolve_organization() has
--    never had. Enables "Anemoi Tech" to find "Anemoi Technologies" without
--    an alias row existing for every possible typo/abbreviation.
-- ---------------------------------------------------------------------------
create extension if not exists pg_trgm;

create index if not exists organizations_display_name_trgm_idx
  on organizations using gin (display_name gin_trgm_ops);
create index if not exists organization_aliases_slug_trgm_idx
  on organization_aliases using gin (alias_slug gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 2. Wikidata QID — captured, not fetched-and-discarded.
-- ---------------------------------------------------------------------------
--    wikidata.ts already resolves a company name to a verified QID (entity
--    type-checked as a business) to pull structured properties, then throws
--    the QID away. It is the single most disambiguating identifier available
--    without a new external dependency — two organizations sharing one QID is
--    a data error, not a coincidence. Nullable: only import-pipeline rows will
--    ever populate it; no candidate-facing form writes this column.
alter table company_profiles add column if not exists wikidata_qid text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'company_profiles_wikidata_qid_format') then
    alter table company_profiles add constraint company_profiles_wikidata_qid_format
      check (wikidata_qid is null or wikidata_qid ~ '^Q[0-9]+$');
  end if;
end $$;

create unique index if not exists company_profiles_wikidata_qid_unique
  on company_profiles (wikidata_qid) where wikidata_qid is not null;

-- ---------------------------------------------------------------------------
-- 3. Domain matching over company_links — 285/334 companies (85%) already
--    carry a website link_type row. A normalized-domain generated column lets
--    a user paste a URL and resolve near-unambiguously without a new table.
-- ---------------------------------------------------------------------------
--    Strips protocol, "www.", and any path/query — "https://www.stripe.com/"
--    and "stripe.com/about" both normalize to "stripe.com".
alter table company_links add column if not exists normalized_domain text
  generated always as (
    case when link_type = 'website' then
      lower(regexp_replace(regexp_replace(url, '^https?://(www\.)?', ''), '/.*$', ''))
    else null end
  ) stored;

create index if not exists company_links_normalized_domain_idx
  on company_links (normalized_domain) where normalized_domain is not null;

-- ---------------------------------------------------------------------------
-- 4. Ranked candidate search — returns a SCORED LIST, never a single winner.
--    The caller (src/lib/company-intelligence/resolve.ts) decides what to
--    show; this function never decides what to submit. Mirrors the confidence
--    tiers from the investigation:
--      1.0   exact canonical slug / exact alias
--      0.95  exact normalized-domain match
--      0.85  exact normalized display-name match
--      0.4-0.84  trigram similarity (name or alias), ranked by score
create or replace function search_organizations_ranked(p_query text, p_limit int default 8)
returns table (
  organization_id uuid,
  display_name    text,
  slug            text,
  score           numeric,
  match_reason    text
)
language sql
stable
as $$
  with q as (
    select
      nullif(trim(p_query), '') as raw,
      canonicalize_slug(p_query) as canon,
      lower(regexp_replace(regexp_replace(trim(p_query), '^https?://(www\.)?', ''), '/.*$', '')) as as_domain
  ),
  candidates as (
    -- Exact canonical slug.
    select o.id, o.display_name, o.slug, 1.0::numeric as score, 'exact_slug'::text as reason
    from organizations o, q where o.slug = q.canon and q.canon is not null

    union all
    -- Exact alias.
    select o.id, o.display_name, o.slug, 1.0::numeric, 'alias'
    from organization_aliases a join organizations o on o.id = a.organization_id, q
    where a.alias_slug = q.canon and q.canon is not null

    union all
    -- Exact normalized-domain match.
    select o.id, o.display_name, o.slug, 0.95::numeric, 'domain'
    from company_links cl join organizations o on o.id = cl.organization_id, q
    where cl.normalized_domain = q.as_domain and q.as_domain is not null and q.as_domain <> ''

    union all
    -- Exact normalized display-name match (query and name canonicalize the same).
    select o.id, o.display_name, o.slug, 0.85::numeric, 'normalized_name'
    from organizations o, q
    where canonicalize_slug(o.display_name) = q.canon and q.canon is not null

    union all
    -- Trigram similarity on display_name.
    select o.id, o.display_name, o.slug,
           (0.4 + 0.44 * similarity(o.display_name, q.raw))::numeric, 'similar_name'
    from organizations o, q
    where q.raw is not null and similarity(o.display_name, q.raw) > 0.4

    union all
    -- Trigram similarity on alias.
    select o.id, o.display_name, o.slug,
           (0.4 + 0.44 * similarity(a.alias_slug, q.raw))::numeric, 'similar_alias'
    from organization_aliases a join organizations o on o.id = a.organization_id, q
    where q.raw is not null and similarity(a.alias_slug, q.raw) > 0.4
  )
  select id, display_name, slug, max(score) as score,
         (array_agg(reason order by score desc))[1] as match_reason
  from candidates
  group by id, display_name, slug
  order by max(score) desc, display_name asc
  limit p_limit;
$$;

revoke execute on function search_organizations_ranked(text, int) from public;
grant execute on function search_organizations_ranked(text, int) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. "Company isn't listed" — a moderation queue, not a public table.
--    Mirrors external_reports.verification_status's exact shape (0009):
--    pending -> approved/rejected, plus 'merged' for "this was actually an
--    existing company, linked via resolved_organization_id". No public read
--    policy: writes go through the API route via the service-role client
--    (same pattern hiring_submissions itself uses — see submit_hiring_report),
--    reads are moderator/admin-only.
-- ---------------------------------------------------------------------------
create table if not exists company_requests (
  id                     uuid primary key default gen_random_uuid(),
  requested_name         text not null,
  requested_domain       text,
  requester_note         text,
  status                 text not null default 'pending'
    check (status in ('pending','approved','rejected','merged')),
  resolved_organization_id uuid references organizations(id),
  created_at             timestamptz not null default now(),
  reviewed_at            timestamptz,

  constraint company_requests_name_length check (char_length(requested_name) between 1 and 200),
  constraint company_requests_domain_length check (requested_domain is null or char_length(requested_domain) <= 200),
  constraint company_requests_note_length check (requester_note is null or char_length(requester_note) <= 500)
);

create index if not exists company_requests_status_idx on company_requests (status, created_at desc);

alter table company_requests enable row level security;
-- Deliberately no anon/authenticated policy of any kind: every access — insert
-- from the submit route, list/approve/reject from admin — goes through the
-- service-role client, exactly like hiring_submissions' own write path.

-- Rollback:
--   drop table if exists company_requests;
--   revoke execute on function search_organizations_ranked(text, int) from anon, authenticated, service_role;
--   drop function if exists search_organizations_ranked(text, int);
--   alter table company_links drop column if exists normalized_domain;
--   drop index if exists company_profiles_wikidata_qid_unique;
--   alter table company_profiles drop constraint if exists company_profiles_wikidata_qid_format;
--   alter table company_profiles drop column if exists wikidata_qid;
--   drop index if exists organization_aliases_slug_trgm_idx;
--   drop index if exists organizations_display_name_trgm_idx;
--   -- pg_trgm extension left in place (other objects may come to depend on it).
