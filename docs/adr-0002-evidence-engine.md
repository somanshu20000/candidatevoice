# ADR-0002 — The Unified Evidence Engine and its downstream surfaces

**Status:** Accepted · implemented (M0–M7) · shipped
**Supersedes:** the count-based `calculateHQS(HiringSubmission[])` in `src/utils/hqs.ts`
**Depends on:** [ADR-0001](adr-0001-evidence-model.md) (Evidence model); migrations `0003` (fingerprint model + `public_submissions`), `0008`–`0009` (external reports + provenance), `0011` (`platform_settings`), `0012` (organization backfill), `0013` (`submit_hiring_report` RPC)
**Scope:** the single path from a stored row to every user-facing number — the Evidence Engine, the Fingerprint, HQS, Analytics, the company page IA, and search ranking. The trust model (ADR-0001), ingestion, moderation, and weighting *policy* are not reopened.

---

## Context

By mid-2026 the infrastructure was ~90% built and consumed by almost nothing. Ingestion, normalization, provenance, moderation, and the policy-driven weighting engine (`src/lib/hiring-intel/weighting.ts`) were complete and unit-tested — but `weighting.ts` was wired into zero aggregations, and `getGlobalExternalMultiplier` was read only by the admin settings route. Two Postgres views written for exactly this purpose — `public_submissions` (0003) and `public_external_reports` (0009) — were read by **zero application code**. The company page still computed a headline score with a count-based function that scored unknown response buckets as a neutral 50 and could render a bare `0%`/`100%` from a single report.

This ADR promotes a **Unified Evidence Engine** to the one auditable path from a stored row to every rendered number. First-party submissions and approved external reports become a single stream of **weighted evidence items**; every downstream feature — Fingerprint, HQS, Analytics, Search — is a *reduction over that stream*, never a parallel computation.

The central finding that made this cheap: **the two dormant views already are the read model.** `public_submissions` coarsens `created_at` to `reported_month` and filters to approved rows; `public_external_reports` pre-filters to approved+enabled and pre-joins `external_sources`. The engine reads through them and inherits both the anonymity coarsening and the provenance join for free.

---

## 1. The engine as one pipeline

> **Evidence → Filter → Weight → Aggregate → Metrics.** One generic pipeline. It knows nothing about "Reddit" or "ghosting"; product meaning is assigned entirely by the callers that supply predicates.

```
public_submissions   ─┐
(first-party,         │
 already coarsened)   ├─► load → normalize → weight → cap → [EvidenceItem] ─┐
                      │                                                     │
public_external_      │                                                     ▼
reports (approved)   ─┘                          filter → aggregate → MetricResult
                                                                          │
      ┌───────────────┬──────────────┬──────────────┬────────────────────┤
      ▼               ▼              ▼              ▼                    ▼
  Fingerprint        HQS         Analytics     Search ranking      future features
```

### Files (`src/lib/evidence/`)

| File | Responsibility |
|---|---|
| `types.ts` | `EvidenceItem` · `EvidenceBase` · `MetricResult` · `EvidenceSet` |
| `load.ts` | the ONLY file touching Supabase — the two views + org resolution + display/analytics reads |
| `normalize.ts` | raw view rows → `EvidenceItem[]` (pure) |
| `weight.ts` | attaches weight — delegates to `hiring-intel/weighting.ts`, never reimplements the formula |
| `cap.ts` | per-source weighted-share cap (pure) |
| `aggregate.ts` | `weightedRate` / `weightedMean` / `weightedShare` · `kishEffectiveN` · `describeBase` (pure) |
| `analytics.ts` | cross-company grouping + rankings |
| `rank.ts` | search ranking formula (pure) |
| `index.ts` | `loadEvidence(orgRef)` → `EvidenceSet` — the single entry point |

### Invariants (must ALWAYS hold)

1. **No product metric lives in the engine.** `calculateGhostRate()` / `calculateHQS()` do not exist inside `src/lib/evidence`. A metric is a predicate pair (`eligible`, `hit`) supplied by a caller.
2. **Weight is a property of every item, from day one.** First-party is `1.0`; external is the four-factor product. A metric never branches on `family` to decide whether something counts — it counts by weight.
3. **Raw and weighted, always.** Every `MetricResult` carries `rawNumerator/rawDenominator` *and* `weightedNumerator/weightedDenominator`. Weighting policy never erases the honest report count.
4. **Confidence is derived, never invented.** `EvidenceBase` is computed from the evidence itself; no caller needs a confidence value the engine cannot already produce.
5. **Pure core.** Everything except `load.ts` is free of I/O and the clock, so the trust-critical arithmetic is unit-testable without a database.
6. **The sunset invariant.** Setting `global_external_multiplier = 0` must make every metric equal its first-party-only value with no code-path change. This is re-verified at every milestone.

---

## 2. Weighting and the sunset switch

`effective_weight = sourceTrust × extractionConfidence × moderatorConfidence × globalMultiplier`, every factor clamped to `[0,1]`, failing safe to `0`. Because the multiplier is one factor in a product, `globalMultiplier = 0` zeroes all external weight — the entire external-evidence bootstrap turns off with **no migration, no schema change, no special case**. The multiplier is stored in `platform_settings` (business policy, not infrastructure config) and read on every load.

**Kish effective sample size** is the basis of every suppression and confidence decision:

```
effectiveN = (Σ wᵢ)² / Σ wᵢ²
```

10 first-party (w=1) + 50 external (w=0.084) → `effectiveN ≈ 19.5`, not 60. Down-weighted evidence contributes proportionally less information, and the interval reflects it automatically.

### Per-source weighted-share cap (`cap.ts`)

No single **external** source may exceed 50% of a company's total evidence weight (first-party is never capped — it is the reference standard). This is the backstop against "one viral thread" once adapters scale. It composes with sunset (at weight 0 nothing exceeds any cap) and leaves single-source companies alone (nothing to drown out).

---

## 3. Fingerprint v1 — Family A (behavioural)

Six process-behaviour scores, each a reduction over the engine primitives. Cross-family by construction: first-party and external evidence flow through the same predicates with their engine-attached weights.

| Dimension | Score | In HQS? |
|---|---|---|
| **Ghosting** | `100 × (1 − rate)` of `no_response ∧ gap ∈ {15-30, 30+}` | 0.35 |
| **Response Speed** | `weightedMean` of `{0-3:100, 4-7:80, 8-14:50, 15+:20}`; **unknown bucket excluded, never 50** | 0.30 |
| **Transparency** | `100 × rate` of a specific reason (not `no_reason`) | 0.25 |
| **Offer Probability** | `100 × rate` of `outcome === 'offer'` | 0.10 |
| **Process Depth** | `weightedMean` of stage ordinal × 20 | 0 (value-laden) |
| **Payment Risk** | `100 × (1 − rate)` of `paymentFlag`; **corroboration-gated** | 0 (too sensitive) |

**Payment Risk** publishes only with ≥2 distinct sources OR `effectiveN ≥ 3` — a single accusation must never render, and zero-weight sources don't count toward the multi-source rescue (so sunset composes).

**Early Rejection is deliberately not a v1 dimension.** Its only inputs (`call_duration`, `first_interaction_outcome`) don't exist on `external_reports`, so it can't be cross-family. It was dropped from HQS and the composite re-normalized — a visible, deliberate change to existing scores.

**Family B** (the six seeded Likert dimensions) renders `awaiting_source` until data exists. M4 shipped the write path (`submit_hiring_report` RPC); the collection UI is future work.

---

## 4. HQS — one headline, one interval

HQS is a *reduction* of the fingerprint, not a parallel computation:

```
HQS = 0.35·Ghosting + 0.30·ResponseSpeed + 0.25·Transparency + 0.10·OfferProbability
```

Re-normalized across unsuppressed dimensions so a missing term never drags the score. Suppressed below `effectiveN < 5` (returns `null`, never a fake 0). Uncertainty is the **Wilson score interval** on the composite-as-proportion, substituting `effectiveN` for n. Confidence tiers come from `effectiveN` (`<5` insufficient · `5–19` low · `20–49` medium · `≥50` high), replacing the old raw-count 50/20 tiers.

---

## 5. Analytics and search

**Analytics** (`/analytics`, server component): every surface runs each company through the same engine. Only companies above the confidence gate are **ranked**; the rest are listed in "Not yet ranked" — never hidden, never scored. A leaderboard without sample sizes is a defamation surface, so every row shows its base.

**Search ranking** (`rank.ts`):

```
rank = HQS_normalized × confidence_factor × freshness_factor
confidence_factor = min(1, effectiveN / 20)
freshness_factor  = exp(−ln2 × monthsSince(latestMonth) / 12)
```

The load-bearing property: **a well-evidenced 60 outranks a thin 90.** External evidence affects rank only through its weight, so at `multiplier = 0` ranking is first-party-only with no branch. Clock-free — `monthsSince` is computed against a caller-supplied reference month.

---

## 6. The company page IA (`/company/[slug]`)

1. **Identity** — name + imported metadata (structurally disjoint, its own card).
2. **Headline** — HQS + interval + "N effective of M reports", or an honest empty state.
3. **Evidence mix** — `firstPartyProportion` *by weight*, with the caveat that external counts for less. Only when external evidence exists.
4. **Fingerprint** — all six Family A dimensions, each with raw counts and coverage; "not in HQS" tags on the two excluded dimensions.
5. **External reports** — clearly labelled, source-linked, `unverified` badge, visually distinct. Structured facts only, never the original text.

---

## 7. Consequences

- **One auditable path.** Every number on every surface traces to `loadEvidence` → the same primitives. Debugging and moderator tooling read the same raw+weighted pair the UI renders.
- **Existing scores moved.** Dropping Early Rejection and switching to weighted, effectiveN-gated computation changed HQS for existing companies. This is correct (the term was never cross-family computable) but visible.
- **`effectiveN` looks like a bug until explained.** "97 reports → 19 effective" invites pressure to hide it. It is statistically correct; the UI explains it rather than hiding it.
- **Load-all is deferred, not free.** The engine loads all of a company's evidence per request — fine at hundreds, wrong at 100k. The analytics batch loaders cap at 50k rows and **log** when they bite. The rollup migration (materialized `company_metrics`, refreshed on moderation events) is inevitable; it is deferred deliberately, and the engine's purity is what will make that migration safe.

---

## Verification discipline

Every milestone: `npx tsc --noEmit` · `npx vitest run` · `npm run build`, plus live verification against the real Supabase project — including a **sunset regression at every milestone** (`global_external_multiplier = 0` ⇒ every metric equals its first-party-only value). All test data created for live verification is cleaned up in the same session.

---

*Frozen from the M0–M7 implementation. Roadmap and per-milestone acceptance criteria: the plan file that drove this work.*
