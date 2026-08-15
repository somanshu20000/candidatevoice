# NOW — CandidateVoice project state

**Current phase:** M5.1 Company-Request Moderation & Promotion — **COMPLETE**.
**Last updated:** 2026-08-14.

## Headline

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
