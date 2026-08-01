# ADR-0003 — Candidate Intelligence Layer

**Status:** Accepted · implemented (migrations 0015; `src/lib/advisor/*`,
`src/lib/candidate/*`, `/advisor`, `/api/advisor/preferences`, the company
"Fit for you" panel)
**Builds on:** ADR-0001 (evidence model) · ADR-0002 (Evidence Engine)

---

## Context

CandidateVoice answered "what happened to other candidates here." This layer
answers **"given MY priorities, should I apply here, what am I giving up, and
why"** — as a deterministic reduction over the Evidence Engine, not a resume
score and not an LLM opinion.

It was explicitly scoped to the deterministic core. Resume/LinkedIn extraction
and any LLM were deferred (see Non-goals) because they carry PII and
generated-text risk the core does not.

## Decision

### 1. It is a reduction, never a new source of truth

Every number the advisor shows traces to a company's behavioural fingerprint,
which traces to real reports. `computeFit` is the same
renormalise-over-unsuppressed-dimensions reduction as `computeHqs`
(`src/utils/hqs.ts`) — the only difference is that the weights come from the
user's preference vector instead of the fixed `HQS_WEIGHTS`. HQS is "how good is
this process"; fit is "how good is it **for you**." The compromise and
recommendation engines are further reductions over the same fingerprints.

### 2. No LLM. Explanation is templated.

The codebase has no LLM and this layer adds none. Part 7's natural-language
explanation is produced by template (`src/lib/advisor/explain.ts`): every
sentence is assembled from numbers already in the FitResult / CompromiseMatrix.
`tests/advisor-explain.test.ts` extracts every integer from the generated prose
and asserts it was an input — a fabricated figure fails the suite. This honours
CLAUDE.md #6 ("no generated text, no AI summaries") while still giving plain
English, with no key, cost, or validation pass.

### 3. Suppress what no evidence measures — never fabricate

Only six behavioural dimensions have evidence today (ghosting, response speed,
offer probability, transparency, process depth, payment risk). The seven
experiential priorities (salary, WLB, growth, learning, remote, prestige,
stability) map to Family B, which is empty. They are **collected** (the user may
state how much they care) but **never scored**: the fit engine reports them
`not_measured`, the compromise matrix leaves their cells blank, and the UI says
"not measured yet." A "Salary: High" cell with no salary evidence would be the
exact fabrication the product forbids. When Family B fills, extending the mapping
in `src/lib/advisor/preferences.ts` lights them up with no other change.

### 4. Preferences are explicit input only

The advisor never infers a preference. The vector is nine-plus 1-5 sliders the
user sets. This is the boundary that keeps the layer honest: evidence describes
companies, the user describes themselves, and fit is the arithmetic between them.

### 5. The candidate identity is anonymous and structurally disjoint from evidence

This is the load-bearing safety property. A candidate profile links a real
career history; if it shared any key with the anonymous `hiring_submissions`,
those reports could be de-anonymised — breaking the core promise.

- `candidate_profiles` / `candidate_preferences` (migration 0015) have **no FK
  and no join path** to any evidence table (verified live; enforced in CI by
  `tests/account-evidence-disjointness.test.ts`, which fails if 0015 so much as
  names an evidence table or `auth.users`).
- The identity is a fresh opaque id in its **own** signed httpOnly cookie
  (`cv_candidate`), never the unlock cookie — so "set these preferences" and
  "submitted about these companies" never share one signed value.
- RLS is enabled with no policy: only the service role reaches the tables, and
  the opaque cookie id is the capability. Every access is mediated by
  `/api/advisor/preferences` or the server-only `readCandidateVector`.

### 6. Reuse, not duplication

Fit/compromise/recommendation consume `buildBehaviouralFingerprint` and
`describeBase` unchanged. Recommendations reuse `loadCompanyAnalytics`'s single
bulk load (now carrying the full fingerprint) rather than a new query. The
candidate cookie mirrors `unlock-cookie.ts`; the API mirrors `/api/submit`'s
validation and rate-limiting.

## Consequences

- Fit inherits the sunset invariant for free: at `global_external_multiplier =
  0` every advisor number equals its first-party-only value, because it consumes
  fingerprint dimension scores that already hold that property (tested).
- The advisor is only as rich as the evidence. Today it can rank on interview
  behaviour honestly and says so; it cannot yet speak to salary/WLB/culture.
  That is a feature, not a gap — it is the difference between this and a
  fabricated advisor.
- Confidence gating means thin companies are listed unrated, never force-ranked
  — the same anti-defamation rule as the analytics leaderboards.

## Non-goals (deferred, require separate approval)

- **Resume / LinkedIn extraction** (brief Part 1) and **any LLM** (Part 7 option
  B). The schema has nullable `source_text_hash` / `extracted` slots so these
  land without redesign, but they are not built.
- **Family B experiential dimensions** — unlocks salary/WLB/growth/… matching
  once collection + volume exist.
- **Embeddings / semantic matching** (Part 9) — the slot exists; the feature
  does not.
- **Scale:** recommendations load every company's evidence per request. Fine at
  the current scale; the ADR-0002 rollup is the path when it isn't.
