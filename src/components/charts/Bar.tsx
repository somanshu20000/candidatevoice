/**
 * A single 0–100 horizontal bar. Zero dependency — inline SVG, styled with the
 * same Tailwind color tokens every other panel already uses (good/warn/bad/
 * accent/rule), the same idiom the logo route (src/app/api/logo) already
 * proves for this app. Not a charting library: one shape, one job.
 *
 * The bar is always an ACCENT alongside a numeric label already rendered by
 * the caller — this component never carries the number on its own (a screen
 * reader gets it from the adjacent text), except via aria-label as a fallback.
 */

const TONE_FILL: Record<NonNullable<BarProps["tone"]>, string> = {
  good: "fill-good",
  warn: "fill-warn",
  bad: "fill-bad",
  neutral: "fill-accent",
};

interface BarProps {
  /** 0..100. null/undefined renders nothing — suppression is the caller's
   *  decision (every dimension already carries its own null-when-suppressed
   *  convention); this component never invents a zero-length bar to stand in
   *  for "no data". */
  value: number | null | undefined;
  tone?: "good" | "warn" | "bad" | "neutral";
  className?: string;
}

export default function Bar({ value, tone = "neutral", className = "" }: BarProps) {
  if (value === null || value === undefined) return null;
  const pct = Math.max(0, Math.min(100, value));
  return (
    <svg
      viewBox="0 0 100 8"
      preserveAspectRatio="none"
      role="img"
      aria-label={`${Math.round(pct)} out of 100`}
      className={`w-full h-2 ${className}`}
    >
      <rect x="0" y="0" width="100" height="8" rx="4" className="fill-rule-strong" />
      {pct > 0 && <rect x="0" y="0" width={pct} height="8" rx="4" className={TONE_FILL[tone]} />}
    </svg>
  );
}
