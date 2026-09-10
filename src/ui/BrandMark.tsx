/**
 * The Arete pillar mark, drawn rather than embedded.
 *
 * The logo is five rectangles — two capital bars, each split at the centre line,
 * over three columns — so an inline SVG reproduces it exactly at any size for about
 * half a kilobyte, keeps the build free of raster assets, and lets dark mode apply
 * the brand board's substitution: navy swaps to white (via `--p-logo` in
 * tokens.css), blue and cyan hold in both modes.
 *
 * Geometry was measured off the supplied artwork and normalised to a 96×86 box;
 * every piece is centred on x=48, which is what makes the asymmetric bar widths
 * read as one figure.
 *
 * `aria-hidden`: wherever the mark appears it sits beside the word "Arete", which
 * is the accessible name — announcing "logo" twice helps nobody.
 */

const NAVY = "var(--p-logo, #09314f)";
const BLUE = "#4887b2";
const CYAN = "#48beff";

export function BrandMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 96 86"
      width={size}
      height={(size * 86) / 96}
      aria-hidden="true"
      focusable="false"
    >
      {/* Capital bars, split at the centre line. The themed segments set fill via
          `style` rather than the SVG presentation attribute: var() in a presentation
          attribute has patchy support across engines, while in a style declaration it
          is plain CSS everywhere. */}
      <rect x="0" y="0" width="48" height="10" style={{ fill: NAVY }} />
      <rect x="48" y="0" width="48" height="10" fill={CYAN} />
      <rect x="11.5" y="15.5" width="36.5" height="9" fill={BLUE} />
      <rect x="48" y="15.5" width="37" height="9" fill={CYAN} />

      {/* Columns */}
      <rect x="20" y="30" width="13.5" height="56" style={{ fill: NAVY }} />
      <rect x="41" y="30" width="13.5" height="56" fill={BLUE} />
      <rect x="63" y="30" width="13.5" height="56" fill={CYAN} />
    </svg>
  );
}
