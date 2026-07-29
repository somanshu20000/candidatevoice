-- CandidateVoice migration: register the built-in metadata-fetch sources
--
-- WHY THIS EXISTS
-- 0005 seeded exactly one metadata_sources row ('manual'). Four adapters land
-- alongside this migration (src/lib/company-intelligence/adapters/wikipedia.ts,
-- wikidata.ts, github-org.ts, website-meta.ts), and runImport() refuses to
-- persist anything from an adapter whose key has no metadata_sources row
-- (importer.ts: "Unknown metadata source"). This migration is that
-- registration — and, more importantly, the legal record of why each one is
-- permitted, at what trust level.
--
-- The four sources carry four different licences. That is the whole reason
-- metadata_sources has a `license` and `attribution_required` column instead of
-- a single blanket "is this allowed" flag:
--
--   wikipedia     CC BY-SA 4.0 — redistribution IS permitted, but ONLY with
--                 attribution and a link back to the source. This is the one
--                 source where attribution_required = true actually gates
--                 something in the UI (CompanyOverview renders a credit line
--                 under the description when the resolved value came from
--                 here).
--   wikidata      CC0 — public domain dedication. No attribution obligation.
--   github_org    Public GitHub API data (org name, bio, avatar). Governed by
--                 GitHub's API Terms, not a content licence; treated as
--                 factual metadata about the org itself, not creative content.
--   website_meta  The company's own site. Not an open licence at all — it is
--                 their own factual self-description, which is exactly the
--                 category this whole subsystem exists to hold. Highest trust
--                 tier (1) because nobody is a more authoritative source on a
--                 company's own facts than the company.
--
-- Run order: after 0005.

insert into metadata_sources (key, display_name, homepage_url, license, terms_url, attribution_required, permits_redistribution, trust_tier, notes)
values
  (
    'wikidata',
    'Wikidata',
    'https://www.wikidata.org',
    'CC0-1.0',
    'https://www.wikidata.org/wiki/Wikidata:Licensing',
    false,
    true,
    2,
    'Structured facts only (website, GitHub org, stock symbol, founding year, logo). Public-domain dedication — no attribution required.'
  ),
  (
    'github_org',
    'GitHub',
    'https://github.com',
    'github-api-terms',
    'https://docs.github.com/en/site-policy/github-terms/github-terms-of-service',
    false,
    true,
    4,
    'Public organization profile via the REST API: name, bio, blog URL, avatar. Lowest trust tier — an org''s self-written bio is the least authoritative of the four sources.'
  ),
  (
    'wikipedia',
    'Wikipedia',
    'https://en.wikipedia.org',
    'CC-BY-SA-4.0',
    'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
    true,
    true,
    3,
    'Article summary text. CC BY-SA requires attribution AND a link back to the article on redistribution — enforced in the UI via CompanyOverview''s attribution line, not just this flag.'
  ),
  (
    'website_meta',
    'Official website',
    null,
    'company-published',
    null,
    false,
    true,
    1,
    'OpenGraph/meta description from the company''s own official site. Not an open licence — their own factual self-description. Highest trust tier: nobody is more authoritative on a company''s own facts than the company.'
  )
on conflict (key) do update set
  display_name = excluded.display_name,
  homepage_url = excluded.homepage_url,
  license = excluded.license,
  terms_url = excluded.terms_url,
  attribution_required = excluded.attribution_required,
  permits_redistribution = excluded.permits_redistribution,
  trust_tier = excluded.trust_tier,
  notes = excluded.notes;

-- Rollback:
--   delete from metadata_sources where key in ('wikidata','github_org','wikipedia','website_meta');
