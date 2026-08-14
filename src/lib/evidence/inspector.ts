/**
 * M4.3 — Evidence Inspector: turns an EvidenceBase (already computed by
 * every fingerprint module — behavioural.ts, compensation.ts, offboarding.ts)
 * into a plain-English, publicly-safe explanation of why a claim is shown or
 * suppressed. Computes NOTHING new: band/rawTotal/effectiveN/latestMonth are
 * all read straight off the EvidenceBase the caller already has, and
 * `families` is passed through from the dimension score that already carries
 * it (D-001, same machinery). The only new thing here is the explanation
 * template — reusing the pattern src/lib/search/explain.ts already
 * established for M3.5 (templated, D-006, integer-provenance-tested).
 *
 * PRIVACY. EvidenceBase carries counts and a YYYY-MM month, nothing finer —
 * it was already built for public display (every number this module reads is
 * already shown somewhere on the company page). This module adds no field
 * that could identify a contributor: no submission id, no exact timestamp,
 * no moderation actor/reason (moderation_audit_log is a separate, admin-only
 * table this module never touches — see migration 0026).
 */

import type { EvidenceBase, EvidenceFamily } from "./types";
import { CONFIDENCE_SATURATION_N } from "./rank";

export type InspectionBand = "well_evidenced" | "limited" | "insufficient";

export interface EvidenceInspection {
  band: InspectionBand;
  rawTotal: number;
  effectiveN: number;
  families: EvidenceFamily[];
  latestMonth: string | null;
  /** Templated, never generated — every number traces to `base` or `opts`. */
  explanation: string;
}

export interface InspectEvidenceOptions {
  /** The dimension/claim's own suppressed flag — the caller already computed
   *  this (BehaviouralDimensionScore.suppressed etc.); never recomputed here. */
  suppressed: boolean;
  /** The floor this dimension needs to clear, for the "need N+" phrasing. */
  minEffectiveN: number;
  /** Human label for the claim being inspected, e.g. "Ghosting". */
  label: string;
  /** Which families contributed ELIGIBLE evidence to this specific claim
   *  (e.g. BehaviouralDimensionScore.families) — not the same as the
   *  company's whole evidence set, which may include families that didn't
   *  answer this particular question. Empty when nothing rendered. */
  families: EvidenceFamily[];
}

function familyPhrase(families: EvidenceFamily[]): string {
  const hasFirstParty = families.includes("first_party");
  const hasExternal = families.includes("external");
  if (hasFirstParty && hasExternal) return " Combines first-party and external reports.";
  if (hasExternal) return " External reports only.";
  if (hasFirstParty) return " First-party reports only.";
  return "";
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * Assemble the inspection for one claim. Pure — no I/O, no clock read
 * (freshness is left as `base.latestMonth` for the caller to render or
 * compare, exactly like every other consumer of EvidenceBase).
 */
export function inspectEvidence(base: EvidenceBase, opts: InspectEvidenceOptions): EvidenceInspection {
  const effN = Math.round(base.effectiveN * 10) / 10;
  const band: InspectionBand = opts.suppressed
    ? "insufficient"
    : base.effectiveN >= CONFIDENCE_SATURATION_N
      ? "well_evidenced"
      : "limited";

  let explanation: string;
  if (opts.suppressed) {
    if (base.rawTotal === 0) {
      explanation = `No reports collected yet for ${opts.label}.`;
    } else if (base.effectiveN < opts.minEffectiveN) {
      explanation =
        `${plural(base.rawTotal, "report")} collected for ${opts.label}, ${effN} effective after weighting — ` +
        `below the ${opts.minEffectiveN}+ effective reports needed before this can be shown responsibly.`;
    } else {
      // effectiveN already clears the floor, so suppression comes from a
      // different gate (e.g. Payment Risk's distinct-source corroboration
      // requirement) — never claim a numeric floor that's already met.
      explanation =
        `${plural(base.rawTotal, "report")} collected for ${opts.label}, ${effN} effective after weighting — ` +
        `not yet shown because it needs additional corroboration beyond report count alone.`;
    }
  } else {
    explanation =
      `${opts.label} is based on ${plural(base.rawTotal, "report")}, ${effN} effective after weighting.` +
      familyPhrase(opts.families) +
      (band === "well_evidenced" ? " Well evidenced." : " Limited evidence — read this as indicative, not definitive.");
  }

  return {
    band,
    rawTotal: base.rawTotal,
    effectiveN: base.effectiveN,
    families: opts.families,
    latestMonth: base.latestMonth,
    explanation,
  };
}
