/**
 * Infographic lesson blocks — the visual explainers inside a topic's reading.
 *
 * Rendered as DOM with the app's SVG icons, never as one big SVG and never as an
 * image, for reasons that were verified before this existed: glossary popovers are
 * HTML (`Inline` cannot live inside SVG <text>), the `.d-*` domain-tint utilities are
 * CSS background/colour (no `fill`), text has to wrap, and columns have to stack at
 * phone width. Being DOM also means the GCM brand tokens and dark mode apply with no
 * work here at all.
 *
 * Every label, bullet and detail is prose — it may carry `[[term]]` refs (popovers
 * work inside a diagram) and `**bold**`. Those fields are walked by collectProse for
 * glossary validation; add a field here and it must be added there (walk.ts's switch
 * is not exhaustiveness-checked — see the schema comment).
 *
 * These render on three surfaces: the topic reading, and the two narrow post-miss
 * re-teach panels (Session and exam review). Everything therefore stacks gracefully
 * in a ~320px column: grids collapse, step arrows rotate, columns pile up.
 */

import type { InfographicSpec } from "../../content/schema";
import { Chart } from "../charts/Chart";
import { Icon, type IconName } from "../icons";
import { Inline } from "../Prose";

/** Icon names come from content as plain strings; render only ones that exist. */
function Pictogram({ name, size = 22 }: { name: string; size?: number }) {
  const known: readonly string[] = [
    "flame", "bolt", "target", "trophy", "check", "cross", "spark", "bulb",
    "alert", "case", "lock", "arrow", "clock", "layers", "coins", "chartUp",
    "docCheck", "gear", "shield",
  ];
  if (!known.includes(name)) return null;
  return <Icon name={name as IconName} size={size} className="d-text" />;
}

/** The numbered badge used by equations and steps — accent pair, measured in M7/M9. */
function NumberBadge({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex h-6 w-6 shrink-0 items-center justify-center bg-accent text-[12.5px] font-bold text-accent-fg tnum"
    >
      {n}
    </span>
  );
}

function OperatorGlyph({ glyph }: { glyph: string }) {
  return (
    <span
      aria-hidden
      className="self-center px-1 text-[26px] font-bold leading-none text-fg-muted"
    >
      {glyph}
    </span>
  );
}

export function Infographic({ spec }: { spec: InfographicSpec }) {
  switch (spec.kind) {
    /* ---------------- equation ---------------- */
    case "equation": {
      const hasPanels = spec.terms.some((t) => t.bullets !== undefined);
      return (
        <div>
          {/* Compact identity strip, always shown — it is the sentence the panels expand. */}
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 bg-accent-soft px-4 py-2.5 text-center">
            {spec.terms.map((term, i) => (
              <span key={i} className="contents">
                {i > 0 && (
                  <span aria-hidden className="text-[17px] font-bold text-fg-muted">
                    {spec.operators[i - 1]}
                  </span>
                )}
                <span className="text-[15.5px] font-bold text-accent">
                  <Inline text={term.label} interactive={false} />
                </span>
              </span>
            ))}
          </div>

          {hasPanels && (
            <div className="mt-3 flex flex-col items-stretch gap-2 sm:flex-row">
              {spec.terms.map((term, i) => (
                <span key={i} className="contents">
                  {i > 0 && <OperatorGlyph glyph={spec.operators[i - 1] ?? ""} />}
                  <div
                    className={`flex-1 border p-3.5 ${
                      i === spec.terms.length - 1
                        ? "d-border d-tint"
                        : "border-border-base bg-surface"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {i < spec.terms.length - 1 && <NumberBadge n={i + 1} />}
                      <div className="min-w-0">
                        <div className="text-[14.5px] font-bold text-fg">
                          <Inline text={term.label} />
                        </div>
                        {term.sublabel !== undefined && (
                          <div className="text-[12.5px] text-fg-muted">
                            <Inline text={term.sublabel} />
                          </div>
                        )}
                      </div>
                    </div>

                    {term.icon !== undefined && (
                      <div className="mt-2.5">
                        <Pictogram name={term.icon} size={26} />
                      </div>
                    )}

                    {term.bullets !== undefined && (
                      <ul className="mt-2.5 space-y-1.5">
                        {term.bullets.map((bullet, j) => (
                          <li
                            key={j}
                            className="flex gap-2 text-[13.5px] leading-relaxed text-fg-muted"
                          >
                            <span aria-hidden className="d-text mt-[7px] h-1 w-1 shrink-0 bg-current" />
                            <span>
                              <Inline text={bullet} />
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </span>
              ))}
            </div>
          )}

          {spec.result !== undefined && (
            <div className="mt-3 bg-accent px-4 py-2.5 text-center text-[14px] font-semibold leading-relaxed text-accent-fg">
              <Inline text={spec.result} interactive={false} />
            </div>
          )}
        </div>
      );
    }

    /* ---------------- steps ---------------- */
    case "steps":
      return (
        <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
          {spec.steps.map((step, i) => (
            <li key={i} className="contents">
              {i > 0 && (
                <span
                  aria-hidden
                  className="self-center text-fg-subtle max-sm:rotate-90 max-sm:self-start max-sm:ml-2.5"
                >
                  <Icon name="arrow" size={16} />
                </span>
              )}
              <div className="flex-1 border border-border-base bg-surface p-3.5">
                <div className="flex items-center gap-2">
                  <NumberBadge n={i + 1} />
                  {step.icon !== undefined && <Pictogram name={step.icon} size={20} />}
                  <span className="text-[14px] font-bold leading-snug text-fg">
                    <Inline text={step.label} />
                  </span>
                </div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-fg-muted">
                  <Inline text={step.detail} />
                </p>
              </div>
            </li>
          ))}
        </ol>
      );

    /* ---------------- facts ---------------- */
    case "facts":
      return (
        <div
          className={`grid gap-2 ${spec.tiles.length === 2 ? "sm:grid-cols-2" : spec.tiles.length === 3 || spec.tiles.length === 5 || spec.tiles.length === 6 ? "sm:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-4"}`}
        >
          {spec.tiles.map((tile, i) => (
            <div key={i} className="border border-border-base bg-surface p-3.5">
              {tile.stat !== undefined ? (
                <div className="d-text text-[22px] font-bold leading-none tnum">{tile.stat}</div>
              ) : tile.icon !== undefined ? (
                <Pictogram name={tile.icon} size={24} />
              ) : null}
              <div className="mt-2 text-[13.5px] font-bold leading-snug text-fg">
                <Inline text={tile.label} />
              </div>
              {tile.detail !== undefined && (
                <p className="mt-1 text-[13px] leading-relaxed text-fg-muted">
                  <Inline text={tile.detail} />
                </p>
              )}
            </div>
          ))}
        </div>
      );

    /* ---------------- spectrum ---------------- */
    case "spectrum":
      return (
        <div className="px-2 py-3">
          {/* The line, with a dot per point. Pure CSS: a grid of equal columns over a
              1px rule, so it needs no measurement and reflows freely. */}
          <div className="relative">
            <div aria-hidden className="absolute left-0 right-0 top-[7px] h-px bg-border-strong" />
            <div
              className="relative grid"
              style={{ gridTemplateColumns: `repeat(${spec.points.length}, minmax(0, 1fr))` }}
            >
              {spec.points.map((point, i) => (
                <div key={i} className="flex flex-col items-center gap-2 text-center">
                  <span
                    aria-hidden
                    className={
                      point.highlight === true
                        ? "d-fill h-[15px] w-[15px] ring-4 ring-[color-mix(in_oklab,var(--d)_25%,transparent)]"
                        : "mt-[3px] h-[9px] w-[9px] bg-border-strong"
                    }
                  />
                  <div className="min-w-0 px-1">
                    <div
                      className={`text-[13px] leading-snug ${point.highlight === true ? "d-text font-bold" : "font-semibold text-fg-muted"}`}
                    >
                      <Inline text={point.label} />
                    </div>
                    {point.sublabel !== undefined && (
                      <div className="mt-0.5 text-[11.5px] leading-snug text-fg-subtle">
                        <Inline text={point.sublabel} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    /* ---------------- comparison ---------------- */
    case "comparison":
      return (
        <div className={`grid gap-2 ${spec.columns.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
          {spec.columns.map((column, i) => (
            <div key={i} className="flex flex-col border border-border-base bg-surface">
              <div className="d-tint flex items-center gap-2 border-b border-border-base px-3.5 py-2">
                {column.mark !== undefined && (
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center text-white ${column.mark === "check" ? "bg-correct" : "bg-incorrect"}`}
                  >
                    <Icon name={column.mark} size={12} />
                  </span>
                )}
                <span className="text-[13.5px] font-bold text-fg">
                  <Inline text={column.title} />
                </span>
                {column.mark !== undefined && (
                  <span className="sr-only">
                    {column.mark === "check" ? "(covered)" : "(not covered)"}
                  </span>
                )}
              </div>

              {column.spec !== undefined && (
                <div className="px-2 pt-1">
                  <Chart spec={column.spec} ariaLabel={column.title} />
                </div>
              )}

              <ul className="space-y-1.5 p-3.5">
                {column.bullets.map((bullet, j) => (
                  <li key={j} className="flex gap-2 text-[13.5px] leading-relaxed text-fg-muted">
                    <span aria-hidden className="d-text mt-[7px] h-1 w-1 shrink-0 bg-current" />
                    <span>
                      <Inline text={bullet} />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      );

    /* ---------------- cycle ---------------- */
    case "cycle":
      return (
        <div>
          <ol className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
            {spec.stages.map((stage, i) => (
              <li key={i} className="contents">
                {i > 0 && (
                  <span
                    aria-hidden
                    className="self-center text-fg-subtle max-sm:rotate-90 max-sm:self-start max-sm:ml-2.5"
                  >
                    <Icon name="arrow" size={15} />
                  </span>
                )}
                <div className="d-tint flex-1 border border-border-base p-3">
                  <div className="text-[13.5px] font-bold leading-snug text-fg">
                    <Inline text={stage.label} />
                  </div>
                  {stage.detail !== undefined && (
                    <p className="mt-1 text-[12.5px] leading-relaxed text-fg-muted">
                      <Inline text={stage.detail} />
                    </p>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {/* The loop-back — what makes it a cycle rather than steps. */}
          <div className="mt-1.5 flex items-center gap-1.5 text-[12px] font-semibold text-fg-subtle">
            <span aria-hidden className="d-text rotate-180">
              <Icon name="arrow" size={13} />
            </span>
            …and the loop repeats
          </div>
        </div>
      );

    /* ---------------- stack ---------------- */
    case "stack":
      return (
        <div className="flex gap-3">
          {spec.axis !== undefined && (
            <div className="flex shrink-0 flex-col items-center gap-1 py-1">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-fg-subtle [writing-mode:vertical-rl]">
                {spec.axis}
              </span>
              <span aria-hidden className="rotate-90 text-fg-subtle">
                <Icon name="arrow" size={13} />
              </span>
            </div>
          )}
          <ol className="flex min-w-0 flex-1 flex-col gap-1">
            {spec.layers.map((layer, i) => (
              <li
                key={i}
                className={`flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border px-3.5 py-2.5 ${
                  layer.emphasis === true
                    ? "d-border d-tint-strong"
                    : "border-border-base bg-surface-2"
                }`}
              >
                <span className="text-[13.5px] font-bold text-fg">
                  <Inline text={layer.label} />
                </span>
                {layer.sublabel !== undefined && (
                  <span className="text-[12.5px] text-fg-muted">
                    <Inline text={layer.sublabel} />
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      );
  }
}
