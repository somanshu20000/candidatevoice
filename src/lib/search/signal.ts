/**
 * M3.4 — signal retrieval + evidence gating (M3 architecture plan §6).
 *
 * Ranks companies against a hiring-signal query (e.g. "companies that ghost")
 * using ONLY the dimension scores the Evidence/Fingerprint engine already
 * computed (analytics.ts). It defines no metric, no aggregate, and no
 * suppression rule of its own — D-001, "same machinery".
 *
 * THE RANKING IS GATE -> ORDER -> BAND, NEVER `relevance × trust × sufficiency`
 * (M3 §6). Relevance, statistical sufficiency, and freshness are not the same
 * kind of thing, so they are kept in separate mechanisms:
 *
 *   1. GATE (boolean). A company enters the result set only if EVERY requested
 *      dimension RENDERED — i.e. is not suppressed. Suppression is already
 *      effective-N-gated in the fingerprint modules, so this is where "500
 *      low-confidence external mentions must not outrank 30 first-party
 *      observations" is enforced structurally: external items carry fractional
 *      weight, Kish effectiveN stays small, the dimension does not qualify to
 *      make a claim, and the company simply is not a signal result. No tuning
 *      constant — it falls out of machinery that already exists and is tested.
 *
 *   2. ORDER within the gated set. signalStrength × confidenceFactor(effectiveN)
 *      × freshnessFactor(latestMonth). The two factors are imported UNCHANGED
 *      from evidence/rank.ts. Multiplication is legitimate here only because all
 *      three now describe the same thing — how confidently this company exhibits
 *      the queried signal — and each is a bounded 0..1 with a stated meaning.
 *
 *   3. BAND (presentation). well_evidenced (effectiveN ≥ CONFIDENCE_SATURATION_N)
 *      / limited (rendered, below that) / insufficient (never in a signal
 *      result — those companies are simply absent, findable by entity search).
 *      Results are sorted band-first so a thin result never sits above a strong
 *      one (§6 stage 3: "bands never interleave").
 *
 * signalStrength is the company's normalized distance from the population median
 * on the QUERIED side of the dimension. That needs a real population to mean
 * anything; below SIGNAL_MIN_POPULATION companies the median is noise, so
 * ordering falls back to the raw directional score and is flagged
 * populationCalibrated:false — never pretending a peer comparison exists.
 */

import { confidenceFactor, freshnessFactor, CONFIDENCE_SATURATION_N } from "@/lib/evidence";
import type { CompanyAnalytics } from "@/lib/evidence";
import type { EvidenceBase, EvidenceFamily } from "@/lib/evidence";
import type { SearchDimensionKey, SignalDirection, EvidenceBand, SearchDimensionScoreView } from "./types";
import { dimensionLabel } from "./lexicon";

/** Minimum number of companies that must render a dimension before its median
 *  is a meaningful peer baseline. Below this, ordering is raw-directional and
 *  labelled uncalibrated. Same order of magnitude as the effectiveN saturation
 *  point — a deliberately modest bar, documented rather than silently applied. */
export const SIGNAL_MIN_POPULATION = 5;

/** One requested signal — the parser's ParsedSignal, narrowed to what ranking
 *  needs (no display label required as input). */
export interface SignalSpec {
  dimensionKey: SearchDimensionKey;
  direction: SignalDirection;
}

/** The one dimension-score shape ranking needs, shared with the result
 *  contract (types.ts) so a signal result carries the exact object the ranker
 *  gated on. */
type DimScore = SearchDimensionScoreView;

/** Locate a dimension's score on a company, across all three families. Returns
 *  null when the key is not one this company's profiles carry (should not
 *  happen for a valid SearchDimensionKey, but keeps the accessor total). */
export function findDimension(company: CompanyAnalytics, key: SearchDimensionKey): DimScore | null {
  const beh = company.fingerprint.dimensions.find((d) => d.key === key);
  if (beh) {
    return { key, label: beh.label, score: beh.score, base: beh.base, suppressed: beh.suppressed, families: beh.families };
  }
  const comp = company.compensation.dimensions.find((d) => d.key === key);
  if (comp) {
    return { key, label: comp.label, score: comp.score, base: comp.base, suppressed: comp.suppressed, families: [] };
  }
  const off = company.offboarding.dimensions.find((d) => d.key === key);
  if (off) {
    return { key, label: off.label, score: off.score, base: off.base, suppressed: off.suppressed, families: [] };
  }
  return null;
}

/** Median of a non-empty numeric array. Pure. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * signalStrength on the queried side of the median, 0..1. 0 at/against the
 * median, 1 at the far extreme on the queried side; a company on the WRONG side
 * of the median for the query gets 0 (it still appears — evidence-gated — but
 * ranks below any company that actually exhibits the pattern).
 */
function calibratedStrength(score: number, scores: number[], direction: SignalDirection): number {
  const med = median(scores);
  if (direction === "low") {
    const min = Math.min(...scores);
    if (score >= med || med === min) return 0;
    return Math.max(0, Math.min(1, (med - score) / (med - min)));
  }
  const max = Math.max(...scores);
  if (score <= med || max === med) return 0;
  return Math.max(0, Math.min(1, (score - med) / (max - med)));
}

/** Raw directional score, 0..1, used when the population is too thin to
 *  calibrate. "low" query -> lower score is stronger, so invert. */
function rawDirectionalStrength(score: number, direction: SignalDirection): number {
  const norm = Math.max(0, Math.min(1, score / 100));
  return direction === "low" ? 1 - norm : norm;
}

export interface SignalRankedCompany {
  company: CompanyAnalytics;
  /** Per requested signal, the dimension score that gated it in. */
  dimensions: DimScore[];
  band: EvidenceBand;
  signalStrength: number;
  populationCalibrated: boolean;
  confidence: number;
  freshness: number;
  /** The families contributing across all requested dimensions. */
  families: EvidenceFamily[];
  /** The weakest (lowest effectiveN) base across requested dimensions — the
   *  honest "how much evidence backs this whole result". */
  base: EvidenceBase;
}

const BAND_RANK: Record<EvidenceBand, number> = { well_evidenced: 0, limited: 1, insufficient: 2 };

function bandFor(effectiveN: number): EvidenceBand {
  // A gated (rendered) dimension is already ≥ its floor, so it is at least
  // `limited`; `insufficient` never reaches ranking (those companies are absent).
  return effectiveN >= CONFIDENCE_SATURATION_N ? "well_evidenced" : "limited";
}

/**
 * Rank companies for a signal query. Pure and clock-free (caller supplies
 * referenceMonth, same discipline as evidence/rank.ts). Multiple signals are
 * ANDed: a company must render EVERY requested dimension, and its result takes
 * the weakest band / lowest confidence / lowest freshness across them, with
 * signalStrength averaged — the honest "weakest link" reading of a compound query.
 */
export function rankSignalResults(
  companies: CompanyAnalytics[],
  signals: SignalSpec[],
  referenceMonth: string
): SignalRankedCompany[] {
  if (signals.length === 0) return [];

  // GATE: keep only companies where every requested dimension rendered.
  const gated: { company: CompanyAnalytics; dims: DimScore[] }[] = [];
  for (const company of companies) {
    const dims: DimScore[] = [];
    let ok = true;
    for (const sig of signals) {
      const dim = findDimension(company, sig.dimensionKey);
      if (!dim || dim.suppressed || dim.score === null) {
        ok = false;
        break;
      }
      dims.push(dim);
    }
    if (ok) gated.push({ company, dims });
  }
  if (gated.length === 0) return [];

  // Per-dimension population of rendered scores, for calibration.
  const populationByKey = new Map<SearchDimensionKey, number[]>();
  for (const sig of signals) {
    const scores: number[] = [];
    for (const g of gated) {
      const dim = g.dims.find((d) => d.key === sig.dimensionKey);
      if (dim && dim.score !== null) scores.push(dim.score);
    }
    populationByKey.set(sig.dimensionKey, scores);
  }

  const results: SignalRankedCompany[] = gated.map(({ company, dims }) => {
    let strengthSum = 0;
    let calibrated = true;
    let minEffectiveN = Infinity;
    let minFreshness = Infinity;
    let weakestBase = dims[0].base;
    const familySet = new Set<EvidenceFamily>();

    for (const sig of signals) {
      const dim = dims.find((d) => d.key === sig.dimensionKey)!;
      const scores = populationByKey.get(sig.dimensionKey)!;
      const thisCalibrated = scores.length >= SIGNAL_MIN_POPULATION;
      if (!thisCalibrated) calibrated = false;
      strengthSum += thisCalibrated
        ? calibratedStrength(dim.score!, scores, sig.direction)
        : rawDirectionalStrength(dim.score!, sig.direction);

      const fresh = freshnessFactor(dim.base.latestMonth, referenceMonth);
      if (fresh < minFreshness) minFreshness = fresh;
      if (dim.base.effectiveN < minEffectiveN) {
        minEffectiveN = dim.base.effectiveN;
        weakestBase = dim.base;
      }
      for (const f of dim.families) familySet.add(f);
    }

    const confidence = confidenceFactor(minEffectiveN);
    return {
      company,
      dimensions: dims,
      band: bandFor(minEffectiveN),
      signalStrength: strengthSum / signals.length,
      populationCalibrated: calibrated,
      confidence,
      freshness: minFreshness,
      families: [...familySet],
      base: weakestBase,
    };
  });

  // ORDER: band first (so bands never interleave — §6 stage 3), then the
  // composite rank descending within a band.
  return results.sort((a, b) => {
    if (BAND_RANK[a.band] !== BAND_RANK[b.band]) return BAND_RANK[a.band] - BAND_RANK[b.band];
    const ra = a.signalStrength * a.confidence * a.freshness;
    const rb = b.signalStrength * b.confidence * b.freshness;
    if (rb !== ra) return rb - ra;
    return a.company.displayName.localeCompare(b.company.displayName);
  });
}

export { dimensionLabel };
