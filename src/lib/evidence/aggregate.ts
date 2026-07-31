/**
 * Evidence Engine — aggregation primitives. PURE. This is the entire
 * aggregation API (ADR-0002 Part 2): every downstream metric — Fingerprint,
 * HQS, Analytics, Search ranking — is expressed as a call into one of the
 * three functions below over a predicate/accessor. Nothing in this file
 * knows what "ghosting" or "HQS" means; product meaning lives entirely in
 * the predicates callers supply.
 */

import type { EvidenceItem, EvidenceBase, MetricResult } from "./types";

/**
 * Kish effective sample size: (Σw)² / Σw². The basis of every suppression
 * decision in this engine (ADR-0002 Part 4) because raw counts overstate the
 * information content of down-weighted evidence. Worked example: 10 items at
 * w=1 plus 50 at w=0.084 → Σw=14.2, Σw²=10.35 → effectiveN≈19.5, not 60.
 *
 * Guards Σw===0 explicitly (not just relying on Σw² also being 0) so this
 * never divides 0/0 — the all-zero-weight case (e.g. full external sunset)
 * must resolve to exactly 0, not NaN.
 */
export function kishEffectiveN(weights: number[]): number {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return 0;
  const sumSquares = weights.reduce((s, w) => s + w * w, 0);
  return (sum * sum) / sumSquares;
}

interface RawMetricInputs {
  rawNumerator: number;
  rawDenominator: number;
  weightedNumerator: number;
  weightedDenominator: number;
  coverage: number;
  effectiveN: number;
  minEffectiveN: number;
}

/**
 * The suppression gate, in ONE place so weightedRate, weightedMean, and
 * weightedShare (built on weightedRate) all apply it identically.
 *
 * Order matters:
 *   1. rawDenominator === 0        → no_coverage   (nothing eligible at all)
 *   2. weightedDenominator === 0   → no_coverage   (eligible evidence exists
 *      but carries zero total weight — e.g. only external rows survived
 *      filtering and the global multiplier is 0)
 *   3. effectiveN < minEffectiveN  → insufficient_evidence
 *   4. otherwise                   → value = weightedNumerator / weightedDenominator
 *
 * Step 2 MUST run before step 3: minEffectiveN defaults to 0, and effectiveN
 * is never negative, so "effectiveN < 0" never trips — without an explicit
 * zero-weight check, that case would fall through to computing 0/0 and
 * silently render NaN as a score.
 */
function gate(inputs: RawMetricInputs): MetricResult {
  const { rawNumerator, rawDenominator, weightedNumerator, weightedDenominator, coverage, effectiveN, minEffectiveN } = inputs;
  const base = { weightedNumerator, weightedDenominator, rawNumerator, rawDenominator, coverage };

  if (rawDenominator === 0) {
    return { ...base, value: null, suppressed: true, suppressionReason: "no_coverage" };
  }
  if (weightedDenominator === 0) {
    return { ...base, value: null, suppressed: true, suppressionReason: "no_coverage" };
  }
  if (effectiveN < minEffectiveN) {
    return { ...base, value: null, suppressed: true, suppressionReason: "insufficient_evidence" };
  }
  return { ...base, value: weightedNumerator / weightedDenominator, suppressed: false };
}

export interface WeightedRateOptions {
  /** Does this item have the fields the metric needs at all? Decides the denominator. */
  eligible: (item: EvidenceItem) => boolean;
  /** Among eligible items, does this one count toward the numerator? */
  hit: (item: EvidenceItem) => boolean;
  /** effectiveN floor below which the result is suppressed. Default 0 (no gate). */
  minEffectiveN?: number;
}

/**
 * Σ(weight of hits) / Σ(weight of eligible) — the entire rate formula
 * (ADR-0002 Part 2), with raw counts and coverage carried alongside so a UI
 * can render e.g. "18% ghosted · 42.6 weighted from 97 reports" from one call.
 * `coverage` is measured against ALL items passed in, not just the eligible
 * subset — it exists to surface field asymmetry (W1), not to hide it.
 */
export function weightedRate(items: EvidenceItem[], options: WeightedRateOptions): MetricResult {
  const { eligible, hit, minEffectiveN = 0 } = options;
  const eligibleItems = items.filter(eligible);
  const hitItems = eligibleItems.filter(hit);

  return gate({
    rawNumerator: hitItems.length,
    rawDenominator: eligibleItems.length,
    weightedNumerator: hitItems.reduce((s, i) => s + i.weight, 0),
    weightedDenominator: eligibleItems.reduce((s, i) => s + i.weight, 0),
    coverage: items.length > 0 ? eligibleItems.length / items.length : 0,
    effectiveN: kishEffectiveN(eligibleItems.map((i) => i.weight)),
    minEffectiveN,
  });
}

/**
 * Weighted average of a numeric accessor over items where it's defined.
 * Items where `value` returns null are excluded entirely — never coerced to
 * a placeholder score (this is the fix for the latent `|| 50` defect:
 * an unrecognized bucket must shrink coverage, not score as neutral).
 * `rawNumerator`/`rawDenominator` are the same computation at weight=1, so a
 * caller can compare the unweighted mean against the weighted one.
 */
export function weightedMean(
  items: EvidenceItem[],
  value: (item: EvidenceItem) => number | null,
  minEffectiveN = 0
): MetricResult {
  const withValue = items
    .map((item) => ({ item, v: value(item) }))
    .filter((x): x is { item: EvidenceItem; v: number } => x.v !== null);

  return gate({
    rawNumerator: withValue.reduce((s, x) => s + x.v, 0),
    rawDenominator: withValue.length,
    weightedNumerator: withValue.reduce((s, x) => s + x.item.weight * x.v, 0),
    weightedDenominator: withValue.reduce((s, x) => s + x.item.weight, 0),
    coverage: items.length > 0 ? withValue.length / items.length : 0,
    effectiveN: kishEffectiveN(withValue.map((x) => x.item.weight)),
    minEffectiveN,
  });
}

/**
 * Weighted distribution over a key's distinct observed values — e.g. stage
 * analysis (Part 5). Values are discovered from the evidence itself (never a
 * hardcoded enum list), each backed by an independent weightedRate call so
 * every slice carries its own coverage/suppression rather than inheriting one
 * from the whole.
 */
export function weightedShare<K extends string>(
  items: EvidenceItem[],
  key: (item: EvidenceItem) => K | null,
  minEffectiveN = 0
): Record<K, MetricResult> {
  const values = new Set<K>();
  for (const item of items) {
    const v = key(item);
    if (v !== null) values.add(v);
  }

  const eligible = (item: EvidenceItem) => key(item) !== null;
  const result = {} as Record<K, MetricResult>;
  for (const v of values) {
    result[v] = weightedRate(items, { eligible, hit: (item) => key(item) === v, minEffectiveN });
  }
  return result;
}

function monthIndex(yyyymm: string): number {
  const [y, m] = yyyymm.split("-").map(Number);
  return y * 12 + m;
}

/**
 * Confidence, DERIVED (ADR-0002 W3) — every field computed from the evidence
 * passed in. Callable over an entire EvidenceSet or over a per-dimension
 * eligible subset (Family A's DimensionScore.base) — it has no notion of
 * "the whole company," only of whatever item array it's given.
 */
export function describeBase(items: EvidenceItem[]): EvidenceBase {
  const rawTotal = items.length;
  const weightedTotal = items.reduce((s, i) => s + i.weight, 0);

  const firstPartyItems = items.filter((i) => i.family === "first_party");
  const externalItems = items.filter((i) => i.family === "external");
  const firstPartyRaw = firstPartyItems.length;
  const firstPartyWeighted = firstPartyItems.reduce((s, i) => s + i.weight, 0);
  const externalRaw = externalItems.length;
  const externalWeighted = externalItems.reduce((s, i) => s + i.weight, 0);

  const firstPartyProportion = weightedTotal > 0 ? firstPartyWeighted / weightedTotal : 0;

  // Zero-weight sources (e.g. external at multiplier=0) aren't "speaking" in
  // any way that affects a rendered number, so they don't count as diversity
  // either — consistent with firstPartyProportion being measured by weight.
  const sourceDiversity = new Set(items.filter((i) => i.weight > 0).map((i) => i.sourceKey)).size;

  const months = items
    .map((i) => i.reportedMonth)
    .filter((m): m is string => m !== null)
    .sort();
  const earliestMonth = months.length > 0 ? months[0] : null;
  const latestMonth = months.length > 0 ? months[months.length - 1] : null;
  const monthsSpanned = earliestMonth !== null && latestMonth !== null ? monthIndex(latestMonth) - monthIndex(earliestMonth) + 1 : 0;

  const effectiveN = kishEffectiveN(items.map((i) => i.weight));

  return {
    rawTotal,
    weightedTotal,
    firstPartyRaw,
    firstPartyWeighted,
    externalRaw,
    externalWeighted,
    firstPartyProportion,
    sourceDiversity,
    monthsSpanned,
    earliestMonth,
    latestMonth,
    effectiveN,
  };
}
