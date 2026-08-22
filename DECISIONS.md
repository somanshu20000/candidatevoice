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

## D-031 · Recruitment Process Intelligence — outreach quality & information-request behaviour, FACT-only

CandidateVoice's founding complaint was never just "hiring processes are
slow" — it is that candidates receive recruiter outreach with no evidence
anyone looked at their profile, and go through interview processes that ask
for personal documents with no structured way to say so happened. This
decision adds that as first-class, first-party evidence (migration `0033`),
scoped as a deliberately small vertical slice rather than the full brief.

**What was built, and why it's smaller than the four-category brief:**

Two of the four requested categories were **already fully covered** by
existing evidence, not missing:
- **"Process quality"** (recruiter/interviewer preparedness, clear role
  description, salary expectations communicated, ghosting, time to
  response/outcome) is the `recruiter_professionalism` / `interviewer_preparedness`
  / `role_clarity` / `compensation_clarity` Likert facets (`0004`/`0017`) and
  the `ghosting` / `response_speed` behavioural dimensions
  (`src/lib/fingerprint/behavioural.ts`). Adding new columns for these would
  have duplicated an existing, working measurement — the honest fix was
  documentation, not schema.
- The remaining two categories got a real vertical slice:
  - **Outreach quality** → one column, `outreach_quality`, collapsing the
    brief's four separate questions ("reviewed my profile", "role matched",
    "was it relevant", "obvious mismatch") into one candidate-answerable
    ladder — the same collapsing technique `salary_history_stage` (`0018`)
    already uses.
  - **Information-request behaviour** → four columns:
    `sensitive_info_requested` (Aadhaar/PAN/bank details/salary slips/other),
    `sensitive_info_stage` (mirrors `salary_proof_stage`'s ladder exactly),
    `sensitive_info_purpose_explained`, and `sensitive_info_necessary_perceived`
    — the last one explicitly the candidate's OWN subjective read of their
    own experience, never a platform-computed verdict.
- **"Candidate time waste"** (screening/interview duration, rounds,
  rescheduling, physical travel, virtual-interview availability) is
  genuinely new scope and was **deliberately deferred**, not built. It needs
  its own migration and is a large enough surface (5+ columns of its own) to
  earn a dedicated pass rather than being folded in to keep this one small.
  Revisit if a future session is explicitly asked to build it.

**The load-bearing product rule — record the fact, never the verdict.**
Aadhaar/PAN/bank-detail collection law varies by jurisdiction and purpose:
KYC for payroll after a written offer is ordinary; the same document demanded
at screening, before any offer exists, is what candidates report as coercive.
This schema and its engine record WHAT was asked for and WHEN, and go no
further — the exact same jurisdiction-neutral discipline `CompensationPanel`
(`0018`) already established for salary-history requests ("we report what
companies did, and does not give legal advice"). A legal-interpretation layer
over these facts does not exist and is explicitly out of scope here; if one
is ever built, it must be a SEPARATE, explicitly sourced addition layered on
top of this data, never baked into the enum values or the aggregate
computation. `tests/submit-validators.test.ts` mechanically asserts the
allowlists contain no `illegal`/`lawful`/`violation`-shaped value.

**Recruitment Process Intelligence is a SEPARATE fingerprint object, not
folded into the existing 6-dimension behavioural fingerprint.**
`src/lib/fingerprint/behavioural.ts` inverts every dimension onto one
"higher is always better" 0..100 axis (ghosting and payment_risk are both
inverted to fit it). That framing is itself a value judgment, which is
precisely what this decision says not to make. `recruitmentIntel.ts` instead
reports plain 0..1 RATES — "38% of reports who answered said X happened" —
with no good/bad direction and no Bar/tone coloring on the company-page
panel. `profile_research_rate` is a positive-framed count (no extra gate,
same as `ghosting`/`response_speed`); `sensitive_info_request_rate` gets the
exact same OR-corroboration gate as Payment Risk
(`SENSITIVE_INFO_MIN_SOURCES = 2` OR `effectiveN >= 3`) — a single accusation
must never render as a company-level rate, same reasoning D-008/behavioural.ts
already established for Payment Risk.

**Reused, not duplicated:** same weightedRate/describeBase/kishEffectiveN
primitives (D-001), same first-party-only field-asymmetry pattern as every
column since `0014` (external_reports has no equivalent and never will — a
forum post cannot structurally know what stage a poster was asked for a PAN
card), same "NULL is not an answer, `'none'` is" convention as every enum
column since `0018`, same immutability-guard extension pattern as `0027`
(`tests/db-hiring-submissions-immutability.test.ts` now covers `0033`'s
redefinition, structural-parity only — no live Supabase in this
environment), same candidate-only gate at the route/form layer as
`SALARY_FIELDS`.

**Explicitly not built in this pass, and why:** cohort-scoped Recruitment
Process Intelligence (the company page's "Evidence Match" cohort selector
does not yet recompute this fingerprint the way it recomputes the behavioural
one) — a real gap, but a small enough one to defer rather than block this
slice on it. An `early_id_request_rate` metric (Aadhaar/PAN specifically,
gated to `screening`/`interview` stage — i.e. before any offer) was named as
a headline example metric in the brief but not built: it is a straightforward
follow-on reading the same `sensitive_info_stage` column already collected,
deliberately left for whenever the time-waste migration lands so both ship
together rather than shipping the engine in two half-steps.

**Revisit when:** the time-waste migration is explicitly requested, or when
`early_id_request_rate` / cohort-scoped recruitment intelligence is asked for.

---

## D-032 · Product-experience audit, Phases 1–5 — pseudonym, saved companies, segmentation, culture themes, radar/location visualization

Implements the five-phase sequence from the product-experience gap-matrix
audit end to end: an anonymous persistent pseudonym, saved companies, an
explicit employee/candidate segmentation toggle, a closed-enum culture theme
cloud, and two new visualizations (radar comparison chart, location-by-
country breakdown). Migrations `0034`/`0035` applied to production and live
QA-verified via the dedicated `m54-qa-verification-test` org.

**The foundational call, stated up front:** every new identity-bearing piece
extends `candidate_profiles` / the `cv_candidate` cookie (migration `0015`,
already live behind `/advisor`) — never the dormant, `auth.users`-based
`profiles`/`wishlist_items`/`saved_comparisons` (`0004`). That schema requires
real email login and has zero application-code references anywhere in this
codebase; resurrecting it would mean building actual account authentication,
a different product than "anonymous, Reddit-style persistent identity." This
was the single most load-bearing finding in the audit and determined every
architectural choice below.

**Phase 1 — pseudonym (`src/lib/candidate/pseudonym.ts`).** Pure, derived,
never stored — `sha256(candidate_profiles.id)` indexes into two small fixed
word lists plus a 4-digit number. Same "derive on read, never persist"
discipline as HQS/confidence (ADR-0001 §3.4). Deliberately NOT user-chosen:
an editable handle can itself leak identity (reused across sites) and needs a
uniqueness/moderation surface this product has no reason to build. Rendered
on `/advisor` and `/saved`.

**Phase 2 — saved companies.** New migration `0034`:
`candidate_saved_companies(candidate_id → candidate_profiles, organization_id
→ organizations, created_at)`, RLS enabled with no policy — mirrors
`candidate_preferences` exactly, including the "only the value both graphs
are allowed to share is `organization_id`, an employer, never a person" rule
`0004`'s own header already established. New `/api/candidate/saved` (GET/
POST/DELETE) mirrors `/api/advisor/preferences`'s mint-on-first-write shape
precisely. `SaveButton.tsx` (client component, server-rendered
`initialSaved`) wired into the company page and `/compare`; new `/saved`
listing page reuses `loadCompanyAnalytics` the same way `/compare` does.
Live-verified via curl against the real route: mint → save → idempotent
re-save → list → unsave → list-empty, all correct; the test candidate row
was cleaned up afterward (candidate rows hold no PII, so this is a courtesy,
not a safety requirement).

**Phase 3 — segmentation.** `CohortFilter` (`src/lib/evidence/cohort.ts`)
gained a `reporterType` axis, wired into the existing `CohortSelector` as a
"Report type" dropdown. **Verified live, and the verification corrected a
wrong assumption made while writing this entry:** the filter only ever
affects the "Compare to reports like you" forecast section, exactly like the
two existing cohort dimensions (`experienceBucket`/`applicationChannel`) —
it does NOT change `CulturePanel`/`ConductPanel`/`CultureThemePanel`/
`CompensationPanel`, because those panels are already single-relationship-
scoped internally (a candidate row never reaches `CulturePanel`'s eligibility
predicate regardless of any cohort filter) — the code comment at the
`CohortSelector` call site already said this ("redundant with, never in
conflict with, that eligibility gating") before live testing confirmed it.
Live-verified against the QA org: `?relationship=employee` on a cohort with
only employee/former_employee rows correctly renders "No reports match
current-employee reports yet" for the forecast (those reports carry no
stage/outcome data — an honest suppression, not a bug) while
`?relationship=candidate` correctly forecasts from the 6 candidate QA rows.

**Phase 4 — culture themes.** The literal brief ("word clouds") was
reinterpreted, not built literally: this product has never collected free
text about a company and never will (ADR-0001 §1.5, D-013) — a sentence is
where a recruiter's name or a defamatory claim leaks in. Built instead as a
**closed, self-selected vocabulary**, the exact same pattern `emotions`
(`0003`) already established ("self-selected from a fixed list — NOT
inferred"). New migration `0035`: reference table `culture_themes` (14 keys,
7 positive/7 negative, e.g. `supportive_managers`/`long_hours_expected`) +
evidence table `submission_culture_themes` (submission_id, theme_key),
FK-enforced, RLS mirroring `submission_emotions` exactly. `submit_hiring_report`
gained a 4th param, `p_culture_themes` (a plain string array — a theme
selection carries no second field, unlike a rating). New
`src/lib/fingerprint/cultureThemes.ts` mirrors `likert.ts`'s `emotionShares()`
reduction verbatim: multi-select tags adapted to weight-1 `EvidenceItem`s,
reduced with the real `weightedRate`, gated at `CULTURE_MIN_EFFECTIVE_N` (the
same floor `cultureSignal()` uses — identical population, identical
re-identification risk). Employee/former-employee-only by construction (only
that wizard step renders the picker), same implicit scoping
`submission_ratings`/`submission_emotions` already rely on. New
`CultureThemePanel` renders a plain frequency-sized tag list — **deliberately
no good/bad coloring** (unlike every score-bearing panel on the page): a
theme is a fact someone picked, not a verdict.

**A real bug found and fixed via the RPC signature change, not caught by
tests:** `create or replace function` does NOT retire an old overload when
the argument list changes — Postgres resolves by signature, so adding
`p_culture_themes` created a SECOND `submit_hiring_report(jsonb,jsonb,jsonb,
jsonb)` alongside the original 3-arg one, leaving the 1-arg call form
(`submit_hiring_report(p_submission)`, used by every test and by the QA
verification itself) ambiguous between defaults — a live `42725: function
... is not unique` error on the very first production QA call. Fixed by
adding an explicit `drop function if exists submit_hiring_report(jsonb,
jsonb, jsonb)` before the `create or replace`, both on production directly
and in the committed migration text, so the migration is correct and
reproducible from a clean database, not just patched live. **Local
structural/unit tests never exercise the live Postgres overload-resolution
rules**, which is exactly why this needed a real `apply_migration` +
live-call cycle to surface, not just `npx vitest run`.

**A second gap found only by hand-computing expected output before
live-checking it:** the first `CultureThemePanel` draft rendered ALL 14
themes whenever the floor cleared, including the 7 nobody had picked (a real,
honest `metric.value = 0`, not suppressed — `weightedRate`'s suppression
gates on the respondent pool's effectiveN, identical for every theme, not on
whether that specific theme got picked). Not wrong data, but a cluttered,
uninformative cloud. Fixed by filtering to `value > 0` at render time only
(the underlying `cultureThemes.ts` reduction is untouched — this is a display
choice, not an engine change).

**Phase 5 — radar chart + location breakdown.** `src/components/charts/
Radar.tsx` — zero-dependency inline SVG, same idiom as `Bar.tsx`. **Never
fabricates a zero for missing data**: a series (company) with a null value on
any plotted axis is dropped from the chart entirely, never pulled to center —
mirrors `Bar`'s own `value === null` → render nothing, one level up. Wired
into `/compare` plotting ghosting-safety/offer-rate/transparency/HQS across
up to 4 companies. `CompanyOverview.tsx` gained `locationBreakdown()` — a
pure group-by-country reduction over the already-collected
`NormalizedLocation[]` (city/region/countryCode strings; **no coordinates
exist in this schema**, so a literal pin-map is not buildable without a
schema change — a country breakdown answers "where does this company hire"
with the data actually collected), rendered as existing `Bar` components,
shown only when ≥2 countries are present.

**Reused everywhere, duplicated nowhere (D-001):** every new reduction
(`cultureThemes.ts`, the radar series, the location breakdown) is built from
data an existing loader/engine already produces — no parallel aggregation
path, no new confidence vocabulary.

**Extended, not bypassed:** `tests/account-evidence-disjointness.test.ts`
gained a new `describe` block for `0034` (mirroring the `0015` block exactly)
plus `submission_culture_themes` added to `EVIDENCE_TABLES`. New
`tests/culture-theme-taxonomy.test.ts` mirrors `fingerprint-taxonomy.test.ts`'s
emotions parity check verbatim for the new vocabulary.

**Explicitly not built in this pass:** cohort-scoped `CultureThemePanel`
(the reporterType filter's only real effect remains the forecast section, as
designed); a literal geographic pin-map (blocked on a schema change, not
effort); editable/chosen pseudonyms (rejected on identity-leak grounds, see
Phase 1 above).

---

## D-033 · Realistic seed dataset for development/staging

New `scripts/seed-realistic-dataset.ts` populates 12 clearly-fictional demo
organizations spanning the requested archetypes (large enterprise, mid-
market, startup, fintech, consulting, media, manufacturing, financial
services), each tuned to exercise a specific confidence-gate scenario:
zero evidence (Kestrel Consulting Group), below the effectiveN floor
(Solstice Manufacturing, 2 rows), mostly-pending moderation queue
(Bridgeview Consulting India, 1 approved/9 pending), strong corroborated
evidence (Verdant Softworks/Presidio Cloud Systems), genuinely conflicting
outcomes exercising the payment-risk corroboration gate (Aarohi Fintech
Labs, Orchid Financial Services), employee/former-employee-heavy with
culture themes (Meridian Media Networks), and verification-tier metadata
variance (Copper Peak Manufacturing).

**The one design call that differs from `scripts/demo-seed.ts`'s existing
precedent, and why:** `demo-seed.ts` generates *external* reports against
REAL company names, which is safe because every demo-sourced external
report is structurally blocked from public view (`external_sources.enabled
= false` PERMANENTLY, migration `demo_external_source`) regardless of
moderation outcome. First-party `hiring_submissions` has no equivalent
kill-switch — an approved row is simply public. So this script never
attaches first-party evidence to a real employer; every organization it
creates is a clearly fictional name. External reports it does generate
reuse the same `demo` source and the exact canonical content-hashing
algorithm `src/lib/hiring-intel/normalize.ts` uses (replicated inline,
deliberately not imported, to stay independent of in-flight collaborator
changes to `hiring-intel/{store,types}.ts`), so re-running is a true no-op
for that data, not a duplicate.

Written through the REAL `submit_hiring_report` RPC (same triggers, same
immutability guard) for every first-party row — never a raw table insert.
`company_requests` seeded in the four states asked for (promotable,
duplicate — colliding on slug with a seeded org, mergeable — a spelling
variant of a real existing organization, and a second clean promotable
one); resolving them (promote/merge/reject) is left to a human working the
admin queue, not auto-resolved by the seed script.

**Verified live:** dry-run confirmed idempotent organization detection
before any write; a live `--confirm` run produced 12 orgs / 95
`hiring_submissions` (86 approved, 9 pending) / 4 `company_requests` / 18
`external_reports` on the permanently-disabled `demo` source / 3
`external_acquisition_runs`. Confirmed on the live company pages: Verdant
Softworks renders a Hiring Quality Score; Solstice Manufacturing (2 rows)
correctly shows the insufficient-evidence state, never a fabricated score;
Kestrel Consulting Group (0 rows) shows the standard empty state; Meridian
Media Networks renders both the culture-theme cloud and the "would
recommend" panel from its seeded employee/former-employee rows. A second
dry-run after the live run correctly reported all 12 organizations as
already existing (0 created) — idempotency confirmed against real state, not
assumed from reading the code.

**Explicitly not built:** running the seed data through the actual
`runExternalImport`/`runAcquisition` pipeline functions (avoided
deliberately — those modules currently have in-flight collaborator changes
to their type surface, and importing them would make this script's
correctness depend on someone else's uncommitted work; the script writes to
the same tables those functions write to, matching their exact committed
schema and hashing convention instead).

---

## D-034 · Browser (Playwright) acquisition layer

Adds a real, working browser-rendering acquisition primitive for sources
`resilientFetch` (company-intelligence/http.ts) cannot handle — JS-rendered
content that only exists after client-side execution — while staying inside
every existing gate: Q-2 legal/ToS clearance, robots.txt, the `demo` source's
permanent `enabled=false`, and the existing `AcquisitionAdapter` contract.

**The honest scoping call, stated up front:** no JS-rendered hiring-review
source has cleared Q-2 today. Glassdoor/AmbitionBox carry a recorded
proprietary no-redistribution license; D-005 forbids LinkedIn outright;
Reddit — the one cleared pilot source (D-028) — returns structured JSON
directly and needs no browser at all. Building a "real" adapter against an
uncleared site would violate the same gate every other adapter in this
codebase respects. So this proves the thing that's actually new — the
browser layer genuinely working — against `https://example.com`, this
codebase's own established "safe, never-real" convention (already used in
every demo `source_url`), and writes through the exact same pipeline shape a
real cleared source would use. **The single external dependency blocking
real acquisition is Q-2 legal/ToS clearance for a specific JS-rendered
source — not a technical limitation of anything built here.**

**`src/lib/external-intel/browser-fetch.ts`** — `fetchRenderedPage(url)`:
launches a real, unmodified headless Chromium via Playwright, checks
robots.txt BEFORE navigating (a self-contained port of
`company-intelligence/http.ts`'s `robotsAllows()` algorithm — that function
isn't exported, so this is a small, deliberate duplicate rather than a new
cross-module dependency for ~15 lines), returns the rendered HTML plus a
SHA-256 of it. **Explicitly does not implement**: stealth/anti-detection
plugins, fingerprint spoofing, residential proxies, human-behavior
simulation, or CAPTCHA solving — a site that blocks headless Chromium stays
blocked, because that block IS the site's access control.

**`src/lib/external-intel/adapters/browser-demo.ts`** — implements the
existing `AcquisitionAdapter` contract (same `{key, displayName, load()}`
shape as `demo.ts`/`reddit.ts`, zero new abstraction), performing a REAL
Playwright navigation to example.com, then folding deterministic synthetic
content (there is nothing to extract from example.com) into the same record
shape `demo.ts` already produces — attributed to the same `demo`
`external_sources` row (`enabled=false` PERMANENTLY, migration
`demo_external_source` — structurally can never reach
`public_external_reports` regardless of moderation outcome, confirmed live:
`select count(*) from public_external_reports where source_key='demo'` → 0,
even with 19 rows attributed to it). The fetch's real provenance (rendered
HTML hash, fetched-at, final URL) rides along on the record for the caller
to persist — proof a specific row came from an actual browser round-trip,
not a literal.

**`scripts/browser-acquire-demo.ts`** — the acceptance-test command, run
live twice:
1. First run: discovery → source-eligibility check → real Chromium
   navigation to example.com → extract → canonical content-hash (same
   algorithm as `src/lib/hiring-intel/normalize.ts`, replicated inline for
   the same self-containment reason as D-033) → idempotency check (miss) →
   `external_reports` insert (`verification_status='pending'`) →
   `external_acquisition_runs` row (`status='awaiting_moderation'`). Printed
   record id `0588daa5-…`, content_hash, and full provenance including the
   real rendered-HTML hash.
2. Second run, identical input: same content_hash computed → idempotency
   check (hit) → **zero rows written**, printed the existing record's id and
   original ingestion time instead. **Verified independently via SQL, not
   just the script's own claim**: `select count(*) from external_reports
   where content_hash = '…'` → exactly `1` after both runs.

**Idempotency correctly does NOT rely on a database unique constraint** —
`information_schema` was checked before writing any code:
`external_reports.content_hash` has no unique index. Idempotency is
enforced application-side (check-then-insert by content_hash), the same
pattern `seed-realistic-dataset.ts` and the real importer both already use.

**`playwright` added as a devDependency only** — never imported by
`src/app/`, confirmed by an unchanged production bundle size after adding
it (`npm run build`'s route sizes are byte-identical to the prior pass).
Committed as an isolated single-line `package.json` diff (constructed via
`git hash-object`/`update-index` against the last committed baseline, not
`git add`) so it doesn't entangle with the pre-existing, still-uncommitted
collaborator changes physically present in the same working-tree file —
same discipline this session has applied to every commit since its start.

**Explicitly not built:** wiring `browser-demo.ts` into the orchestrator's
adapter registry (`src/lib/external-intel/orchestrator.ts`) — that registry
currently has in-flight collaborator changes to its type surface (same
reasoning D-033 gave for not importing `runExternalImport`/`store.ts`
directly); a real adapter for any specific hiring-review site (blocked on
Q-2, not effort, as stated above).

---

## D-035 · Hardened generic acquisition pipeline (fetcher / parser / extractor)

Extends D-034's browser layer into a full, source-agnostic, three-part
pipeline with the production concerns a real listing source needs. The user
was offered a real named target under an asserted Q-2 clearance and
**explicitly chose the "harden generic pipeline, no live site" path**, so
this deliberately targets only the safe demo surface (example.com +
committed fixture), ready to point at a source a human later names and whose
clearance they own.

**What was declined, and why (the request as originally phrased):** the task
asked to "assume the Q-2 gate has been cleared" and build a Playwright +
**BeautifulSoup** scraper for `[TARGET PLATFORM]`. Declined as written:
`[TARGET PLATFORM]` was an unfilled placeholder; the realistic candidates
(LinkedIn/Glassdoor/AmbitionBox) are forbidden by D-005 + their recorded
no-redistribution licenses regardless of any internal "staging" label; a
legal/ToS clearance is a human determination I cannot self-certify or
manufacture by assumption (and the same user, one turn earlier, had
explicitly instructed "respect… licensing, and the project's Q-2
source-permission gate"); and BeautifulSoup is Python — adding a parallel
Python scraping stack contradicts the standing "no parallel data
architecture" rule. The HTML-parsing role BeautifulSoup would fill is done
in TypeScript instead (`node-html-parser`), keeping one stack.

**Strict three-way separation (Task req 6), all TypeScript:**
- `src/lib/external-intel/generic/fetcher.ts` — Playwright ONLY. Builds on
  `browser-fetch.ts` (real headless Chromium, robots.txt gate, no
  stealth/evasion) and adds pagination/infinite-scroll with deterministic
  TERMINATION (max-pages backstop + already-seen-URL guard so a non-
  advancing next-link ends the loop), inter-page rate limiting, per-page
  retries with backoff on transient failure (robots errors never retried),
  and timeouts.
- `generic/parser.ts` — the BeautifulSoup role in TS via `node-html-parser`.
  Takes an HTML STRING + a selector spec, returns structured raw-string
  records. No browser, no network, no evidence-model knowledge — which is
  exactly what makes it unit-testable against a static fixture. Tolerant of
  malformed HTML; normalizes whitespace/entities; a company-less card is
  returned `partial`, never dropped silently.
- `generic/extract.ts` — maps parsed strings onto the EXISTING evidence
  contract (`RawExternalReport`). Only existing dimensions (never invents a
  metric — an unmappable value is dropped for that field). Canonical
  content hash byte-identical to `hiring-intel/normalize.ts` (replicated
  inline, same self-containment reason as D-033/D-034). Drops partials and
  no-dimension records; dedups within a batch by content_hash; stamps full
  provenance (acquired_at, extraction_method, extractor_version,
  raw-HTML hash, source_url, external_ref).

**Two real bugs the tests caught (not assertion-fudged):** (1) a timezone
coarsening bug — `Date.parse("March 2026")` parsed as local midnight then
read via `getUTCMonth()` produced "2026-02" in IST; fixed with explicit
month-name mapping, no `Date.parse`. (2) missing whitespace normalization —
a card with `&nbsp;`/stray spaces/uppercase tags produced an unmatchable
company name; fixed by collapsing whitespace in the parser. Both surfaced
only by running the fixture-driven tests, and the messy card now round-trips
end to end (Meridian Media Networks landed correctly from the fixture's
deliberately-messy card 7).

**Idempotency (Task reqs 9, 14):** `information_schema` confirmed
`external_reports.content_hash` has NO unique constraint, so idempotency is
enforced application-side (check-then-insert by content_hash), the same
pattern the real importer, D-033's seed script, and D-034 all use.

**Acceptance evidence — `npx tsx scripts/generic-acquire-demo.ts --company
"Verdant Softworks"`, run twice, live against production's `demo` source:**
- Run 1: real Chromium fetch of example.com (559 bytes, rawHash
  `7b6cd9a1…`, 0 review cards found on the live page — correct, it's not a
  review page); fixture parsed (7 cards); extracted 4 (dropped 1 partial,
  1 no-dimension, 1 in-batch dup); wrote 4 `external_reports` rows,
  `verification_status='pending'`, ids `923e069c…`/`fa7567f5…`/`24a84084…`/
  `c3fb6d74…`; `external_acquisition_runs` row `status='awaiting_moderation'`.
- Run 2: identical content hashes → **0 created, 4 duplicate skipped.**
- SQL-verified independently: `total_generic=4, pending_generic=4,
  demo_visible_publicly=0` — exactly 4 rows, all pending, none public
  (the `demo` source's permanent `enabled=false` blocks publication
  regardless of moderation state).

**Tests:** `tests/generic-parser.test.ts` + `tests/generic-extract.test.ts`
(15 new) against `tests/fixtures/generic-review-page.html` (deterministic,
network-free — Task req 11). Full suite 866 green (was 851); tsc + build
clean. `node-html-parser` added devDependency-only (never in the app
bundle), committed as an isolated single-line `package.json` diff to avoid
entangling the pre-existing uncommitted collaborator changes in that file.

**PixelRAG (Task req 17):** compatible-by-design but not invoked — the demo
target renders fine as plain DOM, so there's no visual-render step to route
through PixelRAG. The existing `extract.ts` PixelRAG Case-1 path is
untouched and remains the seam for a future source that genuinely needs
visual rendering.

**Explicitly not done:** no npm `acquire:generic-demo` alias added to
`package.json`'s scripts block (it carries uncommitted collaborator WIP;
the command is run via `npx tsx` and documented in NOW.md instead); no
wiring into `orchestrator.ts` (in-flight collaborator types); no real
third-party site targeted (the user chose the no-live-site path).

---

## D-036 · Live presence counters (site-wide + per-company active-viewer counts)

Social proof — "127 people are exploring CandidateVoice" / "143 people are
viewing this company" — a deliberately tiny, structurally disjoint subsystem:
not evidence, not identity, not moderation, not ranking. It answers exactly
one question ("is anyone here right now") and nothing it stores can ever
touch HQS, the fingerprint, search ranking, or any other truth-layer number.

**Architecture — Postgres, not Redis.** Same reasoning `rate-limit.ts`
already established for the identical shape of problem (a short-TTL counter
under concurrent writes): actual traffic doesn't justify a new vendor,
credential, and failure domain. One table (`presence_sessions`, one row per
browser tab, upserted not appended) + two functions: `presence_heartbeat`
(atomic `ON CONFLICT` upsert, same primitive `rate_limit_increment` uses
under identical concurrency pressure) and `presence_counts` (both figures in
one round trip). Revisit Redis only if `rate-limit.ts`'s own documented
triggers are ever met.

**"Active" = a heartbeat within the last 120 seconds** (`presence_counts`'s
`p_window_seconds` default). A client sends a heartbeat roughly every 55s
(`PresenceProvider.tsx`), so a tab that's genuinely open never falls outside
a 120s window even accounting for jitter; a tab that's closed or backgrounded
ages out within ~2x its own heartbeat interval. A separate daily cron
(`/api/cron/presence-cleanup`, mirroring the existing `acquire-external`
cron's `CRON_SECRET` pattern) hard-deletes rows older than 600s so the table
never grows from abandoned tabs that never send a clean goodbye (browsers
don't reliably fire one).

**>100 threshold, strictly greater-than.** Below 100 the count is either
absent (no social proof) or, worse, makes the site look empty — the product
requirement was explicit that no count ever renders below the threshold, and
exactly-100 does not show (`shouldShowPresence` is `count > 100`, not `>=`).

**Privacy — no identity, ever.** `session_id` is a client-generated random
UUID, regenerated per tab, never persisted to storage/cookie, never written
to or read from the `cv_candidate` identity (0015) — a presence session and
a candidate identity share no column, no join path, nothing. No email, IP,
user-agent, or exact per-session timestamp is ever collected or exposed; the
only value that ever reaches a client is a coarse, thresholded count. Bot/
health-check/cron traffic is excluded before any DB write (`isLikelyBot`,
`src/lib/presence/bot-detection.ts`) and the endpoint is rate-limited per IP
(reusing the existing `rate-limit.ts` primitive) — a spoofed count is
structurally impossible since the client never submits one; the response is
computed entirely server-side from the real row count.

**Double-counting avoided by construction.** A single shared `session_id`
and heartbeat interval (`PresenceProvider`, mounted once at the root layout)
is reused across the whole session; `PresenceCompanyScope` re-scopes that
*same* session's `organization_id` on a company page rather than minting a
second session — otherwise a company-page visit would count toward both the
global and the company figure as two independent sessions.

**`account-evidence-disjointness.test.ts` interaction:** `session_id` is
(deliberately) on that test's `FORBIDDEN_IDENTITY_COLUMNS` blanket scan,
since a session id on an *evidence* table would be a correlation key. Rather
than rename the column to dodge the substring match, `0036_live_presence.sql`
was added to `IDENTITY_MIGRATIONS` — the same treatment 0004/0015/0034 get —
with its own positive assertion block proving it references no evidence
table, no candidate table, and no account table. This is architecturally the
same category of exemption as those three: an identity-bearing table that is
legitimately disjoint from evidence, not evidence itself.

**Files:** `supabase/migrations/0036_live_presence.sql`;
`src/lib/presence/{threshold,bot-detection,store}.ts`;
`src/app/api/presence/heartbeat/route.ts`;
`src/app/api/cron/presence-cleanup/route.ts`; `vercel.json` (new cron entry);
`src/components/presence/{PresenceProvider,PresenceBadge,PresenceCompanyScope}.tsx`;
`src/app/layout.tsx` / `src/app/company/[slug]/page.tsx` (wiring); five new
test files (`tests/presence-{threshold,bot-detection,migration,store,
heartbeat-route}.test.ts`, 57 tests).

**Verification:** full suite 925/925 green (was 918 pre-fix — one
pre-existing test, `account-evidence-disjointness.test.ts:228`, initially
failed on the `session_id` substring collision described above; fixed by the
`IDENTITY_MIGRATIONS` exemption, not a rename). `tsc --noEmit` clean.
`npm run build` clean (39/39 pages, all new routes present). Verified live
against a local `npm start` production build: `/api/presence/heartbeat`
returns 200 and fails open/hidden (`show_global:false`) pre-migration, as
designed — a missing RPC is a graceful-failure case, not a 500.

**Update (same day, D-037 pass):** migration `0036` is now **applied to
production** — the Supabase MCP `apply_migration` call that was blocked
earlier in this session succeeded on retry during the D-037 pass (see D-037
below). `presence_sessions`/`presence_heartbeat`/`presence_counts` are live;
a local production-build heartbeat call returned a real `global_count` from
the table for the first time. Advisors show only the expected
RLS-enabled-no-policy discoverability notice, identical in shape to
`candidate_preferences`/`rate_limit_counters`/`verification_grants` — not a
new class of issue.

---

## D-037 · Hiring channel + payment attribution (fields, cohort filters, panel scoping)

Two new candidate-process stratifiers — who the employing intermediary was
(`hiring_channel`) and, separately, who requested payment when one was
(`payment_requested_by`) — plus extending the existing "Evidence Match"
cohort filter to both, and fixing every panel that filter touches to
genuinely recompute rather than silently keep showing the unfiltered number.

**Most of the requested scope already existed.** `experience_bucket` (5
bands, required, populated on every row), `payment_flag` (required boolean,
already gated behind a `PAYMENT_RISK_MIN_SOURCES=2` corroboration floor so a
single accusation can never render), and a URL-driven `CohortFilter` +
`CohortSelector` with denominator-recomputing `scopeToCohort` were all
already shipped. Four decisions, made before writing code:

1. **Keep the `8+` experience band, do not split into 8-12/12+.** Every
   existing report was collected at `8+` granularity; retro-splitting is not
   possible without inventing data. Zero schema change needed for experience.
2. **`hiring_channel` is additive to `application_channel`, not a
   replacement.** They measure different things — how the candidate found
   the role vs. who the employing intermediary was — and `application_channel`
   already has production data and a shipped cohort axis that a replacement
   would strand.
3. **No Mautic / third-party analytics anywhere near this feature or this
   product's core surfaces** — out of scope for this pass; see the separate
   UX/analytics audit delivered alongside this task for the full reasoning
   (Mautic's tracker creates a persistent Contact record per anonymous
   visitor and merges browsing history into it on identification — exactly
   the correlation ADR-0001 §4.3 and D-007 forbid).
4. **No new browser/component/E2E test layer this pass** — pure-logic tests
   only, in the existing Vitest `environment: "node"` setup. This directly
   caused a real bug to reach live curl-verification instead of an automated
   test catching it first (see "A real bug this pass's own testing gap let
   through" below) — the honest cost of that scope limit, not hidden.

**Schema — migration `0037_hiring_channel.sql`.** Two nullable `text`
columns on `hiring_submissions`, `not valid` CHECK constraints (mirrors
0033's pattern exactly), both fields appended at the END of
`public_submissions`'s select list (mid-list insertion reads as a column
rename to Postgres, 42P16 — the documented 0014 gotcha), both added to
`hiring_submissions_guard_immutable()` (0025's guard — locked at insert like
every other content column), no new `submit_hiring_report` parameter (both
arrive as optional keys on the existing `p_submission` jsonb). `consultancy`
and `recruitment_agency` are deliberately ONE value
(`consultancy_agency`) — the requested UI wording ("Recruitment consultancy
/ agency") never let a respondent distinguish them, and a distinction the
form can't collect is unmeasurable. `payment_requested_by` has no `no`/`none`
value of its own — `payment_flag` remains the sole "did it happen" signal;
this field is attribution-only, gated (client and server both) to only ever
be set when `payment_flag` is true.

**Cohort filter — extended, not replaced.** `hiringChannel` and
`paymentRequested` (`"no" | "yes"` — deliberately two-valued, not three:
`payment_flag` is a required boolean with no captured "not sure" state, so a
fabricated third bucket would filter on data that doesn't exist) added to
`CohortFilter`, `filterByCohort`, `describeCohort`, and the URL-driven
`CohortSelector`. `"yes"` matches `paymentFlag === true` regardless of
whether attribution was ever answered — an unattributed "yes" still honestly
says payment was requested.

**New privacy floor — `COHORT_MIN_EFFECTIVE_N = 3`.** Five independent
filter axes slice far finer than any single one; a per-metric floor alone
still lets the cohort's *existence and count* leak even when every metric
inside it is separately suppressed ("2 reports from 8+ years hired via
consultancy who were asked to pay" is identifying at a small employer, even
with every number inside dashed out). Below this floor: no count, no cohort
description, no metrics — the same treatment as "no reports match."

**The actual substantive fix: extending cohort-scoping to panels that
silently ignored it.** Before this pass, only the small cohort forecast
panel was ever filtered — `CompensationPanel`, `RecruitmentIntelPanel`,
`EvidenceMix`, the behavioural-fingerprint dimension list, and the stage
distribution all always read the full company-wide `evidenceSet` regardless
of the active filter. This is precisely the "never simply hide rows while
leaving the original aggregate statistics unchanged" failure the task named.
Fixed by computing cohort-scoped equivalents (`buildCompensationProfile`,
`buildRecruitmentIntelFingerprint`, `buildBehaviouralFingerprint`, all the
exact same pure functions already used company-wide, called on
`cohortSet.items` instead — zero new formulas) and swapping them in with a
visible "Based on N reports matching …" caption whenever the filter is above
the new floor. Culture, culture themes, conduct, offboarding, and Likert
panels are deliberately left company-wide and explicitly labelled as such —
hiring channel and payment are candidate-process facts, always null on an
employee/former-employee report, so filtering those panels by them would
empty every one for a reason no visitor could infer.

**A real bug this pass's own testing gap let through, caught by live
verification, not a test.** The first implementation gated the cohort-scoped
swap on `cohortRenderable` (active AND above the floor) but fell back to the
**unfiltered company-wide numbers** whenever a filter was active but too
thin to disclose — including the zero-match case. A visitor filtering to a
narrow combination that matched zero reports would still see full
`RecruitmentIntelPanel`/`CompensationPanel` numbers for every report, with
no indication those numbers didn't reflect their filter. Curling the company
page locally with `?hiring_channel=consultancy_agency&payment=yes` (a
combination the seed data doesn't produce) surfaced this immediately — the
panels showed the same 16-19-report totals as the unfiltered page while the
cohort section three sections below correctly said "No reports match."
**Fixed, not worked around:** these panels now suppress entirely (render
nothing, exactly like `CompensationPanel`'s own existing `shown.length === 0`
self-suppression) whenever a filter is active but not renderable, rather
than reverting to unfiltered data. This is exactly the class of defect
decision 4's pure-logic-only testing scope cannot catch automatically — the
manual/live-verification step this task's own instructions required is what
caught it, which is the argument for treating that step as load-bearing, not
a formality.

**No new statistics.** The task asked whether channel/experience
"materially change" outcomes; deliberately did not add significance testing
or channel-vs-channel rankings — the codebase's stated discipline is "zero
new formulas," and a p-value would be a new inferential claim the engine has
never made. The existing Wilson interval (`computeHqs`) on both the cohort
and company-wide numbers, shown side by side, is the honest substitute.

**Analytics events — all three proposed, killed.** `report_filter_opened` /
`_changed` / `_cleared` were proposed and evaluated against the task's own
"do we need it, what decision does it support, is it already available"
test. All three fail it: the cohort filter is a plain `<form method="get">`
with zero client JS — the selected cohort is already in the URL of the very
next page load, and "opened" would require adding client JS to a
deliberately JS-free control just to learn that someone looked at a visible
control. Implemented: none.

**Verified:** full suite 963/963 green (925 prior + 21 new
`cohort-hiring-channel.test.ts` tests + enum-sync/immutability additions).
`tsc --noEmit` clean. `npm run build` clean, 39/39 pages. Migration `0037`
applied to production (and, as a consequence of investigating deployment
ordering for this pass, migration `0036` — blocked earlier this session —
was retried and also succeeded). Live-verified against a local `npm start`
production build against the now-live schema: unfiltered company page 200,
filtered company page 200, the two new filter dropdowns render, the submit
wizard's "Who hired you?" question renders, a narrow zero-match filter
correctly suppresses the panels it touches instead of leaking unfiltered
numbers, a broader filter correctly shows "No reports match" in the cohort
section while the HQS headline stays company-wide and labelled `· all
reports`, and `/api/presence/heartbeat` now returns a real `global_count`
from the newly-live `presence_sessions` table.

**Deployment-ordering finding, not a design defect:** the evidence loader
(`src/lib/evidence/load.ts`) selects `hiring_channel, payment_requested_by`
on every company-page load — an always-hit path, unlike the additive,
fail-open presence feature. Pushing this code before migration `0037` was
live would have 500'd every company page. Caught before pushing by tracing
the actual query path rather than assuming "additive migration = safe like
last time"; resolved by applying `0037` (and then `0036`) to production
before this pass's commit.

**Files:** `supabase/migrations/0037_hiring_channel.sql`;
`src/types/index.ts`; `src/app/api/submit/route.ts`;
`src/app/submit/page.tsx`; `src/lib/evidence/{cohort,types,load,normalize,
synthetic}.ts`; `src/app/company/[slug]/page.tsx` (largest diff — panel
scoping, captions, suppression fix); `scripts/seed-realistic-dataset.ts`;
`tests/{cohort-hiring-channel,submit-validators,
db-hiring-submissions-immutability,evidence-engine,verification-pipeline}.test.ts`
plus the 13 pre-existing test files' local `EvidenceItem` fixture helpers
(each needed the two new required fields added to stay assignable).

---

## Open questions (decisions *not* yet made)

| # | Question | Blocked on |
|---|---|---|
| Q-1 | How do companies authenticate to post HR updates? | **Designed** (D-017, `docs/design-hr-authentication.md`), **not built**. Implementing it is the remaining blocker on roadmap items 6 & 8. |
| Q-2 | Where does genuine external seed data come from? | **Pilot pipeline fully built and live-verified (D-028).** Reddit is the resolved pilot source; `reddit_ingest.py` + the existing hiring-intel core are proven end-to-end via `scripts/qa-verify-external-pipeline.ts`. **Only remaining blocker: a real `REDDIT_CLIENT_ID`/`REDDIT_CLIENT_SECRET`** (checked live — current `.env.local` values are 3-char placeholders, Reddit returns 401). Zero real Reddit content has been acquired. **Unrelated, still unresolved:** production's `external_sources.acquisition_enabled` is `true` for `glassdoor`/`ambitionbox`/`linkedin` — contradicts D-005 and their own recorded license — needs a human confirm-or-revert decision (`docs/q2-source-acquisition-plan.md` §0). |
| Q-3 | Do timeline events ever feed HQS? | Deliberately **not** wired today (D-016 reaffirms). Needs its own decision — events are perception-heavy and would change what HQS means. |
| Q-4 | Who runs staleness when nobody loads the page? | No scheduler exists (D-012). |
| Q-5 | Should `public_hiring_opportunities.first_observed_at` be coarsened? | Exact timestamp is an n=1 correlation vector for single-report opportunities (flagged in D-016). Schema change, out of scope for the analytics task that found it. |
