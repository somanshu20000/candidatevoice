# ADR-0005 — Company Identity + Longitudinal Hiring Intent

**Status:** Accepted · implemented (migrations 0021–0023;
`src/lib/company-intelligence/resolve.ts`, `src/lib/hiring-intent/*`,
`/api/company-search`, submit-flow `CompanyPicker` + seriousness step,
`HiringTimeline`)
**Builds on:** ADR-0001 (evidence model) · ADR-0004 (tenure stages)

---

## Part 1 — Company identity: never silently choose

### Context

`resolve_organization()` (0002) was exact-match only. Any miss caused
`resolveOrCreateOrganization` to silently mint a brand-new organization from
raw text — a typo, an abbreviation, or a deliberately misleading company name
would each create a permanent new row with zero human confirmation.

### Decision

1. **Ranked, never resolved.** `search_organizations_ranked()` (0021) returns
   a scored list — exact slug/alias (1.0), exact domain (0.95), exact
   normalized name (0.85), trigram similarity (0.4–0.84). It never returns a
   single winner; the submit UI always requires an explicit "This is the
   company" click before an `organization_id` becomes usable.
2. **The server re-verifies, never trusts.** `/api/submit` requires either a
   confirmed `organization_id` (re-checked against the database — the
   candidate list a user saw is advisory, this query is truth) or an explicit
   `company_not_listed`. Neither present → `400`, not a silent fallback.
   Verified live: a fabricated `organization_id` creates **zero rows** — the
   old fail-open behavior would have silently created `"fake-co"`.
3. **"Isn't listed" writes to a queue, not to identity.** `company_requests`
   mirrors `external_reports.verification_status`'s exact shape. The original
   typed text is preserved verbatim ("Anemoi Technologies", never slugified)
   — evidence is never blocked on identity resolving.
4. **Every new signal was already in the pipeline.** `wikidata_qid` was
   already fetched by the Wikidata adapter and previously discarded — 0021
   just keeps it. `normalized_domain` reads `company_links`, already 85%
   populated by the existing enrichment pipeline. No LinkedIn, no scraping.

### Known limitation (documented, not fixed)

Trigram similarity does not bridge full-abbreviation mismatches — "Tata
Consultancy Services" does not find the seed's "TCS" (confirmed live; the two
strings share almost no trigrams). That needs an alias row. **No bulk alias
backfill was run**, per explicit instruction.

---

## Part 2 — Longitudinal hiring intent: events, not a status column

### Context

Every table in this codebase is state, not events. "How serious did this
company seem, and did it go anywhere" cannot be answered by a single column
without losing the timeline that makes the answer trustworthy.

### Decision

1. **`hiring_events` is genuinely immutable** — not just "fields we don't
   expect to change," but a trigger that unconditionally rejects UPDATE and
   DELETE, verified live (`UPDATE ... → ERROR P0001`, `DELETE ... → ERROR
   P0001`). This is stricter than `external_reports_guard_immutable()`, which
   still permits a moderation-state transition; an event log has no
   moderation state, only new events.
2. **`actor_type` admits only `candidate` and `system` today** — `'hr'` is
   not a legal CHECK value, mirroring `reporter_type`'s own history
   (`candidate`-only at baseline, widened in 0019 once the product was
   ready). No route, no UI, no future refactor can start writing HR events
   without a deliberate migration first. No HR authentication was invented;
   none exists in this app.
3. **Candidate events reuse existing vocabulary.** `interview_occurred`,
   `candidate_outcome`, and `candidate_follow_up` derive from
   `stage`/`outcome`/`last_interaction_gap` already collected on the same
   submission — nothing is asked twice. Only `perceived_seriousness` (5-point
   scale) and `intent_reasons` (9 closed enum values, no free text) are new
   fields, and both are explicitly labelled as **perception**, never fact.
4. **Matching is one deterministic tier**, not the fuller
   STRONG/PROBABLE/AMBIGUOUS scheme discussed earlier: same
   `organization_id` + same normalized `role_key` + not-yet-stale → attach;
   else create new. This codebase has no job-title taxonomy to corroborate a
   fuzzy match against, so a confidence-tiered matcher would be guessing.
   Verified live: "Senior Backend Engineer" and "senior   backend   engineer"
   correctly attached to the *same* opportunity.
5. **Staleness is computed at read time**, not by a scheduler — none exists
   in this app. `recordStaleInferenceIfDue` fires opportunistically whenever
   a company page is loaded past the 30-day deadline, is idempotent (checked
   live: 3 consecutive loads produced exactly 1 `system_stale_inference`
   event), and the only string it ever produces is *"Hiring activity appears
   stale based on available evidence"* — never a claim about intent.
6. **Zero contamination, structurally.** `fingerprint/behavioural.ts`,
   `hqs.ts`, and every Evidence Engine loader never reference
   `hiring_opportunities`/`hiring_events`. Verified live: an employee report
   submitted alongside two candidate reports produced **zero** hiring-intent
   events (the `isCandidate` gate held) and did not appear in either table.
7. **Not integrated into HQS.** No code path was added connecting the two;
   this is the explicit, deliberate absence, not a partial wiring.

### Bugs found and fixed during live verification (both now confirmed working)

- **RLS gap (fixed, migration 0023):** `hiring_opportunities`/`hiring_events`
  had RLS enabled with **zero** SELECT policies — unlike `hiring_submissions`,
  which has an explicit `is_approved`-scoped read policy. Because the public
  views use `security_invoker = on`, the anon role querying through them
  inherited the deny-all and silently returned nothing — no error, just an
  empty timeline and a staleness check that could never fire. Added explicit,
  unrestricted SELECT policies (unrestricted is correct here: unlike
  `hiring_submissions`, every `hiring_events` row is a closed-enum,
  server-constructed event with no free text and nothing to moderate).
- **Load-order gap (fixed):** the timeline load originally sat after the
  company page's zero-approved-evidence early return, so a company with a
  pending-moderation candidate report (the normal state for any brand-new
  submission) would never show its own timeline. Moved before the early
  return; `HiringTimeline` now renders in both branches, self-suppressing
  when empty.

### Residual test data (cannot be removed — a direct proof, not an oversight)

The immutability trigger was verified against *real* database rows, and the
same guarantee that makes it trustworthy also makes those specific test rows
permanently undeletable:

- One `hiring_opportunities` row attached to a **real seeded company**
  (Kodehash Tech) carries a single inert `role_reported` event with no
  `submission_id`. Its `role_key` has been renamed (a mutable field, unlike
  the event itself) to `"(internal test data — safe to ignore, see
  hiring_events immutability verification)"` so it can never be mistaken for
  real data if it ever surfaces.
- Three `hiring_submissions` rows (all `is_approved = false`, never public),
  one organization (`zz-intent-demo`), one `hiring_opportunities` row, and 11
  `hiring_events` rows are stuck for the same reason — the events reference
  the submissions via FK, and the submissions therefore cannot be
  hard-deleted either.

Disabling the immutability trigger to tidy these up was considered and
rejected: it would undermine the exact guarantee the rows exist to prove.
This is the same trade-off documented in ADR-0004 for a similar residual row.

## Verification

`tsc` clean · **498/498 tests** passing (+16 since ADR-0004: 5
company-resolve, 14 hiring-intent pure-function, and the compensation
fixture's tenure-field update) · production build clean (22 routes). Live
against Supabase, cleaned up where the immutability guarantee allows:
company search (exact/domain/trigram/empty-for-unknown), submit-time
re-verification and rejection, the "isn't listed" queue, opportunity
matching and normalization, candidate-only event emission, zero
contamination under a mixed reporter-type fixture, idempotent stale
inference, and the RLS + load-order fixes above — each re-verified live
after the fix, not just patched and assumed correct.
