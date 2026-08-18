# Decisions

A plain-language log of **what we decided, why, and what it cost us** — so anyone
(including future-us) can reconstruct the reasoning without reading every diff.

The dense technical rationale lives in `docs/adr-*.md`. This file is the index
and the *why*, in the order things actually happened.

**Format:** each entry says what was decided, what evidence drove it, what we
gave up, and what would make us revisit it. A decision with no cost and no
revisit-trigger is usually a decision that wasn't really made.

---

## D-001 · Evidence is weighted, never averaged
**Status:** Accepted · [ADR-0001](docs/adr-0001-evidence-model.md), [ADR-0002](docs/adr-0002-evidence-engine.md)

First-party candidate reports and third-party external reports are *not*
interchangeable. Every metric flows through one engine
(`load → filter → weight → aggregate`), and external evidence carries a
policy-driven multiplier that an admin can retune **without a redeploy**
(`platform_settings`).

**Why:** an aggregate that silently mixes a verified first-party report with a
scraped forum post is a lie about confidence, not a feature.
**Cost:** every new metric must be expressed as a reduction over the engine's
primitives. We cannot "just query the table."
**Revisit if:** we ever gain a source class that is neither first-party nor
scraped (e.g. verified employer-submitted data).

---

## D-002 · Suppression over fabrication — `null`, never a stand-in `0`
**Status:** Accepted · load-bearing everywhere

Below an effective-N floor, a metric returns `null` and the UI renders nothing.
It never renders `0`, and it never renders a confident-looking number from thin
evidence. Kish effective-N (not raw count) is the gate, so a single
heavily-weighted source cannot fake corroboration.

**Why:** "we don't know yet" and "this company scores zero" are opposite claims.
Conflating them is the single easiest way for this product to start lying.
**Cost:** new companies look empty for a long time. That is intended.
**Revisit if:** never, without a very good reason.

---

## D-003 · NULL is not NO
**Status:** Accepted · [ADR-0004](docs/adr-0004-tenure-stages.md)

An unanswered optional field is **excluded from its metric entirely**. It is
never scored as good or bad. `"never"` / `"none"` / `"na"` are *real answers*
and do count.

**Why:** silence must never manufacture either an accusation or a clean record.
**Proven live:** a mixed 11-row fixture (8 answered, 3 skipped) rendered
"2 of 8 reports" — never "2 of 11".
**Cost:** denominators differ per field, which makes the UI wordier.

---

## D-004 · Absence is not refusal · no causal claims
**Status:** Accepted · [ADR-0004](docs/adr-0004-tenure-stages.md)

We report what companies *did* ("no salary range was shared", "the letter was
not received"), never intent ("refused", "withheld"), and never causation
("the offer dropped *because* you revealed salary").

**Why:** intent and causation are unprovable from a candidate report, and they
are the two highest-defamation-risk claim shapes.
**Cost:** copy is blander. Worth it.

---

## D-005 · Never crawl LinkedIn — and never scrape for identity
**Status:** Accepted · project constitution

No LinkedIn API, no LinkedIn scraping, ever. Company identity is resolved only
from data already in the enrichment pipeline (Wikidata, Wikipedia, GitHub,
company website meta) or from Postgres itself.

**Why:** ToS, legal exposure, and the fact that the product's whole claim is
provenance. Scraped identity data poisons that.
**Cost:** company coverage grows slower.
**Consequence:** the `scripts/Data_Deepseek_layer/` scrapers were declined and
left unrun. See D-012.

---

## D-006 · No LLM in the product runtime
**Status:** Accepted · [ADR-0003](docs/adr-0003-candidate-intelligence.md)

There is no LLM anywhere in the request path. Explanations are **templated** from
numbers that already exist. A test extracts every integer from generated prose
and asserts it was an input — a fabricated figure fails the suite.

**Why:** "no generated text, no AI summaries" is a product promise, and a
templated sentence is auditable in a way a model output is not.
**Cost:** prose is repetitive.

---

## D-007 · Candidate identity is structurally disjoint from evidence
**Status:** Accepted · [ADR-0003](docs/adr-0003-candidate-intelligence.md)

`candidate_*` tables have **zero foreign keys** into `hiring_submissions` or any
evidence table, and a test enumerates FKs to assert it stays that way.

**Why:** a candidate profile links a real career history. One shared key and
every anonymous report becomes de-anonymisable.
**Cost:** we cannot personalise using someone's own submitted reports.

---

## D-008 · Workplace conduct ships behind a hard gate, not as a headline
**Status:** Accepted, with a documented ceiling · [ADR-0004](docs/adr-0004-tenure-stages.md)

One role-neutral, closed-enum psychological-safety scale. Never free text, never
about a named person. `CONDUCT_MIN_EFFECTIVE_N = 8` — far above the ordinary
floor of 3 — and it renders **only** aggregate prevalence.

**Why:** this is the highest-liability surface in the product. At a 20-person
company, "the company" and "a named person" are the same thing.
**The floor is doing double duty** as both the statistical *and* the anonymity
gate, because **no company-headcount field exists** to gate on directly.
**Revisit only when:** (1) a live Grievance Officer + takedown path exists per IT
Rules 2021, **and** (2) a real headcount field exists. Not before.

---

## D-009 · Company identity: never silently choose or create
**Status:** Accepted · [ADR-0005](docs/adr-0005-company-identity-and-hiring-intent.md)

Search returns a **ranked list, never a single winner**. A human must click
"This is the company." The server then **re-verifies** the id independently —
the list the user saw is advisory; the database query is truth. "Company isn't
listed" writes to a `company_requests` moderation queue, never to `organizations`.

**Why:** the old path silently created a new organization from raw text on any
near-miss — a typo, an abbreviation, or a deliberately misleading name each
minted a permanent row with zero human confirmation.
**Proven live:** a fabricated `organization_id` now creates **zero rows**; the
old behaviour would have silently created `"fake-co"`.
**Known cost:** trigram similarity does *not* bridge full-abbreviation
mismatches — "Tata Consultancy Services" does not find the seed's "TCS". That
needs an alias row. **We deliberately did not bulk-backfill aliases.**

---

## D-010 · Hiring events are append-only and genuinely immutable
**Status:** Accepted · [ADR-0005](docs/adr-0005-company-identity-and-hiring-intent.md)

`hiring_events` rejects **UPDATE and DELETE unconditionally** at the database
level. Every change is a new event. A system inference is its own event, never a
mutation of an earlier one.

**Why:** the timeline is the product. A status column that overwrites history
cannot answer "what did we know, and when."
**Proven live:** `UPDATE → ERROR P0001`, `DELETE → ERROR P0001`.
**Cost, accepted knowingly:** the rows used to *prove* immutability can never be
deleted. A handful of inert test rows are permanently stuck, one relabelled
`"(internal test data — safe to ignore…)"`. Disabling the trigger to tidy up was
considered and rejected — it would undermine the exact guarantee those rows exist
to prove.

---

## D-011 · HR is modelled as a future actor, and disabled at the schema level
**Status:** Accepted · [ADR-0005](docs/adr-0005-company-identity-and-hiring-intent.md)

`hiring_events.actor_type` admits **only** `candidate` and `system`. `'hr'` is
*not* a legal CHECK value. No route, no UI, no future refactor can start writing
HR events without a deliberate migration first.

**Why:** there is **no organization-level authentication in this app** — the only
"auth" is a single shared `ADMIN_SECRET` with no per-user identity. Shipping an
HR write path on top of that would let anyone with the secret speak *as a
company*. We refused to invent auth to unblock a feature.
**Cost:** items 6 and 8 of the product roadmap (HR status, weekly HR updates)
are **blocked** until real org auth exists. This is the single biggest known gap.

---

## D-012 · Staleness is an inference, computed on read
**Status:** Accepted, with a real limitation · [ADR-0005](docs/adr-0005-company-identity-and-hiring-intent.md)

After 30 days with no new activity, the system emits **one** event whose only
wording is *"Hiring activity appears stale based on available evidence."* Never
"the company never intended to hire."

**Why:** we can only observe our own evidence. A claim about intent is not ours
to make.
**Limitation, stated plainly:** **no scheduler exists in this app.** Staleness is
detected opportunistically when someone loads the page, not proactively. It is
idempotent (verified: 3 consecutive loads → exactly 1 event). A real background
worker is future work.

---

## D-013 · Demo data stays local-only
**Status:** Accepted · evidence-backed, 2026-08-11

Synthetic demo reports (320 records) exist **only** in the local Supabase. They
are never imported to production.

**Evidence:** a read-only query against production returned **zero external
reports across all four sources** (`reddit`, `glassdoor`, `ambitionbox`,
`linkedin` — all `enabled=false`, all `reports=0`). Production is genuinely
clean; this decision ratifies the status quo rather than changing anything.

**How demo data is kept distinguishable** — `scripts/demo-seed.ts` already
enforces this by construction:
- every record is attributed to a `DEMO — …` source
- every `source_url` points at `example.com` (IANA's reserved documentation
  domain), so a demo row can never be mistaken for a real acquisition
- records run through the **real** validator (`normalizeExternalReport`), so the
  demo file is guaranteed importer-compatible — no second import path that could
  drift from the real one
- demo sources are weighted so they stay invisible to HQS/fingerprint

**Cost:** production UI will look sparse until genuine evidence arrives. That is
the honest state, and D-002 says we show it rather than pad it.
**Revisit if:** we ever want a public demo environment — then it gets its **own
project**, never a flag inside production.

---

## D-014 · Compensation/privacy dimensions stay first-party-only
**Status:** Accepted · [ADR-0004](docs/adr-0004-tenure-stages.md) (W1 field asymmetry)

The salary-practice and tenure columns live on `hiring_submissions` and are
**null on every external report**, by design.

**Why:** a third-party forum post cannot structurally know *at which stage* a
poster was asked for a payslip. The Evidence Engine already models this as
reduced `coverage` (W1 field asymmetry) — it is a modelled property, not a bug.
**Explicitly rejected:** changing the schema so synthetic demo data can populate
these fields. That would corrupt the model to make a demo look better.
**Revisit if:** a source class appears that genuinely carries stage-level detail.

---

## D-015 · Migration numbering collision — chronology wins, collaborator's file stays put
**Status:** Accepted · resolved 2026-08-11 (commit `47b08a8`)

Two migrations shared the `0019` prefix. Resolution: **acquisition keeps `0019`**;
our five files shifted to `0020`–`0024`.

**Evidence for the ordering** (two independent sources agreed): the local CLI
history gave acquisition the clean `0019` slot, and remote timestamps put it a
day earlier (Aug 8 vs Aug 9).
**Why this shape:** the acquisition file is an untracked collaborator file. The
fix renames **only our own files**, and chronological correctness happened to
point the same way.
**Verified:** renames are content-identical (git `R93`–`R100`); a from-zero
scratch-DB replay applied `0019`–`0024` cleanly in order; the local
`schema_migrations` orphan row was repaired so labels match filenames.
**Note:** `supabase migration repair` **could not** do this — it rejects the
corrupted non-numeric version string — so the relabel was a direct SQL
transaction, taken against a backup.

---

## D-016 · Hiring-event analytics: opportunity-scoped, not event-scoped
**Status:** Accepted · 2026-08-11 · `src/lib/hiring-intent/analytics.ts`

Four metrics (time to resolution, stale-role rate, candidate-perception-vs-
outcome, HR-update frequency) reduce over `hiring_events`, reusing the
**exact same** `weightedRate`/suppression-gate machinery as every other metric
in the codebase (D-001, D-002) — no parallel statistics layer.

**The unit of analysis is the opportunity, not the event.** Every metric asks a
question about a *role* ("did it resolve", "did it go stale"), so counting raw
events would let one talkative candidate outweigh five quiet ones on the same
role. Every hiring event is first-party (`actor_type` is `candidate` or
`system` — D-011's CHECK forbids anything else), so every opportunity carries
uniform weight 1, and Kish effective-N reduces to an exact opportunity count.

**Three definitions fixed explicitly, not silently assumed:**
- **`no_response` / `ongoing` are NOT resolutions.** Only `offer`/`rejected`
  count as terminal. Counting "they never replied" as a resolution is the
  ghosting fallacy — it would let a company that ignores everyone score a fast
  "resolution" time. Ghosting has its own dimension (`behavioural.ts`); this
  metric would otherwise silently duplicate and contradict it.
- **`'neutral'` perception is excluded from the perception-vs-outcome
  denominator**, not averaged in as a midpoint — D-003's "NULL is not NO" rule
  applied to a mid-scale answer. A genuine split (equal high/low reports) is
  excluded the same way: it is evidence of disagreement among candidates, not
  evidence *for* or *against* accuracy.
- **The stale-rate denominator is opportunities past their deadline**, not all
  opportunities. A role still inside its 30-day window hasn't had the chance to
  go stale; counting it would dilute the rate toward a flattering zero.

**HR-update frequency returns `null` by construction today** — not a stub, a
structural consequence of D-011. Its test fixture is deliberately rich (20
opportunities, every *other* signal present) specifically to prove the null is
about HR, not a general suppression bug. The metric is built correct-and-ready:
the day `actor_type` widens (see `docs/design-hr-authentication.md` §5), it
starts reporting with no rewrite.

**Floors:** `HIRING_ANALYTICS_MIN_EFFECTIVE_N = 3` (ordinary); the higher
`PERCEPTION_OUTCOME_MIN_EFFECTIVE_N = 5` for perception-vs-outcome, because it
pairs a subjective read with a real outcome — the same higher-bar reasoning as
`PRIVACY_INVASIVE_MIN_EFFECTIVE_N` (D-004's compensation dimensions).

**Not wired into HQS** (Q-3 stays open — deliberately, these are
perception-heavy and opportunity-scoped; folding them in would silently change
what HQS means).

**Known, accepted exposure — not fixed here:** `public_hiring_opportunities`
still exposes exact `first_observed_at`. For a single-report opportunity, that
is that person's exact submission time — an n=1 correlation vector. This
module never emits it (every output is floor-gated and, for timing, bucketed
to whole days at the aggregate level only); closing the exposure at the view
level is a schema change, which was explicitly out of scope for this task.
Carried forward as an open item, same treatment as D-009's alias-backfill gap.

---

## D-017 · HR authentication: designed, not built
**Status:** Accepted (design) · not implemented · `docs/design-hr-authentication.md`

Company-domain email verification (reusing the HMAC-signed-cookie pattern
already in `unlock-cookie.ts`/`candidate/cookie.ts` — no new crypto primitive),
with a manual admin-review fallback extending the existing `ADMIN_SECRET`
surface for cases the automatic path can't reach.

**The one thing this design insists on saying out loud:** domain-email control
proves *identity*, not *authorization* and not *honesty*. A verified HR update
is a first-party claim — evaluated by corroboration and the same suppression
discipline as everything else (D-002), never taken as ground truth because it
arrived from a verified sender. This is the same posture the whole product
takes toward candidate reports; HR updates do not get a free pass just because
verification sounds authoritative.

**The audit trail already exists as a mechanism, just not a legal one.**
`hiring_events`' immutability (D-010) means the moment `actor_type` widens to
admit `'hr'`, every HR action is automatically an audit-trail row — no
additional schema work for the trail itself. Session grants/revocations are
proposed as a **separate** `hr_sessions` table, not folded into `hiring_events`
— session bookkeeping is about who may write, not evidence of anything
observed, and blurring the two would erode the exact distinction D-011 exists
to protect.

**Why design-only:** implementing this unblocks roadmap items 6 and 8, which
is real product surface area — new secrets, a new session/cookie type, a new
admin UI, a schema migration widening a CHECK we deliberately locked down. That
deserves its own explicit go-ahead, not a decision made in passing while
building analytics.

---

## D-018 · Likert facet rollup and emotion tags: a read path that was missing, not a new source
**Status:** Accepted · 2026-08-13 · `src/lib/fingerprint/likert.ts`

The submit wizard has collected structured 1-5 facet ratings (15 facets across
`professionalism`/`candidate_experience`/`hiring_process`) and self-selected
emotion tags since the relationship selector shipped — `facetsForDimension()`
renders every facet generically, so 0017's two clarity facets
(`compensation_clarity`, `work_arrangement_clarity`) already had a slider with
no code change. Nothing ever read `submission_ratings`/`submission_emotions`
back out; a stale comment in `forecast.ts` claimed "no collection UI" long
after D7 shipped one. This closes that gap — a read path, not a new evidence
source.

**Same machinery (D-001).** Every rating row and emotion selection is adapted
to a minimal, weight-1 `EvidenceItem` (`minimalEvidenceItem`, factored out of
`hiring-intent/analytics.ts`'s private adapter so both call sites share one
definition) and reduced with the real `weightedMean`/`weightedRate`. No
parallel statistics layer.

**Three definitions fixed explicitly:**
- **Rating scale:** a 1-5 rating rescales to 0-100 (`(rating-1)/4*100`) — the
  same "higher is better" scale as every other dimension on the page.
- **Dimension rollup is pooled, not mean-of-facet-means.** Every individual
  rating under a dimension's facets counts once toward that dimension's
  weighted mean, so a facet with more responses carries proportionally more
  weight — the honest reading of "what did people say across everything we
  asked here," not an editorial equal-weighting across facets.
- **Emotion denominator is respondents who selected at least one emotion**,
  never every submission in the evidence set — D-003's "NULL is not NO"
  applied to an unanswered multi-select. One submission can contribute to
  several emotions' numerators.

**Scope, deliberately narrow:** only the three candidate-sourced Likert
dimensions and the one emotion dimension are scored — exactly what
`submit/page.tsx`'s `LIKERT_DIMENSIONS`/`EMOTION_DIMENSION` collect.
`leadership`/`work_culture` (employee-sourced, `adr-0004`'s re-identification
tradeoff) remain `awaiting_source`; no UI collects them and this task does not
invent one.

**Floor:** `LIKERT_MIN_EFFECTIVE_N = 3` — the ordinary floor (`behavioural.ts`'s
`DIMENSION_MIN_EFFECTIVE_N`), because this is candidate-sourced evidence, same
population and anonymity profile as the rest of the free/unlocked page. No
elevated bar applies (unlike `culture.ts`'s employee-sourced floor of 5, or
`conduct.ts`'s 8).

**Placement:** rendered behind the same unlock gate as the Behavioural
Fingerprint panel (`isUnlocked`), matching that panel's depth and precedent
rather than making a new call about what's free vs. gated.

**Not done here:** per-facet drill-down UI (dimension-level only, mirroring
`CompensationPanel`/`OffboardingPanel`'s depth); cohort-scoping (matches the
existing Behavioural Fingerprint panel, which is also not cohort-scoped).

---

## D-019 · PixelRAG is an optional extraction adapter, never the truth layer
**Status:** Accepted (boundary only) · not implemented · 2026-08-14

If PixelRAG (or any future visual/automated extraction tool) is ever adopted,
it sits strictly **before** normalization, at the same position `scripts/`'s
existing adapters occupy today — never inside the trust boundary.

**The conceptual flow, recorded so nobody builds it out of order:**

```
Permitted external source
        ↓
PixelRAG / extraction adapter
        ↓
strict structured JSON (a contract this codebase defines, not PixelRAG)
        ↓
CandidateVoice normalize() (src/lib/hiring-intel or equivalent)
        ↓
validation + provenance + content hash
        ↓
moderation
        ↓
trust/extraction weighting (src/lib/hiring-intel/weighting.ts)
        ↓
Unified Evidence Engine (src/lib/evidence)
        ↓
Fingerprint / HQS / Search / Analytics
```

**PixelRAG (or any such tool) must never:** be the database; be the source of
truth; write directly to Supabase; bypass validation or moderation; decide
truth or evidence weight itself; bypass robots.txt, ToS, authentication, access
controls, or rate limits; be treated as permission to scrape a site; or
introduce raw page bodies, author PII, comments, or arbitrary UGC into the
evidence model. It is analogous to a camera or scanner: it helps the pipeline
*see*, never *judge*.

**Why recorded now, built later:** the existing external-ingestion pipeline
(migrations 0008/0009/0011, `src/lib/hiring-intel/*`) already enforces exactly
this shape for every adapter that exists today (D-005's declined scrapers
included) — this decision commits any *future* extraction tool to the same
boundary before one is built, rather than leaving it to be decided under
pressure once a specific adapter is halfway written.
**Not started:** no PixelRAG code exists in this repository. Building it is
explicitly out of scope until the core product (search → organization
resolution → evidence → fingerprint → company page) is genuinely finished —
see the 2026-08-14 audit in this log for what "finished" currently means.

**Amendment (2026-08-14, M3):** the M3 search architecture reaffirmed this and
sharpened *why* PixelRAG is not adopted, on two grounds beyond "not yet":
(a) **retriever ≠ extractor.** PixelRAG answers "which page-tiles look relevant
to a query" (visual embedding + ANN over a corpus). CandidateVoice's external-
ingestion need is the opposite — given ONE permitted page, extract ~8 enum
fields into a strict JSON contract — which PixelRAG does not do; field
extraction would still be a separate vision-model call. (b) **The bottleneck is
permission, not parsing.** `external_reports = 0` because Q-2 is unresolved (no
credentials, no licensed source, D-005 forecloses the richest one), not because
pages are hard to parse. Better parsing of sources we may not acquire yields
zero rows. The only conceivable future role is `pixelshot` (its renderer) alone,
behind `src/lib/company-intelligence/http.ts` (robots + SSRF + rate-limit + UA),
as a last resort when a *permitted* source is proven DOM-unparseable — gated on
the benchmark in the M3 plan. The retrieval/search system itself is Postgres-only
(D-020); PixelRAG is never part of it.

---

## D-020 · CandidateVoice search is PostgreSQL + a deterministic signal lexicon — no embeddings, no LLM
**Status:** Accepted · 2026-08-14 · M3 Search & Discovery (`src/lib/search/*`)

Search has two modes, one truth layer, and no second aggregation path:

- **Entity search** (a company name / alias / domain) layers the ranked RPC
  `search_organizations_ranked` (migration 0022 — exact/alias/domain/normalized/
  trigram) over the original `.ilike` substring pass, RPC hits first, substring
  as a floor the RPC's 0.4 trigram cutoff would otherwise drop (`searchCompanies`,
  `directory.ts`). Evidence is a badge, NEVER a search-rank key — a zero-report
  company is still findable by name.
- **Signal search** (a hiring pattern) parses the query against a checked-in
  lexicon of ~70 phrases over the 13 existing fingerprint dimensions
  (`lexicon.ts`/`parse.ts`), then ranks with **gate → order → band** over the
  EXISTING engine (`loadCompanyAnalytics`): gate = dimension not suppressed
  (the effective-N floor already there); order = signalStrength × confidence ×
  freshness (the last two imported unchanged from `evidence/rank.ts`); band =
  well_evidenced / limited / insufficient, never interleaved. No metric is
  computed anywhere in `src/lib/search`.

**Why not pgvector / embeddings:** there is no free text in the evidence model
to embed — every evidence column is a closed enum (D-005/D-019: no raw bodies,
no UGC). On a closed vocabulary of 13 dimensions a synonym lexicon is *more*
accurate than a cosine score, is deterministic, is unit-testable, and prints its
own reasoning. Reversible: if narrative text ever enters the model, pgvector
becomes justified and can be added on Supabase then, unwinding none of this.

**Why no LLM in the request path (D-006 applied to search):** the query parser
and explanations are deterministic templates; an integer-provenance test asserts
every number in a generated explanation was an input, exactly as advisor/explain
already does. An embedding/LLM call per query would also add a vendor, a latency
floor, and a failure mode to the most-hit path on the site.

**Unsupported constraints are named, never dropped:** location (`company_locations`
= 0 rows) and absolute salary amounts (never collected) are detected and
surfaced ("can't yet filter by office location"), instead of silently ignoring
the constraint and returning results that appear to honour it.

**One additive engine change:** `CompanyAnalytics` now also carries the
compensation and offboarding profiles, built in the SAME bulk loop via the SAME
pure builders the company page uses (`buildCompensationProfile` /
`buildOffboardingProfile`) — so signal search can reach all 13 dimensions from
one load. This is reuse, not a second aggregation path (D-001).

**Cost:** the lexicon is hand-maintained (a new dimension needs its phrases
added). Alias recall depends on `organization_aliases`, still sparse — the
`scripts/backfill-organization-aliases.ts` dry-run derives ~262 collision-safe
candidates but stays human-gated because the domain-stem source carries noise
from mis-stored `company_links` rows.

---

## D-021 · Company-request promotion extends D-009's re-verify to the admin side, plus a domain check
**Status:** Accepted · 2026-08-14 · M5.1 (`src/lib/company-intelligence/requests.ts`)

D-009 established "never silently choose or create" for the *submit-flow*
confirmation UI: the ranked list is advisory, the server re-verifies before
trusting a client-supplied `organization_id`. `company_requests` (migration
`0022`) sat on the other side of that boundary with no code path at all — a
queued request could never become a canonical organization, so the gap
D-009 was designed against didn't yet have anywhere to reopen. Building that
path (M5.1) meant deciding how promotion re-verifies, since a request may sit
in the queue for weeks before an admin reviews it — long enough for the
directory to have moved on.

**Decision:** `promoteCompanyRequest` re-resolves the candidate slug via the
same `resolve_organization()` RPC `store.ts` and `submit_hiring_report`
already trust, **immediately before** creating — not at request-filing time.
If it now resolves to an existing organization, promotion refuses and
returns that id so the admin can merge instead. **A second, independent
check** was added beyond the original submit-flow pattern: if the request
carries a `requested_domain`, it's checked against
`company_links.normalized_domain` too — a differently-named request for an
employer that already exists ("Google" filed against an org already present
as "Alphabet Inc.") would pass a slug-only check but is still a duplicate.

**Why the domain check is best-effort, not authoritative:** a `company_links`
query failure returns `null` (no match) rather than blocking promotion — the
slug re-resolve is the load-bearing guard; domain is a bonus catch, not a
second point of failure for an otherwise-legitimate promotion.

**Merge creates nothing, by construction:** `mergeCompanyRequest` never calls
`organizations.insert`/`upsert` — it only writes `resolved_organization_id`
onto the request after confirming the target id exists
(`organizationExists`, already used by the submit flow). The distinction from
promote is structural, not just a status string.

**Race guard:** every mutation (`promote`/`merge`/`reject`) conditions its
`UPDATE` on `status = 'pending'` and requires the update to actually match a
row (`.select().maybeSingle()` returning non-null) — two admins (or a stale
tab) acting on the same request twice is caught rather than silently
double-applied.

**Cost:** merge requires the admin to already have the target
`organizationId` (a plain text field, no inline search-and-pick). Acceptable
for M5.1's scope; a follow-up can wire the existing ranked search into that
field without changing the underlying `requests.ts` contract.

---

## D-022 · Verification tier is an envelope, never a weight — and the envelope stores nothing identity-shaped
**Status:** Accepted · 2026-08-15 · M5.2a (`src/lib/verification/*`, migration `0027`)

`hiring_submissions` gained one column, `verification_tier`. Two decisions
about it are durable enough to record rather than leave implicit in code:

**1. Tier is metadata about provenance, never a multiplier on trust.**
`firstPartyWeight()` takes no parameters and cannot be made to; a regression
test (`tests/verification-weight-neutrality.test.ts`) pins this down so a
future change can't quietly thread a tier into it. Three reasons this is a
hard rule, not a placeholder: (a) it would punish the anonymous majority,
whose safety depends on *not* verifying; (b) a higher-weighted report is a
more attractive de-anonymization target, so weighting-by-tier creates the
exact incentive the anonymity model exists to remove; (c) only a *current*
employee can ever domain-verify (a former employee's inbox is revoked) — so
weighting by tier would systematically overweight the cohort with the
strongest incentive to make their employer look good and the cohort an
employer can most easily pressure. It would not be neutral; it would be
backwards.

**2. INV-V: no verification artifact is ever a linkage key.**
`verification_grants` stores exactly `sha256(nonce)` + `expires_at` — no
organization, no tier, no address, no `consumed_at` (a timestamp on a
since-deleted row would itself be a timing-correlation vector), no
`created_at`. The organization/tier binding lives only inside the signed
grant token the caller holds; the database side can never answer "who
verified, for which company." `tests/account-evidence-disjointness.test.ts`
now enforces this structurally for `verification_grants`, mirroring the
existing account/candidate disjointness blocks (D-007).

**Consumption is atomic via one SQL statement, not an explicit transaction:**
`DELETE FROM verification_grants WHERE grant_hash=$1 AND expires_at > now()
RETURNING ...` — Postgres's own row locking means two concurrent callers
racing the same nonce can never both succeed. This is the same "prefer a
single atomic operation over a lock" idiom M5.1's `promoteCompanyRequest`
already used for a different race.

**A tier can never be revoked once stamped.** `0027` extends the M4
immutability guard (`0025`'s `hiring_submissions_guard_immutable()`, via
`CREATE OR REPLACE FUNCTION` on the same name the existing trigger already
points at) to lock `verification_tier` too — it is content, not moderation
state, and must be immutable exactly like every other reported fact on the
row. "User withdraws verification" has no implementation and is not planned;
the tier records a fact about the moment of submission.

**Why M5.2a and not the full email-verification design:** the original M5
plan proposed HMAC email/domain proof as one piece. Splitting it (see the
M5.2 architecture plan) exposed that domain verification only ever proves
control of an inbox for a *current* employee — not a candidate, not a former
employee — and that no email infrastructure exists in this codebase at all
(no vendor, no send code, no credentials). Building the envelope now and
gating the emailed tier on a separate vendor/legal decision (log-retention
terms, since any mail vendor's own delivery logs would hold a recipient
address at a company domain regardless of what CandidateVoice itself stores)
avoided taking on that failure domain before it was decided.

**Cost:** the mechanism is currently inert — nothing calls `/api/verify/grant`
from product UI, and `/api/submit` does not yet consult a redeemed grant when
stamping a real row. This is intentional scope discipline, not an oversight;
see `.context/NOW.md`'s M5.2a section for what's explicitly deferred.
**Revisit if:** a vendor/log-retention decision is made for the emailed
`contact_domain` tier (unblocks M5.2b), or a decision is made to wire a
redeemed grant into `/api/submit` (independent of M5.2b, no vendor needed).

**Amendment (2026-08-16, M5.3):** the second revisit-trigger fired — the grant
is now wired through the pipeline. `/api/submit` optionally redeems a
`verification_token` (bound to the re-verified organization, D-009), the
`submit_hiring_report` RPC (migration 0028) writes `verification_tier`, and the
`public_submissions` view + `load.ts`/`normalize.ts` carry it onto
`EvidenceItem.verificationTier`. **Both durable decisions above hold unchanged:**
the tier is written and read but never weighted (`normalizeFirstParty` computes
`weight` with no reference to it; a test asserts two rows differing only in tier
weigh the same), and `verification_grants` is untouched by this work so INV-V is
intact. Redemption is **fail-open** — an absent/invalid/expired/replayed/
mismatched grant leaves `'unverified'` and never blocks the submission;
verification is additive, never a gate (matching §17-B of the M5.2 plan). Still
NOT closed by this: the tier is caller-asserted (no email proof — M5.2b), and no
UI reads it yet.

---

## D-023 · Production was three migrations behind — dependency, not choice, dictated the apply order
**Status:** Accepted · 2026-08-16 · M5.4 (production verification gate)

Before this milestone, production had never received `0025`
(hiring_submissions immutability) or `0026` (moderation audit ledger) — both
were built and locally verified in the M4 session but left unapplied, the
same "migration application is human-gated" pattern D-015 and prior sessions
already established. This became load-bearing for M5.4, not just a leftover:
`0027`'s `verification_tier` guard is written as `CREATE OR REPLACE FUNCTION
hiring_submissions_guard_immutable()`, relying on `0025`'s trigger already
existing and pointing at that function name — deliberately no `CREATE
TRIGGER` in `0027` itself. On a database that never ran `0025`, applying
`0027` alone would have created the function but left it wired to nothing,
so `verification_tier` (and every other supposedly-locked column) would have
been silently mutable in production, contradicting the migration's own stated
design.

**Decision:** apply `0025` → `0026` → `0027` → `0028` in that order, as one
dependency chain, not as four independent choices. Verified live (not just by
reading the migration text): after applying all four, a direct `UPDATE
verification_tier` on a real production row raised the guard's exception —
confirmed the dependency now genuinely holds, not merely on paper.

**Why this wasn't caught earlier:** the M4 session's own verification was
itself structural-parity-only (reading migration text, no live database was
reachable), explicitly documented as such in
`tests/db-hiring-submissions-immutability.test.ts`'s header. A structural test
can prove a migration file is internally consistent; it cannot prove a later
migration's *cross-migration* assumption about what already ran in the target
environment. That gap is exactly what this session's live verification (D-024
below) exists to close.

**Cost:** none beyond the two extra migrations landing later than intended —
both were already fully written, tested, and reviewed; this was purely a
sequencing correction, not new design work.
**Revisit if:** never — this is now production's actual state, not a decision
to reconsider.

---

## D-024 · Production write-path verification uses a dedicated, clearly-labeled QA organization — never a real company
**Status:** Accepted · 2026-08-16 · M5.4

Live-verifying an approve/moderate/publish pipeline against production
necessarily means writing a real row through the real functions. Two options
existed: reuse an existing real company (as D-010's hiring_events immutability
proof did, out of necessity, before this pattern was named), or create a
purpose-built test organization. This session created a new organization
(`slug = 'm54-qa-verification-test'`, `display_name` prefixed `(QA TEST —
...)`) specifically so a verification submission never touches a real
company's evidence, even transiently while approved.

**Why this matters beyond tidiness:** `hiring_submissions` rows cannot be
hard-deleted (D-010's guard, extended by `0025`) — once an approved test
report exists on a real company's row set, it is not fully undoable; a reject
removes it from the public view but the row (and its brief window of public
visibility) is permanent history. Isolating verification data to its own
organization means the *organization* is inert test data forever, rather than
a real company's evidence set carrying a permanent asterisk.

**The cost this doesn't avoid:** the test organization and its one rejected
submission remain in production forever, exactly like D-010's test rows — this
decision only changes *what* is permanently there, not *whether* something is.
**Pattern for future live-verification of immutable write paths:** create a
dedicated, obviously-labeled test entity first; never reuse real product data
to prove a database guarantee, even briefly.

---

## D-025 · M5.2b stays deferred; the evidence gate, not verification, is the priority
**Status:** Accepted · 2026-08-16 · roadmap V3.2 (planning decision, no code)

Records three linked sequencing decisions so nobody builds them out of order.

**1. M5.2b (the emailed `contact_domain` tier) stays DEFERRED.** The envelope
it sits on (M5.2a/M5.3) is built and pipeline-verified, but the emailed tier
adds a whole new failure domain — an email vendor, a new credential, SPF/DKIM,
deliverability/bounce handling, and a legal choice about the vendor's delivery-
log retention (the M5.2 architecture §11 gate, since those logs hold recipient
addresses at company domains — threat T2). With ~0 approved evidence in
production, verification protects a supply that does not yet exist while adding
friction to the exact funnel that is the bottleneck. It also only ever helps
*current employees* (F1) — the highest-retaliation-risk cohort (F2) — so it is
least useful where it is most dangerous. **Do not build it now.**

**2. If a verified signal is ever needed sooner, `attested` is the cheaper
first step — not M5.2b.** The `attested` tier (a human moderator reviewing
out-of-band proof through the existing admin surface, the M5.1 pattern) needs
NO vendor, NO email, NO new failure domain. It is the correct first verified
tier to reach for if demand appears before the email gate is worth crossing.
Either way, verification remains optional, never required, never weighted
(D-022 / M5.2 architecture §17-B) — a tier is provenance metadata, never trust.

**3. External evidence acquisition / M6 is gated on three preconditions, none
met today:** (a) a real first-party evidence base — external weighting is
meaningless relative to zero first-party (D-001); (b) resolved Q-2 — a
*permitted* source with credentials or a license (D-005 forecloses LinkedIn;
all four external sources currently hold 0 reports, D-013); (c) the same
vendor/legal gate as §11. Do not start M6 before all three hold.

**The measurable bar for "enough evidence" (the V3.1 metric enforces this
definition, using the engine's own floors):**
- THRESHOLD — mechanism proven: ≥1 company at the HQS floor
  (`HQS_MIN_EFFECTIVE_N` = 5), i.e. HQS actually renders somewhere.
- TARGET — genuinely useful: ≥3 companies at the HQS floor, with ≥1 at a
  stronger anchor (effectiveN ≥ 8), so browse/compare/search have real,
  rankable content. (~18–25 genuine approved reports across 3–4 companies.)
- STRETCH: one company at effectiveN ≥ 20 (`CONFIDENCE_SATURATION_N`) — full
  search-ranking confidence.

**Cost:** the verification envelope sits inert (no product UI drives it) until
either the evidence bar is met or a concrete `contact_domain` demand appears —
intentional, per the honest-priority note above. **Revisit if:** the V3.1
metric shows the target met AND a concrete need for a domain-verified signal
materializes (then M5.2b's vendor/legal gate becomes worth crossing), or a
permitted external source with credentials is secured (then Q-2/M6 unblocks).

---

## D-026 · RLS is row-only — a coarsening view over an unconditionally-open base table is not a privacy boundary
**Status:** Accepted · 2026-08-16 · V1.1 (`supabase/migrations/0029_hiring_opportunity_timing_leak.sql`)

D-016 flagged `public_hiring_opportunities.first_observed_at` as an exposed
exact timestamp — an n=1 de-anonymization vector for a single-report
opportunity. Closing it surfaced a more general bug: migration 0023 gave
`hiring_opportunities`/`hiring_events` an UNCONDITIONAL anon/authenticated
SELECT policy (`using (true)`) on the **base tables**, not only on the
`public_*` views layered over them. Postgres RLS filters ROWS; it has no
concept of hiding a COLUMN. So the coarsening view was never a real boundary
— any holder of the public anon key (shipped in every browser bundle as
`NEXT_PUBLIC_SUPABASE_ANON_KEY`) could bypass it entirely and query the exact
column directly off the base table. The same gap also exposed
`hiring_events.submission_id` and `.created_at`, neither named in the
original D-016 finding — the leak was broader than first identified.

**The only correct fix is column-level GRANT**, Postgres's separate
privilege system for exactly this: `revoke select on t from anon,
authenticated` then `grant select (safe_col, safe_col) on t to anon,
authenticated`. A view redefinition alone cannot close this class of leak —
it can only make the *intended* path narrower while leaving the direct path
wide open. `public_hiring_opportunities` was additionally switched off
`security_invoker = on` (to definer/owner mode) so it can still read the
now-column-restricted timestamps internally to compute a coarsened
`first_observed_month`/`last_activity_month` — this changes nothing about
row visibility, only which columns are readable and by which path.

**Internal engine reads that genuinely need day-precision must use the
service-role client, reading base tables directly** — `stale.ts`'s
`computeStaleness` and `analytics.ts`'s `daysToResolution`/`observedMonths`
cannot work off month-coarsened data, unlike the Evidence Engine (which only
ever needed month precision, so `public_submissions`'s row-level RLS
scoping was always sufficient there — `hiring_submissions` has no equivalent
gap because its own base-table RLS policy was scoped from day one, `using
(is_approved = true and rejected_at is null)`, matching D-016's original,
narrower framing).

**Why this is recorded as its own decision, not folded into D-016:** the
generalizable lesson — *check column-level exposure on the base table, not
just what the intended-path view projects, for any RLS-enabled table with a
public read policy* — applies to every future public-facing table this
codebase adds, not just this one leak.

**Live-verified in production** (not just locally): `set local role anon;
select first_observed_at from hiring_opportunities` → `permission denied for
table hiring_opportunities`. Safe columns and the coarsened view both
confirmed still working for anon.

**Cost:** none beyond the migration itself — no product behavior changed
(the UI never rendered these fields; only direct API/database access is
affected), and the two internal callers already had an admin client
available nearby (`recordStaleInferenceIfDue` was already using one).
**Revisit if:** a future public view is added over an RLS-enabled table with
an unconditional (`using (true)`) or otherwise permissive base policy —
audit whether every column the view's own query reads is safe for the
querying role to access directly, not just what the view projects.

---

## D-027 · PixelRAG's real scope: a retrieval fallback, not a general acquisition engine — and the company_requests write-path gap it exposed

**Status:** Accepted · 2026-08-17 · `src/lib/external-intel/*`, `src/app/api/company-requests/create`

PixelRAG was required to be a real part of the product, not deferred. Before
writing any code, its actual hosted capabilities were checked directly
(`https://github.com/StarTrail-org/PixelRAG`, live-fetched) rather than
assumed from the name. Finding: it is a visual-retrieval system over a
**fixed, pre-indexed corpus** (~8.28M Wikipedia pages), hosted at
`api.pixelrag.ai` with exactly one unauthenticated endpoint, `POST /search`.
It is **not** a general web crawler and has **no structured-extraction or
render endpoint on the hosted API** — `pixelshot` (arbitrary-URL rendering)
and `pixelrag serve` (a custom index) are local-only capabilities of the
open-source project, never exposed over the network today. This independently
confirms D-019's original framing ("retriever ≠ extractor," "the bottleneck is
permission, not parsing") and matches `website-meta.ts`'s own prior comment
that PixelRAG was already rejected for headless-rendering-shaped company
enrichment for the same reason.

**What was actually built, in the role PixelRAG can genuinely fill:**

1. **`src/lib/external-intel/pixelrag.ts`** — the one module allowed to call
   PixelRAG. `pixelragSearch()` is real and wired to the hosted API today.
   `pixelragRender()` is a documented stub returning `null` (never a
   fabricated result) unless `PIXELRAG_RENDER_URL` points at a self-hosted
   instance — there is nothing else it could honestly do against the hosted
   API.
2. **Search-fallback name resolution (`enrich.ts`'s
   `resolveViaPixelragFallback`)** — when Wikidata's own entity search misses
   (a real, measured failure mode — see wikidata.ts's own comment on Okta/
   Redis/Sentry-style near-misses), PixelRAG's fuzzy retrieval over its
   Wikipedia corpus proposes a candidate article. That candidate is resolved
   to a QID (`external-intel/wikipedia-qid.ts`, via MediaWiki's own
   `pageprops` API — not PixelRAG) and **must still pass
   `resolveCompanyEntityByQid`'s existing business-type verification gate**
   before anything is persisted. PixelRAG proposes; Wikidata's existing gate
   decides. This is the real, live, testable "unknown company → discover
   basic identity/metadata" path (Case 2), reusing the on-demand enrichment
   pipeline that already existed rather than building a second one.
3. **The Case-1 skeleton (`web-discovery.ts` → `extract.ts` →
   `seed-pipeline.ts`)** — known company, sparse evidence → discover a
   *permitted* external source → extract → the EXISTING hiring-intel
   normalize/validate/moderate pipeline (unmodified). Every stage is real and
   wired; `discoverPermittedSource` genuinely queries `external_sources` and
   returns `found:false` today because every registered source still has
   `acquisition_enabled=false` (Q-2, unchanged by this work). That is the
   correct, honest output — not a bug to work around. `extractReportsFromSource`
   is equally honest: even with `PIXELRAG_RENDER_URL` configured, there is no
   per-source URL-discovery mechanism yet (a source's own search/listing API,
   never PixelRAG), so it returns `[]` with the specific missing piece named.
   **This is the human/credential gate the task's own instructions named as
   an acceptable stopping point** — it is scoped, not silently dropped.

**The company_requests write-path gap this surfaced (was already found and
designed but unimplemented before this session, from the "still can't search
naukri.com" investigation):** `company_requests` (migration 0022) had zero
public write path — the only way to reach `createCompanyRequest` was as a
side effect of finishing the full hiring-report wizard. **Built:**
`POST /api/company-requests/create` — rate-limited, duplicate/domain-collision
pre-checks (`searchOrganizationsRanked` + `findOrganizationByDomain`, the
exact promote-time checks now also run at creation time) + a pending-request
dedup check, with best-effort domain auto-fill via the same Wikidata/PixelRAG
identity lookup (never blocking on failure). `companies/page.tsx`'s
zero-match state now offers this directly (`AddCompanyRequestForm.tsx`)
instead of only routing into the full submit wizard. Requests still land as
`pending`; only M5.1's existing admin promote/merge/reject flow (unchanged)
turns one into a real organization.

**What PixelRAG must still never do** (unchanged from D-019): write to
Supabase directly, bypass moderation, decide weight, replace Postgres search
(D-020), or stand in as the truth layer. Nothing built here crosses that line.

**Revisit when:** (a) a self-hosted PixelRAG render deployment exists — set
`PIXELRAG_RENDER_URL` and build the per-source URL-discovery step Case 1 still
needs; (b) Q-2 resolves (a licensed/credentialed source gets
`acquisition_enabled=true`) — at that point `seed-pipeline.ts` starts actually
importing rows through the unmodified existing pipeline, with no further
plumbing required.

---

## D-028 · Reddit acquisition pilot built end-to-end; credential is the only remaining gate

**Status:** Accepted · 2026-08-17 · `scripts/reddit_ingest.py`,
`scripts/qa-verify-external-pipeline.ts`,
`supabase/migrations/0030_qa_external_source.sql`, `tests/reddit-pilot.test.ts`

Following `docs/q2-source-acquisition-plan.md`'s recommendation (§5), the user
authorized Reddit as Q-2's first pilot source. This decision records what was
built and, critically, that **the pipeline is complete and proven; only a
real credential is missing** — nothing here should be read as "Reddit data is
now flowing," because it is not.

**What changed, concretely:**
1. **`reddit_ingest.py` hardened**, not rebuilt — the adapter (PRAW, official
   API, structured-fields-only contract) already existed and was already
   sound. Added: a `--check-credentials` flag that makes ONE real
   authenticated call and exits, so a bad credential is caught in seconds
   instead of after a full harvest; retry-with-backoff per search query for
   TRANSIENT failures (network/5xx), with auth failures (401/403) never
   retried — retrying a wrong client id/secret cannot succeed and only
   delays a clear failure message. The full run now calls
   `check_credentials()` before `harvest()` and refuses to write ANY output
   file on a credential failure — never a silent empty/stub JSONL that could
   be mistaken for "ran successfully, found nothing."
2. **Migration `0030`** adds a QA-only external source
   (`qa_external_verification`), `enabled=false` **permanently** (unlike
   `reddit`, which is disabled only until reviewed) — a row attributed to it
   can never reach `public_external_reports` regardless of moderation
   status, by the same WHERE clause every other source's publication already
   goes through. Applied via the Supabase MCP's `apply_migration` (the
   correct, committed path — not the "direct then backfill" pattern already
   flagged twice in this codebase's history).
3. **`scripts/qa-verify-external-pipeline.ts`** — the external-reports
   analogue of M5.4's QA-org verification. Runs the REAL
   `runExternalImport()` and `moderateExternalReport()` (no reimplemented
   logic) against the QA source and the existing QA organization
   (`m54-qa-verification-test`, D-024, matched via exact slug —
   `normalizeCompanySlug("M54 QA Verification Test")` ===
   `"m54-qa-verification-test"`), then asserts `public_external_reports`
   shows zero rows for that source even after approval, then rejects and
   deletes, then asserts the count returns to baseline. **Run live against
   production during this task — passed on the first run**, every assertion
   green (import 1 created → approved → 0 public rows → cleaned up → count
   back to 0).
4. **`tests/reddit-pilot.test.ts`** — Reddit-shaped fixtures (matching
   `reddit_ingest.py`'s exact emitted contract: `external_ref="t3_…"`,
   `extraction_version="reddit-v1"`, the adapter's real 0.3–0.85 confidence
   range) through the unmodified `normalize`/`import` core, plus a weighting
   test pinned to the REAL production values
   (`external_sources.trust_weight('reddit')=0.30`,
   `platform_settings.global_external_multiplier=0.35`, both read live during
   this task) proving an approved Reddit report at maximum extraction
   confidence still weighs `0.3 × 0.85 × 1 × 0.35 ≈ 0.089` — far below a
   first-party report's `1.0`, and exactly `0` while `pending`.

**PixelRAG's role: none, and this is now documented explicitly**
(`docs/hiring-intelligence.md` "Why PixelRAG is not part of Reddit
acquisition"). Reddit's official API returns structured JSON directly; there
is nothing to render. PixelRAG's real role (D-027) remains identity-fallback
in `enrich.ts` and the stubbed Case-1 render step for a *future* source that
has no API. Nothing built for this pilot touches `external-intel/pixelrag.ts`.

**Credential status — checked, not assumed.** `.env.local`'s
`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET` were positively verified against
the real Reddit API (a forced network round-trip, not an inference from
their being merely present): both are 3-character placeholder values, and
the real API returns `401`. **No real Reddit data has been acquired.**
`live evidence count for real Reddit content: 0 before, 0 after` — the only
non-zero counts from this task are the QA fixture's transient
import→approve→delete cycle described in point 3, never real content.

**What remains before real data flows:** a human registers a Reddit "script"
app (free, reddit.com/prefs/apps) and sets
`REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`/`REDDIT_USER_AGENT` as real
values. Then: `python scripts/reddit_ingest.py --check-credentials` (expect
`Credential check OK`) → a small real harvest → `npm run external:import --
… --source reddit --dry-run` → the real import → moderation queue review.
None of that is run by this decision or by any automated process — approving
real third-party content about real companies is a human moderation
decision, matching the precedent already set for `hiring_submissions`
(V1.2) and never crossed here.

**Unrelated, still unresolved (carried forward from D-027's audit, not
touched by this task):** production's `external_sources.acquisition_enabled`
remains `true` for `glassdoor`/`ambitionbox`/`linkedin` — still needs the
human confirm-or-revert decision `docs/q2-source-acquisition-plan.md` §0
describes.

---

## D-029 · The acquisition pipeline is a real, triggerable, end-to-end system — not adapters in isolation

**Status:** Accepted · 2026-08-17 ·
`src/lib/external-intel/{orchestrator,adapters/{reddit,demo}}.ts`,
`supabase/migrations/{0031,0032}`,
`src/app/api/{admin/external/{runs,acquire},cron/acquire-external}/route.ts`,
`vercel.json`, `src/app/admin/page.tsx`

D-028 proved the Reddit *adapter* and the *existing* hiring-intel core work.
This decision closes the gap D-028 explicitly left open: nothing tied
company-detection, source-eligibility, acquisition, and the existing
import/moderation core into one callable, schedulable system. Before this,
"running the pipeline" meant a human invoking `scripts/reddit_ingest.py` then
`npm run external:import` by hand — the exact manual-script dependency this
decision removes.

**The real, end-to-end vertical slice — every stage genuinely wired, none
mocked:**

```
company search (searchOrganizationsRanked, EXISTING)
  -> detect unknown/sparse (confident match? else queue a company_request
     via createCompanyRequest, EXISTING, same D-009 checks the public
     "Add this company" flow uses)
  -> source eligibility (external_sources.acquisition_enabled, the Q-2 gate,
     EXISTING column, never bypassed)
  -> acquire (adapter.load() — REAL Reddit OAuth+search, or the
     credential-free demo adapter)
  -> structured extraction (same RawExternalReport contract every source
     already used)
  -> provenance + content hash + validation + dedup (runExternalImport,
     src/lib/hiring-intel/importer.ts, UNCHANGED — not reimplemented)
  -> moderation queue (verification_status='pending', UNCHANGED)
  -> [human approval] -> Evidence Engine (UNCHANGED)
```

**Real Reddit, ported in-process (`adapters/reddit.ts`), not the Python
script wrapped.** `scripts/reddit_ingest.py` (D-028) is a manually-run CLI
tool with no path into the app. This is the SAME source — same OAuth grant
(`client_credentials`, what PRAW's `read_only=True` does internally), same
extraction regexes ported verbatim, same structured-fields-only contract —
made callable from an API route or the cron trigger, with retry/backoff and
a real (not inferred) credential check. `isRedditConfigured()` is
presence-only; `checkRedditCredentials()` performs one live OAuth round
trip, mirroring V0.2's "positive check, not inference" discipline. Still
credential-gated exactly as D-028 found (`.env.local`'s values remain 3-char
placeholders — unchanged by this task, not re-checked since nothing about
that fact could have changed).

**Demo adapter (`adapters/demo.ts`) — proves the surrounding pipeline
independent of any credential or ToS surface**, per D-013's already-
established convention (`example.com` URLs, `extraction_version='demo-v1'`).
Deterministic (same company → same `external_ref`/`content_hash`), which is
what makes idempotency provably testable rather than assumed. Registered
under its own permanently-`enabled=false` source (migration 0032, mirroring
migration 0030's QA source) — structurally can never reach
`public_external_reports`, exactly like the QA source.

**A real bug found by actually running the pipeline, not by reasoning about
it.** The first live run (Case B below) landed with `organization_id=null`
instead of the QA organization — the adapter's search input used the
resolved organization's raw `display_name`
(`"(QA TEST — M5.4 pipeline verification, safe to ignore)"`), and
`normalizeCompanySlug` only lowercases and hyphenates *whitespace* — it does
not strip the parens/em-dash/comma that name contains, so the record's
`company` field never round-tripped back through `resolve_organization()`.
**Fixed in `orchestrator.ts`, not in the untouched core**: once an
organization is confidently resolved, every acquired record's `company`
field is rewritten to that organization's own `slug` (guaranteed to resolve
to itself) before handing off to `runExternalImport`. A regression test
(`tests/external-acquisition-orchestrator.test.ts`, messy `display_name`
fixture) pins this. `RawExternalReport` / `normalizeExternalReport` /
`runExternalImport` were not touched — the fix lives entirely in what this
orchestrator hands them.

**Admin status view (migration 0031, `external_acquisition_runs`) — the one
genuinely new table.** `external_reports.verification_status` is per-record;
an acquisition attempt that found nothing produces no record at all, which
was invisible. This table's sole job is showing the ATTEMPT
(`queued → fetching → extracted → validation_failed/awaiting_moderation/
completed/failed`), carrying no evidence content itself. Service-role only,
same RLS posture as `moderation_audit_log`/`rate_limit_counters`. Surfaced
via `GET /api/admin/external/runs` and a compact table + trigger form on the
admin page's External tab.

**Scheduled trigger, the real Vercel-native mechanism — not a fictional
worker service.** `vercel.json` registers `GET /api/cron/acquire-external`
on a daily schedule; Vercel automatically sends
`Authorization: Bearer $CRON_SECRET` on cron-triggered requests, which the
route verifies (fails closed — 500 if `CRON_SECRET` is unset, matching
`ADMIN_SECRET`'s own fail-closed shape). The cron route **only ever uses the
real `reddit` source, never `demo`** — deliberately, so no fabricated-looking
content can ever auto-attach to a real company's moderation queue; if
Reddit's credentials aren't genuinely valid (checked live), every candidate
is skipped and reported as skipped, never silently retried into a fake
success.

**Live acceptance evidence (production, cleaned up after — no residue left
in any real company's queue):**
- Case A (unknown company, demo source): `companyRequestCreated: true`,
  zero records acquired (correctly short-circuits before ever calling the
  adapter for an unresolved company) — queued a `company_requests` row,
  rejected and removed after.
- Case B (QA organization, sparse evidence, demo source), run twice:
  - Run 1 → `status: "awaiting_moderation"`, `recordsCreated: 1`. Inserted
    row carried `company: "m54-qa-verification-test"` (the org's own slug —
    the bug fix, live-proven), `organization_id` correctly set to the QA
    org, real `source_url`/`external_ref`/`content_hash`
    (`sha256`, 64 hex chars)/`extraction_version`/`extraction_confidence`,
    `verification_status: "pending"`.
  - `public_external_reports` for the QA org: **0 rows** — moderation
    boundary held even though the record existed and validated cleanly.
  - Run 2 (same input) → `recordsCreated: 0`, `recordsDuplicate: 1` —
    idempotent, no second row.
  - Cleanup: row deleted, count back to 0, confirmed.
- Real Reddit's *logic* (not just the pipeline around it) is independently
  proven correct via `tests/external-intel-adapters.test.ts` — mocked-fetch
  tests of the actual OAuth+search+extraction code path, not a stub.

**What is automatic vs. human-gated, stated plainly:**
- Automatic: eligibility checking, company detection, acquisition,
  extraction, validation, dedup, run-status tracking, the cron schedule
  itself.
- Human-gated, unchanged from every prior milestone: approving any record
  into public evidence (moderation), and — the one credential this task
  could not simulate — registering a real Reddit app so `reddit`-sourced
  runs produce anything beyond an empty result.

**Remaining blockers, unchanged in kind from D-028, now with a real trigger
mechanism sitting in front of them:** the Reddit credential (free,
human-registered) and the `acquisition_enabled` drift on
glassdoor/ambitionbox/linkedin (D-027 §0, still not reverted, still out of
scope for this task).

---

## D-030 · Named dormant subsystems, kept — this product is feature-complete and evidence-starved, not the reverse

**Status:** Accepted · 2026-08-17 · documentation only, nothing removed

Production state at time of writing: 337 organizations, 6 `hiring_submissions`
(0 approved — of the 5 pending, 3 belong to a `"ZZ Intent Demo"` test
organization that was never cleaned up, leaving only 2 genuinely real
candidate reports, one each on Xcelit and Kodehash Tech), 0 external reports.
Every scoring dimension needs `effectiveN` between 3 and 8 to render at all
(D-001 and every dimension's own `MIN_EFFECTIVE_N`) — so almost nothing
renders for a real visitor today. Two independent audits this session (one
tracing every collected field to whether anything displays it, one tracing
every table/route/module to whether anything reads or calls it) confirmed
the product is **over-built relative to its data**, not under-built. The
user's explicit direction: prioritize first-party evidence acquisition and
submit-flow friction, and **do not remove anything that already exists** —
this entry names what's dormant so a future session doesn't rediscover it as
an unexplained bug, without deleting any of it.

**Confirmed unreachable end-to-end, not merely unused:** `/api/verify/grant`,
`/api/verify/consume`, `/api/verify/health`, and the `verification_grants`
table have zero callers from any UI. Worse than simple dead code: `issueGrant`
(`src/lib/verification/grants.ts`) is reachable ONLY via the dead
`/api/verify/grant` route, so nothing in the running system can ever create a
grant for `/api/submit`'s existing `redeemGrant` call to consume — the
"verified submission" tier is structurally unreachable, not just unbuilt.

**Confirmed schema-only, zero code touches them:** `profiles`, `wishlist_items`,
`saved_comparisons` (migration `0004`) — there is no auth system anywhere in
this app. `src/components/CompanyOverview.tsx`'s own header comment already
documents that Compare/Wishlist buttons were deliberately removed rather than
left greyed out ("a dead control teaches a visitor the product is
unfinished").

**Confirmed write-only, read by nothing:** `moderation_audit_log` (an
append-only trigger fires on every hiring_submissions approve/reject,
migration `0026`'s own header already states nothing queries it) and
`company_field_observations` (a full per-field provenance ledger for company
metadata, populated by `store.ts`'s `upsertFieldObservation`, surfaced
nowhere).

**Confirmed a parallel, unreachable model:** `src/lib/fingerprint/aggregate.ts`
(529 lines, including the only trend/`improving|declining|stable` machinery
in the codebase) is imported solely by its own test file. The REAL, live
scoring model is `src/lib/fingerprint/behavioural.ts` — a drift risk if a
future change touches one and not the other, since nothing would catch the
two silently disagreeing.

**Confirmed collected, never read downstream:** `tenure_bucket` and
`intent_reasons` are collected, validated, and normalized, but no metric,
panel, or query anywhere reads either back out (`intent_reasons` reaches
`hiring_events.payload.reasons` via `buildCandidateEvents`, and stops there —
confirmed via grep across every consumer of hiring-intent events). Both
fields are optional to submit, so — unlike the `call_duration`/
`first_interaction_outcome` fix in this same pass — leaving them alone costs
a submitter nothing; the gap is unrealized potential, not friction.

**Confirmed deliberate, not a gap:** `public_hiring_opportunities` /
`public_hiring_events` (the anonymity-coarsening views, revised as recently
as migration `0029` to close a real timing leak) are never queried —
`src/lib/hiring-intent/timeline.ts` deliberately reads the base tables
directly via the admin client instead, because it needs day-precision the
views intentionally coarsen away (D-026). The views exist for a future public
API surface that does not exist yet, not as an abandoned mistake. Likewise,
the Likert panel showing only 3 dimension rollups behind the unlock gate
(D-018) and 7 of the advisor's 13 preference dimensions mapping to `null` in
`PREFERENCE_TO_EVIDENCE` (no first-party evidence measures salary/growth/
prestige/etc. today) are both already-reasoned product decisions, not bugs.

**What this session actually fixed, distinct from the list above** (see the
submit-flow commit for detail): `call_duration`/`first_interaction_outcome`
were REQUIRED fields blocking submission completion for zero downstream
product value — made optional, since relaxing a required-field UX constraint
deletes no code, column, or schema, and directly serves "reduce friction on
the evidence-acquisition bottleneck." `application_channel` was silently
discarded server-side for 2 of 3 reporter types while still being asked of
them in the UI — now hidden for those two, since asking a question whose
answer is thrown away costs trust in a product whose entire pitch is honest
data handling. Neither is in the "dormant, kept" category above — both were
active friction/trust costs on the live submission path, actively fixed, not
merely documented.

**Explicitly NOT done, considered and rejected as overreach for this pass:**
a `payment_flag_detail` column to stop collapsing the wizard's existing
4-way payment-timing answer to a boolean. Verified directly against migration
history (`0007_reconcile_live_schema.sql`, `0021`) that this collapse is a
twice-documented DELIBERATE decision, not a bug — `payment_risk`
(`src/lib/fingerprint/behavioural.ts`) already scores correctly off the
boolean. Capturing the richer answer would be a genuine, additive enhancement
to what's measured, not a friction fix — out of scope for a pass whose
stated priority is user acquisition and evidence quantity, not scoring depth.
Revisit if a future session is explicitly asked to deepen fraud-signal
granularity.

**Revisit when:** any dormant item above gets a real caller — at that point
this entry should be updated to reflect it moved from "dormant" to "live,"
not deleted (the historical record of why it sat dormant, and for how long,
stays useful).

---

## Open questions (decisions *not* yet made)

| # | Question | Blocked on |
|---|---|---|
| Q-1 | How do companies authenticate to post HR updates? | **Designed** (D-017, `docs/design-hr-authentication.md`), **not built**. Implementing it is the remaining blocker on roadmap items 6 & 8. |
| Q-2 | Where does genuine external seed data come from? | **Pilot pipeline fully built and live-verified (D-028).** Reddit is the resolved pilot source; `reddit_ingest.py` + the existing hiring-intel core are proven end-to-end via `scripts/qa-verify-external-pipeline.ts`. **Only remaining blocker: a real `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`** (checked live — current `.env.local` values are 3-char placeholders, Reddit returns 401). Zero real Reddit content has been acquired. **Unrelated, still unresolved:** production's `external_sources.acquisition_enabled` is `true` for `glassdoor`/`ambitionbox`/`linkedin` — contradicts D-005 and their own recorded license — needs a human confirm-or-revert decision (`docs/q2-source-acquisition-plan.md` §0). |
| Q-3 | Do timeline events ever feed HQS? | Deliberately **not** wired today (D-016 reaffirms). Needs its own decision — events are perception-heavy and would change what HQS means. |
| Q-4 | Who runs staleness when nobody loads the page? | No scheduler exists (D-012). |
| Q-5 | Should `public_hiring_opportunities.first_observed_at` be coarsened? | Exact timestamp is an n=1 correlation vector for single-report opportunities (flagged in D-016). Schema change, out of scope for the analytics task that found it. |
