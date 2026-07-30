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
# 1. Acquire (does NOT touch the database) — needs REDDIT_* in .env.local
python scripts/reddit_ingest.py --all-subreddits --limit 100

# 2. Ingest the JSONL as PENDING moderation rows
npm run external:import -- Data/external/reddit.jsonl --source reddit --dry-run
npm run external:import -- Data/external/reddit.jsonl --source reddit

# 3. Approve in moderation, and enable the source, before anything is public.
```

Nothing an importer writes is visible until **both** the row is approved and the
source is enabled (`reddit` ships disabled).

## Legal posture (bootstrap)

- **Official API only** (PRAW, authenticated) — not HTML scraping.
- **Structured facts + link-back**, never the post body → minimises copyright and
  defamation exposure; attribution is the `source_url`.
- **Human moderation** before publication.
- Per-source `license` / `terms_url` recorded in `external_sources`.
- Before any of this is public, the IT-Rules 2021 Grievance Officer and a
  takedown path (already noted as launch requirements) must be in place.
