# Q-2 Source-Acquisition Plan

> Audit of the M6/external-intelligence pipeline as of commit `c8ee60c`, plus a
> concrete acquisition plan for resolving Q-2 ("where does genuine external
> seed data come from?"). Documentation only — no code or schema changed to
> produce this; a small number of read-only `SELECT`s were run against
> production to verify the audit's claims against reality rather than against
> what the migration files say.

---

## 0. Urgent finding — read this first

**Production's `external_sources` table does not match what every prior
decision record (D-013, D-025, D-027) and `.context/NOW.md` claim.** A
read-only query against production (project `sjvnvncmpioajmmtnzne`, table
`external_sources`) on 2026-08-17 returned:

| key | enabled | **acquisition_enabled** | license | reports |
|---|---|---|---|---|
| `reddit` | false | **true** | `reddit-api-terms` | 0 |
| `glassdoor` | false | **true** | `proprietary-no-redistribution` | 0 |
| `ambitionbox` | false | **true** | `proprietary-no-redistribution` | 0 |
| `linkedin` | false | **true** | `proprietary-no-redistribution` | 0 |

Every prior document (this session's own D-027, `web-discovery.ts`'s tests,
`.context/NOW.md`) states "every source has `acquisition_enabled=false`
except reddit." **That is false as of right now.** All four are `true`.

**Why this matters:** `acquisition_enabled` is the one gate
`src/lib/external-intel/web-discovery.ts`'s `discoverPermittedSource()`
checks before treating a source as safe to pull from. With three
proprietary/ToS-restricted sources marked permitted, any future importer —
including a naive extension of `seed-pipeline.ts`'s Case-1 skeleton — would
be told by the database itself that Glassdoor, AmbitionBox, and LinkedIn are
fair game. That directly contradicts:
- **D-005**, project constitution: *"No LinkedIn API, no LinkedIn scraping,
  ever."*
- Glassdoor's and AmbitionBox's own recorded `license` value —
  `proprietary-no-redistribution` — which is this codebase's own admission
  that redistributing their content is not licensed.

**No application code sets this column** (`grep -rn acquisition_enabled src/`
finds only *readers*: `extract.ts`, `web-discovery.ts`, `importer.ts`,
`store.ts` — never a writer). Migration `0019`'s own text only intended
`update external_sources set acquisition_enabled = true where key =
'reddit'`. The other three rows were set `true` by a **direct, uncommitted
action against production** at some point before this audit — the same
pattern already flagged once before in this codebase (migration `0019`
itself was "applied to production directly via the Supabase MCP" and
back-filled into git afterward, per its own header comment). This is the
second time a schema/config change has landed in production without a
corresponding committed migration or decision record.

**This did not cause any harm today** — zero rows exist in `external_reports`
for any source, and `extractReportsFromSource()` (built last session) still
returns `[]` unconditionally because no per-source URL-discovery mechanism or
self-hosted PixelRAG render endpoint exists yet. But it is a loaded, mislabeled
gun: the one column meant to say "ingestion from this source is legally
sound" currently says "yes" for two sources with a license this project's own
schema records as prohibiting redistribution, and one source under an explicit
standing prohibition (D-005).

**Human decision required, before anything else in this plan:** confirm
whether `glassdoor`/`ambitionbox`/`linkedin` being `acquisition_enabled=true`
was a deliberate choice backed by a license/partnership this documentation
simply never recorded, or an error that should be reverted. If it was never a
deliberate, licensed decision, the fix is a single-column `UPDATE` a human (or
a future session with explicit authorization) should run:

```sql
update external_sources
set acquisition_enabled = false
where key in ('glassdoor', 'ambitionbox', 'linkedin');
```

This plan does **not** run that statement — it is flagged here, not executed,
per this task's explicit "do not change the database" instruction.

---

## 1. Audit — what the current M6/external-intelligence architecture actually is

**Schema** (`supabase/migrations/0008`, `0009`, `0010`, `0011`, `0019`):
- `external_sources` — one row per acquisition source: `key`, `display_name`,
  `kind`, `license`, `terms_url`, `attribution_required`, `trust_weight`
  (0–1), `enabled` (publication gate), `acquisition_enabled` (ingestion gate,
  added 0019 — see the finding above).
- `external_reports` — structured, sourced, moderated. **No post-body column,
  no third-party author column, no FK to any evidence table** — the schema
  physically cannot hold copyrighted body text or identify a source author,
  and cannot be joined to `hiring_submissions`. Only `organization_id`
  (an employer, never a person) is shared with the evidence side.
- `platform_settings.global_external_multiplier` — currently `0.35` in
  production. One global dial; setting it to `0` zeroes every external
  report's contribution to scoring with no other change (`weighting.ts`'s
  documented "sunset property").

**Pipeline, source-agnostic core** (`src/lib/hiring-intel/`):
```
acquisition adapter (any language) → RawExternalReport[] JSONL
  → normalize.ts (validate, closed enums only)
  → importer.ts (dedupe on content-hash + external_ref, resolve org, insert PENDING)
  → moderation.ts (human approve/reject/archive queue, full explainability trail)
  → weighting.ts (trust × extraction confidence × moderator confidence × global multiplier)
  → Evidence Engine (blended with first-party evidence, always discounted below 1.0)
```
This is genuinely source-agnostic and already proven end-to-end with one real
adapter: `scripts/reddit_ingest.py` (PRAW, Reddit's official authenticated
API) → `npm run external:import`. It has never been run against production
(`report_count = 0` for every source).

**PixelRAG's actual place in this pipeline** (`src/lib/external-intel/`,
committed `c8ee60c`, DECISIONS.md D-027): a retrieval aid for **identity
resolution** (feeds `enrich.ts`, not `external_reports`), plus an honest,
currently-inert skeleton for a future rendering step
(`extractReportsFromSource` → `pixelragRender()`, stubbed until
`PIXELRAG_RENDER_URL` is set). **PixelRAG has no role in Reddit acquisition
at all** — Reddit's API already returns structured JSON directly;
`reddit_ingest.py` never touches PixelRAG or renders a page. PixelRAG only
becomes relevant for a source that (a) is legally permitted, (b) has no
structured API, and (c) requires rendering JS-heavy HTML to read. As section 3
shows, no source in this plan's "immediately usable" tier needs that.

**What is NOT built:** any acquisition adapter besides Reddit's; any
per-source URL-discovery mechanism (`extract.ts`'s honest gap); a self-hosted
PixelRAG render deployment; any credential for Reddit in this environment
(`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` are commented out in
`.env.example`, unset in `.env.local` per this session's own check).

---

## 2. Source types the existing architecture can ingest

The contract (`RawExternalReport`, `src/lib/hiring-intel/types.ts`) constrains
every source to the same shape regardless of origin:

| Requirement | Why |
|---|---|
| Structured fields only (experience bucket, stage, outcome, response-time bucket, reason, payment flag, coarsened month) — **no free-text body field exists in the contract** | Physically cannot republish copyrighted prose or a defamatory quote |
| A `source_url` back-link (required) | The attribution *is* the link; nothing else is stored |
| No author/handle field | Cannot identify a poster |
| One adapter = one `external_sources.key` | Every source goes through identical validation/dedupe/moderation — no source gets a shortcut |

Concretely ingestible source *types*, ranked by how well they fit that
contract:

1. **Official structured APIs with hiring-process signal** (Reddit's Data
   API, a jobs-forum API, a career-community API with an official endpoint) —
   best fit. Adapter parses structured fields from post text/metadata, never
   stores the body.
2. **Licensed data feeds / commercial datasets** (a vendor who already
   licenses aggregated interview-experience data for redistribution) — fits
   directly if the license permits derived structured facts.
3. **Permitted-to-crawl public pages with a machine-readable structure**
   (e.g., a company's own published "hiring process" page, a job board's
   public listing page under a permissive robots.txt) — fits via the
   existing `website-meta.ts`-style adapter pattern (SSRF-guarded,
   robots.txt-respecting, meta/structured-data only). This is where PixelRAG
   rendering could legitimately help if a page requires JS to display its
   content and no API exists.
4. **Review sites with proprietary ToS** (Glassdoor, AmbitionBox, Comparably,
   Kununu) — the schema *could* hold their data, but section 3/4 explains why
   this codebase cannot legally acquire it today.
5. **Professional-network scraping** (LinkedIn) — structurally ingestible,
   **categorically forbidden** by D-005 regardless of technical feasibility.

---

## 3 & 4. Candidate sources — legal/technical assessment and categorization

| Source | Kind | API/feed | License needed | Credentials | Rate limit | PixelRAG applicable? | Category |
|---|---|---|---|---|---|---|---|
| **Reddit** (r/cscareerquestions etc.) | forum | Official Data API (PRAW) | Reddit Data API Terms — **free tier exists but Reddit's 2023 pricing overhaul added commercial-use tiers; re-verify current terms before scaling past hobby volume** (this plan does not have live 2026 pricing and should not assume the free tier still applies at any volume) | `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` (register an app at reddit.com/prefs/apps, "script" type) | PRAW's own throttling, ~60 req/min per Reddit's API guidelines | No — API returns JSON directly | **Requires credentials** (free to obtain; commercial-scale terms need a legal re-check before high volume) |
| **A public jobs/careers forum with an official API** (e.g., a Discourse-based community forum, if one relevant to hiring exists) | forum | Varies — Discourse has a public read API | Forum-specific ToS, typically permissive for read-only structured use with attribution | Varies, often none for read endpoints | Varies | Possibly, if API lacks structured fields and only exposes rendered HTML | **Immediately usable** if a specific instance is identified — none currently identified in this codebase |
| **Company's own published careers/interview-process page** | official source | None — direct fetch of a known, already-discovered URL | The company's own content — highest trust tier already used by `website-meta.ts` for company metadata | None | Existing `resilientFetch` per-bucket pacing | **Yes, if JS-rendered and no static markup** — the one legitimate rendering role for PixelRAG (self-hosted) | **Immediately usable** — infrastructure already exists (`website-meta.ts` pattern), just not extended to interview-process content yet |
| **Glassdoor** | review site | No public API (deprecated); ToS explicitly prohibits scraping/automated access without a partner agreement | `proprietary-no-redistribution` (this project's own recorded value) | Would require a commercial data-partnership agreement | N/A without a deal | Would be relevant (JS-heavy pages) **but only after a license exists** | **Must NOT use** without a signed commercial agreement — currently `acquisition_enabled=true` in production, which is the urgent finding in §0 |
| **AmbitionBox** | review site | No public API; ToS restricts automated collection | `proprietary-no-redistribution` | Commercial agreement | N/A | Same as Glassdoor | **Must NOT use** without a signed commercial agreement — same urgent finding |
| **LinkedIn** | professional network | Official API exists but does not cover interview/hiring-experience content; scraping explicitly prohibited by ToS | Forbidden outright | N/A | N/A | Irrelevant — forbidden regardless of technical means | **Must NOT use, ever** — D-005, project constitution. Currently `acquisition_enabled=true` in production; this is the most serious part of the urgent finding |
| **Blind (TeamBlind)** | anonymous professional forum | No public read API; ToS restricts scraping | Unclear/proprietary, not recorded anywhere in this codebase | Would require investigation | N/A | Would be relevant if permitted | **Must NOT use** until ToS/licensing is actually researched — not currently in `external_sources` at all, and should not be added speculatively |
| **Kununu / Comparably / Indeed reviews** | review sites | No open API for review content; ToS restrictions typical of the category | Proprietary, unrecorded | Commercial agreement likely required | N/A | Would be relevant if permitted | **Must NOT use** without the same commercial-agreement step as Glassdoor/AmbitionBox |
| **A licensed aggregator/data vendor** (hypothetical — e.g., a company that already licenses interview-experience datasets for redistribution) | curated | Vendor-specific feed/API | Commercial license, by definition | Vendor credentials | Vendor-specific | Usually no — vendor already delivers structured data | **Requires a commercial/license agreement** — no such vendor identified or contacted; this is a real category, not a current option |

**Immediately usable (no credential, no license needed):** none in the strict
sense — even Reddit needs a free credential. The closest to "immediately
usable" is the **company's-own-page** pattern, since the infrastructure
already exists and needs no new legal clearance (it is the company's own
first-party content, same trust tier already used for company metadata) —
but it requires per-company page discovery work not yet built, and yields
sparse, uneven coverage (few companies publish a structured "our interview
process" page).

**Requires credentials only (free, low friction):**
- **Reddit** — register a "script" app at reddit.com/prefs/apps, get a
  client ID/secret, set `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` in
  production env vars. No payment. **Recommend re-verifying Reddit's current
  (2026) Data API commercial-use terms before any high-volume production run**
  — the 2023 pricing changes introduced paid tiers above a free threshold;
  this plan has not verified where that threshold currently sits.

**Requires a commercial/license agreement:**
- Glassdoor, AmbitionBox, Kununu, Comparably, Indeed reviews, and any
  hypothetical licensed-dataset vendor. None currently contacted or
  contracted.

**Must NOT be used (categorically, regardless of credentials):**
- **LinkedIn** — D-005, standing project constitution.
- Any source without a recorded license the codebase can point to — the
  `external_sources.license` column exists specifically so nothing gets
  ingested without that answer being on record first.

---

## 5. Recommendation: smallest legitimate first pilot

**Reddit**, exactly as already scaffolded (`scripts/reddit_ingest.py` +
`external_sources` row `key='reddit'`), for three reasons:
1. It is the only source in this table with a *recorded, already-reviewed*
   license (`reddit-api-terms`) and an adapter that already respects the
   contract (structured fields only, no body, no author).
2. It needs **only a free credential**, not a commercial negotiation — the
   smallest possible step to move Q-2 from "zero sources" to "one real
   source."
3. It needs **zero new code** — the adapter, the core pipeline, the
   moderation queue, and the weighting engine all already exist and are
   tested. This is a credentialing and a go/no-go decision, not an
   engineering task.

**Before running it at any real volume**, re-confirm Reddit's current Data
API terms cover CandidateVoice's intended use and scale (free-tier
non-commercial research/community use very likely qualifies for a low-volume
cold-start pilot; this plan does not assert that with certainty for every
possible future volume and should not be read as legal clearance beyond
"the existing recorded terms and this codebase's existing structured-only,
no-body, no-author design were already judged acceptable for a bootstrap,"
per D-013/D-019's own framing).

---

## 6. Pipeline mapping for the recommended pilot (Reddit)

```
DISCOVERY               reddit_ingest.py — PRAW against Reddit's official API,
                         fixed subreddit list + search queries already in the
                         script. No PixelRAG involved: Reddit's API returns
                         structured JSON directly, there is no page to render.

PIXELRAG                NOT IN THE CRITICAL PATH for this source. (PixelRAG's
                         real role in this codebase — D-027 — is identity-
                         resolution fallback in enrich.ts, and a stubbed
                         render step for a future JS-rendered, licensed
                         source. Reddit needs neither.)

EXTRACTION               reddit_ingest.py's own keyword/pattern extraction
                         over post title+body (in-process, output-only —
                         the body is read to extract signals but never
                         written to the JSONL). Produces RawExternalReport
                         records: company, role, stage, outcome,
                         response_time_bucket, reported_month,
                         extraction_version="reddit-v1",
                         extraction_confidence.

VALIDATION                normalize.ts — closed-enum coercion, required-field
                         check, per-record validation warnings.

MODERATION                importer.ts inserts PENDING → moderation.ts's
                         existing human queue (approve/reject/archive),
                         full explainability trail already rendered
                         (extraction_version, confidence, fields_extracted,
                         validation_warnings, duplicate/related context).

EXTERNAL_REPORTS           Row lands with verification_status='pending',
                         source_id → the existing 'reddit' row,
                         organization_id resolved via the same
                         resolve_organization() RPC evidence uses.

EVIDENCE ENGINE            Only on approval: weighting.ts computes
                         trust_weight(0.30) × extraction_confidence ×
                         moderator_confidence(1.0) × global_multiplier(0.35)
                         ≈ a report that can never outweigh first-party
                         evidence, blended in as clearly-labeled
                         external/unverified.
```

**What this pilot does NOT require:** any change to `web-discovery.ts` /
`extract.ts` / `seed-pipeline.ts` (those exist for a *future*, PixelRAG-
rendering-dependent source, not for Reddit — Reddit's own script already
bypasses that skeleton entirely, by design, since it needs no rendering
step). No migration. No PixelRAG credential or self-hosting.

---

## Human decisions/credentials required to unblock Q-2

**In order of urgency:**

1. **(Urgent, independent of the rest of this plan)** Confirm whether
   `glassdoor`/`ambitionbox`/`linkedin` being `acquisition_enabled=true` in
   production was ever a deliberate, licensed decision. If not — and no
   evidence of one exists in this codebase's own records — authorize
   reverting those three rows to `false` (§0's `UPDATE` statement, not yet
   run). LinkedIn's case is the more serious one: it directly contradicts
   D-005, a standing project constitution entry.
2. **To actually resolve Q-2 (produce the first real external reports):**
   register a Reddit "script" app (reddit.com/prefs/apps) and provide
   `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` / `REDDIT_USER_AGENT` as
   production environment variables — free, no commercial agreement, the
   only credential this plan's recommended pilot needs.
3. **Before running the pilot at meaningful volume:** a human (ideally with
   counsel) should re-confirm Reddit's current Data API terms still permit
   CandidateVoice's intended use/scale — this plan explicitly does not assert
   that for every possible volume.
4. **Out of scope for the pilot, tracked for later:** any decision to pursue
   Glassdoor/AmbitionBox/Kununu/Comparably via a commercial license is a
   business/legal decision this plan does not recommend pursuing yet (D-025's
   evidence-bar gate isn't met either — see DECISIONS.md).

No code was written and no schema was changed to produce this plan. The one
database interaction was two read-only `SELECT` statements against production
(`external_sources`, `platform_settings`) run to verify this audit against
actual state rather than against what the migration files claim.
