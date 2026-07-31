/**
 * Interview Forecast — the plain-language reduction of the behavioural
 * fingerprint into "what will actually happen to me if I apply here".
 *
 * WHY THIS EXISTS
 * The fingerprint renders `Ghosting 76`. A candidate cannot act on that. The
 * engine already computed the thing they actually want — the ghost RATE — and
 * then the UI inverted it into an abstract higher-is-better score and threw the
 * probability away. This module hands the probability back.
 *
 * It is a REDUCTION, exactly like utils/hqs.ts: it computes nothing new, adds
 * no data source, and reaches into no table. Every number here is already on
 * the MetricResult the Evidence Engine produced.
 *
 * WHAT IS DELIBERATELY ABSENT
 * A forecast is only as honest as its inputs. These were specified in the
 * product brief and are NOT here, because the evidence to support them does
 * not exist:
 *   - Expected total timeline in days. `responseTimeBucket` measures days to
 *     FIRST response, not application-to-offer. Presenting it as "expected
 *     timeline" would be a fabrication.
 *   - Expected number of rounds. `stage` records the furthest stage reached,
 *     which is not a round count.
 *   - Take-home / weekend work / negotiation friendliness. No field collects them.
 *   - Emotional fingerprint and manager behaviour. Family B (submission_ratings,
 *     submission_emotions) has a write path but no collection UI, so it holds
 *     zero rows.
 *   - Preparation advice ("prepare for SQL"). That is generated text, which
 *     ADR-0001 forbids outright — every claim must trace to a source.
 * Adding any of them means collecting the evidence first, not inferring it.
 */

import type { EvidenceItem } from "@/lib/evidence";
import type { BehaviouralFingerprint, BehaviouralDimensionKey } from "./behavioural";

/** Higher is worse for these — used to pick the tone ramp direction. */
const RISK_DIMENSIONS: ReadonlySet<BehaviouralDimensionKey> = new Set([
  "ghosting",
  "payment_risk",
]);

export type ForecastTone = "good" | "warn" | "bad" | "neutral";

export interface ForecastLine {
  key: string;
  /** Written as an outcome that happened to people, not as a metric name. */
  label: string;
  /** Pre-formatted for display, e.g. "24%" or "4–7 days". Null when suppressed. */
  value: string | null;
  /** The evidence behind it, e.g. "12 of 50 reports". Null when suppressed. */
  basis: string | null;
  tone: ForecastTone;
  /** Present only when `value` is null: why this line cannot be shown. */
  unavailableReason: string | null;
}

/**
 * Tone for a rate, given whether high values are bad. Thresholds are product
 * judgements, named here rather than buried in JSX so they can be argued with.
 */
function rateTone(rate: number, higherIsWorse: boolean): ForecastTone {
  const bad = higherIsWorse ? rate >= 0.25 : rate <= 0.15;
  const warn = higherIsWorse ? rate >= 0.1 : rate <= 0.4;
  if (bad) return "bad";
  if (warn) return "warn";
  return "good";
}

function pct(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function reportsBasis(numerator: number, denominator: number): string {
  return `${numerator} of ${denominator} ${denominator === 1 ? "report" : "reports"}`;
}

/** Human phrasing for why a line is missing, from the engine's own reason codes. */
function suppressionCopy(reason: string | null): string {
  if (reason === "uncorroborated") return "Needs corroboration from a second source";
  if (reason === "no_coverage") return "Not reported yet";
  return "Not enough reports yet";
}

/** One line per rate-shaped dimension, phrased as an outcome. */
function rateLine(
  fingerprint: BehaviouralFingerprint,
  key: BehaviouralDimensionKey,
  label: string
): ForecastLine {
  const dim = fingerprint.dimensions.find((d) => d.key === key);
  if (!dim || dim.suppressed || dim.metric.value === null) {
    return {
      key,
      label,
      value: null,
      basis: null,
      tone: "neutral",
      unavailableReason: suppressionCopy(dim?.suppressionReason ?? null),
    };
  }
  // metric.value is the underlying RATE for every rate-shaped dimension —
  // the exact number the score was computed from, handed back un-inverted.
  const rate = dim.metric.value;
  return {
    key,
    label,
    value: pct(rate),
    basis: reportsBasis(dim.metric.rawNumerator, dim.metric.rawDenominator),
    tone: rateTone(rate, RISK_DIMENSIONS.has(key)),
    unavailableReason: null,
  };
}

const RESPONSE_BUCKET_LABELS: Record<string, string> = {
  "0-3": "within 3 days",
  "4-7": "in 4–7 days",
  "8-14": "in 8–14 days",
  "15+": "after 15+ days",
};

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied",
  screening: "Screening",
  technical: "Technical",
  hr: "HR round",
  final: "Final round",
};

/**
 * Modal value of a field across items, by WEIGHT — so a pile of low-trust
 * external reports cannot outvote first-party evidence on "what's typical",
 * consistent with how every other number on the page is computed.
 */
function weightedMode(items: EvidenceItem[], pick: (i: EvidenceItem) => string | null): { value: string; count: number; total: number } | null {
  const weights = new Map<string, number>();
  const counts = new Map<string, number>();
  let total = 0;
  for (const item of items) {
    const v = pick(item);
    if (v === null) continue;
    weights.set(v, (weights.get(v) ?? 0) + item.weight);
    counts.set(v, (counts.get(v) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  let best: string | null = null;
  let bestWeight = -1;
  for (const [v, w] of weights) {
    if (w > bestWeight) {
      bestWeight = w;
      best = v;
    }
  }
  // Every candidate came from a non-null pick, so `best` is set whenever
  // total > 0 — but a zero-weight-everywhere set (full sunset) leaves
  // bestWeight at 0, which is still a legitimate mode by raw count.
  if (best === null) return null;
  return { value: best, count: counts.get(best) ?? 0, total };
}

/** Minimum reports before a "typical" distribution line is shown at all. */
export const FORECAST_MIN_REPORTS_FOR_MODE = 3;

function modeLine(
  items: EvidenceItem[],
  key: string,
  label: string,
  pick: (i: EvidenceItem) => string | null,
  labels: Record<string, string>
): ForecastLine {
  const mode = weightedMode(items, pick);
  if (mode === null || mode.total < FORECAST_MIN_REPORTS_FOR_MODE) {
    return {
      key,
      label,
      value: null,
      basis: null,
      tone: "neutral",
      unavailableReason: mode === null ? "Not reported yet" : "Not enough reports yet",
    };
  }
  return {
    key,
    label,
    value: labels[mode.value] ?? mode.value,
    basis: reportsBasis(mode.count, mode.total),
    tone: "neutral",
    unavailableReason: null,
  };
}

/**
 * The forecast, in the order a candidate actually asks the questions:
 * will they ghost me, will I get an offer, will they tell me why, how fast do
 * they move, how far do people get, will they ask me for money.
 */
export function buildForecast(
  fingerprint: BehaviouralFingerprint,
  items: EvidenceItem[]
): ForecastLine[] {
  return [
    rateLine(fingerprint, "ghosting", "Went silent after contact"),
    rateLine(fingerprint, "offer_probability", "Received an offer"),
    rateLine(fingerprint, "transparency", "Were told why they were rejected"),
    modeLine(items, "response_time", "Usually heard back", (i) => i.responseTimeBucket, RESPONSE_BUCKET_LABELS),
    modeLine(items, "furthest_stage", "Most reached", (i) => i.stage, STAGE_LABELS),
    rateLine(fingerprint, "payment_risk", "Were asked to pay"),
  ];
}

/** True when at least one line has a real value — decides whether to render the panel. */
export function hasAnyForecast(lines: ForecastLine[]): boolean {
  return lines.some((l) => l.value !== null);
}
