# ADR-0001 — Evidence: the core domain object of CandidateVoice

**Status:** Accepted · pre-launch · implementation-ready
**Supersedes:** the implicit "submission = review" model in `docs/schema.md`
**Depends on:** `0001_rate_limit_and_moderation_audit.sql` (already adds `rejected_at`); `docs/mvp-roadmap.md` item #2 (companies lookup — unified here as the `organizations` entity)
**Scope:** the trust model only — Evidence, its lifecycle, its confidence, and the minimal schema. No product-strategy, roadmap, or ATS decisions are reopened.

---

## Context

CandidateVoice's durable asset is not a database of opinions. It is a database of **anonymous evidence contributions that gain confidence through corroboration.** Every earlier design treated a row as a "review" — a mutable, author-owned rating. That framing quietly leaks identity (authors, timestamps, free text) and cannot express the one thing that makes this product defensible: that a claim about an employer becomes more trustworthy as independent candidates corroborate it, under human moderation, without any AI.

This ADR promotes **Evidence** to a first-class domain object with the rigor DDD applies to `Order` or `LedgerEntry`. Corroboration, moderation, HQS, legal defensibility, and future ATS ingestion all become *extensions of this one object* rather than separate systems.

The central engineering finding that makes this cheap to ship: **the current `hiring_submissions` table already is an evidence log in all but name.** `created_at` is the receipt time, `is_approved` + `rejected_at` already encode three lifecycle states. We evolve it additively. We do **not** build a parallel `hiring_events` table, and we do **not** migrate data.

---

## 1. Evidence as a domain object

### 1.1 Definition

> **An Evidence object is a single, immutable, anonymous, human-moderated contribution asserting a set of coarse structured facts about one candidate's experience of one employer's hiring process, stamped with its provenance.**

It is **not** a review: no rating, no free-form opinion, no author identity, no exact time. It is a bundle of bucketed observations plus provenance metadata. It is the atomic unit of truth in the system.

### 1.2 Invariants (must ALWAYS hold)

1. **Anonymous.** Carries no field that identifies the contributor — no user id, email, IP, device, or contact handle; no exact timestamp of the underlying hiring events.
2. **Coarse by construction.** Every temporal fact is a bucket (`"4-7 days"`), never exact. This is the anonymity guarantee, not a preference.
3. **Immutable factual core after moderation.** Once `published`, the asserted facts never change. Corrections happen by **supersession** (new evidence + retract old), never by mutation.
4. **Always provenanced.** `source` and `producer` are always known.
5. **Always privacy-classed.** Every row declares whether it may appear in public output.
6. **Always precision-declared.** `occurred_precision` always states whether facts are `bucket`, `exact`, or `synthetic`. At MVP: always `bucket`.
7. **Points at exactly one organization.** (Nullable only transiently, before moderation resolves the employer.)
8. **Confidence is metadata *about* evidence, never part of its assertion.** The truth claim does not change as confidence rises; only our corroboration of it does.
9. **Never hard-deleted.** Rejected/retracted/superseded evidence is retained for audit and legal defensibility. Deletion is not a valid operation.

### 1.3 Immutable vs. evolving fields

| Immutable after moderation (the factual core) | May evolve (the assessment envelope) |
|---|---|
| `organization_id`, `event_type`, `source`, `producer` | `lifecycle_state` (derived) |
| `occurred_precision`, `created_at` (receipt time) | confidence (derived on read) |
| all bucketed fact columns (`stage`, `outcome`, `response_time_bucket`, …), `payment_flag` | `rejected_at`, `retracted_at`, `superseded_by`, `rejection_reason` |
| `privacy_class` — **may only be tightened**, never loosened (a safety ratchet) | |

### 1.4 What belongs where

- **Evidence** — the atomic bucketed facts + provenance + privacy + lifecycle pointers. One candidate, one process, one contribution.
- **Organization** — employer *identity only*: canonical slug, display name, known aliases. Holds **no scores**. This is `docs/mvp-roadmap.md` item #2. The `normalizeCompanySlug()` in `src/lib/company-slug.ts` is its slug rule.
- **HQS** — a **derived, ephemeral projection**, computed on read from the set of `published` evidence for an organization (exactly as `src/utils/hqs.ts` does today). Not an entity, not stored, holds no state.

Two persisted entities (Evidence, Organization). One pure function (HQS). Nothing else.

### 1.5 What must NEVER be stored on Evidence (identity leaks)

Exact event timestamps · any candidate id/hash/pseudonym · IP / user-agent / geo · email / phone / name / LinkedIn / any handle · recruiter or interviewer names · req ids or ATS external ids · exact salary or exact dates · unlock-cookie contents or auth tokens · free-text narrative that could embed a name (current `reason` is an enum — keep it that way; `role` is the one free-text surface and must stay sanitized + length-capped, as it already is).

> **Live leak to fix (INV-1/2 violation at the publication boundary):** `src/app/browse/page.tsx` and the home feed currently select and ship exact `created_at` per public row. Combined with `company` + `role` at low volume, that is a fingerprint. **Fix:** never expose row-level `created_at` at full precision publicly — expose a coarsened `reported_month` (month or quarter) instead. `created_at` stays full-precision internally; `privacy_class` + this rendering rule govern exposure.

### 1.6 Future capabilities Evidence must support *without changing its identity*

- **Corroboration** — via derived queries over sibling evidence (§3), not by mutating rows.
- **Phase 4 ATS ingestion** — same envelope, new `source`/`producer`, `occurred_precision='exact'`. Evidence's identity is unchanged; a new producer simply writes rows with different provenance. **This is the entire payoff of the envelope.**
- **Retraction / supersession** — via pointer columns, not deletion.
- **Legal defensibility** — because Evidence is immutable + provenance-stamped + moderation-logged, you can always show *exactly what was submitted, when it was received, who reviewed it, and why it is public.* That is the audit trail a takedown or defamation defense requires.

---

## 2. Evidence lifecycle

**Key design decision:** lifecycle and confidence are **two separate axes.** The rough draft (`submitted → moderated → published → corroborated → high-confidence`) conflated them. *Lifecycle* = where the evidence sits in the publication pipeline. *Confidence* (§3) = how corroborated a published claim is. Mixing them is the trap; separating them is what keeps both simple.

### 2.1 States (publication axis — 5, deterministic)

| State | Meaning | Public? | Counts toward HQS? |
|---|---|---|---|
| `submitted` | received, awaiting moderation | no | no |
| `published` | approved by a moderator | yes (coarsened) | yes |
| `rejected` | reviewed and refused; **retained** for audit | no | no |
| `retracted` | was published, later withdrawn (moderator or contributor); retained | no | no |
| `superseded` | was published, replaced by a correction; retained; points to successor | no | no |

### 2.2 Lifecycle is *derived*, not stored

No `lifecycle_state` column. It is a pure function of four columns — `is_approved`, `rejected_at`, `retracted_at`, `superseded_by` — via one shared helper (`lifecycleState(row)`), so it can never drift from the physical truth and needs no update pipeline:

```
superseded_by IS NOT NULL         → 'superseded'
retracted_at  IS NOT NULL         → 'retracted'
rejected_at   IS NOT NULL         → 'rejected'
is_approved   = true              → 'published'
otherwise                         → 'submitted'
```

This reuses the columns `0001_…sql` already established and touches none of the existing `is_approved` query sites.

### 2.3 Valid transitions

```
submitted ──approve──▶ published
submitted ──reject───▶ rejected        (terminal)
published ──retract──▶ retracted       (terminal)
published ──supersede▶ superseded      (terminal; successor is a new Evidence row)
```

### 2.4 Invalid transitions (and why)

- `published → submitted` — cannot un-review; destroys audit integrity.
- `rejected → published` — terminal; prevents laundering refused content back in. (Moderator mistakes are corrected by the contributor resubmitting a *new* row; reinstatement is post-MVP.)
- `retracted → *`, `superseded → *` — terminal; withdrawn evidence stays out.
- `* → deleted` — **never.** Violates INV-9.
- `submitted → (any confidence state)` — confidence is a separate axis; nothing skips publication.

### 2.5 Moderation actions

| Action | Effect | Column written |
|---|---|---|
| approve | `submitted → published` | (sets `is_approved=true`) |
| reject(reason) | `submitted → rejected` | `rejected_at`, `rejection_reason` |
| retract(reason) | `published → retracted` | `retracted_at`, `rejection_reason` |
| supersede | publish new row, mark old | `superseded_by` on the old row |

### 2.6 Phase-4 extension point

ATS-sourced evidence is born `published` (`producer='ats'`), optionally skipping human moderation, and can be *linked* to candidate evidence to raise a claim's confidence. Linking lives in the confidence layer, not the lifecycle — lifecycle is identical for ATS rows. **Deferred; noted only so nothing here blocks it.**

---

## 3. Evidence confidence model

Confidence rewards **corroboration**, not popularity or activity. No AI, no Bayesian inference, no scoring model.

**Refinement of the brief:** confidence is well-defined only for a **claim**, not a lone row (with anonymity you cannot attach confidence to "this contributor"). So confidence is a property of an **(organization, claim)** pair, and each Evidence row **inherits** the confidence of the claims it asserts.

### 3.1 Corroboratable claims (deterministic, reuse `hqs.ts` predicates)

A fixed, small set, each computed by the *same* predicate HQS already uses — so confidence and HQS never diverge:

| Claim | Predicate (from `src/utils/hqs.ts`) |
|---|---|
| `GHOSTING` | `outcome='no_response'` AND `last_interaction_gap ∈ {15-30, 30+}` |
| `PAYMENT_REQUESTED` | `payment_flag = true` |
| `EARLY_REJECTION` | `call_duration ∈ {<2, 2-5}` AND `first_interaction_outcome='rejected_immediately'` |
| `SLOW_RESPONSE` | `response_time_bucket = 15+` |
| `LOW_TRANSPARENCY` | `reason = no_reason` |

### 3.2 Levels (few, explicit)

| Level | Definition |
|---|---|
| `single` | one published report asserting the claim for the org. Default. |
| `corroborated` | **≥3** published reports asserting the same claim for the same org, spanning **≥2 distinct calendar months** of `created_at`, no two byte-identical. |
| `verified` | a moderator has explicitly confirmed the *pattern* (never identity). Highest. **Post-MVP** (needs stored state — see §3.6). |

Thresholds are config constants: `MIN_CORROBORATING = 3`, `MIN_DISTINCT_MONTHS = 2`.

### 3.3 Honesty about "independent"

With true anonymity we **cannot prove** two reports came from different humans. We approximate independence via (a) human moderation filtering obvious duplicates/brigading, (b) temporal spread across months, (c) rejecting byte-identical payloads. The UI must therefore say **"corroborated by N reports,"** never "independently verified." Stating this limit is both more honest and more legally defensible than claiming independence.

### 3.4 Promotion / demotion — computed on read

Confidence is **derived on read**, never stored (MVP volume is tens of rows; the company page already scans an org's rows for HQS — compute confidence in the same pass). Therefore:

- **Promotion** is automatic the instant the counts are met.
- **Demotion** is automatic when siblings leave the published set (retracted/rejected/superseded rows stop counting) and the recomputed count/months drop below threshold. `corroborated → single` needs no job — it simply recomputes lower.

No triggers, no background workers, no stored counters, no staleness bugs.

### 3.5 HQS interaction (do NOT reweight the formula)

The HQS arithmetic in `src/utils/hqs.ts` is a fixed decision — confidence **must not** re-weight it (that is the "complex scoring" rabbit hole). Confidence governs **visibility and language only:**

1. **Keep** the existing "≥5 submissions to show the number" gate.
2. **Annotate** each breakdown metric with its claim's confidence chip (e.g., *"Ghost rate 40% · corroborated"*).
3. **Suppress the single highest-defamation-risk signal — `PAYMENT_REQUESTED` — from public display until it is `corroborated`.** A lone, unverified "asked me to pay" claim about a named employer is the most dangerous row in the database; require corroboration before it is publicly visible. (It still counts internally; it is only hidden from public display below `corroborated`.)
4. Escalate wording from "reported" to "pattern" only at `corroborated+`.

Note the two distinct confidence axes and keep their names apart in code:
- **Sample confidence** (existing `hqs.ts` output: `low/medium/high` from org submission count) — "do we have enough data at all?"
- **Claim confidence** (this section: `single/corroborated/verified`) — "how corroborated is this specific claim?"

Both survive; they answer different questions.

### 3.6 UI implications

- Company page: each breakdown row carries a confidence chip. Payment-risk row is hidden below `corroborated`.
- Evidence rows (browse): show the inherited chip for their strongest asserted claim; show `reported_month`, never exact date.
- `verified` (post-MVP) adds a "moderator-confirmed pattern" badge.

---

## 4. Minimal schema — evolve `hiring_submissions`, do not replace it

**Decision:** the physical table stays `hiring_submissions`. Renaming to `hiring_events` is cosmetic churn (touches ~10 files + RLS + the `0001` code paths) with zero user value — deferred to a trivial post-launch `ALTER TABLE … RENAME`. The domain object is **Evidence**; the persistence name is legacy. That mismatch is normal and costs nothing.

### 4.1 Deviations from the proposed field list (justified)

| Proposed field | Decision | Reason |
|---|---|---|
| `reported_at` | **omit** | `created_at` already *is* the receipt time. A second column duplicates it. |
| `payload JSONB` | **defer** | Every fact a `candidate_experience_reported` event carries is already a typed, CHECK-constrained column. An empty JSONB today is speculative. Adding a nullable JSONB in Phase 4 (when a second `event_type` needs fields the table lacks) is a trivial, non-breaking migration. |
| `event_type`, `source`, `producer`, `privacy_class`, `occurred_precision` | **keep** | Provenance/privacy/precision invariants (§1.2) + the seam that lets Phase 4 add producers and event types with no rewrite. Cost: five text columns with single-value CHECKs today. |
| `organization_id` | **keep (nullable)** | Points at the `organizations` entity (mvp-roadmap #2), created in the same migration. Nullable so Evidence works before every historical row is backfilled. |

### 4.2 Field-by-field justification

| Field | Why it exists | Why today | Why not premature |
|---|---|---|---|
| `id` (existing) | identity | — | — |
| bucketed fact cols (existing) | the asserted facts; consumed by HQS | product works on them now | already CHECK-enforced in code |
| `payment_flag` (existing) | highest-signal, highest-risk claim | drives payment risk | — |
| `is_approved`, `rejected_at` (existing) | lifecycle basis | moderation works on them | already shipped in `0001` |
| `created_at` (existing) | **receipt time = `reported_at`** | ordering, audit, month-coarsening | — |
| `organization_id` | canonical employer identity; fixes slug fragmentation | pairs with mvp-roadmap #2 | nullable, no backfill blocker |
| `event_type` | envelope discriminator | one value now (`candidate_experience_reported`) | the seam Phase 4 needs; no migration later |
| `source` | provenance channel | `candidate_form` | diverges at Phase 4 (`greenhouse`, …) |
| `producer` | provenance actor | `anonymous_candidate` | avoids a Phase-4 NOT-NULL backfill; one text column |
| `privacy_class` | declares public exposure; anchors the leak fix | all rows `public` now | carries `employer_private` at Phase 4 |
| `occurred_precision` | lets bucketed & exact time coexist in one table | `bucket` now | **directly answers "no collision"** (§4.4) |
| `retracted_at` | enables `retracted` state without mutation | supports retract flow (mvp-roadmap #9) | nullable |
| `superseded_by` | correction-by-supersession without mutation | supports anonymous edit/retract | nullable self-ref |
| `rejection_reason` | moderation audit + future resubmission hints | cheap enum | nullable |

### 4.3 Fields that must NEVER be added until Phase 4 (traps)

- `occurred_at` (exact event timestamp) — the anonymity killer. ATS rows only, only under `privacy_class='employer_private'`. Never on candidate evidence.
- `hiring_process_id` / any case/thread id linking one candidate's events — reconstructs a journey → re-identifiable. Phase 4, ATS rows only.
- `candidate_id` / candidate hash / pseudonym — **even a hash is a linkage key** that correlates one person's reports = de-anonymization. Never.
- `ats_provider`, `external_id`, `req_id` — ATS coupling + identity leak.
- `confidence_level` as a **stored** column — creates an update pipeline you don't need. Confidence is derived (§3.4).

### 4.4 Time coexistence (the "no collision" answer)

Yes. `occurred_precision` is self-describing. Candidate rows: `occurred_precision='bucket'`, temporal facts in the typed bucket columns, `occurred_at` never populated. Phase-4 ATS rows: `occurred_precision='exact'`, a *then-added* nullable `occurred_at`, `privacy_class='employer_private'`. The two never collide because candidate rows simply never carry `occurred_at`, and precision tells every consumer which world a row lives in.

---

## 5. Migration `0002_evidence_model.sql`

Additive, idempotent, non-destructive — same style as `0001`. No data movement. Run in the Supabase SQL editor.

```sql
-- CandidateVoice 0002 — Evidence model: organizations entity + evidence envelope.
-- Additive and idempotent. No data is moved or deleted. Depends on 0001.

-- 1. Organization entity (also satisfies mvp-roadmap.md #2 companies lookup).
create table if not exists organizations (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,          -- normalizeCompanySlug() output
  display_name text not null,
  aliases      text[] not null default '{}',  -- known variants, for dedup at submit
  created_at   timestamptz not null default now()
);
alter table organizations enable row level security;
-- Org identity is public; reads open, writes service-role only.
drop policy if exists organizations_public_read on organizations;
create policy organizations_public_read on organizations for select using (true);

-- 2. Evidence envelope columns on the existing table (the "event envelope").
alter table hiring_submissions
  add column if not exists organization_id   uuid references organizations(id),
  add column if not exists event_type        text not null default 'candidate_experience_reported',
  add column if not exists source            text not null default 'candidate_form',
  add column if not exists producer          text not null default 'anonymous_candidate',
  add column if not exists privacy_class     text not null default 'public',
  add column if not exists occurred_precision text not null default 'bucket',
  add column if not exists retracted_at      timestamptz,
  add column if not exists superseded_by     uuid references hiring_submissions(id),
  add column if not exists rejection_reason  text;

-- 3. Invariant guards (single-valued today; widen the IN-lists in Phase 4).
do $$ begin
  alter table hiring_submissions add constraint hs_event_type_chk
    check (event_type in ('candidate_experience_reported'));
  alter table hiring_submissions add constraint hs_source_chk
    check (source in ('candidate_form'));
  alter table hiring_submissions add constraint hs_producer_chk
    check (producer in ('anonymous_candidate'));
  alter table hiring_submissions add constraint hs_privacy_chk
    check (privacy_class in ('public','internal_only'));   -- +employer_private in Phase 4
  alter table hiring_submissions add constraint hs_precision_chk
    check (occurred_precision in ('bucket','exact','synthetic'));
exception when duplicate_object then null; end $$;

-- 4. Read-path indexes.
create index if not exists hiring_submissions_org_idx
  on hiring_submissions (organization_id);
-- The HQS/company-page hot path: published rows for one company.
create index if not exists hiring_submissions_company_published_idx
  on hiring_submissions (company) where is_approved;

-- Rollback (non-destructive):
--   drop index if exists hiring_submissions_company_published_idx;
--   drop index if exists hiring_submissions_org_idx;
--   alter table hiring_submissions
--     drop constraint if exists hs_precision_chk, drop constraint if exists hs_privacy_chk,
--     drop constraint if exists hs_producer_chk, drop constraint if exists hs_source_chk,
--     drop constraint if exists hs_event_type_chk;
--   alter table hiring_submissions
--     drop column if exists rejection_reason, drop column if exists superseded_by,
--     drop column if exists retracted_at, drop column if exists occurred_precision,
--     drop column if exists privacy_class, drop column if exists producer,
--     drop column if exists source, drop column if exists event_type,
--     drop column if exists organization_id;
--   drop table if exists organizations;
```

### 5.1 Application changes to pair with the migration

1. **`lifecycleState(row)` helper** (new, pure) — the §2.2 function; reuse everywhere lifecycle is shown.
2. **Claim predicates + confidence** — extract the §3.1 predicates from `hqs.ts` into a shared module; compute `(org, claim) → single|corroborated` in the same read that builds the company page.
3. **Leak fix** — stop selecting exact `created_at` into public row payloads in `browse/page.tsx` and the home feed; expose a coarsened `reported_month`.
4. **Payment suppression** — hide the payment-risk signal publicly until its claim is `corroborated`.
5. **Reject/retract** — write `rejection_reason`; retract sets `retracted_at`.
6. **Submit** — resolve or create an `organizations` row (the mvp-roadmap #2 "did you mean?" dedup) and set `organization_id`.

No existing `.eq("is_approved", true)` query needs to change; lifecycle is derived on top of them.

---

## 6. Explicitly postponed until after product-market fit

- `verified` confidence level + `claim_verifications` state + admin UI (the only confidence piece needing stored state).
- `payload JSONB` (first Phase-4 addition, when a second `event_type` needs it).
- `occurred_at` / exact time / ATS producers / `employer_private` privacy class.
- `hiring_processes` and any case/thread identity.
- Physical `ALTER TABLE hiring_submissions RENAME TO hiring_events` (cosmetic).
- Predictive analytics, employer tooling, workflow automation.

## 7. Architectural traps to avoid

1. **Storing confidence** → builds an update pipeline you don't need. Derive on read.
2. **Moving typed facts into JSONB** → a rewrite that discards CHECK constraints and breaks `hqs.ts`. Keep facts typed.
3. **A parallel `hiring_events` table + data migration** → churn with no value. Evolve the existing table.
4. **Confidence-weighting the HQS arithmetic** → the forbidden scoring rabbit hole. Confidence governs visibility/language only.
5. **One axis for lifecycle + confidence** (the original draft) → couples two independent things. Keep them separate.
6. **A candidate hash "just for dedup"** → the seductive de-anonymizer. Never.
7. **Publishing exact per-row `created_at`** → the live fingerprint leak. Coarsen at the boundary.

---

*This ADR is the canonical foundation for CandidateVoice's trust model. Corroboration, moderation, HQS, and future ATS ingestion are extensions of the Evidence object defined here — not separate systems.*
