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

## Open questions (decisions *not* yet made)

| # | Question | Blocked on |
|---|---|---|
| Q-1 | How do companies authenticate to post HR updates? | **Designed** (D-017, `docs/design-hr-authentication.md`), **not built**. Implementing it is the remaining blocker on roadmap items 6 & 8. |
| Q-2 | Where does genuine external seed data come from? | Reddit API credentials; a licensed source. All four sources currently hold 0 reports. |
| Q-3 | Do timeline events ever feed HQS? | Deliberately **not** wired today (D-016 reaffirms). Needs its own decision — events are perception-heavy and would change what HQS means. |
| Q-4 | Who runs staleness when nobody loads the page? | No scheduler exists (D-012). |
| Q-5 | Should `public_hiring_opportunities.first_observed_at` be coarsened? | Exact timestamp is an n=1 correlation vector for single-report opportunities (flagged in D-016). Schema change, out of scope for the analytics task that found it. |
