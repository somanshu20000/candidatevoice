/**
 * Fingerprint v1 — Family A: behavioural dimensions.
 *
 * The six process-behaviour scores rendered on every company page: what the
 * company DOES during hiring, computed from the structured facts on
 * EvidenceItem. Pure, no I/O — takes an EvidenceSet in, returns scores out.
 *
 * Everything here is a REDUCTION over the Evidence Engine's three primitives
 * (weightedRate / weightedMean / weightedShare) and never invents a metric
 * of its own. If a formula would need to look at raw rows directly, the
 * right fix is to add a primitive to aggregate.ts — not to bypass the engine.
 *
 * Cross-family: every dimension here consumes BOTH first-party and approved
 * external evidence in the same call. The engine has already attached the
 * correct weight to each item (first-party 1.0, external the four-factor
 * product), so this file never branches on family — it counts by weight.
 *
 * Family B (the six Likert dimensions in taxonomy.ts) remains
 * `awaiting_source` until M4 wires the submit flow to write facet ratings.
 * That is deliberately NOT a bug shown as a zero — the aggregate.ts pattern
 * `awaiting_source` already established for it is preserved.
 */

import type {
  EvidenceItem,
  EvidenceSet,
  EvidenceBase,
  EvidenceFamily,
  MetricResult,
} from "@/lib/evidence";
import { weightedRate, weightedMean, describeBase, kishEffectiveN } from "@/lib/evidence";

/** effectiveN floor for a dimension to render at all (ADR-0002 Part 4). */
export const DIMENSION_MIN_EFFECTIVE_N = 3;

/** Payment Risk-only corroboration bar — a single accusation must never render. */
export const PAYMENT_RISK_MIN_SOURCES = 2;

/** Mapping from response_time_bucket to a 0..100 speed score.
 *  Faster response → higher score. Buckets not in this map are excluded
 *  from the mean entirely (never coerced to a neutral 50 — the latent
 *  `|| 50` defect this replaces). */
export const RESPONSE_SPEED_SCORES: Record<string, number> = {
  "0-3": 100,
  "4-7": 80,
  "8-14": 50,
  "15+": 20,
};

/** Mapping from stage to an ordinal (applied=1 … final=5). Process Depth is
 *  weightedMean × 20, so `applied` scores 20 and `final` scores 100.
 *  A judgement encoded in the score, not a measurement — Part 10 self-critique. */
export const STAGE_ORDINALS: Record<string, number> = {
  applied: 1,
  screening: 2,
  technical: 3,
  hr: 4,
  final: 5,
};

export type BehaviouralDimensionKey =
  | "ghosting"
  | "response_speed"
  | "process_depth"
  | "offer_probability"
  | "transparency"
  | "payment_risk";

/** Fixed display order — matches every rendering surface. */
export const BEHAVIOURAL_DIMENSION_KEYS: readonly BehaviouralDimensionKey[] = [
  "ghosting",
  "response_speed",
  "process_depth",
  "offer_probability",
  "transparency",
  "payment_risk",
];

export const BEHAVIOURAL_DIMENSION_LABELS: Record<BehaviouralDimensionKey, string> = {
  ghosting: "Ghosting",
  response_speed: "Response Speed",
  process_depth: "Process Depth",
  offer_probability: "Offer Probability",
  transparency: "Transparency",
  payment_risk: "Payment Risk",
};

export type DimensionSuppressionReason =
  | "no_coverage"
  | "insufficient_evidence"
  /** Dimension gate not met (currently only Payment Risk's ≥2-source rule). */
  | "uncorroborated";

/**
 * One dimension's result. `metric` and `base` are exactly what the Evidence
 * Engine produced from the ELIGIBLE items for this dimension (not the whole
 * evidence set) — the honest confidence for this specific number, not the
 * company overall.
 */
export interface BehaviouralDimensionScore {
  key: BehaviouralDimensionKey;
  label: string;
  /** 0..100, or null when suppressed. Higher is always better — Ghosting and
   *  Payment Risk are inverted at the source so the axis is consistent. */
  score: number | null;
  metric: MetricResult;
  base: EvidenceBase;
  /** Which families actually contributed eligible evidence for THIS dimension.
   *  Blank on suppressed dimensions with no eligible items. */
  families: EvidenceFamily[];
  suppressed: boolean;
  suppressionReason: DimensionSuppressionReason | null;
}

export interface BehaviouralFingerprint {
  dimensions: BehaviouralDimensionScore[];
  /** Coarse companion to the EvidenceBase — the set-level view a header renders. */
  base: EvidenceBase;
  /** Threaded through so downstream (HQS) can render "at policy X". */
  globalMultiplier: number;
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function familiesContributing(items: EvidenceItem[], eligible: (item: EvidenceItem) => boolean): EvidenceFamily[] {
  const set = new Set<EvidenceFamily>();
  for (const item of items) if (eligible(item)) set.add(item.family);
  return [...set];
}

/**
 * Distinct sourceKeys of items that actually count (eligible AND carry weight).
 * Used by Payment Risk's corroboration gate — a single-source signal must
 * never publish a "corroborated" fingerprint reading.
 */
function distinctContributingSources(items: EvidenceItem[], eligible: (item: EvidenceItem) => boolean): number {
  return new Set(items.filter((i) => eligible(i) && i.weight > 0).map((i) => i.sourceKey)).size;
}

interface DimensionShape {
  key: BehaviouralDimensionKey;
  eligible: (item: EvidenceItem) => boolean;
  /** Compute the metric — returns both the MetricResult and the raw 0..100 score. */
  compute: (items: EvidenceItem[]) => { metric: MetricResult; score: number | null };
  /** Optional extra suppression gate on top of the engine's own — Payment Risk only. */
  extraGate?: (items: EvidenceItem[], metric: MetricResult) => DimensionSuppressionReason | null;
}

function evaluate(items: EvidenceItem[], shape: DimensionShape): BehaviouralDimensionScore {
  const { key, eligible, compute, extraGate } = shape;
  const { metric, score: rawScore } = compute(items);
  const eligibleItems = items.filter(eligible);
  const base = describeBase(eligibleItems);
  const families = familiesContributing(items, eligible);

  const engineSuppression = metric.suppressed ? (metric.suppressionReason ?? "no_coverage") : null;
  const dimensionSuppression = engineSuppression ?? extraGate?.(items, metric) ?? null;
  const suppressed = dimensionSuppression !== null;

  return {
    key,
    label: BEHAVIOURAL_DIMENSION_LABELS[key],
    score: suppressed ? null : rawScore,
    metric,
    base,
    families,
    suppressed,
    suppressionReason: dimensionSuppression,
  };
}

// -------------------------------------------------------------------------
// The six dimensions
// -------------------------------------------------------------------------

/**
 * Ghosting: `outcome === 'no_response' && lastInteractionGap ∈ {15-30, 30+}`.
 * Both fields exist on external_reports — genuinely cross-family, unlike
 * Early Rejection (ADR-0002 W1). Score = 100 × (1 − rate); higher is better.
 */
function ghosting(items: EvidenceItem[]): BehaviouralDimensionScore {
  const eligible = (i: EvidenceItem) => i.outcome !== null && i.lastInteractionGap !== null;
  return evaluate(items, {
    key: "ghosting",
    eligible,
    compute: (all) => {
      const metric = weightedRate(all, {
        eligible,
        hit: (i) => i.outcome === "no_response" && (i.lastInteractionGap === "15-30" || i.lastInteractionGap === "30+"),
        minEffectiveN: DIMENSION_MIN_EFFECTIVE_N,
      });
      return { metric, score: metric.value === null ? null : 100 * (1 - metric.value) };
    },
  });
}

/**
 * Response Speed: weighted mean of the bucket-score map. Unknown buckets are
 * excluded (never scored as neutral 50) — this is the fix for the latent
 * `|| 50` defect that would silently soften ratings on bad data.
 */
function responseSpeed(items: EvidenceItem[]): BehaviouralDimensionScore {
  const eligible = (i: EvidenceItem) => i.responseTimeBucket !== null;
  return evaluate(items, {
    key: "response_speed",
    eligible,
    compute: (all) => {
      const metric = weightedMean(
        all,
        (i) => (i.responseTimeBucket !== null ? RESPONSE_SPEED_SCORES[i.responseTimeBucket] ?? null : null),
        DIMENSION_MIN_EFFECTIVE_N
      );
      return { metric, score: metric.value };
    },
  });
}

/** Process Depth: weighted mean of stage ordinal × 20 → 20..100. */
function processDepth(items: EvidenceItem[]): BehaviouralDimensionScore {
  const eligible = (i: EvidenceItem) => i.stage !== null;
  return evaluate(items, {
    key: "process_depth",
    eligible,
    compute: (all) => {
      const metric = weightedMean(
        all,
        (i) => (i.stage !== null ? (STAGE_ORDINALS[i.stage] ?? null) : null),
        DIMENSION_MIN_EFFECTIVE_N
      );
      return { metric, score: metric.value === null ? null : metric.value * 20 };
    },
  });
}

/** Offer Probability: rate of `outcome === 'offer'` among eligible submissions. */
function offerProbability(items: EvidenceItem[]): BehaviouralDimensionScore {
  const eligible = (i: EvidenceItem) => i.outcome !== null;
  return evaluate(items, {
    key: "offer_probability",
    eligible,
    compute: (all) => {
      const metric = weightedRate(all, {
        eligible,
        hit: (i) => i.outcome === "offer",
        minEffectiveN: DIMENSION_MIN_EFFECTIVE_N,
      });
      return { metric, score: metric.value === null ? null : 100 * metric.value };
    },
  });
}

/** Transparency: share of eligible reports that carry a specific reason (not `no_reason`). */
function transparency(items: EvidenceItem[]): BehaviouralDimensionScore {
  const eligible = (i: EvidenceItem) => i.reason !== null;
  return evaluate(items, {
    key: "transparency",
    eligible,
    compute: (all) => {
      const metric = weightedRate(all, {
        eligible,
        hit: (i) => i.reason !== "no_reason",
        minEffectiveN: DIMENSION_MIN_EFFECTIVE_N,
      });
      return { metric, score: metric.value === null ? null : 100 * metric.value };
    },
  });
}

/**
 * Payment Risk: rate of paymentFlag === true → 100 × (1 − rate).
 * Corroboration gate (blueprint): suppressed unless
 *   ≥ PAYMENT_RISK_MIN_SOURCES distinct sources OR effectiveN ≥ 3.
 * A single accusation with a big weight must NEVER surface — Payment Risk is
 * the one dimension where a false positive is a genuine reputational injury.
 */
function paymentRisk(items: EvidenceItem[]): BehaviouralDimensionScore {
  // payment_flag is NOT NULL at the DB (migration 0021's note): a tenure report
  // that never answers it still stores `false`. Without this guard that would
  // silently count every employee/former_employee row as "no payment
  // requested" and dilute a candidate-only signal — so eligibility is also
  // restricted to reporter_type === 'candidate', the only relationship this
  // question actually describes.
  const eligible = (i: EvidenceItem) => i.reporterType === "candidate" && i.paymentFlag !== null;
  return evaluate(items, {
    key: "payment_risk",
    eligible,
    compute: (all) => {
      const metric = weightedRate(all, {
        eligible,
        hit: (i) => i.paymentFlag === true,
      });
      return { metric, score: metric.value === null ? null : 100 * (1 - metric.value) };
    },
    extraGate: (all) => {
      // Blueprint: pass if EITHER at least PAYMENT_RISK_MIN_SOURCES distinct
      // sources OR effectiveN ≥ DIMENSION_MIN_EFFECTIVE_N. `weightedRate` has
      // no minEffectiveN of its own on this dimension precisely because the
      // OR-rule replaces it (multi-source can rescue below-threshold effectiveN).
      const sources = distinctContributingSources(all, (i) => i.paymentFlag !== null);
      const eligibleWeights = all.filter((i) => i.paymentFlag !== null).map((i) => i.weight);
      const effectiveN = kishEffectiveN(eligibleWeights);
      if (sources >= PAYMENT_RISK_MIN_SOURCES) return null;
      if (effectiveN >= DIMENSION_MIN_EFFECTIVE_N) return null;
      return "uncorroborated";
    },
  });
}

// -------------------------------------------------------------------------
// Public entry point
// -------------------------------------------------------------------------

/**
 * Build the full behavioural fingerprint from an EvidenceSet.
 * Always returns all six dimensions in fixed order — a company with zero
 * evidence gets six suppressed dimensions, never a hidden dimension.
 */
export function buildBehaviouralFingerprint(evidenceSet: EvidenceSet): BehaviouralFingerprint {
  const { items, base, globalMultiplier } = evidenceSet;
  const dimensions: BehaviouralDimensionScore[] = [
    ghosting(items),
    responseSpeed(items),
    processDepth(items),
    offerProbability(items),
    transparency(items),
    paymentRisk(items),
  ];
  return { dimensions, base, globalMultiplier };
}
