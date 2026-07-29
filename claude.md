# CandidateVoice — claude.md

> Read before starting any task. Update after completing any task.
>
> This file describes what the code **actually does today**, not what is planned.
> If it disagrees with the code, the code is right and this file is stale — fix it.

---

## 1. Status

Experimental MVP / private beta. **Not deployed, not production-ready.**

The single most important fact for anyone working here:

> **The Supabase database is PAUSED and EMPTY. None of the six migrations in
> `supabase/migrations/` has ever been executed against any database.**

Everything below that describes SQL is therefore verified by *reading*, not by
running. Do not claim a migration "works" — claim it "has not been run".

---

## 2. What this is

Open-source platform where candidates anonymously submit structured signals
about hiring experiences. Approved submissions aggregate into a per-company
score with a confidence tier based on sample size.

Two data families live side by side and **must never be mixed**:

| Family | What it is | Where |
|---|---|---|
| **Evidence** | First-party candidate reports. The product's actual value. | `hiring_submissions`, `submission_ratings`, `submission_emotions` |
| **Company Intelligence** | Third-party *factual* metadata imported to solve cold-start. | `organizations`, `company_*`, `metadata_sources`, `taxonomy_terms` |

- **Code License:** MIT · **Data License:** CC0 1.0 — but see §11, imported
  metadata is **not** uniformly CC0 and this is an open inconsistency.

---

## 3. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14.2.35 (App Router), TypeScript, React 18.2 |
| Styling | Tailwind CSS 3.0.0 (pinned old — no core `line-clamp`, see `.clamp-2` in globals.css) |
| DB | Supabase (PostgreSQL + RLS) |
| Hosting | Vercel (not yet deployed) |
| Tests | Vitest — **145 tests, all passing** |
| Scripts | `tsx` (dev dependency) |

**No AI services. No third-party content moderation. No analytics.** Emotions
in the fingerprint model are *self-selected from a closed vocabulary*, never
inferred — this rule is intact.

---

## 4. Directory Structure

```
howdarethey/
├── src/
│   ├── app/
│   │   ├── page.tsx  browse/  submit/  admin/  company/[slug]/
│   │   └── api/
│   │       ├── submit/route.ts
│   │       ├── logo/[slug]/route.ts      # same-origin logo proxy (CSP-safe)
│   │       └── admin/{approve,reject,list-pending}/route.ts, _utils.ts
│   ├── components/                       # Navbar, Footer, SubmissionCard,
│   │                                     #   StageBadge, CompanySearch,
│   │                                     #   CompanyOverview
│   ├── lib/
│   │   ├── supabase/{client,browser,server}.ts
│   │   ├── company-intelligence/         # imported metadata subsystem (§8)
│   │   ├── fingerprint/                  # evidence dimensions (§9) — NO UI YET
│   │   ├── company-slug.ts  rate-limit.ts  client-ip.ts  unlock-cookie.ts
│   ├── types/  utils/{sanitize,hqs,date,labels}.ts
├── scripts/                              # tsx CLI tools (§8)
├── supabase/migrations/                  # 0000–0006, NONE APPLIED
├── tests/                                # 5 files, 145 tests
├── docs/
└── Data/companies/                       # NOTE: capital D, and .gitignored
```

---

## 5. Database

**25 tables across migrations `0000`–`0006`.** (`docs/schema.md` is stale — it
still describes a single-table schema. Trust the migrations.)

Run order matters: `0000` creates `hiring_submissions`; `0001` alters it. The
baseline was renumbered to `0000` precisely so a fresh database builds in
filename order.

| Migration | Adds |
|---|---|
| `0000_baseline_hiring_submissions` | `hiring_submissions` + RLS + enum CHECKs + `reporter_type` |
| `0001_rate_limit_and_moderation_audit` | `rate_limit_counters`, `rate_limit_increment()`, `rejected_at` |
| `0002_organizations` | `organizations`, `organization_aliases`, `canonicalize_slug()`, `resolve_organization()` |
| `0003_fingerprint_model` | dimensions/facets/emotions + ratings + `public_submissions` view |
| `0004_accounts_and_wishlist` | `profiles`, `wishlist_items`, `saved_comparisons` (Supabase Auth) |
| `0005_company_intelligence` | 13 metadata tables (§8) |
| `0006_metadata_fetch_sources` | 4 `metadata_sources` rows with real licences |

Invariants:
- RLS on every table. Public reads only `is_approved = true AND rejected_at IS NULL`.
- All writes go through the service-role key server-side (bypasses RLS).
- **No `user_id`, email, or IP on any evidence row.** Account tables and
  evidence tables are *provably disjoint* — no FK, no shared identifier —
  enforced by `tests/account-evidence-disjointness.test.ts`.
- Nothing is hard-deleted; rejection is `rejected_at`, an audit trail.

---

## 6. Trust & Moderation

- Submissions default `is_approved = false`. Nothing public until approved.
- All moderation is **human**, via `/admin` with a bearer token (`ADMIN_SECRET`),
  constant-time compared, with IP lockout after 10 failures / 15 min.
- Server-side enum allowlists validate every dropdown on submit.
- Free-text (`company`, `role`) is HTML-stripped and length-capped.
- Reject is a **soft delete** (`rejected_at`), not a hard delete.
- Rate limiting is **durable and Postgres-backed** (`rate_limit_increment()`),
  5 submissions/hour/IP. It **fails open** if migration `0001` has not been
  applied — which, today, it has not.

---

## 7. Hiring Quality Score (HQS)

`src/utils/hqs.ts`. Weighted linear formula over **four** weighted metrics
(weights sum to 1.00):

`0.30·responseScore + 0.25·(1−earlyRejectRate) + 0.25·transparencyRate + 0.20·(1−ghostRate)`

`paymentRate` is computed and displayed but is **not** a term in the formula.

Confidence tiers on `total`: low <20 · medium 20–49 · high ≥50.
Both the numeric score **and** the breakdown are suppressed below 5 submissions.
Not Bayesian.

---

## 8. Company Intelligence (imported metadata)

Solves cold-start without diluting evidence. Full spec: `docs/company-intelligence.md`.

Pipeline — `adapter → normalize → validate → dedupe → resolve → persist`:

| File | Role |
|---|---|
| `types.ts` | `SourceAdapter` plugin contract, `RawCompanyRecord` seed schema |
| `normalize.ts` | `canonicalizeSlug()` — **must** mirror SQL `canonicalize_slug()` |
| `validate.ts` / `importer.ts` / `store.ts` | checks, pipeline, all upserts |
| `adapters/` | `seed-file`, `wikidata`, `wikipedia`, `github-org`, `website-meta` |

**Four adapters, not one** — deliberately. Each source has a different licence
(Wikidata CC0 · Wikipedia **CC BY-SA, attribution required** · GitHub API Terms ·
company site unlicensed). One merged adapter would emit one source key, making
per-field attribution impossible. `CompanyOverview.tsx` renders a CC BY-SA credit
line when the winning description came from Wikipedia.

Idempotent at two levels: batch (content hash) and row (upsert on natural key).
`store.upsertProfile` coalesces nulls against the existing row, so a later
adapter's *absence* of a field never erases an earlier adapter's value.

Commands: `companies:validate` · `companies:import` · `companies:fetch` ·
`companies:sync` · `companies:aliases`.

---

## 9. Organizational Fingerprint (evidence dimensions)

`src/lib/fingerprint/` — taxonomy + pure aggregation with corroboration-based
confidence, derived on read, never stored.

> **Built and tested, but has NO UI.** Nothing under `src/app/` imports it. It is
> not reachable by any user action. Do not mistake it for live functionality.

---

## 10. Environment Variables

See `.env.example`. Never commit `.env.local`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key (ships in the browser — not a secret) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never expose. |
| `NEXT_PUBLIC_APP_URL` | Canonical app URL |
| `ADMIN_SECRET` | Bearer token for `/api/admin/*` |
| `COOKIE_SECRET` | HMAC secret for the unlock cookie |
| `GITHUB_TOKEN` | *Optional.* Raises GitHub API 60/hr → 5,000/hr during metadata fetch. |

---

## 11. Known Limitations & Open Risks

Ordered roughly by severity. Be honest about these; do not quietly drop them.

1. **No migration has ever run.** Six migrations, ~25 tables, zero executions.
   The first `supabase db push` is genuinely unvalidated.
2. **Legal pages missing** (Terms, Privacy, Grievance, Contact) — required
   before any public launch.
3. **CC0 vs CC BY-SA conflict.** `README.md`/`LICENSE` assert all data is CC0,
   but Wikipedia-derived descriptions are CC BY-SA. Attribution is rendered in
   the UI, but the blanket CC0 claim is still inaccurate and unresolved.
4. **No CI.** No `.github/workflows/`. The PR template asks contributors to run
   `npm run lint`, which is not machine-enforced.
5. **Metadata fetch has no concurrency, retry/backoff, cache, or resume.**
   Sequential with fixed delays. A long run that dies has no checkpoint. A
   Wikidata SPARQL timeout was observed live during testing.
6. **`docs/schema.md` is stale** — describes the pre-`0002` single-table schema.
7. **Fingerprint subsystem has no UI** (§9).
8. **`npm audit`: 21 vulnerabilities** (1 moderate, 20 high) — unexamined.
9. **`src/lib/supabase/client.ts` is dead code** — nothing imports it.
   (`browser.ts` is the one `browse/page.tsx` actually uses; it does export
   `supabase`.)
10. `Data/companies/` is **gitignored**, so a fresh clone has no seed files.
11. `@types/react` is 19.x while React is 18.2 — a version mismatch that has
    not yet caused a failure.

---

## 12. Verification Commands

```bash
npx tsc --noEmit     # 0 errors
npx vitest run       # 145 passing
npm run build        # succeeds, 11 routes
npm run lint         # eslint (config populated; previously empty/broken)
```

Always run these before claiming work is complete. Prefer verifying over
asserting — several bugs in this repo's history were found only by executing,
not by reading.
