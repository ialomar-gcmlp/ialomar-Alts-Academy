/**
 * Line and bar charts, hand-rolled SVG.
 *
 * No charting library (CLAUDE.md §3): chart-read questions need full control of the
 * series, and Recharts/Chart.js would be the largest dependency in the app.
 *
 * Follows the dataviz conventions:
 *  - series colours assigned 1→4 in fixed order from the validated palette, never cycled
 *  - 2px lines, >=8px markers, recessive grid and axes
 *  - a legend whenever there are 2+ series, plus direct labels at the last point
 *  - identity never by colour alone: a table view is always available
 *  - hover crosshair and tooltip by default
 *  - one y-axis, always. Never a second scale.
 */

import { useId, useMemo, useState } from "react";

import type { ChartSpec } from "../../content/schema";

const SERIES_CLASSES = [
  "text-series-1",
  "text-series-2",
  "text-series-3",
  "text-series-4",
] as const;

const PAD = { top: 16, right: 56, bottom: 32, left: 48 };
const VIEW = { w: 640, h: 280 };

interface Scale {
  min: number;
  max: number;
  ticks: number[];
}

function niceScale(values: number[], zeroBaseline: boolean): Scale {
  const finite = values.filter(Number.isFinite);
  let lo = Math.min(...finite);
  let hi = Math.max(...finite);

  if (zeroBaseline) lo = Math.min(0, lo);
  if (lo === hi) {
    // A flat series still needs a visible band, or it renders on the axis line.
    lo -= 1;
    hi += 1;
  }

  const span = hi - lo;
  const rawStep = span / 4;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? magnitude * 10;

  const min = Math.floor(lo / step) * step;
  const max = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) {
    // Re-round to kill floating point dust like 4.300000000000001.
    ticks.push(Number(v.toFixed(10)));
  }

  return { min, max, ticks };
}

function formatValue(v: number, unit?: string): string {
  const abs = Math.abs(v);
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
  const text = v.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
  return unit === undefined ? text : `${text}${unit}`;
}

export function Chart({ spec, ariaLabel }: { spec: ChartSpec; ariaLabel?: string }) {
  const titleId = useId();
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<number | null>(null);

  const zeroBaseline = spec.zeroBaseline ?? spec.kind === "bar";
  const scale = useMemo(
    () => niceScale(spec.series.flatMap((s) => s.values), zeroBaseline),
    [spec.series, zeroBaseline],
  );

  const plotW = VIEW.w - PAD.left - PAD.right;
  const plotH = VIEW.h - PAD.top - PAD.bottom;

  const y = (v: number): number =>
    PAD.top + plotH - ((v - scale.min) / (scale.max - scale.min)) * plotH;

  const n = spec.xLabels.length;
  // Lines sit on the category boundaries; bars sit centred in bands.
  const x = (i: number): number =>
    spec.kind === "line"
      ? PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW)
      : PAD.left + ((i + 0.5) / n) * plotW;

  const bandW = plotW / n;
  const groupW = bandW * 0.7;
  const barW = Math.max(2, groupW / spec.series.length - 2); // 2px surface gap between bars

  const multi = spec.series.length > 1;

  return (
    <figure className="my-6">
      <div className="rounded-lg border border-border-base bg-surface p-3">
        <svg
          viewBox={`0 0 ${VIEW.w} ${VIEW.h}`}
          className="w-full"
          role="img"
          aria-labelledby={titleId}
          onMouseLeave={() => setHover(null)}
        >
          <title id={titleId}>{ariaLabel ?? "Chart"}</title>

          {/* Recessive grid */}
          <g className="text-grid" stroke="currentColor" strokeWidth={1}>
            {scale.ticks.map((t) => (
              <line key={t} x1={PAD.left} x2={PAD.left + plotW} y1={y(t)} y2={y(t)} />
            ))}
          </g>

          {/* Zero line, when zero is inside the plotted range and is not the floor */}
          {scale.min < 0 && scale.max > 0 && (
            <line
              x1={PAD.left}
              x2={PAD.left + plotW}
              y1={y(0)}
              y2={y(0)}
              className="text-axis"
              stroke="currentColor"
              strokeWidth={1.5}
            />
          )}

          {/* Axes labels */}
          <g className="fill-current text-axis" fontSize={11}>
            {scale.ticks.map((t) => (
              <text key={t} x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                {formatValue(t, spec.yUnit)}
              </text>
            ))}
            {spec.xLabels.map((label, i) => (
              <text key={label + i} x={x(i)} y={VIEW.h - PAD.bottom + 18} textAnchor="middle">
                {label}
              </text>
            ))}
          </g>

          {/* Hover crosshair */}
          {hover !== null && spec.kind === "line" && (
            <line
              x1={x(hover)}
              x2={x(hover)}
              y1={PAD.top}
              y2={PAD.top + plotH}
              className="text-axis"
              stroke="currentColor"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
          )}

          {/* Marks */}
          {spec.series.map((series, si) => {
            const colour = SERIES_CLASSES[si % SERIES_CLASSES.length] ?? SERIES_CLASSES[0];

            if (spec.kind === "line") {
              const d = series.values
                .map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(v).toFixed(2)}`)
                .join(" ");
              const lastValue = series.values[series.values.length - 1];

              return (
                <g key={series.name} className={colour}>
                  <path d={d} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" />
                  {series.values.map((v, i) => (
                    <circle
                      key={i}
                      cx={x(i)}
                      cy={y(v)}
                      r={hover === i ? 5 : 4}
                      fill="currentColor"
                      // 2px surface ring so overlapping series stay distinguishable
                      className="stroke-surface"
                      strokeWidth={2}
                    />
                  ))}
                  {/* Direct label — identity without relying on the legend */}
                  {lastValue !== undefined && (
                    <text
                      x={PAD.left + plotW + 8}
                      y={y(lastValue) + 4}
                      fontSize={11}
                      className="fill-current"
                    >
                      {series.name}
                    </text>
                  )}
                </g>
              );
            }

            return (
              <g key={series.name} className={colour}>
                {series.values.map((v, i) => {
                  const groupLeft = x(i) - groupW / 2;
                  const left = groupLeft + si * (barW + 2);
                  const top = Math.min(y(v), y(0));
                  const height = Math.abs(y(v) - y(0));
                  return (
                    <rect
                      key={i}
                      x={left}
                      y={top}
                      width={barW}
                      height={Math.max(1, height)}
                      rx={2}
                      fill="currentColor"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* Hover hit targets, larger than the marks */}
          {spec.xLabels.map((_, i) => (
            <rect
              key={i}
              x={spec.kind === "line" ? x(i) - bandW / 2 : PAD.left + i * bandW}
              y={PAD.top}
              width={bandW}
              height={plotH}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>

        {/* Tooltip, rendered as HTML below the plot so it can never be clipped */}
        <div className="mt-1 min-h-[1.75rem] px-1 text-[13px]" aria-live="polite">
          {hover !== null && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium text-fg tnum">{spec.xLabels[hover]}</span>
              {spec.series.map((s, si) => (
                <span key={s.name} className="flex items-center gap-1.5 text-fg-muted">
                  <span
                    aria-hidden
                    className={`inline-block h-2 w-2 rounded-full bg-current ${SERIES_CLASSES[si % SERIES_CLASSES.length]}`}
                  />
                  {multi && <span>{s.name}</span>}
                  <span className="tnum text-fg">{formatValue(s.values[hover] ?? 0, spec.yUnit)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-4">
        {/* Legend for 2+ series. A single series is named by the caption instead. */}
        {multi ? (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-fg-muted">
            {spec.series.map((s, si) => (
              <li key={s.name} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className={`inline-block h-2.5 w-2.5 rounded-sm bg-current ${SERIES_CLASSES[si % SERIES_CLASSES.length]}`}
                />
                {s.name}
              </li>
            ))}
          </ul>
        ) : (
          <span />
        )}

        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="shrink-0 text-[13px] text-fg-subtle underline decoration-dotted underline-offset-2 hover:text-fg"
          aria-expanded={showTable}
        >
          {showTable ? "Hide data" : "View as table"}
        </button>
      </div>

      {showTable && (
        <table className="mt-3 w-full border-collapse text-[13px]">
          <caption className="sr-only">{ariaLabel ?? "Chart data"}</caption>
          <thead>
            <tr className="border-b border-border-strong text-left">
              <th scope="col" className="py-1.5 pr-3 font-medium text-fg-muted">
                {spec.yLabel ?? "Series"}
              </th>
              {spec.xLabels.map((label, i) => (
                <th key={label + i} scope="col" className="py-1.5 pr-3 font-medium text-fg-muted">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.series.map((s) => (
              <tr key={s.name} className="border-b border-border-base">
                <th scope="row" className="py-1.5 pr-3 text-left font-normal text-fg">
                  {s.name}
                </th>
                {s.values.map((v, i) => (
                  <td key={i} className="py-1.5 pr-3 text-fg-muted tnum">
                    {formatValue(v, spec.yUnit)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </figure>
  );
}
