/**
 * Icons — inline SVG, no dependency, `currentColor` throughout.
 *
 * Deliberately not emoji: emoji render differently on every platform, cannot take a
 * token colour, and read as decoration rather than as part of the interface. These
 * are all aria-hidden, because every one of them sits next to its own label.
 */

export type IconName =
  | "flame"
  | "bolt"
  | "target"
  | "trophy"
  | "check"
  | "cross"
  | "spark"
  | "bulb"
  | "alert"
  | "case"
  | "lock"
  | "arrow"
  | "clock"
  | "layers"
  | "coins"
  | "chartUp"
  | "docCheck"
  | "gear"
  | "shield";

const PATHS: Record<IconName, string> = {
  // A flame, for the streak.
  flame: "M12 2c2.5 3.5 1 5.5 0 6.5C10.5 7 9 5.5 9 4 6.5 6 5 8.7 5 12a7 7 0 0014 0c0-3.5-2-6.5-7-10zm0 17a3.5 3.5 0 01-1.6-6.6c.3 1 1 1.8 1.9 2.2.6-1 .5-2 .1-2.9 2 .7 3.1 2.3 3.1 3.8A3.5 3.5 0 0112 19z",
  // A bolt, for XP.
  bolt: "M13.5 2L4 13.5h5.5L8.5 22 19 10.5h-5.7L13.5 2z",
  target: "M12 2a10 10 0 100 20 10 10 0 000-20zm0 3a7 7 0 110 14 7 7 0 010-14zm0 3.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7z",
  trophy:
    "M7 4h10v1h3v3a4 4 0 01-3.3 3.9A5 5 0 0113 15.9V18h3v2H8v-2h3v-2.1a5 5 0 01-3.7-4A4 4 0 014 8V5h3V4zm0 3H6v1a2 2 0 001 1.7V7zm11 0h-1v2.7A2 2 0 0018 8V7z",
  check: "M20.3 5.7L9 17 3.7 11.7l1.4-1.4L9 14.2l9.9-9.9 1.4 1.4z",
  cross: "M18.3 5.7L12 12l6.3 6.3-1.4 1.4L10.6 13.4 5.7 18.3 4.3 16.9 10.6 10.6 4.3 4.3 5.7 2.9 12 9.2l4.9-4.9z",
  spark: "M12 2l1.8 5.6L19.5 9l-4.3 3.4L16.5 18 12 14.9 7.5 18l1.3-5.6L4.5 9l5.7-1.4L12 2z",
  bulb: "M12 2a7 7 0 00-4 12.7V17a2 2 0 002 2h4a2 2 0 002-2v-2.3A7 7 0 0012 2zm-2 19h4v1h-4v-1z",
  alert: "M12 2l10 18H2L12 2zm-1 7v5h2V9h-2zm0 6.5v2h2v-2h-2z",
  case: "M9 4h6a2 2 0 012 2v1h3a2 2 0 012 2v9a2 2 0 01-2 2H4a2 2 0 01-2-2V9a2 2 0 012-2h3V6a2 2 0 012-2zm0 3h6V6H9v1z",
  lock: "M12 2a5 5 0 015 5v2h1a2 2 0 012 2v9a2 2 0 01-2 2H6a2 2 0 01-2-2v-9a2 2 0 012-2h1V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v2h6V7a3 3 0 00-3-3z",
  arrow: "M13.2 4.6L20.6 12l-7.4 7.4-1.4-1.4 5-5H3.4v-2h13.4l-5-5 1.4-1.4z",
  clock: "M12 2a10 10 0 100 20 10 10 0 000-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z",
  layers: "M12 2l10 5.5-10 5.5L2 7.5 12 2zm0 12.5l7.6-4.2 2.4 1.3-10 5.5-10-5.5 2.4-1.3L12 14.5zm0 5l7.6-4.2 2.4 1.3-10 5.4-10-5.4 2.4-1.3L12 19.5z",
  // Infographic pictograms (M10). Same rules as everything above: single path,
  // currentColor, evenodd so the cut-outs render.
  // A short stack of coins: three ellipses-as-discs.
  coins:
    "M12 3c4.4 0 8 1.1 8 2.5S16.4 8 12 8 4 6.9 4 5.5 7.6 3 12 3zm8 5.8v2.7c0 1.4-3.6 2.5-8 2.5s-8-1.1-8-2.5V8.8C5.6 9.9 8.6 10.5 12 10.5s6.4-.6 8-1.7zm0 5.5V17c0 1.4-3.6 2.5-8 2.5S4 18.4 4 17v-2.7c1.6 1.1 4.6 1.7 8 1.7s6.4-.6 8-1.7z",
  // Rising bars with an arrow above.
  chartUp:
    "M3 20h3v-6H3v6zm5.5 0h3V9h-3v11zm5.5 0h3v-8h-3v8zm5.5 0H22v-11h-2.5v11zM14 3h7v7h-2V6.4l-6.3 6.3-1.4-1.4L17.6 5H14V3z",
  // A document with a tick.
  docCheck:
    "M6 2h9l5 5v13a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2zm8 1.5V8h4.5L14 3.5zM10.6 18l-3.3-3.3 1.4-1.4 1.9 1.9 4.7-4.7 1.4 1.4L10.6 18z",
  // A gear: ring with teeth via evenodd cut-out.
  gear: "M12 8.5a3.5 3.5 0 110 7 3.5 3.5 0 010-7zm9.4 5l-2.2-.4a7.3 7.3 0 000-2.2l2.2-.4v-1l-2.3-.4a7.2 7.2 0 00-1.1-1.9l1.3-1.9-.7-.7-1.9 1.3a7.2 7.2 0 00-1.9-1.1L14.4 2.6h-1l-.4 2.2a7.3 7.3 0 00-2.2 0l-.4-2.2h-1l-.4 2.3a7.2 7.2 0 00-1.9 1.1L5.2 4.7l-.7.7 1.3 1.9a7.2 7.2 0 00-1.1 1.9l-2.3.4v1l2.2.4a7.3 7.3 0 000 2.2l-2.2.4v1l2.3.4c.3.7.6 1.3 1.1 1.9l-1.3 1.9.7.7 1.9-1.3c.6.5 1.2.8 1.9 1.1l.4 2.3h1l.4-2.2a7.3 7.3 0 002.2 0l.4 2.2h1l.4-2.3a7.2 7.2 0 001.9-1.1l1.9 1.3.7-.7-1.3-1.9c.5-.6.8-1.2 1.1-1.9l2.3-.4v-1zM12 6.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11z",
  // A shield with a tick.
  shield:
    "M12 2l8 3v6.1c0 4.8-3.2 8.6-8 10.9-4.8-2.3-8-6.1-8-10.9V5l8-3zm-1.4 13.5l6-6-1.4-1.4-4.6 4.6-2-2-1.4 1.4 3.4 3.4z",
};

export function Icon({
  name,
  size = 16,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="currentColor"
      aria-hidden
      focusable="false"
      className={`inline-block shrink-0 ${className}`}
    >
      {/* evenodd, because several of these are donuts — a target, a clock face, a
          padlock shackle. With the default nonzero rule they fill in as solid discs. */}
      <path d={PATHS[name]} fillRule="evenodd" clipRule="evenodd" />
    </svg>
  );
}
