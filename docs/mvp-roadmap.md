# CandidateVoice — MVP Readiness Review & Roadmap

**Lens:** Product Engineer / Tech Lead review of what stands between the current codebase and real candidates/recruiters using this product. Architecture and security hardening are considered done (see the security-review work in this session's history) — this document is scoped to product completeness, not further infrastructure.

**Method:** grounded in a fresh read of every route/component/type in `src/`, plus targeted checks for Next.js special files (`loading.tsx`/`error.tsx`/`not-found.tsx` — none exist anywhere), SEO/structured-data markers (none exist), and accessibility markers (12 total `aria-`/`alt`/`label`/`htmlFor` occurrences across the entire `src/` tree, almost all in `submit/page.tsx`).

---

## 1. Candidate journey

| Can a candidate... | Today | Gap |
|---|---|---|
| Submit a company | Yes — clean 4-step wizard (`submit/page.tsx`), server-validated | — |
| Edit mistakes | **No** | No submission ID is ever returned to the client, no edit link, nothing. Once submitted, a typo is permanent. Anonymity makes this genuinely hard (no account to check ownership against) — but not unsolvable at MVP scope (see roadmap). |
| Receive confirmation | **No** | `handleSubmit` redirects straight to `/company/[slug]?unlocked=true` — the `?unlocked=true` param is never actually read by the destination page (confirmed: `company/[slug]/page.tsx` derives unlock state from the cookie, not the query string — dead param). There is no "thanks, your submission is pending moderation" message anywhere. If the company still has fewer than 5 approved submissions, the user lands on the "not enough data yet" screen immediately after submitting *their own* data — which reads as "did that even work?" |
| Understand moderation | **Partially** | The submit page shows one line ("Anonymous. No personal data stored.") and the footer has a disclaimer about moderation existing, but nothing states *when* to expect a decision or that a pending submission won't appear immediately. |
| Avoid duplicates | **No** | No canonical company entity exists (confirmed: no `companies` table anywhere in the schema). "Google", "google inc", and "Google LLC" would normalize to three different slugs and fragment data across three separate pages, directly undermining the product's core value (enough aggregated signal per company to be meaningful). |
| Search existing companies | **Partially** | `CompanySearch` navigates directly to a guessed slug with no autocomplete/typeahead against real existing companies. A near-miss spelling lands the user on an empty "be the first" page even when real data exists under a slightly different slug. |

## 2. Public company pages

- **Completeness:** the core HQS breakdown, stage distribution, and unlock gating are all functionally complete and already well-designed (confirmed empty state: "Not enough data yet — be the first to submit" is a genuinely good touch, not a gap).
- **SEO:** no per-page `<title>`/description overrides, no Open Graph tags, no Twitter Card tags anywhere in the codebase (confirmed via grep — zero matches for `openGraph`/`og:`/`twitter:`/`generateMetadata`). Every company page currently shares the root layout's generic title/description. This directly undermines the product's growth loop: sharing a company link on social/WhatsApp/Slack (the primary expected discovery channel for a community-driven product) shows a blank/generic link preview instead of the company name and score.
- **Structured data:** none (zero `application/ld+json` anywhere). Not urgent, but worth noting for future search-snippet visibility.
- **Loading states:** none — no `loading.tsx` anywhere in the app (confirmed via glob). `company/[slug]/page.tsx` is an async Server Component; on a cold Supabase connection, the user sees a blank tab with no feedback until the whole page resolves.
- **Error states:** none — no `error.tsx` anywhere. A Supabase failure mid-request falls through to Next.js's generic default error page, not a branded one.
- **Empty states:** already good (see above) — the one genuinely complete UX surface in this review.

## 3. Admin workflow

- **Review:** functional — a flat list of pending items with company/role/stage/outcome/reason visible.
- **Search:** **none.** No way to find a specific submission by company name or id.
- **Filter:** **none.** No filter by company, stage, or date.
- **Approve/Reject:** functional, and now has an audit trail (`rejected_at`, from the security pass).
- **Audit:** partial — rejection is now recorded with a timestamp, but there's still no *who* (the admin model is a single shared secret, not per-admin identity — a bigger lift, correctly out of scope for "ship the MVP").
- **Friction identified:**
  - `list-pending` has **no pagination or limit** — it fetches every pending row in one shot. Fine at today's volume; becomes the first thing to break as real submission volume grows, and moderation is the entire trust mechanism this product depends on (README: "human moderation before publication").
  - No bulk actions (approve/reject one at a time only).
  - No pending-count indicator anywhere in the UI (the admin has to load the list to know if anything needs attention).
  - Approve/reject on a nonexistent or already-actioned id currently returns `{ok:true}` regardless of whether any row actually matched — Supabase's update/delete on a non-matching filter doesn't error, it just affects zero rows silently.

## 4. Data model

Current schema (`hiring_submissions`, confirmed against `docs/schema.md`) is a single flat table — no `companies` entity at all. Missing, evaluated at MVP scope rather than full enrichment:

| Field/entity | Needed for MVP? | Why |
|---|---|---|
| A minimal `companies` lookup table (name, canonical slug, known aliases) | **Yes** | This is the fix for duplicate/typo fragmentation in §1 and §2 — the single highest-leverage data-model change available. Does not need website/industry/size/etc. to solve the actual problem. |
| Duplicate detection (fuzzy match against the lookup table at submit time) | **Yes** | Pairs directly with the above — warn "did you mean [existing company]?" before creating a new slug. |
| `website`, `headquarters`, `industry`, `company size`, `LinkedIn` | **No, not for MVP** | Real enrichment value, zero cost to defer — nothing in the candidate or admin journey is blocked without these. Matches this project's own stated principle of not over-building ahead of validated need. |
| Moderation metadata beyond `rejected_at` (moderator identity, rejection reason) | **Partially** | A free-text or enum rejection-reason field is cheap and valuable (lets a rejected submitter's future resubmission actually improve); per-admin identity requires a real auth system — defer. |
| Submission edit/ownership token | **Yes, lightweight version** | A random token generated client-side at submit time, shown once and stored in the browser (not tied to any real identity), checked server-side on an edit/retract request — preserves full anonymity while solving §1's "no way to fix a typo" gap. |
| Timestamps beyond `created_at`/`rejected_at` | **No** | Sufficient for MVP. |

## 5. API review

- **Consistency:** good — every route returns `{error: string}` on failure or `{ok: true}` / `{data: [...]}` on success, uniformly.
- **Validation:** strong — server-side enum allowlisting on every field, already hardened in the security pass.
- **Error responses:** appropriately non-leaky (no stack traces, no internal detail exposed) but somewhat unhelpful for legitimate users — "Invalid field values" doesn't say *which* field. Low-priority DX polish, not a blocker.
- **Status codes:** mostly correct (400/401/429/500/200); one real gap — approve/reject return `200 {ok:true}` even when the given `id` matched zero rows, since Supabase doesn't error on a no-op update/delete. Should check the affected-row count and return `404` when nothing matched.
- **Pagination:** `/browse` paginates correctly client-side; `/api/admin/list-pending` has none at all (see §3).
- **Idempotency:** none. The submit button is disabled while a request is in flight (some protection against double-click), but there's no server-side idempotency key — a network retry after a timeout could create a duplicate row. Low-Medium priority given the moderation gate would likely catch obvious duplicates anyway.

## 6. Frontend review

- **Accessibility:** the weakest area found in this review. Only 12 `aria-`/`alt`/`label`/`htmlFor` occurrences exist in the entire codebase, nearly all in `submit/page.tsx`. Specifically missing: a real `<label>` for the admin password input (placeholder text only), a label for the `CompanySearch` input, and no accessible names on the `browse` page's filter `<select>` elements.
- **Mobile responsiveness:** better than expected — most layouts already use Tailwind's responsive prefixes correctly (`flex-col md:flex-row` in `Footer.tsx`, `md:grid-cols-2 lg:grid-cols-3` in `browse/page.tsx`). Worth an actual on-device smoke test before launch, but not a rebuild.
- **Loading UX:** missing at the route level (§2) — no skeletons/spinners for the two async Server Component routes.
- **Forms:** the submit wizard itself is well-structured (clear steps, disabled-until-valid progression) — the gap is post-submission, not the form itself (§1).
- **Navigation:** simple and clear (`Navbar`/`Footer`), nothing broken.
- **Empty states:** already good (§2) — credit where due.

## 7. Launch blockers

**Critical (must fix before real candidates/recruiters use this):**
1. Post-submission confirmation UX (§1) — users must know their submission was received and is pending.
2. Lightweight `companies` lookup + duplicate warning (§4) — without this, the product's core value (aggregated signal per company) actively degrades as real usage starts.
3. Admin pagination on `list-pending` (§3) — moderation is the trust mechanism; it must not fall over under real volume.
4. Open Graph / basic per-page metadata on company pages (§2) — the primary expected growth channel (link sharing) is currently broken.

**Important (should fix, not launch-blocking):**
5. `loading.tsx` / `error.tsx` for both dynamic routes (§2).
6. Accessibility basics — labels on all form inputs, a real focus-state pass (§6).
7. Company autocomplete/typeahead search (§1).
8. Approve/reject should 404 on a non-matching id (§5).
9. Submission edit/retract via a lightweight anonymous token (§1, §4).
10. Admin search/filter + pending-count indicator (§3).
11. Rejection-reason field surfaced to a future resubmission flow (§4).

**Nice to have (defer):**
12. Full company enrichment fields (website, HQ, industry, size, LinkedIn) (§4).
13. Bulk admin actions.
14. Per-admin identity/audit attribution (needs real auth — bigger lift).
15. JSON-LD structured data.
16. Idempotency keys on submit (§5).
17. Dynamic `sitemap.ts`.

---

## 8. MVP roadmap — prioritized order

| # | Task | Impact | Effort | Dependencies |
|---|---|---|---|---|
| 1 | Post-submission confirmation screen/banner ("pending review, typically resolved in X") | High — fixes the most confusing moment in the entire candidate journey | Small — client-side only, no schema change | None |
| 2 | Minimal `companies` lookup table (name, slug, aliases) + submit-time "did you mean X?" duplicate check | High — protects the core data asset from day one of real usage | Medium — one new table + a lookup query in the submit flow | None; independent of everything else |
| 3 | Paginate `/api/admin/list-pending` (limit + offset or cursor) | High — prevents moderation from breaking under real load | Small — query change plus a "load more"/page control in `admin/page.tsx` | None |
| 4 | Open Graph + per-page `<title>`/description via `generateMetadata` on `company/[slug]/page.tsx` and `browse/page.tsx` | High — unlocks the primary growth channel (link sharing) | Small — Next.js metadata API, no new data needed beyond what's already fetched | None |
| 5 | `loading.tsx` + `error.tsx` for `company/[slug]` and `browse` | Medium — real polish for real users hitting cold paths | Small | None |
| 6 | Accessibility pass: labels on admin password field, `CompanySearch` input, `browse` filters; focus-state spot-check | Medium — table-stakes for a public product | Small | None |
| 7 | Company autocomplete/typeahead in `CompanySearch`, backed by the lookup table from #2 | Medium-High — directly improves discovery of existing data | Medium | Depends on #2 |
| 8 | Approve/reject return `404` when no row matched | Low-Medium — correctness/API hygiene | Small | None |
| 9 | Lightweight anonymous edit/retract token (generate client-side at submit, store in browser, check server-side on an edit request) | Medium — closes the "can't fix a typo" gap without breaking anonymity | Medium — one new column + one new small API route | None, but naturally sequenced after #1 (same UX surface) |
| 10 | Admin search/filter by company + a pending-count badge | Medium — meaningful quality-of-life once moderation volume grows | Medium | Pairs well with #3, not blocked by it |
| 11 | Rejection-reason field on the reject action, surfaced if/when a resubmission flow exists | Low at MVP — value compounds later | Small | None |
| 12+ | Everything in "Nice to have" (§7) | Low at MVP scope | Varies | Revisit post-launch, driven by real usage data rather than pre-built |

**Sequencing logic:** items 1–4 are the actual launch blockers and are all independent of each other — they can be done in parallel by however many people are available, in any order. Items 5–8 are cheap, high-value polish with no dependencies, worth doing in the same push. Items 9–11 are genuinely valuable but each carries a bit more design/schema surface, and #7 specifically depends on #2 landing first. Nothing in the "nice to have" tier should be started before the Critical tier ships — consistent with this project's own standing principle of not building ahead of validated need.
