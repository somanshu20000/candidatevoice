# NOW — CandidateVoice project state

**Current phase:** M5.3 Verification pipeline (submission → moderation → approved evidence) — **COMPLETE**.
**Last updated:** 2026-08-16.

## Headline (M5.3)

The verification envelope (M5.2a) is now wired end-to-end through the real
report pipeline. A submitter who holds a redeemable grant can attach it to a
submission; the tier is stamped at insert, stays immutable through moderation
(0027's guard), and surfaces on the approved-evidence read path as a coarse
`verification_tier` on every `EvidenceItem`. The tier is provenance metadata
only — it is **never** a weight (D-022), and nothing in the Evidence Engine
reads it to change a score. No UI was added (out of scope): the pipeline
carries the value; rendering an aggregate composition is later work.

### What was implemented
| Piece | File |
|---|---|
| Grant redemption at submit (fail-open, org-bound) | `src/app/api/submit/route.ts` (modified) |
| RPC writes the tier + view exposes it | `supabase/migrations/0028_verification_pipeline.sql` (new, **unapplied**) |
| Tier on the canonical evidence shape | `src/lib/evidence/types.ts` (EvidenceItem.verificationTier) |
| Loader reads the column | `src/lib/evidence/load.ts` (RawFirstPartyRow + FIRST_PARTY_SELECT) |
| Normalizer maps it (both families) | `src/lib/evidence/normalize.ts` |
| Synthetic items default it | `src/lib/evidence/synthetic.ts` |
| Canonical type | `src/types/index.ts` (VerificationTier); re-exported from `src/lib/verification/token.ts` |
| Tests | `tests/verification-pipeline.test.ts` (new); 12 evidence-fixture files updated for the new required field |

### The pipeline, end to end
1. **verification → submission.** `/api/submit` accepts an optional
   `verification_token`. It is redeemed via `redeemGrant` **only against the
   organization just re-verified** (D-009's re-verify) — a grant for org A can
   never stamp a report about org B, and a mismatch leaves the nonce unconsumed
   for a legitimate retry. Redemption is entirely best-effort: any failure
   (absent, invalid, expired, replayed, mismatched, or a redeem error) leaves
   `verification_tier` `'unverified'` and the submission proceeds. **Verification
   never gates a submission.** The tier rides in `p_submission` to the RPC.
2. **submission → moderation.** `submit_hiring_report` (redefined in 0028)
   writes `verification_tier`, defaulting to `'unverified'`. Moderation is
   unchanged; 0027's immutability guard locks the column at insert, so approval
   never alters it.
3. **moderation → approved evidence.** `public_submissions` (redefined in 0028)
   now projects `verification_tier`; `load.ts` selects it, `normalize.ts` maps
   it onto `EvidenceItem.verificationTier`. External evidence is always
   `'unverified'` (a forum post carries no grant — the same W1 asymmetry as the
   other first-party-only fields).

### Database changes (unapplied to production)
Migration `0028_verification_pipeline.sql`:
- `create or replace function submit_hiring_report` — full 0020 body plus
  `verification_tier` written as `coalesce(nullif(p_submission->>'verification_tier',''),'unverified')`. Signature unchanged (still 3 jsonb params).
- `create or replace view public_submissions` — full 0020 select list plus
  `s.verification_tier`. Still never projects a bare `created_at` (only the
  `reported_month` coarsening) — the anonymity boundary is preserved.

### Weight neutrality (D-022), proven
`firstPartyWeight()` still takes no tier input; `normalizeFirstParty` computes
`weight` before mapping the tier and never references it.
`tests/verification-pipeline.test.ts` asserts two first-party rows differing
ONLY in tier get identical weight; `tests/verification-weight-neutrality.test.ts`
(from M5.2a) still guards `firstPartyWeight()` directly.

### Test results
`npx tsc --noEmit` — clean. `npx vitest run` — **49 files, 702 tests, all
pass** (9 new: tier passthrough for both families, unrecognized-tier-fails-safe,
weight neutrality, and migration-0028 structural parity for the RPC write and
the view projection). `npm run build` — clean, 28 routes.

### What is still true / still deferred
- **Still no proof of employment.** M5.2a's `/api/verify/grant` remains
  scaffolding — the tier is caller-asserted, no email is sent. A
  `contact_domain` tier does not prove employment; M5.3 only moves the value
  through the pipeline. The real proof step is M5.2b, gated on the
  vendor/log-retention decision (§11 of the M5.2 architecture plan).
- **No UI.** No aggregate-composition surface ("N of M reports from verified
  company addresses") was built — out of scope. `EvidenceItem.verificationTier`
  exists so that display can be built later without a second query.
- **Migration `0028` is unapplied to production**, joining `0025`/`0026`/`0027`.
  All evidence is the test suite + a clean build; production application stays
  human-gated per the M4 precedent.

---

## Headline (M5.2a — superseded above as "current phase")

**M5.2a Verification Envelope (vendor-free)** — complete (see below), now wired
by M5.3.

## Headline (M5.2a)

A reusable, privacy-preserving "verification envelope" now exists: a short-lived,
HMAC-signed grant token (`{nonce, organizationId, tier, exp}`) that can be issued
and redeemed over HTTP, with atomic single-use consumption backed by one new
content-free table (`verification_grants`) and one new column
(`hiring_submissions.verification_tier`). **No email, no vendor, no UI** — this
is plumbing only, exactly as scoped. See D-022 for the durable decisions this
introduced. Migration `0027` is written but **NOT applied to production**; no
git commit/push has been made. Full detail below; the M5.1 summary that used to
head this file follows underneath, unchanged.

### What was implemented
| Piece | File |
|---|---|
| HMAC sign/verify core (pure) | `src/lib/verification/token.ts` (new) |
| Atomic nonce store | `src/lib/verification/grants.ts` (new) |
| Combined verify+consume | `src/lib/verification/redeem.ts` (new) |
| Grant-issuance API | `src/app/api/verify/grant/route.ts` (new) |
| Grant-redemption API | `src/app/api/verify/consume/route.ts` (new) |
| Migration | `supabase/migrations/0027_submission_verification.sql` (new, **unapplied**) |
| Tests | `tests/verification-token.test.ts`, `tests/verification-grants.test.ts`, `tests/verification-redeem.test.ts`, `tests/verification-weight-neutrality.test.ts` (all new); `tests/account-evidence-disjointness.test.ts` and `tests/db-hiring-submissions-immutability.test.ts` extended |

### Database changes (unapplied to production)
- `hiring_submissions.verification_tier text not null default 'unverified'` +
  `NOT VALID` CHECK over `unverified | inbox_verified | contact_domain | attested`.
- `hiring_submissions_guard_immutable()` redefined (`CREATE OR REPLACE`, same
  function name the existing `0025` trigger already points at — no trigger DDL
  needed) to also lock `verification_tier`. Without this, the column would have
  been silently mutable after insert, since it didn't exist when `0025`'s guard
  was written.
- New table `verification_grants (grant_hash text primary key, expires_at
  timestamptz not null)` — deliberately content-free. RLS enabled, no policy
  (service-role only). No organization, no tier, no address, no `consumed_at`,
  no `created_at` — see INV-V below.
- **Naming note:** the tier is named `inbox_verified`, not the more obvious
  "email_verified" — the latter's substring collides with
  `account-evidence-disjointness.test.ts`'s forbidden-identity-column scan
  (which flags any executable SQL containing "email"). Renamed rather than
  weakening that test.

### Cryptographic mechanism
HMAC-SHA256 over the whole JSON payload (`{nonce, organizationId, tier, exp}`),
keyed by a new `VERIFICATION_SECRET` env var (not yet set anywhere — grant
issuance/consumption both fail closed with a 500 until it is configured).
Tampering any single field invalidates the signature as a whole — there is no
way to keep the organization valid while changing the tier. Signature
comparison is constant-time (`crypto.timingSafeEqual`, matching the existing
pattern in `src/app/api/admin/_utils.ts` rather than `unlock-cookie.ts`'s
weaker plain `!==`, since this is new security-sensitive code).

### Privacy guarantees (INV-V)
No verification artifact — address, domain, OTP, document, IP, token, or
nonce — is stored on, foreign-keyed to, or joinable with an evidence row.
`verification_grants` holds only `sha256(nonce)` + `expires_at`; the
organization/tier binding lives ONLY inside the signed token the caller holds,
never in the database. `tests/account-evidence-disjointness.test.ts` now has a
dedicated block asserting `verification_grants`' declaration names no evidence
table, carries none of a forbidden-column list (email/phone/organization_id/
submission_id/nonce/address/domain/user_id/ip_address), declares exactly two
columns, and has RLS with zero policies.

### Abuse / replay protection
- **Replay:** `consumeGrant()` is a single atomic
  `DELETE ... WHERE grant_hash=$1 AND expires_at > now() RETURNING ...` — one
  SQL statement, so Postgres's own row locking means exactly one of two
  concurrent callers can ever consume the same nonce (tested via
  `Promise.all` racing two `redeemGrant` calls on one token).
  Defense in depth: expiry is checked twice (embedded `exp` inside the signed
  token, and independently via `expires_at` in the DB row).
- **Organization mismatch never consumes:** if `redeemGrant` is called with an
  `expectedOrganizationId` that doesn't match the token's bound org, the
  underlying nonce is left untouched — a legitimate retry with the correct org
  can still redeem the same token afterward.
- **Forgery:** HMAC over the full payload; server-only secret.
- **No internal identifiers ever leave the API:** both routes return only
  `{organizationId, tier}` (plus `expiresAt`/`token` from `grant`) — never
  `grant_hash` or the plaintext nonce.

### Test results
`npx vitest run` — **48 test files, 693 tests, all pass** (M5.2a added 43 over
M5.1's 650: 12 token tests, 10 grants tests, 6 redeem tests, 2 weight-neutrality
tests, plus new disjointness/immutability blocks). Covers: valid grant round
trip; invalid signature; tampered organization/tier/nonce; signature-swap
across two tokens; expired grant; wrong-secret; malformed/missing-dot tokens;
nonce replay; simulated concurrent consumption (exactly one of two racing
calls succeeds); wrong-organization-never-consumes + successful retry;
successful consumption; second consumption fails; no identity fields stored;
no evidence-table linkage; `firstPartyWeight()` provably ignores tier.

### Build result
`npx tsc --noEmit` — clean. `npm run build` — clean, 28 routes (2 new:
`/api/verify/grant`, `/api/verify/consume`).

### What M5.2a still cannot verify
- **Nothing about employment.** No email is ever sent; `tier` in
  `POST /api/verify/grant` is caller-asserted, not proven. Both API routes are
  explicitly documented in-file as scaffolding that exercises the plumbing
  only — this does **not** establish current employment, former employment, or
  candidate interaction.
- Not wired into `/api/submit` — a redeemed grant does not yet stamp a real
  submission's `verification_tier`. That integration is deliberately deferred:
  M5.2a's scope was the envelope/grant infrastructure, not the submit-flow
  wiring.
- `VERIFICATION_SECRET` is not configured anywhere yet (not in `.env.example`,
  not in the deployed environment) — both routes fail closed (500) until it is.
- No live/production verification was performed (migration `0027` is
  unapplied) — all evidence is the 43 new unit/structural tests plus a clean
  local build, per the M4/M5.1 precedent for DDL that's human-gated before
  production application.

### Recommended next step (M5.2b, gated)
Per the M5.2 architecture decision, M5.2b (the emailed domain-matching tier)
is gated on a **vendor/legal decision about email log retention** (§11 of the
plan) — a human decision, not an engineering one. Until that's made: do not
build `mailer.ts`, `/api/verify/start`, `/api/verify/confirm`, or any
submit-wizard UI. The more immediately valuable next step, independent of
M5.2b, is likely wiring a redeemed grant into `/api/submit` so
`verification_tier` actually reaches a real row — but see the honest priority
note already on record: with production evidence still extremely sparse,
closing the M4 migration-application gap and deciding the 2 pending
submissions outranks further verification work.

---

## Headline (M5.1, superseded above as "current phase" — kept for history)

The "add a company" loop is closed. `company_requests` (migration `0022`) and the
submit flow's "isn't listed" write path already existed, but nothing ever read
the queue or turned a request into a canonical organization — it was a
write-only dead end. Admin now has a third moderation tab: **Promote** (create
exactly one new organization, re-verifying via `resolve_organization` first —
D-009), **Merge** (link the request to an existing organization, create
nothing), or **Reject**. A stranger can now genuinely go: search → not found →
add company → admin reviews → canonical organization → searchable →
submittable.

## What was implemented

| Piece | File |
|---|---|
| Queue read + promote/merge/reject logic | `src/lib/company-intelligence/requests.ts` (new) |
| Admin API | `src/app/api/admin/company-requests/{list-pending,promote,merge,reject}/route.ts` (new — 4 routes; the plan's list named 3, `merge` was added because §7 of the M5 plan explicitly requires it and the admin UI needs a merge action) |
| Admin UI | `src/app/admin/page.tsx` — third `"companies"` tab, mirroring the existing `"hiring"`/`"external"` tab pattern exactly (same auth flow, same load-on-select, same error/message banners) |

## D-009 enforcement (never silently create a duplicate)

`promoteCompanyRequest` re-resolves **immediately before creating**, via the
same `resolve_organization()` RPC `store.ts`/`submit_hiring_report` already
trust — not a fresh algorithm. Two independent guards:
1. **Slug re-resolve.** If the candidate slug already resolves to an
   organization (exact/alias/canonicalized match), promotion refuses and
   returns the existing `organizationId` so the admin can merge instead.
2. **Domain collision.** If `requested_domain` already belongs to an
   organization via `company_links.normalized_domain`, promotion refuses the
   same way — catches a differently-named request for a company that already
   exists under a different display name.

Every mutation (`promote`/`merge`/`reject`) re-checks `status = 'pending'` in
the same UPDATE and requires the update to actually match a row — the guard
against two admins (or a promote racing a reject) acting on the same request
twice. `organizations` creation itself uses the same `upsert(...,
{onConflict:"slug", ignoreDuplicates:true})` + re-select pattern `store.ts`'s
`createOrganization` already uses, so a genuine race on the same slug
converges rather than erroring.

## Files changed

**New:**
- `src/lib/company-intelligence/requests.ts`
- `src/app/api/admin/company-requests/list-pending/route.ts`
- `src/app/api/admin/company-requests/promote/route.ts`
- `src/app/api/admin/company-requests/merge/route.ts`
- `src/app/api/admin/company-requests/reject/route.ts`
- `tests/company-requests.test.ts` (14 tests)

**Modified:**
- `src/app/admin/page.tsx` — `Tab` type widened to include `"companies"`;
  `CompanyRequestItem` type; `companyRequests`/`mergeTargets` state;
  `loadTab` extended for the third URL; `promoteRequest`/`rejectRequest`/
  `mergeRequest` handlers; third tab button + render block.

**Untouched collaborator work** (left exactly as found): `scripts/_shared.ts`,
`scripts/fetch-company-metadata.ts`, `scripts/import-external.ts`,
`src/lib/company-intelligence/store.ts`, `.../adapters/website-meta.ts`,
`src/lib/hiring-intel/*`, `package.json`/`package-lock.json`, and the
untracked `.bak`/`demo-seed.ts`/`system_1.png`/`supabase-debug.txt`/`0019_*`/
`Logo/`/`Data_Deepseek_layer/` files.

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run` — **44 files, 650 tests, all pass** (M5.1 added 14 over M4's 636).
- `npm run build` — clean, 26 routes (4 new: the company-requests API routes).
- **Testing approach — why a fake Supabase client, not a live DB.** `requests.ts`
  talks to Supabase directly (no `CompanyStore` abstraction like `importer.ts`
  has), and this codebase's established convention (confirmed across M3/M4:
  `company-resolve.test.ts`, `db-hiring-submissions-immutability.test.ts`) is
  unit-test pure logic, live-verify I/O — never mock Supabase. Since local
  Docker Supabase is unavailable in this environment and the task explicitly
  forbade creating/promoting/merging/rejecting anything in **production**
  `company_requests`, I built the smallest in-memory fake that reproduces the
  exact query shapes `requests.ts` issues (including a realistic
  `resolve_organization` RPC that reads the fake `organizations` table, so a
  company created by one `promote()` call is genuinely visible to the next
  call's D-009 re-resolve). This is new infrastructure for this codebase, not
  a general Supabase mock — scoped to exactly one module. The 14 tests cover:
  pending-queue filtering, exactly-one-org creation, invalid-slug rejection,
  unknown/already-resolved request handling, **slug-collision refusal**,
  **domain-collision refusal**, **the real two-requests-for-one-company race
  (still exactly one org after both)**, **concurrent-action guard** (a
  reject landing before a promote), merge creating zero organizations, merge
  into a nonexistent org refused, and reject's status/timestamp/no-org-touched
  invariants.
- **Live browser verification (`npm start`, not `npm run dev`):**
  - `GET /api/admin/company-requests/list-pending` with no `Authorization`
    header → `401 {"error":"Missing authorization header."}`.
  - `POST` to `promote`/`merge`/`reject` with a wrong bearer token → all three
    `401 {"error":"Unauthorized."}`, confirmed via `fetch()` from the page
    (no data touched — auth is checked before any `requests.ts` call).
  - `/admin` renders the third **Companies** tab alongside Hiring/External;
    clicking it switches `tab` state correctly and — because `isReady` is
    false with no secret entered — fires **no** fetch at all, matching the
    existing hiring/external tabs' exact behavior.
- **What was NOT live-exercised, and why:** the actual promote/merge/reject
  write paths were not run against a real database (production or otherwise)
  in this session. Doing so against production would mean either acting on a
  genuine pending request (explicitly forbidden) or inserting a throwaway
  test request + promoting it into a real `organizations` row (which,
  unlike `hiring_submissions`, has no immutability trigger and so *could* be
  cleaned up afterward — but the task's "do not modify production data
  without explicit authorization" was read as covering this too, so it was
  not attempted). The 14 fake-client tests are the substitute evidence; they
  exercise the literal shipped code, not a refactored-out subset.

## Production data touched

**NO.** No `company_requests`, `organizations`, or any other production row
was read (beyond what the earlier session's audits already covered),
created, updated, or deleted this session.

## Known limitations (honest)

- Merge requires the admin to already know the target `organizationId` (a
  plain text input, no search widget). Finding it today means using the
  existing company search/`/api/company-search` separately and pasting the
  id in. A proper inline search-and-pick UI is a natural follow-up, not built
  here to keep this milestone's diff reviewable.
- The domain-collision guard only fires when the request itself carries
  `requested_domain` — requests filed without a domain (the field is
  optional in the submit UI) only get the slug-based D-009 check.
- No email/notification path exists when a request is promoted or rejected —
  the requester is anonymous by design (D-007-adjacent: no identity is
  stored with a `company_requests` row either), so there is no one to notify.

## Next milestone

**M5.2 — Verification envelope (optional, pre-submit).** Per the M5
architecture plan: a submitter may optionally prove inbox or work-domain
control (HMAC signed short-lived link, reusing the exact pattern already
specified in `docs/design-hr-authentication.md` §1), yielding a grant that
stamps a `verification_tier` enum on the submission — never an email, domain,
document, or token. New migration `0027_submission_verification.sql`. Verification changes **display only, never weight** (see the M5 plan's §6 reasoning: weighting verified evidence higher punishes the anonymous majority and creates a de-anonymization incentive). Requires a new
FK-disjointness test mirroring `tests/account-evidence-disjointness.test.ts`
to prove no verification artifact ever touches an evidence row (INV-V).
