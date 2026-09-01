/**
 * The case a vignette sub-question belongs to: stem, exhibits, and where in the set
 * the current question sits.
 *
 * Rendered above the question rather than folded into it, because the case is shared
 * state: walking sub-questions 1→4, the panel stays put while the question below it
 * changes, which is how a paper exam reads. When a lone sub comes back in a review
 * session weeks later, the same panel is what makes the question answerable at all.
 *
 * Tables get real <th>/<caption> markup — they are data, not layout — and charts
 * reuse the app's Chart with all its dataviz rules.
 */

import type { VignetteContext, VignetteExhibit } from "../../content/flatten";
import { Chart } from "../charts/Chart";
import { Icon } from "../icons";
import { Prose } from "../Prose";

export function VignettePanel({ context }: { context: VignetteContext }) {
  return (
    <section
      className="mb-5 rounded-lg border border-border-strong bg-surface-2 p-4 sm:p-5"
      aria-label={`Case, question ${context.index} of ${context.total}`}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
          <Icon name="case" size={13} />
          The case
        </span>
        <span className="text-[12px] font-semibold text-fg-muted tnum">
          Question {context.index} of {context.total} on this case
        </span>
      </div>

      <Prose text={context.stem} className="text-[15px]" />

      {context.exhibits.map((exhibit, i) => (
        <Exhibit key={i} exhibit={exhibit} n={i + 1} />
      ))}
    </section>
  );
}

function Exhibit({ exhibit, n }: { exhibit: VignetteExhibit; n: number }) {
  return (
    <div className="mt-4 rounded-md border border-border-base bg-surface p-3.5">
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
        Exhibit {n} — {exhibit.title}
      </div>

      {exhibit.kind === "text" && <Prose text={exhibit.body} className="text-[14px]" />}

      {exhibit.kind === "table" && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13.5px] tnum">
            <thead>
              <tr>
                {exhibit.headers.map((header, i) => (
                  <th
                    key={i}
                    scope="col"
                    className="border-b border-border-strong py-1.5 pr-4 text-[11.5px] font-bold uppercase tracking-wide text-fg-muted"
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {exhibit.rows.map((row, i) => (
                <tr key={i} className="border-b border-border-base last:border-b-0">
                  {row.map((cell, j) => (
                    <td key={j} className="py-1.5 pr-4 align-top text-fg">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {exhibit.kind === "chart" && (
        <Chart spec={exhibit.spec} ariaLabel={exhibit.title} />
      )}
    </div>
  );
}
