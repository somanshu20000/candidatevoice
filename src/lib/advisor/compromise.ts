/**
 * The Compromise engine — the trade-off matrix a candidate reads to decide.
 *
 * For every priority the user weighted it places three things side by side:
 * how much you care, how this company does, and how the market does. From that
 * it derives the honest headline: on the things you care about, what are you
 * GIVING UP here versus companies in general, and what do you GAIN.
 *
 * Pure. Every band traces to a fingerprint dimension score; a priority nothing
 * measures (Family B) is shown as "not yet measured," never banded — the same
 * discipline the fit engine and the whole product hold.
 */

import type { BehaviouralFingerprint } from "@/lib/fingerprint/behavioural";
import { PREFERENCE_DIMENSION_KEYS, PREFERENCE_DIMENSION_LABELS, PREFERENCE_TO_EVIDENCE } from "./preferences";
import type { MarketBaseline } from "./baseline";
import type { FitDimensionStatus, PreferenceDimensionKey, PreferenceVector } from "./types";
import { HIGH_PRIORITY_WEIGHT } from "./fit";

export type Band = "high" | "medium" | "low";

/** 0-100 "higher is better" score → band. Thresholds exported for tests/UI. */
export const BAND_THRESHOLDS = { high: 66, medium: 33 } as const;

export function bandFor(score: number): Band {
  if (score >= BAND_THRESHOLDS.high) return "high";
  if (score >= BAND_THRESHOLDS.medium) return "medium";
  return "low";
}

/** Points a company must beat the market mean by before we call it above/below (avoids noise). */
export const MARKET_MARGIN = 5;

export type VsMarket = "above" | "at" | "below";

export interface CompromiseRow {
  key: PreferenceDimensionKey;
  label: string;
  /** 1-5. */
  yourPriority: number;
  status: FitDimensionStatus;
  companyScore: number | null;
  companyBand: Band | null;
  marketMean: number | null;
  marketBand: Band | null;
  /** How this company compares to the market for this dimension. Null unless both are known. */
  vsMarket: VsMarket | null;
}

export interface CompromiseMatrix {
  rows: CompromiseRow[];
  /** High-priority dimensions where this company is below the market — the cost of choosing it. */
  givingUp: PreferenceDimensionKey[];
  /** High-priority dimensions where this company beats the market — the payoff. */
  gaining: PreferenceDimensionKey[];
}

function normalizeWeight(raw: number | undefined): number | null {
  if (raw === undefined || !Number.isFinite(raw)) return null;
  const rounded = Math.round(raw);
  return rounded >= 1 ? Math.min(rounded, 5) : null;
}

function compareToMarket(companyScore: number, marketMean: number): VsMarket {
  if (companyScore >= marketMean + MARKET_MARGIN) return "above";
  if (companyScore <= marketMean - MARKET_MARGIN) return "below";
  return "at";
}

/**
 * Build the compromise matrix for one company against a market baseline.
 * Includes every dimension the user weighted, in display order, each with an
 * honest status so the UI never has to guess whether a blank cell means
 * "average" or "unknown."
 */
export function buildCompromiseMatrix(
  vector: PreferenceVector,
  fingerprint: BehaviouralFingerprint,
  baseline: MarketBaseline
): CompromiseMatrix {
  const dimByKey = new Map(fingerprint.dimensions.map((d) => [d.key, d]));
  const rows: CompromiseRow[] = [];
  const givingUp: PreferenceDimensionKey[] = [];
  const gaining: PreferenceDimensionKey[] = [];

  for (const key of PREFERENCE_DIMENSION_KEYS) {
    const weight = normalizeWeight(vector[key]);
    if (weight === null) continue;

    const evidenceKey = PREFERENCE_TO_EVIDENCE[key];
    const label = PREFERENCE_DIMENSION_LABELS[key];

    // Family B — nothing measures this.
    if (evidenceKey === null) {
      rows.push({ key, label, yourPriority: weight, status: "not_measured", companyScore: null, companyBand: null, marketMean: null, marketBand: null, vsMarket: null });
      continue;
    }

    // The market column can be known even when THIS company is not.
    const market = baseline[evidenceKey];
    const marketMean = market?.mean ?? null;
    const marketBand = marketMean !== null ? bandFor(marketMean) : null;

    const dim = dimByKey.get(evidenceKey);
    if (!dim || dim.suppressed || dim.score === null) {
      rows.push({ key, label, yourPriority: weight, status: "company_insufficient", companyScore: null, companyBand: null, marketMean, marketBand, vsMarket: null });
      continue;
    }

    const companyScore = dim.score;
    const vsMarket = marketMean !== null ? compareToMarket(companyScore, marketMean) : null;
    rows.push({ key, label, yourPriority: weight, status: "scored", companyScore, companyBand: bandFor(companyScore), marketMean, marketBand, vsMarket });

    if (weight >= HIGH_PRIORITY_WEIGHT && vsMarket === "below") givingUp.push(key);
    if (weight >= HIGH_PRIORITY_WEIGHT && vsMarket === "above") gaining.push(key);
  }

  return { rows, givingUp, gaining };
}
