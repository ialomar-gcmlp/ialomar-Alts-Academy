/**
 * A small line chart that breaks at gaps.
 *
 * Separate from `Chart` because `ChartSpec` cannot express a missing value, and the
 * missing values are the point: a day with nothing answered has no accuracy, and
 * drawing it as zero would claim everything was wrong. So nulls break the line into
 * segments rather than dipping through the floor.
 *
 * Scales proportionally (`xMidYMid meet`). Stretching it to fill a container turns
 * the markers into ellipses and would distort the axis labels with them.
 *
 * Hover detail is per-point via `<title>`, which is enough at this size and needs no
 * tooltip layer.
 */

const VIEW = { w: 640, h: 104 };
const PAD = { top: 10, right: 10, bottom: 20, left: 40 };

export interface SparkPoint {
  label: string;
  /** Null where there is no value for this slot — the line breaks. */
  value: number | null;
  /** Extra hover detail, e.g. "8 of 10 correct". */
  detail?: string;
}

export function Sparkline({
  points,
  min = 0,
  max = 1,
  color = "var(--p-accent)",
  band,
  format = (v) => `${Math.round(v * 100)}%`,
  ariaLabel,
}: {
  points: SparkPoint[];
  min?: number;
  max?: number;
  color?: string;
  /** Optional shaded reference band, e.g. a pass mark up to 100%. */
  band?: { from: number; to: number };
  format?: (value: number) => string;
  ariaLabel?: string;
}) {
  const filled = points.filter((point) => point.value !== null);

  if (filled.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-fg-subtle">
        Nothing answered in this window yet.
      </p>
    );
  }

  const x = (i: number): number =>
    points.length <= 1
      ? (PAD.left + VIEW.w - PAD.right) / 2
      : PAD.left + (i / (points.length - 1)) * (VIEW.w - PAD.left - PAD.right);

  const y = (value: number): number => {
    const t = max === min ? 0.5 : (value - min) / (max - min);
    return VIEW.h - PAD.bottom - t * (VIEW.h - PAD.top - PAD.bottom);
  };

  // Runs of consecutive non-null points, so a gap stays a gap.
  const runs: { i: number; value: number; point: SparkPoint }[][] = [];
  let run: { i: number; value: number; point: SparkPoint }[] = [];
  points.forEach((point, i) => {
    if (point.value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ i, value: point.value, point });
  });
  if (run.length > 0) runs.push(run);

  const ticks = [max, (min + max) / 2, min];
  const first = filled[0];
  const last = filled[filled.length - 1];

  return (
    <svg
      viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
      className="w-full"
      role="img"
      aria-label={ariaLabel}
      preserveAspectRatio="xMidYMid meet"
    >
      {band !== undefined && (
        <rect
          x={PAD.left}
          y={y(band.to)}
          width={VIEW.w - PAD.left - PAD.right}
          height={Math.max(0, y(band.from) - y(band.to))}
          fill="var(--p-correct)"
          opacity={0.08}
        />
      )}

      {/* Gridlines and the scale they mean. Without labels the height of a point
          carries no information at all. */}
      {ticks.map((tick, i) => (
        <g key={i}>
          <line
            x1={PAD.left}
            x2={VIEW.w - PAD.right}
            y1={y(tick)}
            y2={y(tick)}
            stroke="var(--p-border-base)"
            strokeWidth={1}
            strokeDasharray={i === 1 ? "3 4" : undefined}
          />
          <text
            x={PAD.left - 6}
            y={y(tick) + 3.5}
            textAnchor="end"
            fontSize={10}
            fill="var(--p-fg-subtle)"
          >
            {format(tick)}
          </text>
        </g>
      ))}

      {runs.map((segment, s) => (
        <polyline
          key={s}
          points={segment.map(({ i, value }) => `${x(i)},${y(value)}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}

      {points.map((point, i) =>
        point.value === null ? null : (
          <circle key={i} cx={x(i)} cy={y(point.value)} r={2.75} fill={color}>
            <title>{`${point.label}: ${format(point.value)}${point.detail === undefined ? "" : ` (${point.detail})`}`}</title>
          </circle>
        ),
      )}

      {/* Only the ends are labelled on the x-axis: one date per day would be a wall
          of text, and the ends are what tell you which way time runs. */}
      {first !== undefined && (
        <text
          x={PAD.left}
          y={VIEW.h - 5}
          fontSize={10}
          fill="var(--p-fg-subtle)"
          textAnchor="start"
        >
          {points[0]?.label}
        </text>
      )}
      {last !== undefined && (
        <text
          x={VIEW.w - PAD.right}
          y={VIEW.h - 5}
          fontSize={10}
          fill="var(--p-fg-subtle)"
          textAnchor="end"
        >
          {points[points.length - 1]?.label}
        </text>
      )}
    </svg>
  );
}
