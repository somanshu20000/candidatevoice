# NOW — CandidateVoice project state

**Current phase:** M3 Search & Discovery — **COMPLETE** (M3.0 → M3.7), verified live against the production bundle.
**Last updated:** 2026-08-14.

## Headline

A stranger can now visit CandidateVoice, search a real company by name (typo-/
alias-/domain-tolerant, ranked) OR describe a hiring pattern in natural language,
and get an understandable, evidence-gated result — with the honest "not enough
evidence yet" state instead of any fabricated score, and explicit notices when a
requested filter (location, salary amount) isn't supported. Architecture stayed
PostgreSQL-only + a deterministic signal lexicon; no pgvector, no LLM in the
request path, no PixelRAG (D-020, and the D-019 amendment).

## M3 implementation status — all milestones DONE

| Milestone | What shipped |
|---|---|
| M3.0 Search contract + lexicon | `src/lib/search/types.ts`, `lexicon.ts` (~70 phrases / 13 dims) |
| M3.1 Ranked entity search | `searchCompanies` layers ranked RPC + `.ilike` substring (regression-safe) |
| M3.2 Alias backfill | `alias-derivation.ts` (pure) + `scripts/backfill-organization-aliases.ts` (dry-run) |
| M3.3 Query parser | `parse.ts` + `unsupported.ts` — intent, signals, unsupported capabilities |
| M3.4 Signal retrieval + gating | `signal.ts` — gate → order → band over the existing engine |
| M3.5 Explainable assembly | `explain.ts` (templated, integer-provenance-safe) + `retrieve.ts` orchestrator |
| M3.6 Search UI | `src/app/companies/page.tsx` — entity cards, banded signal results, capability notices |
| M3.7 Production audit | full gate + live `npm start` walk (below) |

## Files changed (this M3 session)

**New:**
- `src/lib/search/types.ts`, `lexicon.ts` (M3.0 — prior session, unchanged)
- `src/lib/search/unsupported.ts` — location + salary-amount capability detection
- `src/lib/search/parse.ts` — deterministic query parser (longest-phrase-first, plural-tolerant)
- `src/lib/search/signal.ts` — pure gate→order→band ranker
- `src/lib/search/explain.ts` — SearchResult + templated explanation
- `src/lib/search/retrieve.ts` — `runSearch` orchestrator (parse → entity/signal → explain)
- `src/lib/company-intelligence/alias-derivation.ts` — pure alias derivation + collision-safe plan
- `scripts/backfill-organization-aliases.ts` — dry-run-by-default backfill
- `tests/search-parse.test.ts` (17), `search-signal.test.ts` (10), `search-explain.test.ts` (10), `search-alias-derivation.test.ts` (14)

**Modified:**
- `src/lib/search/types.ts` — added `SearchDimensionScoreView`, `populationCalibrated`
- `src/lib/evidence/analytics.ts` — `CompanyAnalytics` additively carries `compensation` + `offboarding` profiles (same pure builders, one load; D-001-safe)
- `src/app/companies/page.tsx` — rewritten as the search surface (directory listing preserved for no-query)
- `tests/evidence-rank.test.ts` — fixture updated for the two new additive fields
- `DECISIONS.md` — D-020 (Postgres + lexicon; why not pgvector/LLM) + D-019 amendment (retriever ≠ extractor; permission is the bottleneck)
- (M3.1, prior session) `src/lib/company-intelligence/directory.ts`, `tests/search-entity.test.ts`

**Untouched collaborator work** (left exactly as found, NOT in the M3 commit):
`scripts/_shared.ts`, `scripts/fetch-company-metadata.ts`, `scripts/import-external.ts`,
`src/lib/company-intelligence/store.ts`, `src/lib/company-intelligence/adapters/website-meta.ts`,
`src/lib/hiring-intel/*`, `package.json`/`package-lock.json`, and the untracked
`.bak`/`demo-seed.ts`/`system_1.png`/`supabase-debug.txt`/`0019_*` files.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **41 files, 611 tests, all pass** (M3 added 51 tests over the prior 560).
- `npm run build` — clean production build, 22 routes.
- **Live audit, production bundle (`npm start`, "Ready in <1s" — not dev):**
  - Entity: `?q=Razorpay` → 1 exact match; `?q=Razorpy` (typo) → still finds Razorpay; `?q=tech` → 10 substring matches incl. Kodehash Tech (regression guard holds); `/api/company-search?q=razorpay` → exact_slug score 1 (submit-flow search intact).
  - Mixed: `?q=Razorpay ghosting` → Razorpay card + "You also mentioned Ghosting" hint.
  - Signal: `?q=companies that ghost after technical rounds` → honest "No company has enough evidence yet to answer 'Ghosting'" (no fabricated score).
  - Unsupported: `?q=companies in Gurgaon with slow responses` → explicit "can't yet filter by office location" notice **and** the Response Speed signal, insufficient state.
  - Regression: `/company/razorpay` renders metadata + similar companies + honest "no reports yet" + provenance; `/analytics` renders honest empty state (extended loader, no regression).
  - Only console errors are the known preview-tool `main-app.js?v=<ts>` EvalError instrumentation, not CandidateVoice code.

## Known limitations (honest)

- **No approved evidence in production** → every signal query correctly returns the insufficient state today. The machinery is verified against the empty case; the well_evidenced/limited bands are unit-tested but not yet live-exercised (needs approved submissions). This is a data state, not a code gap.
- **Alias recall is still low** (`organization_aliases` ≈ 2 rows). M3.2's script is written and dry-run-verified (262 collision-safe candidates) but NOT applied — the domain-stem source carries noise from mis-stored `company_links` rows (e.g. `credit-agricole`→CRED), so applying it needs a human review pass first.
- **Location search unsupported** (`company_locations` = 0 rows) — surfaced honestly, deferred until that table is populated.
- Signal `signalStrength` is population-calibrated only above 5 rendered companies; below that it's raw-directional and labelled provisional.

## Not committed / not pushed yet

Awaiting the one M3 commit (M3 files only). No push planned unless requested.

## Next milestone

Track B — Truth Layer + legitimate evidence acquisition (see the plan):
1. **B.1 First-party provenance parity** — `hiring_submissions` has no immutability trigger and no moderation audit table (migration `0001` is *named* `rate_limit_and_moderation_audit` but contains only `rate_limit_counters`). Largest genuine gap.
2. **B.4 Legitimate acquisition (Q-2)** — `external_reports = 0` because no permitted source flows yet. This is a sourcing/permissions problem, not engineering; it's the real blocker to a non-empty product.
3. The moderation gate (approve/reject the 2 genuine pending submissions, clear 3 test rows) remains a human decision.
