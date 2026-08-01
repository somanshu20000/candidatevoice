import Link from "next/link";
import type { FitResult, Explanation, FitTier } from "@/lib/advisor";

/**
 * The "Fit for you" panel on a company page — the advisor's answer to "should
 * *I* apply here," shown when the visitor has saved priorities. Public, like
 * the forecast: the decision support is the product, not the thing we withhold.
 *
 * Presentational only. Everything it shows was computed deterministically
 * upstream (computeFit + explainFit); it invents nothing, and it states plainly
 * when the evidence can't answer.
 */

const TIER_CLS: Record<FitTier, string> = {
  best: "text-good",
  good: "text-ink",
  stretch: "text-warn",
  avoid: "text-bad",
};

const TIER_WORD: Record<FitTier, string> = {
  best: "Strong match",
  good: "Reasonable match",
  stretch: "Stretch",
  avoid: "Poor match",
};

export default function FitForYou({
  fit,
  explanation,
  displayName,
}: {
  fit: FitResult;
  explanation: Explanation;
  displayName: string;
}) {
  return (
    <section className="border border-rule bg-paper-sheet rounded-sm p-6 sm:p-8 mb-8 shadow-sheet">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="font-serif text-xl sm:text-2xl text-ink">Fit for you</h2>
        <Link href="/advisor" className="text-xs text-accent hover:text-accent-hover">
          Adjust your priorities →
        </Link>
      </div>

      {fit.score === null || fit.tier === null ? (
        // Honest empty state — never a fabricated score.
        <p className="text-sm text-ink-soft mt-2">{explanation.summary}</p>
      ) : (
        <>
          <div className="flex items-center gap-4 mt-3 mb-4">
            <span className={`font-serif text-5xl tnum ${TIER_CLS[fit.tier]}`}>{fit.score}</span>
            <div>
              <p className={`text-sm font-medium ${TIER_CLS[fit.tier]}`}>{TIER_WORD[fit.tier]}</p>
              <p className="text-[10px] font-mono text-ink-faint tnum">
                {fit.base.rawTotal} reports · {fit.base.effectiveN.toFixed(1)} effective
              </p>
            </div>
          </div>

          <p className="text-sm text-ink-soft leading-relaxed mb-3">{explanation.summary}</p>

          {explanation.bullets.length > 0 && (
            <ul className="space-y-1.5">
              {explanation.bullets.map((b, i) => (
                <li key={i} className="text-sm text-ink-soft flex gap-2">
                  <span className="text-ink-faint shrink-0">—</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
