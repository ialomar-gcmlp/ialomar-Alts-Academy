/**
 * Lesson block renderers — one per block type in the content schema.
 *
 * Adding a block type means adding a case here and a variant in the Zod schema.
 * Nothing else in the app needs to know about it.
 *
 * Visual restraint is deliberate (CLAUDE.md §8): only the blocks that genuinely
 * change the reader's mode get a label and a rule. Concept prose is just prose.
 */

import type { LessonBlock } from "../../content/schema";
import { Callout } from "../primitives";
import { Chart } from "../charts/Chart";
import { Formula } from "../Formula";
import { Inline, Prose } from "../Prose";

export function LessonBlockView({ block }: { block: LessonBlock }) {
  switch (block.type) {
    case "concept":
      return <Prose text={block.body} />;

    case "intuition":
      return (
        <Callout label="Why this is true" tone="accent">
          <Prose text={block.body} />
        </Callout>
      );

    case "pitfall":
      return (
        <Callout label="Common mistake" tone="flag">
          <Prose text={block.body} />
        </Callout>
      );

    case "onTheJob":
      return (
        <Callout label="On the job" tone="neutral">
          <Prose text={block.body} />
        </Callout>
      );

    case "analogy":
      return (
        <Callout label="Another way to see it" tone="neutral">
          <Prose text={block.body} />
        </Callout>
      );

    case "formula":
      return (
        <div className="my-6 rounded-lg border border-border-base bg-surface-2 p-4">
          <Formula latex={block.latex} className="mb-3 overflow-x-auto" />
          <p className="max-w-measure text-[15px] leading-relaxed text-fg-muted">
            <Inline text={block.plainReading} />
          </p>
          {block.variables !== undefined && block.variables.length > 0 && (
            <dl className="mt-4 space-y-1.5 border-t border-border-base pt-3 text-[14px]">
              {block.variables.map((v) => (
                <div key={v.symbol} className="flex gap-3">
                  <dt className="min-w-16 shrink-0">
                    <Formula latex={v.symbol} display={false} className="inline-block" />
                  </dt>
                  <dd className="text-fg-muted">
                    <Inline text={v.meaning} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      );

    case "example":
      return (
        <div className="my-6">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            Worked example
          </div>
          <Prose text={block.body} />
          <ol className="mt-3 max-w-measure space-y-2.5">
            {block.walkthrough.map((step, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[11px] font-medium text-fg-muted tnum">
                  {i + 1}
                </span>
                <span className="leading-relaxed">
                  <Inline text={step} />
                </span>
              </li>
            ))}
          </ol>
        </div>
      );

    case "table":
      return (
        <figure className="my-6">
          <table className="w-full border-collapse text-[14px]">
            <caption className="mb-2 text-left text-[13px] text-fg-muted">
              {block.caption}
            </caption>
            <thead>
              <tr className="border-b border-border-strong text-left">
                {block.headers.map((h) => (
                  <th key={h} scope="col" className="py-2 pr-4 align-bottom font-medium text-fg">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i} className="border-b border-border-base align-top">
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={`py-2 pr-4 leading-relaxed ${j === 0 ? "font-medium text-fg" : "text-fg-muted"}`}
                    >
                      <Inline text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </figure>
      );

    case "chart":
      return (
        <div>
          <Chart spec={block.spec} ariaLabel={block.caption} />
          <p className="-mt-3 max-w-measure text-[13px] text-fg-muted">{block.caption}</p>
          {block.annotation !== undefined && (
            <p className="mt-2 max-w-measure text-[14px] leading-relaxed text-fg-muted">
              <Inline text={block.annotation} />
            </p>
          )}
        </div>
      );

    case "keyTakeaways":
      return (
        <div className="my-6 rounded-lg border border-border-base bg-surface-2 p-5">
          <div className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-accent">
            Worth remembering
          </div>
          <ul className="max-w-measure space-y-2">
            {block.items.map((item, i) => (
              <li key={i} className="flex gap-2.5 leading-relaxed">
                <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                <span>
                  <Inline text={item} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
  }
}

export function Lesson({ blocks }: { blocks: LessonBlock[] }) {
  return (
    <div className="space-y-5">
      {blocks.map((block, i) => (
        <LessonBlockView key={block.id ?? `${block.type}-${i}`} block={block} />
      ))}
    </div>
  );
}
