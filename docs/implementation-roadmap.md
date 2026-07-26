# CandidateVoice — Implementation Roadmap

> From an empty repository to a fully functional platform, **preserving the
> existing architecture** defined in `adr-0001-evidence-model.md`,
> `company-intelligence.md`, `mvp-roadmap.md`, `schema.md`, and `claude.md`.
> This document does not redesign anything — it sequences what those documents
> already decided into buildable work.

## How to read this

- **Milestones (M0–M7)** are releasable increments, roughly in dependency order.
- **Epics** group related tasks within a milestone.
- **Tasks** carry: **Cx** (complexity), **Deps** (blocking task IDs), **∥**
  (yes = parallelizable with its siblings once deps are met), plus
  inputs / outputs / acceptance criteria.
- **Complexity:** `S` ≤ half a day · `M` 1–2 days · `L` 3–5 days · `XL` 1–2 weeks.
  Estimates assume one engineer familiar with the stack; they size *effort*, not
  calendar time.
- **Status tags:** ✅ done · 🟡 partial · ⬜ not started. Reflects the repo at the
  time of writing so this doubles as a live tracker.

## Architectural invariants (never violated by any task)

These come from the ADR, `claude.md`, and the PR legal checklist. Every task
inherits them; they are acceptance criteria on *everything*.

1. **Anonymous.** No user id, email, IP, device, hash, or exact event timestamp
   on evidence. Even a hash is a linkage key.
2. **Coarse by construction.** Public temporal facts are buckets / `reported_month`,
   never exact timestamps.
3. **Evidence is immutable** after moderation; correct by supersession, never
   mutation; never hard-delete.
4. **No AI.** Routing, categorization, and moderation are lookups, enums, and
   humans. No LLM, no sentiment inference, no generated text.
5. **Metadata ≠ evidence.** Imported company metadata lives in its own tables,
   its own confidence vocabulary, and never feeds a score.
6. **Confidence is derived on read**, never stored.
7. **Individuals are never named.** Employers are named; recruiters/interviewers/
   employees never are.

---

## Current-state snapshot

| Layer | Built | Gap |
|---|---|---|
| Base schema + RLS under version control | ✅ `0000` | Not yet applied to a live DB |
| Organizations + alias resolution | ✅ `0002` | No submit-time wiring; no seed data |
| Fingerprint schema + taxonomy + aggregation engine | ✅ `0003`, `src/lib/fingerprint/*` | No UI; no write path |
| Accounts / wishlist / saved comparisons schema | ✅ `0004` | No auth; no UI |
| Company Intelligence schema + import pipeline + scripts + logo route + profile UI | ✅ `0005`, `src/lib/company-intelligence/*`, `scripts/*` | No registered sources; no seed run; Storage bucket not created |
| Evidence envelope (event_type/source/producer/privacy_class/occurred_precision/retracted_at/superseded_by/rejection_reason) | ⬜ ADR §5 spec only | Not migrated |
| Claim-confidence (single/corroborated/verified) + payment suppression | ⬜ ADR §3 spec only | Not built |
| `created_at` publication leak fix | 🟡 `public_submissions` view exists | Pages still read raw `created_at` |
| Launch-blocker product UX (confirmation, dedup, admin pagination, OG) | ⬜ | mvp-roadmap §7 |
| Tests | ✅ 112 passing | No CI runner; no e2e |

---

# Milestone M0 — Foundation & Environment

**Goal:** a reproducible environment where every migration applies cleanly and
the app boots against a real database. **Exit criteria:** `0000`→`0005` apply to
a fresh Supabase project with zero errors; the app runs locally against it; CI
runs `tsc` + `vitest` on every push.

### Epic M0.E1 — Database provisioning

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M0-1 | Restore/create Supabase project; capture URL + keys | S | — | ✅start |
| M0-2 | Apply migrations `0000`→`0005` in order; verify tables/policies/functions | M | M0-1 | no |
| M0-3 | Create `company-logos` Storage bucket (private) + service-role access | S | M0-1 | ∥ |
| M0-4 | Reconcile `docs/schema.md` to the applied schema (it is now stale on every structural claim) | S | M0-2 | ∥ |

- **M0-2** — *In:* migration files. *Out:* provisioned schema. *AC:* `list_tables`
  shows all 20+ tables; `resolve_organization`, `canonicalize_slug`,
  `rate_limit_increment`, `handle_new_user` exist; RLS enabled on every table;
  `public_submissions` returns `reported_month` and no `created_at`; running the
  set twice is a no-op (idempotency).
- **M0-4** — *AC:* `schema.md` lists every current table/column; no claim
  contradicts the live DB; the "what is not in the schema" section is corrected.

### Epic M0.E2 — CI & tooling

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M0-5 | `npm install` to pick up `tsx` (already in `package.json`); confirm `companies:*` scripts run | S | M0-1 | ∥ |
| M0-6 | GitHub Actions: `tsc --noEmit` + `vitest run` on PR and push | S | — | ∥ |
| M0-7 | Add `npm test` to the PR template's "Testing Done" checklist | S | M0-6 | ∥ |
| M0-8 | Seed `metadata_sources` rows for the sources you intend to use (licence + terms recorded) | S | M0-2 | ∥ |

- **M0-6** — *AC:* a PR with a type error or failing test shows a red check; the
  disjointness and taxonomy-parity tests run in CI (they were written to be merge
  gates and currently gate nothing).

---

# Milestone M1 — Evidence Integrity & Anonymity

**Goal:** implement the ADR's evidence envelope and close the two open anonymity/
defamation gaps **before** any new surface reads evidence. This is first because
the whole product's legal defensibility rests on it, and later milestones read
the columns it adds. **Exit criteria:** no public surface ships an exact
timestamp; payment risk is suppressed below corroboration; lifecycle and claim
confidence are derivable from shared helpers with tests.

### Epic M1.E1 — Evidence envelope (ADR §4–5)

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M1-1 | Migration `0006_evidence_envelope.sql`: add `event_type`, `source`, `producer`, `privacy_class`, `occurred_precision`, `retracted_at`, `superseded_by`, `rejection_reason` (+ single-value CHECKs) | M | M0-2 | no |
| M1-2 | `lifecycleState(row)` pure helper (`submitted/published/rejected/retracted/superseded`) + tests | S | M1-1 | ∥ |
| M1-3 | Reject/retract write `rejection_reason` + `retracted_at`; approve stays consistent | M | M1-1, M1-2 | ∥ |
| M1-4 | Extend `Database` type + `HiringSubmission` with the new columns | S | M1-1 | ∥ |

- **M1-1** — *In:* ADR §5 SQL (adapt column names/order to the as-built table).
  *Out:* additive migration. *AC:* additive + idempotent + non-destructive;
  every existing `.eq("is_approved", true)` query still works unchanged; CHECKs
  are single-valued today and documented as "widen in Phase 4".
- **M1-2** — *AC:* pure function of the four lifecycle columns; property test
  covers all five states and rejects impossible combinations.

### Epic M1.E2 — Publication boundary (ADR §1.5, trap #7)

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M1-5 | Point `browse/page.tsx` + home feed at `public_submissions`; select `reported_month`, order by it | M | M0-2 | no |
| M1-6 | Column-grant migration `0007`: `revoke select on hiring_submissions from anon`, re-grant explicit column list **excluding `created_at`**; drop `security_invoker` on the view or keep with owner grant | M | M1-5 | no |
| M1-7 | Strengthen the coarsening test to assert base-table `created_at` is unreachable by anon, not just absent from the view body | S | M1-6 | ∥ |

- **M1-5/6** — *Why paired:* the review confirmed the view alone is not a
  boundary — anon holds table-wide SELECT, so `GET /rest/v1/hiring_submissions?
  select=created_at` still leaks. The column grant is what actually closes it.
  *AC:* an anon REST call selecting `created_at` returns 403/400; both public
  feeds render from `reported_month`; admin routes (service-role) unaffected.

### Epic M1.E3 — Claim confidence & payment suppression (ADR §3)

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M1-8 | Extract §3.1 claim predicates from `hqs.ts` into a shared module (single source with HQS) | M | — | ∥ |
| M1-9 | `claimConfidence(org, claim)` → `single/corroborated` derived on read (`MIN_CORROBORATING=3`, `MIN_DISTINCT_MONTHS=2`) + tests | M | M1-8 | no |
| M1-10 | Company page: suppress `PAYMENT_REQUESTED` publicly until `corroborated`; do NOT touch HQS arithmetic | M | M1-9 | no |
| M1-11 | Company page: confidence chip per breakdown metric ("Ghost rate 40% · corroborated") | M | M1-9 | ∥ |

- **M1-9** — *AC:* naming stays distinct from fingerprint dimension-confidence
  and from HQS sample-confidence (three axes, three vocabularies); pure; no
  stored column; test asserts one payment row in one month ≠ corroborated, three
  rows across two months = corroborated.
- **M1-10** — *AC:* a single `payment_flag=true` row never renders "Payment Risk"
  to the public; the value still counts internally; HQS formula unchanged
  (trap #4).

---

# Milestone M2 — Launch-Blocker Product Completeness

**Goal:** the four `mvp-roadmap.md` §7 critical blockers. All four are mutually
independent → maximal parallelism. **Exit criteria:** a candidate gets
confirmation, duplicates are prevented at submit, moderation paginates, and
shared links show rich previews.

### Epic M2.E1 — Candidate journey

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M2-1 | Post-submission confirmation screen ("received, pending moderation") | S | — | ∥ |
| M2-2 | Submit-time org resolution: call `resolve_organization`, set `organization_id`; "did you mean X?" dedup against `organizations` | M | M0-2 | ∥ |
| M2-3 | Lightweight anonymous edit/retract token (client-generated, shown once, checked server-side) + column + route | M | M1-1 | ∥ |

- **M2-1** — *In:* current `handleSubmit` redirect. *Out:* a real confirmation
  state. *AC:* the dead `?unlocked=true` param is removed; the user never lands
  on "not enough data" immediately after submitting; copy states expected
  moderation timing. *Cx S, client-only.*
- **M2-2** — *AC:* "Google" / "google inc" / "Google LLC" resolve to one
  organization; a near-duplicate prompts "did you mean **Google**?" before a new
  slug is minted; on a miss, `organization_id` is left null (never auto-insert a
  raw punctuated slug into `organizations` — that reintroduces the CHECK
  violation the review caught).

### Epic M2.E2 — Moderation & distribution

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M2-4 | Paginate `/api/admin/list-pending` (limit + cursor) + "load more" control | S | — | ∥ |
| M2-5 | `generateMetadata` + Open Graph/Twitter tags on `company/[slug]` and `browse` | S | — | ∥ |
| M2-6 | Approve/reject return `404` when zero rows matched | S | — | ∥ |
| M2-7 | `loading.tsx` + `error.tsx` for `company/[slug]` and `browse` | S | — | ∥ |

- **M2-5** — *AC:* sharing a company link renders company name + HQS (when ≥5
  submissions) in the preview card; no exact date in any tag; uses data already
  fetched. *Note:* the OG image must not embed an exact timestamp or a
  sub-threshold score.

---

# Milestone M3 — Organizational Fingerprint

**Goal:** the fingerprint product on top of the Milestone-1/2 foundation. The
aggregation engine (`aggregate.ts`) and schema (`0003`) already exist; this is
the write path and the UI. **Exit criteria:** candidates can rate facets and
emotions; a company page renders the six-node fingerprint with drill-downs,
confidence, and coarsened trend; 2–4 companies compare.

### Epic M3.E1 — Structured submission (write path)

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M3-1 | Extend submit wizard: optional Likert facet ratings (Professionalism, Candidate Experience, Hiring Process) + multi-select emotions | L | — | no |
| M3-2 | Server allowlist validation for facet keys / ratings / emotion keys (mirror `taxonomy.ts` guards) | M | M3-1 | ∥ |
| M3-3 | Transactional write of submission + ratings + emotions via a Postgres RPC (Supabase JS has no client transaction) | M | M3-1, M3-2 | no |

- **M3-3** — *Why RPC:* three sequential inserts risk a submission row with no
  ratings if the second call fails, and the ADR forbids the compensating delete.
  *In:* submission payload + rating/emotion arrays. *Out:* one `plpgsql` function
  that inserts all three atomically. *AC:* a mid-write failure leaves **no** row
  (all-or-nothing); every facet/emotion is optional; invalid keys 400 before the
  RPC runs.

### Epic M3.E2 — Fingerprint UI

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M3-4 | Hand-built SVG radial fingerprint (6 nodes; Leadership/Work Culture render `awaiting_source`, never 0) | L | M0-2 | ∥ |
| M3-5 | Per-dimension drill-down: score, confidence, evidence count, facet breakdown, emotion distribution, coarsened timeline | L | M3-4 | no |
| M3-6 | Explainability drawers ("derived from N reports, M observations; confidence high; updated …") throughout | M | M3-5 | ∥ |
| M3-7 | k-anonymity guard: suppress per-rating distributions and per-facet counts below threshold (do not expose a single person's exact rating) | M | M3-4 | ∥ |

- **M3-7** — *Why:* the review flagged that exposing exact per-rating
  distributions at 5 submissions can be more identifying than the aggregate.
  *AC:* below `MIN_OBSERVATIONS_PER_FACET`, the facet shows "not enough responses"
  not a distribution; no view reveals a lone respondent's value.
- **M3-fix** (carry-over) — before M3-5 ships, fix the confirmed **trend/score
  estimator mismatch** in `aggregate.ts` (mean-of-means vs pooled) so a
  response-mix shift can't fabricate a directional trend. *Cx S, Deps none, ∥.*

### Epic M3.E3 — Comparison & insights

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M3-8 | Compare page: 2–4 companies, radar + side-by-side + emotion comparison | L | M3-4 | no |
| M3-9 | Deterministic, thresholded comparative insights (template arithmetic, suppressed unless both clear the evidence bar, sample sizes attached) | M | M3-8 | ∥ |

- **M3-9** — *AC:* every insight names its samples ("based on 41 vs 38 reports");
  no insight renders when either side is below threshold; no AI; no unqualified
  claim about a named employer.

---

# Milestone M4 — Company Intelligence Operationalization

**Goal:** turn the built import infrastructure into a populated, maintained
metadata layer. Infra is ✅; this is data + automation. **Exit criteria:**
hundreds of organizations seeded, logos served, links health-checked on a
schedule, autocomplete backed by real data.

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M4-1 | Author seed files for target employers (NCR/India + global tech) in canonical JSON; validate with `companies:validate` | M | M0-5 | ∥ |
| M4-2 | Run `companies:import` (dry-run → real); confirm idempotency on re-run | S | M0-8, M4-1 | no |
| M4-3 | Logo ingestion: fetch/optimize/version into Storage; `company_logos` rows; `/api/logo` serves them | M | M0-3 | ∥ |
| M4-4 | Schedule `companies:sync` (link health) as a cron/GitHub Action | S | M4-2 | ∥ |
| M4-5 | Company autocomplete/typeahead in `CompanySearch`, backed by `organizations` + aliases | M | M4-2 | ∥ |
| M4-6 | Alias operations runbook: consolidate variants with `companies:aliases --suggest/--merge` | S | M4-2 | ∥ |

- **M4-1** — *AC:* every file passes `companies:validate`; no record imports a
  review/rating/opinion (schema makes this structurally impossible); licences of
  any external source recorded in `metadata_sources` before import.
- **M4-3** — *AC:* logos served same-origin (CSP intact); missing logo falls back
  to the monogram; replacing a logo writes a new version and flips `is_current`.

> **External collector hand-off (out of this repo's scope):** standalone
> collectors (any language) produce canonical JSON/CSV for the `seed_file`
> adapter. They target the documented seed format only and never touch this
> schema. `permitsRedistribution=false` makes the importer refuse a source that
> may only be consulted.

---

# Milestone M5 — Accounts, Wishlist & Profile

**Goal:** the account layer, with the disjointness invariant enforced by test.
Schema is ✅ (`0004`); this is auth + UI. **Exit criteria:** users sign in,
manage a wishlist and saved comparisons, and a profile shows **everything except
their own submissions** (that link is forbidden).

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M5-1 | Enable Supabase Auth (email/OTP or OAuth); wire session in middleware + server clients | L | M0-2 | no |
| M5-2 | Auth UI (sign in / out / account menu) in `Navbar` | M | M5-1 | ∥ |
| M5-3 | Wishlist CRUD UI (add from company page, list/sort in profile) | L | M5-1 | no |
| M5-4 | Saved comparisons CRUD (persist a 2–4 company comparison) | M | M5-1, M3-8 | ∥ |
| M5-5 | Profile page: wishlist, saved comparisons, saved filters, career interests, recently viewed | L | M5-1 | ∥ |
| M5-6 | Disjointness enforcement: extend the account-evidence test to catch a bare linkage column (not just literal table names) | S | — | ∥ |

- **M5-3/M5-5** — *AC:* owner-only RLS verified; a signed-in user can **never** be
  shown "my submitted reports"; no account table references an evidence table by
  FK, id, hash, or correlatable timestamp.
- **M5-6** — *Why:* the review showed the current test only catches linkage
  written with a literal evidence table name. *AC:* a `submission_id`-style column
  added to any account table fails CI.

---

# Milestone M6 — Navigation, Filters, Explainability & Docs

**Goal:** stitch the sections into one product with cross-cutting filtering and
consistent methodology surfaces. **Exit criteria:** the nav covers all sections;
filters apply everywhere; every number explains itself.

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M6-1 | Navigation redesign: Browse · Companies · Compare · Fingerprint · Insights · Wishlist · Profile · Admin | M | M3-4, M5-2 | no |
| M6-2 | Cross-cutting filter system (role, dept, experience, country/city, interview type/year, outcome, confidence, verified) | L | M3-4 | ∥ |
| M6-3 | Methodology/info drawers (confidence, evidence, data freshness, how scores are calculated) as reusable components | M | M1-9 | ∥ |
| M6-4 | Shared UI primitives (`Button`/`Card`/`Select`/`Badge`/`Drawer`) to end the per-page class-string drift | M | — | ∥ |

- **M6-2** — *AC:* filters never expose an exact timestamp; k-anonymity holds when
  a filter narrows a company to a handful of reports (suppress rather than reveal).

---

# Milestone M7 — Launch Readiness

**Goal:** everything required before real candidates use the live site.
**Exit criteria:** legal pages present, accessibility baseline met, monitoring on,
deployment reproducible.

| ID | Task | Cx | Deps | ∥ |
|---|---|---|---|---|
| M7-1 | Legal pages: Terms, Privacy, Grievance Officer (IT Rules 2021), Contact | M | — | ∥ |
| M7-2 | Accessibility baseline: labels on all inputs, focus states, keyboard nav, contrast on paper theme | M | M6-4 | ∥ |
| M7-3 | Vercel deploy: `ADMIN_SECRET` + `COOKIE_SECRET` + Supabase env; verify security headers/CSP in prod | S | M0-1 | ∥ |
| M7-4 | Error/observability: route error boundaries, structured logs, rate-limit + moderation-queue alerts | M | — | ∥ |
| M7-5 | `sitemap.ts` + `robots` review + per-page metadata audit | S | M2-5 | ∥ |
| M7-6 | Pre-launch security re-review (RLS, anon reachability, payment suppression, disjointness) | M | M1-*, M5-6 | no |

- **M7-1** — *AC:* Grievance Officer named and reachable (required from day one if
  public); disclaimer consistent with `Footer.tsx`.
- **M7-6** — *AC:* an anon key can read only approved, coarsened rows and public
  reference data; no account table is reachable by anon; payment suppression holds
  at k=1; all invariants above verified.

---

## Dependency map (critical path)

```
M0 (foundation)
 └─▶ M1 (evidence integrity)  ── the spine; nearly everything reads its columns
      ├─▶ M2 (launch blockers)      [M2 mostly parallel to M1; M2-3 needs M1-1]
      ├─▶ M3 (fingerprint)          [M3-3 needs M1-1; M3 UI needs M0-2]
      │    └─▶ M3.E3 compare ─▶ M5-4 saved comparisons
      ├─▶ M4 (company intelligence) [independent of M1/M3 — can run alongside]
      └─▶ M5 (accounts) ─▶ M6 (nav/filters) ─▶ M7 (launch)
```

**Longest chain:** M0 → M1 → M3.E1 → M3.E2 → M3.E3 → M5-4 → M6-1 → M7-6.
Shorten it by starting M4 (Company Intelligence data) and M2 (launch blockers)
in parallel from the moment M0-2 lands.

## What can run in parallel (given the team)

- **Immediately after M0-2:** all of M2 (four independent blockers), M4-1/M4-3
  (seeding + logos), M1-8 (claim predicates), M3-4 (fingerprint SVG shell),
  M3-fix (trend estimator).
- **Two-stream split:** Stream A = M1 → M3 (evidence + fingerprint, one owner of
  the aggregation/anonymity surface). Stream B = M4 + M5 (metadata + accounts,
  no evidence coupling). They converge at M6.
- **Never parallelize:** M1-5 and M1-6 (the leak fix is a paired page+grant
  change); M3-1 and M3-3 (write path shape before the transactional RPC).

## Pre-existing defects to clear along the way

From the adversarial review of the current foundation — fix in the milestone that
touches the file:

| Defect | Fix in |
|---|---|
| `aggregate.ts` trend vs score estimator mismatch (fabricated trend) | M3-fix (before M3-5) |
| `created_at` still reachable by anon on the base table | M1-5/M1-6 |
| `PAYMENT_REQUESTED` shown at k=1 | M1-10 |
| `saved_comparisons` size CHECK passes on empty array (`array_length` NULL) | M5-4 (add `cardinality(...) between 2 and 4`) |
| Emotion distribution returned for `insufficient` dimensions | M3-7 |
| Disjointness test misses a bare linkage column | M5-6 |
| `docs/schema.md`, `claude.md` stale vs built schema | M0-4 (+ update `claude.md`) |

---

*This roadmap sequences the decisions in `adr-0001-evidence-model.md`,
`company-intelligence.md`, and `mvp-roadmap.md` into buildable work. It changes
none of them. Where the built code and the ADR have drifted (evidence envelope,
claim confidence, the leak fix), the roadmap reconciles toward the ADR, because
the ADR is the canonical trust model.*
