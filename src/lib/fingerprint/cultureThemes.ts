/**
 * Culture theme cloud (Phase 4, product-experience audit) — the "closed-enum
 * culture theme visualization" the audit reinterpreted from "word clouds"
 * (see cultureThemeTaxonomy.ts's header for why free text was never on the
 * table). SAME MACHINERY as src/lib/fingerprint/likert.ts's emotionShares:
 * multi-select tags per submission, adapted to weight-1 EvidenceItems
 * (minimalEvidenceItem — first-party by construction, submission_culture_themes
 * FKs only to hiring_submissions) and reduced with the real weightedRate.
 *
 * FLOOR. Reuses CULTURE_MIN_EFFECTIVE_N (culture.ts) — the same anonymity
 * floor the "would you recommend" signal uses, since this is the identical
 * population (employee + former_employee) at the identical re-identification
 * risk. weightedRate's minEffectiveN gates on the FULL respondent pool (every
 * submission that picked at least one theme), so every theme suppresses or
 * renders together, never one theme alone at n=1 while others are hidden —
 * the same behaviour EMOTIONS already has, applied here.
 */

import { weightedRate } from "@/lib/evidence";
import { minimalEvidenceItem } from "@/lib/evidence/synthetic";
import type { EvidenceItem, MetricResult } from "@/lib/evidence";
import type { RawCultureThemeSelection } from "@/lib/evidence/load";
import { CULTURE_THEMES, type CultureThemeKey } from "./cultureThemeTaxonomy";
import { CULTURE_MIN_EFFECTIVE_N } from "./culture";

export interface CultureThemeShare {
  key: CultureThemeKey;
  label: string;
  valence: "positive" | "negative";
  /** Share (0..1) of respondents-who-picked-at-least-one-theme that picked
   *  this one. Null when suppressed (metric.suppressed). */
  metric: MetricResult;
}

/**
 * Build the theme-share list from raw selection rows. Denominator = distinct
 * submissions that selected at least one theme (D-003: null is not no — a
 * submission that answered nothing is not "picked nothing" evidence, it
 * simply isn't in `rows` at all).
 */
export function buildCultureThemeCloud(rows: RawCultureThemeSelection[], organizationId: string): CultureThemeShare[] {
  const bySubmission = new Map<string, Set<CultureThemeKey>>();
  for (const r of rows) {
    const key = r.themeKey as CultureThemeKey;
    const set = bySubmission.get(r.submissionId) ?? new Set<CultureThemeKey>();
    set.add(key);
    bySubmission.set(r.submissionId, set);
  }
  const items = [...bySubmission.keys()].map((id) => minimalEvidenceItem(id, organizationId));
  const themesOf = (i: EvidenceItem) => bySubmission.get(i.id) ?? new Set<CultureThemeKey>();

  return CULTURE_THEMES.map((t) => ({
    key: t.key,
    label: t.label,
    valence: t.valence,
    metric: weightedRate(items, {
      eligible: () => true,
      hit: (i) => themesOf(i).has(t.key),
      minEffectiveN: CULTURE_MIN_EFFECTIVE_N,
    }),
  }));
}

/** Render gate: true when at least one theme cleared its floor. Below that,
 *  the panel must render nothing rather than an empty shell. */
export function hasAnyCultureThemeSignal(themes: CultureThemeShare[]): boolean {
  return themes.some((t) => !t.metric.suppressed);
}
