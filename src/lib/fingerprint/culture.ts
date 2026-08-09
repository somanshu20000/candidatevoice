/**
 * Culture — the "would you recommend working here?" signal.
 *
 * WHAT THIS IS (AND ISN'T)
 * The single headline culture signal from people who actually worked at a
 * company — current or former. It is deliberately NARROW: one question, scored
 * as a rate. The sharp culture dimension (harassment / psychological safety)
 * lives in conduct.ts behind a much harder gate; this is the ordinary,
 * positive-framed "would they do it again" read.
 *
 * SAME MACHINERY. A weightedMean over the Evidence Engine, exactly like Process
 * Depth. yes = 100, maybe = 50, no = 0.
 *
 * ── RULES ───────────────────────────────────────────────────────────────────
 *  1. NULL IS NOT "NO". Unanswered is excluded, never scored.
 *  2. WORKED-THERE ONLY. employee + former_employee. A candidate never worked
 *     there and cannot answer whether they'd recommend it.
 *  3. HIGHER FLOOR THAN INTERVIEW METRICS. An employee at a small firm is more
 *     identifiable than an anonymous candidate, so the render floor is above the
 *     ordinary dimension floor of 3.
 *
 * DEFERRED (see adr-0004): the granular sourceType:'employee' Likert facets
 * (leadership, work_culture) need facet rows seeded in the DB and add little
 * over this signal plus conduct.ts. When seeded, they flow through the existing
 * aggregate.ts facet pipeline with no new engine.
 */

import { weightedMean, describeBase } from "@/lib/evidence";
import type { EvidenceItem } from "@/lib/evidence";

/** Employee/former-employee anonymity floor — above the ordinary 3. */
export const CULTURE_MIN_EFFECTIVE_N = 5;

/** Only people who worked there, who answered the recommend question. */
const workedHere = (i: EvidenceItem) =>
  (i.reporterType === "employee" || i.reporterType === "former_employee") && i.wouldRecommend !== null;

const RECOMMEND_SCORE: Record<string, number> = { yes: 100, maybe: 50, no: 0 };

export interface CultureSignal {
  /** 0..100, higher = more would recommend. */
  recommendScore: number;
  /** Weighted share who said an unqualified "yes" (0..1) — the honest headline. */
  recommendShare: number;
  total: number;
  effectiveN: number;
  counts: { yes: number; maybe: number; no: number };
}

/**
 * Compute the culture signal, or null if it must not render (below floor). Null
 * — never a fabricated 0 — when the worked-there evidence is too thin.
 */
export function cultureSignal(items: EvidenceItem[]): CultureSignal | null {
  const eligible = items.filter(workedHere);
  const base = describeBase(eligible);
  if (base.effectiveN < CULTURE_MIN_EFFECTIVE_N) return null;

  const mean = weightedMean(
    items,
    (i) => (workedHere(i) ? RECOMMEND_SCORE[i.wouldRecommend as string] ?? null : null),
    CULTURE_MIN_EFFECTIVE_N
  );
  if (mean.value === null) return null;

  const yes = eligible.filter((i) => i.wouldRecommend === "yes").length;
  return {
    recommendScore: Math.round(mean.value),
    recommendShare: eligible.length ? yes / eligible.length : 0,
    total: eligible.length,
    effectiveN: base.effectiveN,
    counts: {
      yes,
      maybe: eligible.filter((i) => i.wouldRecommend === "maybe").length,
      no: eligible.filter((i) => i.wouldRecommend === "no").length,
    },
  };
}
