/**
 * M3.5 — assembling a SearchResult and its explanation (M3 architecture §7).
 *
 * Turns a ranked signal outcome (signal.ts) into the SearchResult contract
 * (types.ts), including a plain-English explanation of WHY the company appeared
 * and HOW strong the evidence is. The explanation is TEMPLATED, never generated
 * (D-006): every number in it is one of the fields passed in, and
 * tests/search-explain.test.ts extracts every integer from the prose and
 * asserts it was an input — the same discipline advisor/explain.ts enforces.
 *
 * Dates are deliberately kept OUT of the prose (they carry digits that would
 * otherwise need to be whitelisted, and reduce to noise in a sentence). The
 * latest-month is on `evidence.base` for the UI to render separately.
 */

import type { SearchResult, SearchDimensionScoreView } from "./types";
import type { SignalRankedCompany } from "./signal";
import type { ParsedSignal } from "./parse";

export const BAND_LABEL = {
  well_evidenced: "Well evidenced",
  limited: "Limited evidence",
  insufficient: "Not enough evidence",
} as const;

/** The weakest-evidenced dimension across a compound result — the one whose
 *  base drives band/confidence (signal.ts takes the same weakest link). */
function weakestDimension(dims: SearchDimensionScoreView[]): SearchDimensionScoreView {
  return dims.reduce((a, b) => (b.base.effectiveN < a.base.effectiveN ? b : a));
}

function familyPhrase(families: string[]): string {
  if (families.length === 0) return "";
  if (families.length === 1 && families[0] === "first_party") return " First-party reports only.";
  if (families.includes("external") && families.includes("first_party")) return " First-party and external reports.";
  if (families.includes("external")) return " External reports only.";
  return "";
}

/**
 * Build one signal-mode SearchResult. `signals` is every dimension the query
 * asked for (a compound AND query has more than one); the primary drives the
 * match display, and the explanation names all of them.
 */
export function buildSignalResult(ranked: SignalRankedCompany, signals: ParsedSignal[]): SearchResult {
  const primary = signals[0];
  const weakest = weakestDimension(ranked.dimensions);

  const rawTotal = ranked.base.rawTotal;
  const effN = Math.round(ranked.base.effectiveN);
  const reportWord = rawTotal === 1 ? "report" : "reports";

  const dimNames = signals.map((s) => s.label);
  const dimList =
    dimNames.length === 1
      ? dimNames[0]
      : dimNames.length === 2
        ? `${dimNames[0]} and ${dimNames[1]}`
        : `${dimNames.slice(0, -1).join(", ")}, and ${dimNames[dimNames.length - 1]}`;

  const searchedTerms = signals.map((s) => `"${s.term}"`).join(", ");
  const bandPhrase =
    ranked.band === "well_evidenced"
      ? " Well evidenced."
      : " Limited evidence — read this as indicative, not a firm conclusion.";
  const calibrationPhrase = ranked.populationCalibrated
    ? ""
    : " Too few comparable companies to rank by peer comparison yet, so this ordering is provisional.";

  const explanation =
    `Matched ${dimList} — you searched ${searchedTerms}. ` +
    `${rawTotal} ${reportWord}, ${effN} effective after weighting.` +
    bandPhrase +
    familyPhrase(ranked.families) +
    calibrationPhrase;

  return {
    organizationId: ranked.company.organizationId,
    slug: ranked.company.slug,
    displayName: ranked.company.displayName,
    mode: "signal",
    match: {
      kind: "signal",
      matchedTerm: signals.map((s) => s.term).join(", "),
      dimension: { key: primary.dimensionKey, label: primary.label, direction: primary.direction },
      entityScore: null,
    },
    evidence: {
      band: ranked.band,
      dimension: weakest,
      base: ranked.base,
      families: ranked.families,
      signalStrength: ranked.signalStrength,
      populationCalibrated: ranked.populationCalibrated,
      confidence: ranked.confidence,
      freshness: ranked.freshness,
    },
    explanation,
  };
}
