/**
 * A multi-axis radar/spider chart for comparing several companies across the
 * same dimensions at once — the highest-value visualization gap named in the
 * product-experience audit (Phase 5): /compare already has exactly this
 * multi-axis data (behavioural fingerprint dimensions) with nowhere to show
 * it visually beyond a row of bars.
 *
 * Zero dependency — inline SVG, same idiom as Bar.tsx. Not a charting
 * library: one shape, one job.
 *
 * NEVER FABRICATES A ZERO FOR MISSING DATA. A series with a null value on any
 * plotted axis is dropped from the chart entirely (never pulled to the
 * center) — the same "suppression is real, not a value" discipline every
 * other panel in this codebase already follows. The caller can — and should —
 * separately disclose which companies were dropped and why.
 */

interface RadarSeries {
  key: string;
  label: string;
  /** Tailwind stroke/fill color token, e.g. "text-accent". Applied via
   *  currentColor so one class drives both stroke and fill-with-opacity. */
  colorClass: string;
  /** 0..100, aligned 1:1 with `axes`. null = not measured for this company. */
  values: (number | null)[];
}

interface RadarProps {
  /** Axis labels, in the same order every series' `values` uses. */
  axes: string[];
  series: RadarSeries[];
  size?: number;
}

export default function Radar({ axes, series, size = 260 }: RadarProps) {
  // A radar shape needs at least 3 axes to be a polygon at all.
  if (axes.length < 3) return null;

  // Drop any series missing a value on a plotted axis — never draw a
  // fabricated 0 for "no data" (mirrors Bar's `value === null` → render
  // nothing, one level up: here it's a whole series, not one bar).
  const plottable = series.filter(
    (s) => s.values.length === axes.length && s.values.every((v) => v !== null)
  );
  if (plottable.length === 0) return null;

  const center = size / 2;
  const radius = size / 2 - 28; // leave room for axis labels
  const angleFor = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / axes.length;

  function pointFor(i: number, value: number): [number, number] {
    const r = (Math.max(0, Math.min(100, value)) / 100) * radius;
    const angle = angleFor(i);
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  }

  const gridRings = [25, 50, 75, 100];

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[260px] h-auto" role="img" aria-label="Radar comparison chart">
        {/* Grid rings */}
        {gridRings.map((ring) => (
          <polygon
            key={ring}
            points={axes.map((_, i) => pointFor(i, ring).join(",")).join(" ")}
            className="fill-none stroke-rule"
            strokeWidth={1}
          />
        ))}
        {/* Axis spokes + labels */}
        {axes.map((label, i) => {
          const [x, y] = pointFor(i, 100);
          const [lx, ly] = pointFor(i, 122);
          return (
            <g key={label}>
              <line x1={center} y1={center} x2={x} y2={y} className="stroke-rule" strokeWidth={1} />
              <text
                x={lx}
                y={ly}
                textAnchor="middle"
                dominantBaseline="middle"
                className="fill-ink-muted"
                style={{ fontSize: 9 }}
              >
                {label}
              </text>
            </g>
          );
        })}
        {/* One polygon per plottable series */}
        {plottable.map((s) => (
          <polygon
            key={s.key}
            points={s.values.map((v, i) => pointFor(i, v as number).join(",")).join(" ")}
            className={`${s.colorClass} fill-current fill-opacity-10 stroke-current`}
            strokeWidth={2}
          />
        ))}
      </svg>
      <div className="flex flex-col gap-1.5">
        {plottable.map((s) => (
          <div key={s.key} className="flex items-center gap-2 text-xs">
            <span className={`h-2.5 w-2.5 rounded-full ${s.colorClass} bg-current shrink-0`} />
            <span className="text-ink-soft capitalize">{s.label}</span>
          </div>
        ))}
        {plottable.length < series.length && (
          <p className="text-[10px] text-ink-faint mt-1 max-w-[160px]">
            {series.length - plottable.length} of {series.length} not shown — missing data on at least one axis.
          </p>
        )}
      </div>
    </div>
  );
}
