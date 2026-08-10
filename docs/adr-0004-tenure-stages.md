# ADR-0004 — Tenure Stages: employees and leavers, not just interviewees

**Status:** Accepted · implemented (migrations 0020, 0021;
`src/lib/fingerprint/{offboarding,culture,conduct}.ts`, submit-flow relationship
selector, company-page panels, `src/components/charts/Bar.tsx`)
**Builds on:** ADR-0001 (evidence model) · ADR-0002 (Evidence Engine)

---

## Context

Every report CandidateVoice held before this ADR meant one relationship:
"I interviewed here." A working professional pointed out the gap — the
platform had no way to hear from people who are **inside** a company or
**leaving** it. `reporter_type` existed since the baseline migration
(`0000_baseline_hiring_submissions.sql`) specifically reserved for this
moment, defaulted to `'candidate'`, with a comment naming the reason it wasn't
enabled yet: "a materially sharper re-identification and defamation profile
than an anonymous candidate report."

## Decision

### 1. One field widens, three question sets unlock

`reporter_type` went from a single valid value (`'candidate'`) to three
(`candidate | employee | former_employee`) in migration 0020. No new column,
no data migration — every existing row was already `'candidate'`. Each new
enum column added (exit letter/settlement/documentation, would-recommend,
tenure bucket, conduct environment) follows migration 0018's exact discipline:
nullable, CHECK-constrained, first-party only, optional at the form, and
**NULL is not NO** — an unanswered field is excluded from every metric, never
scored good or bad; `"na"`/`"none"` are answers that do count.

### 2. Interview-only columns had to become nullable

`stage`, `outcome`, `response_time_bucket`, `last_interaction_gap` were `NOT
NULL` from the baseline — a constraint that only made sense when every
reporter was a candidate. Migration 0021 drops that constraint on all four.
The Evidence Engine's existing eligibility-gate pattern (`field !== null`)
does the rest with zero engine changes: a tenure report with these columns
null simply doesn't contribute to ghosting/offer/response-speed/process-depth.

### 3. `payment_risk` needed an explicit reporter_type guard

`payment_flag` could not be made nullable (`NOT NULL DEFAULT false`), so an
employee/leaver row that never answers it would silently store `false` and,
without a guard, count as "no payment requested" — diluting a candidate-only
signal. `behavioural.ts`'s `paymentRisk` eligibility gained
`reporter_type === 'candidate'` alongside its existing null check.

### 4. Three engines, three risk tiers, one shared shape

Each new dimension engine mirrors `compensation.ts` exactly (renormalise
over non-suppressed dimensions, return `null` — never a fabricated 0 — below
an effectiveN floor):

- **`offboarding.ts`** (🟢 lowest risk) — Experience Letter, Settlement
  Timeliness, Documentation Completeness → Exit Integrity Score. `'na'` is
  excluded (unlike salary's `"never"`), because it means "didn't apply to my
  exit," not a company behaviour. Every predicate also requires
  `reporterType === 'former_employee'`.
- **`culture.ts`** (🟡 medium risk) — the single "would you recommend"
  headline from people who worked there, at a higher floor
  (`CULTURE_MIN_EFFECTIVE_N = 5`) than the ordinary interview floor of 3.
- **`conduct.ts`** (🔴 highest risk) — a role-neutral, structured
  psychological-safety scale, never free text, never about a named person.
  `CONDUCT_MIN_EFFECTIVE_N = 8` is simultaneously the statistical *and* the
  anonymity floor, set far above every other floor in the codebase because no
  company-headcount field exists yet to gate on directly. Renders **only**
  aggregate prevalence; the Action Engine's `conductPointer()` emits at most a
  neutral one-line pointer, never the word "harassment," never a cause.

### 5. The submit wizard branches on relationship, not on a parallel form

`stepsFor(relationship)` in `submit/page.tsx` returns a different step list per
relationship — candidate keeps the original 5-step wizard unchanged; employee
gets Company & Role → Culture & Conduct → Experience; former_employee inserts
an Exit step. One form, conditional sections, not three separate wizards.

### 6. The route enforces the boundary the client cannot be trusted to keep

`/api/submit` resolves `reporter_type` server-side (defaulting to
`'candidate'`, matching the RPC's own default) and, for any non-candidate
report, **forces every interview-only and salary field to `null`/`false`
regardless of what the client sent** — not just skips validating them. Verified
live: a crafted employee payload carrying `stage`, `outcome`, `payment_flag`,
and `salary_history_stage` stored all four as null/false; only the legitimate
`would_recommend` field survived.

## Deferred (explicit, not silent)

- **Granular employee Likert facets** (`leadership`, `work_culture` in
  `taxonomy.ts`) have zero facet rows seeded in the DB. `would_recommend`
  covers the headline culture signal today; revealing the granular facets is a
  data-seeding task for a later milestone, not an engine change — the
  aggregate.ts facet pipeline already supports it.
- **Raising the conduct floor, or giving it a headline badge**, requires two
  preconditions before it should even be considered: (1) a live Grievance
  Officer + takedown path per IT Rules 2021, and (2) a real company-headcount
  field to gate small-company anonymity risk directly instead of via a flat
  floor. Neither exists yet. This is a deliberate, documented ceiling, not an
  oversight.

## Verification

`tsc` clean · 477/477 tests green (up from 425 pre-Tenure-Stages) · production
build clean (21/21 routes). Live against Supabase: seeded and submitted all
three reporter types via the real API; the compensation-privacy-style
null-exclusion held (a mixed 11-row fixture read "2 of 8 reports," never "2 of
11"); the injection defense held even after every row was made public
(candidate-only fields stayed null/false); interview-statistic denominators
(ghosting 14%, offer 86%) computed over exactly the 7 candidate rows in a
10-row mixed fixture, proving zero contamination from employee/leaver rows
even under full public exposure; the Culture panel rendered the exact
arithmetic (3 yes + 0 maybe + 2 no → 60/100) the instant its floor was
crossed, and stayed silent below it — same for Exit Integrity and Workplace
Conduct. All seed data cleaned up after each check.
