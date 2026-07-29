# Company Intelligence

> Imported, factual company metadata — kept structurally separate from
> first-party CandidateVoice hiring evidence.

## Why this exists

CandidateVoice's value is first-party, structured hiring evidence: what real
candidates report about real hiring processes. That evidence is sparse until a
community forms. Company Intelligence solves the cold-start problem **without
diluting the evidence**: it seeds company profiles from public factual metadata
so that every search resolves, every company page exists, and a visitor sees a
useful profile — with an explicit "No CandidateVoice hiring reports yet" — before
a single submission arrives.

It is **not** a review importer. See [The separation invariant](#the-separation-invariant).

## What may and may not be imported

**May** — factual company metadata: name, aliases, legal name, a short factual
description, founding year, size band, listing symbol, website, careers page,
engineering blog, GitHub org, LinkedIn, official social accounts, office
locations, hiring regions, industries, technologies, tags, logo.

**May never** — reviews, ratings, comments, opinions, interview experiences,
forum/Reddit posts, Glassdoor / AmbitionBox / Blind content, or any
user-generated content. This is enforced by shape, not just by policy: no table
in this subsystem has a body, author, score, star, sentiment, or
experience-timestamp column, and `description` is capped at 600 characters. **A
schema that cannot hold a review cannot accidentally publish one.**

## The separation invariant

Imported metadata and hiring evidence never mix — enforced structurally:

1. Metadata lives in its own tables (`company_*`, `metadata_sources`,
   `taxonomy_terms`, geography). No column here is added to `hiring_submissions`,
   `submission_ratings`, or `submission_emotions`.
2. No metadata table references an evidence table. The only shared value is
   `organization_id`, which identifies an **employer**, never a person or a
   report.
3. Every metadata row carries `metadata_source_id`, `confidence`, and
   `observed_at`. A value with no source cannot be stored.
4. Metadata never feeds a score. `src/utils/hqs.ts` and
   `src/lib/fingerprint/aggregate.ts` read evidence only.
5. Confidence uses a **different vocabulary** on each side
   (`unverified | reported | cross_checked | official` for metadata;
   `insufficient | single | corroborated` for evidence) so a reader never
   mistakes an imported fact for a candidate-corroborated one.
6. In the UI, metadata renders in a card labelled **"Company facts · Imported
   metadata"** with a provenance footnote, separate from the evidence card.

## Schema

Migrations `0002_organizations.sql` and `0005_company_intelligence.sql`.

### Identity (0002)

| Table | Purpose |
|---|---|
| `organizations` | One canonical row per employer: `slug`, `display_name`. Identity only — no scores, no metadata. |
| `organization_aliases` | Every observed spelling → canonical org. `alias_slug` is intentionally only length-bounded (not shape-constrained) because it is joined against the raw, punctuation-bearing `hiring_submissions.company`. |

`canonicalize_slug(text)` reduces any observed slug to the strict canonical
charset (lowercase, punctuation folded to hyphens, diacritics stripped). It is
mirrored exactly by `canonicalizeSlug()` in
`src/lib/company-intelligence/normalize.ts`; a test asserts parity.
`resolve_organization(slug)` tries canonical slug → alias → canonicalized form.

### Metadata (0005)

| Table | Holds |
|---|---|
| `metadata_sources` | Source registry: licence, terms URL, `permits_redistribution`, `trust_tier`. The legal record of why an import was permitted. |
| `taxonomy_terms` | Controlled vocabularies (`industry`, `tag`, `technology`, `business_category`) in one table keyed by `kind`. |
| `countries`, `cities` | Geography, referenced by locations. |
| `company_profiles` | Scalar metadata, one row per org: legal name, description (≤600), founded year, size band, listing symbol, HQ city. |
| `company_links` | Typed official links (`website`, `careers`, `engineering_blog`, `github`, …) with `last_checked_at` / `last_status`. |
| `company_locations` | Offices (city-level; no street address by design). |
| `company_taxonomy` | Org ↔ term links, `is_primary` flag. |
| `company_hiring_regions` | Countries where the company publicly advertises hiring. |
| `company_logos` | Versioned, append-only; `is_current` marks the live asset. Binary in Supabase Storage, served same-origin (see [Logos](#logos)). |
| `company_field_observations` | Field-level provenance: what every source claimed for a field, so a disagreement is answerable. |
| `import_batches`, `import_queue` | Idempotency + audit + staging. Service-role only. |

Every `company_*` value table carries `metadata_source_id` + `confidence` +
`observed_at`. Reference tables are public-read under RLS; provenance detail and
import machinery are service-role only.

## Import pipeline

```
Raw source ──▶ Adapter ──▶ Normalize ──▶ Validate ──▶ Batch coherence
                                                            │
                          Persist ◀── Resolve/create org ◀──┘
   (profile · links · locations · taxonomy · hiring regions · provenance)
```

Code: `src/lib/company-intelligence/`.

| Stage | File | Responsibility |
|---|---|---|
| Adapter | `adapters/*.ts` | Turn a source into `RawCompanyRecord[]`. Nothing else. |
| Normalize | `normalize.ts` | Clean, canonicalize slugs, type links/locations/taxonomy. Pure. |
| Validate | `validate.ts` | Shape/value checks (errors block, warnings don't) + batch coherence (duplicates, alias conflicts). Pure. |
| Persist | `importer.ts` + `store.ts` | Resolve/create org, upsert every value on a natural key. |

### Idempotency

Two levels:

- **Batch** — `runImport` hashes the normalized record set (order-independent).
  An identical input whose batch already completed is a no-op.
- **Row** — every write is an upsert on a natural unique key declared in the
  migration, so re-importing updates in place rather than duplicating.

### Alias resolution / deduplication

`normalizeCompanySlug` (used by submissions) only lowercases and hyphenates
whitespace, so `hiring_submissions.company` legitimately contains `google-inc.`,
`ernst-&-young`, `byju's`. The importer:

1. Canonicalizes the display name to the strict slug (`ernst-young`).
2. Creates/looks up the canonical `organizations` row.
3. Records punctuated or alternate spellings as `organization_aliases`.

Operationally, a moderator consolidates variants with `update-aliases.ts`
(`--add`, `--merge`, `--suggest`) — data edits, never code changes, and never a
rewrite of immutable evidence.

## Built-in fetch adapters

Four adapters beyond `seed_file` (`src/lib/company-intelligence/adapters/`),
each a real `SourceAdapter` — narrow, independently testable, no shared state:

| Adapter | Source | Licence | Trust tier | Contributes |
|---|---|---|---|---|
| `wikidata` | Wikidata SPARQL | CC0-1.0 — no attribution | 2 | website, GitHub handle, stock symbol, founding year, logo (`P154`, Commons `Special:FilePath`) |
| `github_org` | GitHub REST API | GitHub API Terms | 4 | description (org bio), engineering blog |
| `wikipedia` | REST summary endpoint | **CC BY-SA 4.0 — attribution required** | 3 | description (article extract), Wikipedia link |
| `website_meta` | Company's own site | Not an open licence — their own facts | 1 (highest) | description (`og:description`) |

Registered in `supabase/migrations/0006_metadata_fetch_sources.sql`, which is
also the legal record of why each is permitted — see the migration's own
comments for the reasoning per source.

**Attribution.** Wikipedia content is CC BY-SA: redistributing it requires a
credit and a link back. `read.ts` exposes which source the resolved
`company_profiles.description` came from (`descriptionSource`), and
`CompanyOverview.tsx` renders a "Source: Wikipedia ↗ · CC BY-SA 4.0" line
under the description whenever that source is the winner — never silently.

**Chaining and trust order.** `github_org` and `website_meta` need a GitHub
handle / website URL only `wikidata` resolves, so
`scripts/fetch-company-metadata.ts` runs `wikidata → github_org → wikipedia →
website_meta` in that order and passes wikidata's discovered fields into the
next two as explicit input — no adapter reaches into another. That order also
happens to be lowest-trust-tier-first for the one field several sources
overlap on (`description`), so the official website's own text wins over
Wikipedia's, which wins over a GitHub org bio, whenever more than one is
available. This only works because `store.upsertProfile` coalesces nulls
against the existing row (added alongside these adapters) — otherwise a later
adapter's absence of a field would silently erase an earlier adapter's value
for it.

Run: `npm run companies:fetch -- Data/companies/company-list.txt [--dry-run]`
(one company name per line). Sequential requests with a short delay and an
identifying `User-Agent` on every call, per Wikimedia's and GitHub's API
etiquette; set `GITHUB_TOKEN` to raise GitHub's unauthenticated 60/hour cap.

Every field stays attributable regardless of which value wins in
`company_profiles` — `company_field_observations` keeps one row per
`(organization, field, source)`, so "what did Wikidata say the founding year
was" is always answerable even after `website_meta` overwrites the resolved
value shown on the page.

## Seed format

Canonical JSON (array of records) or CSV. Example files in
`Data/companies/example.{json,csv}` (capital `Data/` — matches `.gitignore`;
the directory is not committed). Only `name` is required.

```json
{
  "name": "Razorpay",
  "aliases": ["Razorpay Software Private Limited"],
  "description": "Payments platform for online businesses in India.",
  "founded_year": 2014,
  "size_band": "1001-5000",
  "industry": "Financial Services",
  "technologies": ["Go", "React"],
  "website": "https://razorpay.com",
  "careers_url": "https://razorpay.com/jobs",
  "engineering_blog": "https://engineering.razorpay.com",
  "github_org": "razorpay",
  "linkedin": "razorpay",
  "locations": [{ "city": "Bengaluru", "region": "Karnataka", "country": "IN", "headquarters": true }],
  "hiring_regions": ["IN"]
}
```

CSV columns match the JSON keys; list fields use `;` or `|` separators;
`locations` cells are `City, Region, CC[, hq]`.

## Tooling

| Command | Does |
|---|---|
| `npm run companies:validate -- <file>` | Validate a seed file. No DB, no network. Exit 1 on errors (`--strict` also fails on warnings). |
| `npm run companies:import -- <file> [--source <key>] [--confidence <level>] [--dry-run]` | Import (idempotent). |
| `npm run companies:sync -- [--limit N] [--type website]` | Re-check stored links; record `last_status`. Flags broken links, never deletes. |
| `npm run companies:aliases -- --list/--add/--merge/--suggest` | Manage alias → org mappings. |
| `npm run companies:fetch -- <company-list.txt> [--dry-run]` | Wikidata → GitHub → Wikipedia → official website, in that order. See [Built-in fetch adapters](#built-in-fetch-adapters). |

Import/sync/aliases require `NEXT_PUBLIC_SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`. Run via `tsx` (a dev dependency).

## Validation

Detects: missing/unsluggable name (error), out-of-range founded year, invalid
size band / stock symbol / country code / URL scheme (error), over-length
description, duplicate companies within a batch (error), alias↔company conflicts
(warning), thin records — no links, no description (warning). URL *reachability*
is a separate network step in `sync-companies.ts`, not part of pure validation.

## Logos

`next.config.js` sets `img-src 'self' data:`, so a logo can't be hot-linked from
a CDN or served straight from Storage (a different origin). `GET /api/logo/[slug]`
serves it **same-origin**: it reads the current `company_logos` row, streams the
binary from Storage, and falls back to a deterministic SVG monogram when no logo
exists — so a page never shows a broken image and the CSP stays strict.

## Update strategy

Re-run an import to refresh; unchanged input is a no-op, changed values upsert in
place. `company_field_observations` retains what each source said, so when two
sources disagree the conflict is inspectable rather than silently overwritten.
`trust_tier` on `metadata_sources` is the intended tie-breaker (1 = the company
itself, 4 = everything else).

## Extensibility — adding a source

Implement `SourceAdapter` (`load(input) → RawCompanyRecord[]`), register it in
`adapters/index.ts`, and add a `metadata_sources` row. The pipeline
(normalize → validate → dedupe → resolve → import) is unchanged.

The intended division of labour: **this codebase owns** the adapter interface,
normalizer, validator, and importer. A **standalone collector** (any language)
produces canonical JSON/CSV for public metadata and feeds the built-in
`seed_file` adapter — it never needs to know this schema, only the documented
seed format. `permitsRedistribution=false` on an adapter (or its source) makes
the importer refuse to persist its values, so a source we may only consult can
never be republished by accident.

## What is deliberately not here

No scraper. No review/rating/comment/opinion import — ever. No street addresses.
No employee data. No metadata input to any score. Company enrichment beyond the
fields above (funding, headcount history, org charts) is out of scope until a
validated need appears.
