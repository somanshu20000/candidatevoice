/**
 * The explanation layer — readable prose over the deterministic outputs.
 *
 * Part 7 of the brief asks for a natural-language explanation. It is produced
 * here by TEMPLATE, not by an LLM: every sentence is assembled from numbers that
 * already exist in the FitResult / CompromiseMatrix, so nothing is invented,
 * nothing needs a validation pass, and there is no model, key, or cost. This
 * honours CLAUDE.md #6 ("no generated text, no AI summaries") while still giving
 * the reader plain English.
 *
 * The one discipline every function here keeps: no number appears in the output
 * that was not passed in. tests/advisor-explain.test.ts enforces exactly that by
 * extracting every integer from the output and checking it against the inputs.
 */

import { PREFERENCE_DIMENSION_LABELS } from "./preferences";
import type { CompromiseMatrix } from "./compromise";
import type { FitResult, PreferenceDimensionKey } from "./types";

export interface Explanation {
  /** One paragraph. */
  summary: string;
  /** 3-5 supporting bullets. */
  bullets: string[];
}

const TIER_PHRASE: Record<string, string> = {
  best: "a strong match",
  good: "a reasonable match",
  stretch: "a stretch",
  avoid: "a poor match",
};

function labelList(keys: PreferenceDimensionKey[]): string {
  const labels = keys.map((k) => PREFERENCE_DIMENSION_LABELS[k]);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

/**
 * Explain a fit result for one company. When the fit is suppressed the summary
 * says why (never a number); otherwise it states the score, tier, and the
 * evidence behind it, and the bullets name the specific strengths and risks —
 * each with the company's own dimension score — plus an honest note about any
 * priorities that cannot be measured.
 */
export function explainFit(fit: FitResult, companyName: string): Explanation {
  if (fit.score === null) {
    const reason =
      fit.suppressionReason === "no_weighted_dimensions"
        ? `None of the priorities you rated can be measured from hiring reports about ${companyName} yet, so there is nothing to score. Rate a priority like interview speed, ghosting, or transparency to get a fit.`
        : `There aren't enough reports about ${companyName} yet to assess how well it fits your priorities. This is a "not enough data" result, not a low score.`;
    return { summary: reason, bullets: [] };
  }

  const tier = fit.tier ?? "avoid";
  const effN = Math.round(fit.base.effectiveN);
  const summary =
    `${companyName} looks like ${TIER_PHRASE[tier]} for your priorities — a fit of ${fit.score} out of 100, ` +
    `based on ${fit.base.rawTotal} ${fit.base.rawTotal === 1 ? "report" : "reports"} ` +
    `(${effN} effective after weighting).`;

  const bullets: string[] = [];

  for (const key of fit.strengths.slice(0, 2)) {
    const c = fit.contributions.find((x) => x.key === key);
    if (c && c.companyScore !== null) {
      bullets.push(`Strength: ${c.label} is one of your top priorities, and this company scores ${c.companyScore} on it.`);
    }
  }
  for (const key of fit.risks.slice(0, 2)) {
    const c = fit.contributions.find((x) => x.key === key);
    if (c && c.companyScore !== null) {
      bullets.push(`Watch out: ${c.label} matters a lot to you, but this company scores only ${c.companyScore} there.`);
    }
  }

  const notMeasured = fit.contributions.filter((c) => c.status === "not_measured").map((c) => c.key);
  if (notMeasured.length > 0) {
    bullets.push(
      `${notMeasured.length} of your priorities (${labelList(notMeasured)}) can't be measured from hiring reports yet — we don't guess them.`
    );
  }

  const insufficient = fit.contributions.filter((c) => c.status === "company_insufficient").map((c) => c.key);
  if (insufficient.length > 0 && bullets.length < 5) {
    bullets.push(
      `${companyName} doesn't have enough reports yet to score ${labelList(insufficient)}, so ${insufficient.length === 1 ? "it was" : "they were"} left out of the fit.`
    );
  }

  return { summary, bullets: bullets.slice(0, 5) };
}

/**
 * Explain the compromise matrix — the "what are you giving up / gaining" prose.
 * Each clause cites the company's score against the market mean, both from the
 * matrix. Returns an empty-but-honest explanation when nothing rated is
 * comparable to the market.
 */
export function explainCompromise(matrix: CompromiseMatrix, companyName: string): Explanation {
  const bullets: string[] = [];

  for (const key of matrix.gaining.slice(0, 2)) {
    const row = matrix.rows.find((r) => r.key === key);
    if (row && row.companyScore !== null && row.marketMean !== null) {
      bullets.push(`You gain on ${row.label}: ${companyName} scores ${row.companyScore}, above the market's ${Math.round(row.marketMean)}.`);
    }
  }
  for (const key of matrix.givingUp.slice(0, 2)) {
    const row = matrix.rows.find((r) => r.key === key);
    if (row && row.companyScore !== null && row.marketMean !== null) {
      bullets.push(`You give up on ${row.label}: ${companyName} scores ${row.companyScore}, below the market's ${Math.round(row.marketMean)}.`);
    }
  }

  let summary: string;
  if (matrix.gaining.length === 0 && matrix.givingUp.length === 0) {
    summary = `On the priorities you care most about, ${companyName} is broadly in line with the market — no standout trade-offs either way from the evidence available.`;
  } else {
    const gainTxt = matrix.gaining.length ? `does better than the market on ${labelList(matrix.gaining)}` : "";
    const giveTxt = matrix.givingUp.length ? `worse on ${labelList(matrix.givingUp)}` : "";
    const joined = [gainTxt, giveTxt].filter(Boolean).join(", and ");
    summary = `For your top priorities, ${companyName} ${joined}.`;
  }

  return { summary, bullets };
}
