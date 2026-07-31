-- CandidateVoice migration: backfill hiring_submissions.organization_id
--
-- WHY THIS EXISTS
-- src/app/api/submit/route.ts never set organization_id — every first-party
-- submission had it NULL, while external_reports resolves it at import time.
-- The two evidence families keyed on different identifiers and could not be
-- joined. The application fix (resolveOrCreateOrganization in the submit
-- route) closes this going forward; this migration closes it for any row that
-- predates that fix. See docs/adr-0002-evidence-engine.md, blocker B0/B2.
--
-- Mirrors 0002_organizations.sql's own backfill exactly: canonicalize, create
-- the organization if it does not exist, record the raw spelling as an alias
-- if it differs, then point the row at the resolved id. LOSSLESS — the same
-- reasoning as 0002 applies (no strict-slug filter that would silently skip
-- punctuated company names).
--
-- Idempotent: every statement is safe to re-run. A fresh database has nothing
-- to backfill (hiring_submissions is created empty), so this is a no-op there.
--
-- Run order: after 0011.

insert into organizations (slug, display_name)
select distinct
  canonicalize_slug(company),
  initcap(replace(canonicalize_slug(company), '-', ' '))
from hiring_submissions
where organization_id is null
  and canonicalize_slug(company) is not null
on conflict (slug) do nothing;

insert into organization_aliases (alias_slug, organization_id, alias_source)
select distinct
  s.company,
  o.id,
  'observed'
from hiring_submissions s
join organizations o on o.slug = canonicalize_slug(s.company)
where s.organization_id is null
  and s.company is distinct from o.slug
  and char_length(s.company) between 1 and 200
on conflict (alias_slug) do nothing;

update hiring_submissions s
set organization_id = resolve_organization(s.company)
where s.organization_id is null
  and resolve_organization(s.company) is not null;

-- Rollback: not recommended — this only fills a gap, it does not remove data.
--   update hiring_submissions set organization_id = null where organization_id in (
--     select id from organizations where created_at >= '<migration run time>'
--   );
