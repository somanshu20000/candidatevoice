/**
 * Recruitment Process Intelligence (D-031).
 *
 * A SEPARATE fingerprint object from src/lib/fingerprint/behavioural.ts, not
 * a 7th/8th entry folded into it — deliberately. The behavioural fingerprint
 * inverts every dimension onto one "higher is always better" 0..100 axis
 * (see behavioural.ts's own comment on this). That framing is a value
 * judgment, and this module's whole point is to NOT make one: it reports
 * plain RATES — what share of eligible reports say X happened — and stops
 * there. Whether a given rate is good, bad, or illegal is a separate,
 * explicitly sourced interpretation layer that does not exist yet (see
 * DECISIONS.md D-031). Do not invert these into a "score" without re-reading
 * that decision.
 *
 * Same engine as everywhere else: every metric here is weightedRate over the
 * Evidence Engine's primitives (aggregate.ts), reduced from the SAME
 * EvidenceItem stream behavioural.ts and compensation.ts already consume —
 * no parallel aggregation path (D-001).
 */

import type { EvidenceItem, EvidenceSet, EvidenceBase, EvidenceFamily, MetricResult } from "@/lib/evidence";
import { weightedRate, describeBase, kishEffectiveN } from "@/lib/evidence";

/** effectiveN floor to render at all — same bar as behavioural.ts's dimensions (ADR-0002 Part 4). */
export const RECRUITMENT_INTEL_MIN_EFFECTIVE_N = 3;

/** Sensitive-info-request corroboration bar, same reasoning and same value as
 *  Payment Risk (behavioural.ts): a single accusation must never render alone. */
export const SENSITIVE_INFO_MIN_SOURCES = 2;

export type RecruitmentIntelMetricKey = "profile_research_rate" | "sensitive_info_request_rate";

export const RECRUITMENT_INTEL_METRIC_KEYS: readonly RecruitmentIntelMetricKey[] = [
  "profile_research_rate",
  "sensitive_info_request_rate",
];

export const RECRUITMENT_INTEL_METRIC_LABELS: Record<RecruitmentIntelMetricKey, string> = {
  profile_research_rate: "Profile research rate",
  sensitive_info_request_rate: "Sensitive-information request rate",
};

export type RecruitmentIntelSuppressionReason = "no_coverage" | "insufficient_evidence" | "uncorroborated";

/**
 * One metric's result. `rate` is a plain 0..1 share, NEVER inverted and
 * NEVER relabelled as a "score" — see this file's header. `metric`/`base` are
 * computed from the ELIGIBLE items for this metric only, matching
 * behavioural.ts's BehaviouralDimensionScore contract exactly.
 */
export interface RecruitmentIntelMetric {
  key: RecruitmentIntelMetricKey;
  label: string;
  /** 0..1, or null when suppressed. A plain share — "38% of reports with an
   *  answer said X" — not a good/bad axis. */
  rate: number | null;
  metric: MetricResult;
  base: EvidenceBase;
  families: EvidenceFamily[];
  suppressed: boolean;
  suppressionReason: RecruitmentIntelSuppressionReason | null;
}

export interface RecruitmentIntelFingerprint {
  metrics: RecruitmentIntelMetric[];
  base: EvidenceBase;
}

function familiesContributing(items: EvidenceItem[], eligible: (item: EvidenceItem) => boolean): EvidenceFamily[] {
  const set = new Set<EvidenceFamily>();
  for (const item of items) if (eligible(item)) set.add(item.family);
  return [...set];
}

function distinctContributingSources(items: EvidenceItem[], eligible: (item: EvidenceItem) => boolean): number {
  return new Set(items.filter((i) => eligible(i) && i.weight > 0).map((i) => i.sourceKey)).size;
}

interface MetricShape {
  key: RecruitmentIntelMetricKey;
  eligible: (item: EvidenceItem) => boolean;
  hit: (item: EvidenceItem) => boolean;
  minEffectiveN?: number;
  extraGate?: (items: EvidenceItem[]) => RecruitmentIntelSuppressionReason | null;
}

function evaluate(items: EvidenceItem[], shape: MetricShape): RecruitmentIntelMetric {
  const { key, eligible, hit, minEffectiveN = RECRUITMENT_INTEL_MIN_EFFECTIVE_N, extraGate } = shape;
  const metric = weightedRate(items, { eligible, hit, minEffectiveN });
  const eligibleItems = items.filter(eligible);
  const base = describeBase(eligibleItems);
  const families = familiesContributing(items, eligible);

  const engineSuppression = metric.suppressed ? (metric.suppressionReason ?? "no_coverage") : null;
  const suppressionReason = engineSuppression ?? extraGate?.(items) ?? null;
  const suppressed = suppressionReason !== null;

  return {
    key,
    label: RECRUITMENT_INTEL_METRIC_LABELS[key],
    rate: suppressed ? null : metric.value,
    metric,
    base,
    families,
    suppressed,
    suppressionReason,
  };
}

/**
 * Share of outreach-answering reports where the candidate said the recruiter
 * had reviewed their profile and the role was relevant. Answers two of the
 * brief's four outreach questions at once ("did they review my profile" /
 * "was it relevant") — the other two ("obvious mismatch") are the same
 * denominator's complement, not a second metric.
 */
function profileResearchRate(items: EvidenceItem[]): RecruitmentIntelMetric {
  return evaluate(items, {
    key: "profile_research_rate",
    eligible: (i) => i.reporterType === "candidate" && i.outreachQuality !== null,
    hit: (i) => i.outreachQuality === "profile_reviewed_relevant",
  });
}

/**
 * Share of candidates who answered the question and reported ANY sensitive
 * document/information request (Aadhaar, PAN, bank details, salary slips, or
 * other) — not gated by stage or purpose-explained, which are separate,
 * unaggregated facts on the same items (see DECISIONS.md D-031 for what is
 * deliberately not built yet: an early-ID-request-rate metric that also
 * reads sensitiveInfoStage). Same OR-corroboration gate as Payment Risk:
 * a single report must never surface as a company-level rate.
 */
function sensitiveInfoRequestRate(items: EvidenceItem[]): RecruitmentIntelMetric {
  const eligible = (i: EvidenceItem) => i.reporterType === "candidate" && i.sensitiveInfoRequested !== null;
  return evaluate(items, {
    key: "sensitive_info_request_rate",
    eligible,
    hit: (i) => i.sensitiveInfoRequested !== null && i.sensitiveInfoRequested !== "none",
    minEffectiveN: 0, // the OR-gate below replaces the engine's own floor, same as Payment Risk
    extraGate: (all) => {
      const sources = distinctContributingSources(all, eligible);
      const effectiveN = kishEffectiveN(all.filter(eligible).map((i) => i.weight));
      if (sources >= SENSITIVE_INFO_MIN_SOURCES) return null;
      if (effectiveN >= RECRUITMENT_INTEL_MIN_EFFECTIVE_N) return null;
      return "uncorroborated";
    },
  });
}

/**
 * Build the Recruitment Process Intelligence fingerprint from an EvidenceSet.
 * Always returns both metrics in fixed order — a company with zero evidence
 * gets two suppressed metrics, never a hidden metric.
 */
export function buildRecruitmentIntelFingerprint(evidenceSet: EvidenceSet): RecruitmentIntelFingerprint {
  const { items, base } = evidenceSet;
  return {
    metrics: [profileResearchRate(items), sensitiveInfoRequestRate(items)],
    base,
  };
}
