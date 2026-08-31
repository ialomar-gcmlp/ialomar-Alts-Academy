/**
 * Inline content markup.
 *
 * Content prose is data, not HTML and not full markdown. Exactly three inline
 * constructs are supported, and this module is the only place they are parsed —
 * used by the renderer at runtime and by the content validator at build time, so the
 * two can never disagree about what counts as a term reference.
 *
 *   [[term-slug]]                  glossary term, displayed as the slug's words
 *   [[term-slug|displayed words]]  glossary term with custom display text
 *   **bold**                       emphasis for the load-bearing phrase in a paragraph
 *   *italic*                       light emphasis
 *
 * Paragraphs are separated by a blank line (\n\n). Nothing else is interpreted, so
 * content can never inject markup or HTML into the app.
 *
 * Constructs nest. `**Tier 2 — [[preferred-return]].**` is bold text, a bold term and
 * bold text; `**when commodities *are* the inflation**` is bold, bold-italic, bold.
 * Emphasis is resolved first as structure, then terms are resolved inside each span
 * and inherit that span's emphasis, so the node list stays flat — each node carries
 * an outer-to-inner list of the emphasis wrapping it — and the renderer needs no
 * recursive node type.
 *
 * The earlier version parsed terms first and looked for `**...**` in the leftovers,
 * and its bold pattern could not span an inner asterisk. Both cases above then failed
 * SILENTLY, printing their asterisks onto the page. The house style is built on bold
 * lead-ins and every specialist term is marked up, so those collisions are routine
 * rather than exotic: two shipped in the first 38 topics.
 */

const TERM_PATTERN = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;
/** Non-greedy and asterisk-tolerant, so bold can contain an italic. */
const STRONG_PATTERN = /\*\*(.+?)\*\*/g;
const EM_PATTERN = /\*([^*]+)\*/g;

export type Emphasis = "strong" | "em";

/** Emphasis wrapping a node, outermost first. Absent when there is none. */
export type InlineNode =
  | { kind: "text"; text: string; emphasis?: Emphasis[] }
  | { kind: "term"; slug: string; display: string; emphasis?: Emphasis[] };

/** The term-only view of a string: text and glossary segments, no emphasis. */
export type ProseSegment =
  | { kind: "text"; text: string }
  | { kind: "term"; slug: string; display: string };

/** Split prose into plain text and glossary-term segments, in order. */
export function parseProse(input: string): ProseSegment[] {
  const segments: ProseSegment[] = [];
  let cursor = 0;

  for (const match of input.matchAll(TERM_PATTERN)) {
    const at = match.index;
    const slug = match[1];
    if (slug === undefined) continue;

    if (at > cursor) segments.push({ kind: "text", text: input.slice(cursor, at) });
    segments.push({ kind: "term", slug, display: match[2] ?? slug.replace(/-/g, " ") });
    cursor = at + match[0].length;
  }

  if (cursor < input.length) segments.push({ kind: "text", text: input.slice(cursor) });
  return segments;
}

/**
 * Full inline parse: emphasis first as structure, then terms within each span.
 * Terms inherit the emphasis of the span they sit in, which keeps the result a flat
 * list — one pass in the renderer, no recursive node type.
 */
export function parseInline(input: string): InlineNode[] {
  return splitEmphasis(input).flatMap((span) =>
    parseProse(span.text).map((segment) =>
      span.emphasis.length === 0 ? segment : { ...segment, emphasis: span.emphasis },
    ),
  );
}

type Span = { text: string; emphasis: Emphasis[] };

/**
 * Bold before italic, so a doubled asterisk is never read as two italics, then
 * italic within each bold span — one level of nesting, which is all the house style
 * uses and all that can be expressed with two asterisk forms.
 */
function splitEmphasis(input: string): Span[] {
  return splitOn(input, STRONG_PATTERN, "strong").flatMap((outer) =>
    splitOn(outer.text, EM_PATTERN, "em").map((inner) => ({
      text: inner.text,
      emphasis: [...outer.emphasis, ...inner.emphasis],
    })),
  );
}

function splitOn(text: string, pattern: RegExp, emphasis: Emphasis): Span[] {
  const out: Span[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    const inner = match[1];
    if (inner === undefined) continue;

    if (at > cursor) out.push({ text: text.slice(cursor, at), emphasis: [] });
    out.push({ text: inner, emphasis: [emphasis] });
    cursor = at + match[0].length;
  }

  if (cursor < text.length) out.push({ text: text.slice(cursor), emphasis: [] });
  return out;
}

/** Split a body into paragraphs. Blank line separated; nothing else is structural. */
export function paragraphs(input: string): string[] {
  return input.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
}

/** Every term slug referenced in a string. */
export function referencedSlugs(input: string): string[] {
  return [...input.matchAll(TERM_PATTERN)]
    .map((m) => m[1])
    .filter((s): s is string => s !== undefined);
}

/** Prose with markup removed — for word counts, search indexes and plain-text export. */
export function stripMarkup(input: string): string {
  return input
    .replace(TERM_PATTERN, (_full, slug: string, display?: string) =>
      display ?? slug.replace(/-/g, " "),
    )
    .replace(STRONG_PATTERN, "$1")
    .replace(EM_PATTERN, "$1");
}
