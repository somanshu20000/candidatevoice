# External Hiring Intelligence

> Third-party, publicly-sourced hiring reports — a **cold-start bootstrap**, kept
> provably separate from first-party candidate evidence.

## Why this exists, and why it is temporary

CandidateVoice's long-term value is first-party structured hiring reports from
its own users. That is sparse until the community reaches critical mass. External
reports (initially Reddit) seed the database so a first-time visitor finds
something useful and has a reason to contribute.

This is **Phase 1 only**. The intended arc:

```
Bootstrap with external data → acquire users → collect first-party submissions
→ build trust + moderation → rely primarily on CandidateVoice's own dataset
```

As first-party volume grows, external acquisition is wound down. Because external
data lives behind a removable adapter layer and in its own tables, winding a
source down is `external_sources.enabled = false` (or a `DELETE`), with **no
application change**.

## The invariant: three provenance classes, never mixed

| Class | What it is | Table |
|---|---|---|
| **Evidence** | First-party candidate testimony. | `hiring_submissions` |
| **Company metadata** | Third-party facts about the company. | `company_*` |
| **External reports** | Third-party *claims about hiring*. | `external_reports` |

An external report is *someone on Reddit said X* — not a candidate's own
structured report, and not a company fact. It must never be mistaken for either.
Enforced structurally (migration `0008`):

- **No foreign key** from `external_reports` to `hiring_submissions` or any
  evidence table. The only shared identifier is `organization_id` (the employer).
  Verified: `external_reports` FKs are `organizations` and `external_sources` only.
- **No post body column.** Only extracted structured fields + a `source_url` link
  back are stored. A schema that cannot hold the post text cannot republish
  copyrighted content or a defamatory paragraph. (Product decision: structured
  facts + source link only.)
- **No third-party author** is stored.
- **Own moderation gate.** Every row lands `verification_status = 'pending'` and
  is invisible until a human approves it.
- **Scoring is down-weighted and flagged**, never silently blended. Each source
  carries a `trust_weight`; approved external reports contribute at that weight
  and the UI labels them as external/unverified. (The blend itself is a separate
  application change; the schema provides the columns it needs.)

## The pipeline

Acquisition and ingestion are separated on purpose:

```
  acquisition adapter (any language)         source-agnostic core (TypeScript)
  reddit_ingest.py ──▶ canonical JSONL ──▶ import-external.ts ──▶ external_reports
   (official API,        (RawExternalReport,   (normalize · validate ·   (PENDING)
    no body/author)       one per line)         dedupe · resolve org)          │
                                                                                 ▼
                                                                    human moderation → approved
```

- **Adapters** produce the canonical contract and nothing else. They can be
  swapped or removed without touching the core. `scripts/reddit_ingest.py` reads
  Reddit's official API (PRAW), extracts signals from post text, and emits JSONL
  — it never writes the database and never stores the post text, title, or author.
- **The core** (`src/lib/hiring-intel/`) is source-agnostic: it imposes the same
  validation, dedup (per source, on `external_ref` and a content hash), org
  resolution (reusing `resolve_organization`), and pending-moderation gate on
  every source.

### Contract (`RawExternalReport`)

One JSON object per JSONL line. `company` and `source_url` required; the rest are
optional extracted facts drawn from the same closed vocabularies as
`hiring_submissions`. There is deliberately no text/body/quote field.

```json
{ "company": "Google", "role": "Software Engineer",
  "source_url": "https://www.reddit.com/r/…/comments/abc",
  "external_ref": "t3_abc", "stage": "technical", "outcome": "rejected",
  "response_time_bucket": "8-14", "reported_month": "2024-05" }
```

## Commands

```bash
# 0. Verify credentials against the REAL Reddit API before running anything
#    else — makes ONE authenticated call, writes nothing, harvests nothing.
python scripts/reddit_ingest.py --check-credentials

# 1. Acquire (does NOT touch the database) — needs REDDIT_* in .env.local
python scripts/reddit_ingest.py --all-subreddits --limit 100

# 2. Ingest the JSONL as PENDING moderation rows
npm run external:import -- Data/external/reddit.jsonl --source reddit --dry-run
npm run external:import -- Data/external/reddit.jsonl --source reddit

# 3. Approve in moderation, and enable the source, before anything is public.
```

`reddit_ingest.py` refuses to run the full harvest — never proceeding to
produce a JSONL that could be mistaken for "ran, found nothing" — if the
credential check fails first. Each search query is retried with exponential
backoff for transient failures only; an auth failure (401/403) is never
retried and aborts the run immediately (see the script's own module
docstring for the exact policy).

Nothing an importer writes is visible until **both** the row is approved and the
source is enabled (`reddit` ships disabled).

## Why PixelRAG is not part of Reddit acquisition

CandidateVoice also has a PixelRAG-based adapter (`src/lib/external-intel/`,
DECISIONS.md D-027) for a *different, future* kind of source: one with no
official structured API, where reading its content means rendering a
JS-heavy webpage. **Reddit needs none of that.** Its official Data API
(PRAW, used here) returns structured JSON directly — there is no page to
render, no visual content to interpret. `scripts/reddit_ingest.py` never
imports or calls anything from `external-intel/pixelrag.ts`, by design, not
by oversight.

The general rule this pilot establishes: **PixelRAG is for the render step
of a source that has no API — never a substitute for a source's own official
API when one exists.** A future source without an API and requiring
JS-rendered pages (see `docs/q2-source-acquisition-plan.md` §2 for the
"official structured API" vs. "webpage/visual" source-type split) would use
`external-intel/web-discovery.ts` → `extract.ts`'s PixelRAG-backed skeleton
instead of this file's pattern.

## QA verification (no real acquisition data required)

`scripts/qa-verify-external-pipeline.ts` proves the full pipeline — import →
moderate (approve) → confirm it can **never** reach `public_external_reports`
→ reject → delete — end to end in production, without touching real
acquisition data or real company organizations. It targets a dedicated,
**permanently unpublishable** source (`qa_external_verification`, migration
`0030`, `enabled=false` forever) and the existing QA organization
(`m54-qa-verification-test`, D-024) via an exact-slug match, calling the
SAME `runExternalImport` / `moderateExternalReport` functions the real admin
routes and CLI use — no reimplemented logic.

```bash
npx tsx scripts/qa-verify-external-pipeline.ts
```

Safe to re-run any time — it cleans up after itself and asserts the row
count returns to its baseline.

## The acquisition pipeline (D-029) — company detection through to the moderation queue

`src/lib/external-intel/orchestrator.ts`'s `runAcquisition()` is the single
entry point that ties everything above into one callable, schedulable
system: company search → detect unknown/sparse → source eligibility
(`acquisition_enabled`) → acquire (`adapter.load()`) → the unchanged
`runExternalImport` core (provenance, content hash, validation, dedup) →
moderation queue. Every stage transition is recorded in
`external_acquisition_runs` (migration `0031`) so an admin can see an
acquisition *attempt*, not just its surviving output.

**Two adapters, same `AcquisitionAdapter` interface**
(`src/lib/hiring-intel/types.ts`):
- `adapters/reddit.ts` — real, in-process Reddit OAuth (`client_credentials`
  grant) + search, the same source D-028 proved, made callable without a
  human running a script.
- `adapters/demo.ts` — deterministic, credential-free, registered under a
  permanently-`enabled=false` source (migration `0032`, mirroring `0030`) —
  exercises the full pipeline with zero external dependency.

**Trigger it three ways** — all call the same `runAcquisition()`, no
duplicated logic:
1. **Admin UI** — the External tab's "Acquisition pipeline" section (company
   name + source select + Run now), backed by `POST /api/admin/external/acquire`.
2. **Scheduled** — `vercel.json`'s cron entry hits
   `GET /api/cron/acquire-external` daily (`CRON_SECRET`-protected,
   Vercel's own auto-injected `Authorization: Bearer` header). Only ever
   uses `reddit`, never `demo` — a fabricated-looking record must never
   auto-attach to a real company.
3. **Programmatically** — `import { runAcquisition } from
   "@/lib/external-intel/orchestrator"` from any server-side code.

**Status view** — `GET /api/admin/external/runs` (also rendered in the admin
UI) lists recent runs with their full stage trail
(`queued → fetching → extracted → validation_failed → awaiting_moderation →
completed/failed`).

## Legal posture (bootstrap)

- **Official API only** (PRAW, authenticated) — not HTML scraping.
- **Structured facts + link-back**, never the post body → minimises copyright and
  defamation exposure; attribution is the `source_url`.
- **Human moderation** before publication.
- Per-source `license` / `terms_url` recorded in `external_sources`.
- Before any of this is public, the IT-Rules 2021 Grievance Officer and a
  takedown path (already noted as launch requirements) must be in place.
