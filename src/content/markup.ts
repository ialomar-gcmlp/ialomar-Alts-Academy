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
 * Known limitation: emphasis and glossary terms do not nest. A term inside **bold**
 * renders as plain bold text. Content is authored to avoid it, and the validator
 * still sees the slug because referencedSlugs scans the raw string.
 */

const TERM_PATTERN = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;
const STRONG_PATTERN = /\*\*([^*]+)\*\*/g;
const EM_PATTERN = /\*([^*]+)\*/g;

export type InlineNode =
  | { kind: "text"; text: string }
  | { kind: "term"; slug: string; display: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string };

/** Back-compat alias: the term-only view of a string. */
export type ProseSegment = Extract<InlineNode, { kind: "text" | "term" }>;

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
 * Full inline parse: terms first, then emphasis within the remaining text.
 * Staged rather than a single tokenizer because the constructs do not nest.
 */
export function parseInline(input: string): InlineNode[] {
  return parseProse(input).flatMap((segment) =>
    segment.kind === "term" ? [segment] : splitEmphasis(segment.text),
  );
}

function splitEmphasis(text: string): InlineNode[] {
  return splitOn(text, STRONG_PATTERN, "strong").flatMap((node) =>
    node.kind === "text" ? splitOn(node.text, EM_PATTERN, "em") : [node],
  );
}

function splitOn(
  text: string,
  pattern: RegExp,
  kind: "strong" | "em",
): InlineNode[] {
  const out: InlineNode[] = [];
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const at = match.index;
    const inner = match[1];
    if (inner === undefined) continue;

    if (at > cursor) out.push({ kind: "text", text: text.slice(cursor, at) });
    out.push({ kind, text: inner });
    cursor = at + match[0].length;
  }

  if (cursor < text.length) out.push({ kind: "text", text: text.slice(cursor) });
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
