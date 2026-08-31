/**
 * Prose rendering with inline glossary terms.
 *
 * Every specialist term in a lesson, stem or explanation is a tappable trigger that
 * shows plain English FIRST, the formal definition second, and related terms third.
 * Terms are defined once in content/glossary and referenced everywhere, so a
 * definition shown here is the same definition shown anywhere else.
 *
 * Two things here are the way they are because the obvious version was wrong:
 *
 *  1. The popover panel is rendered in a PORTAL, not next to its trigger. Prose is
 *     wrapped in <p>, and a panel full of <div>/<p> nested inside a <p> is invalid
 *     HTML that browsers silently reflow — which broke the layout.
 *  2. Placement is decided from available space, not by measuring the panel and
 *     re-positioning. The measure-then-reposition version fed its own state back
 *     into its own effect and hit React's update-depth limit.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { lookupTerm, type IndexedTerm } from "../content/loader";
import { paragraphs, parseInline } from "../content/markup";

/* ------------------------------------------------------------------ *
 * Term trigger + popover
 * ------------------------------------------------------------------ */

const PANEL_WIDTH = 320;
/** Enough room for a typical panel; if there is less below, open upward. */
const PANEL_SPACE = 260;
const GAP = 8;

function TermPanel({ term, top, left }: { term: IndexedTerm; top: number; left: number }) {
  return createPortal(
    <div
      role="dialog"
      aria-label={`Definition: ${term.term}`}
      style={{ top, left, width: PANEL_WIDTH, maxHeight: "min(70vh, 26rem)" }}
      className="fixed z-50 overflow-y-auto rounded-lg border border-border-strong bg-surface p-4 text-left shadow-lg"
      data-term-panel
    >
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-fg">{term.term}</span>
        {term.needsReview === true && (
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-flag">
            unverified
          </span>
        )}
      </div>

      {/* Plain English first — the whole point of the glossary. */}
      <p className="text-sm leading-relaxed text-fg">{term.plain}</p>

      <div className="mt-3 border-t border-border-base pt-2.5">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
          More formally
        </div>
        <p className="text-[13px] leading-relaxed text-fg-muted">{term.formal}</p>
      </div>

      {term.seeAlso.length > 0 && (
        <div className="mt-3 border-t border-border-base pt-2.5">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">
            Related
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-fg-muted">
            {term.seeAlso.map((slug) => {
              const other = lookupTerm(slug);
              return other ? <span key={slug}>{other.term}</span> : null;
            })}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

function TermTrigger({ slug, display }: { slug: string; display: string }) {
  // Every hook runs before any conditional return, or the hook order changes
  // between renders when a slug fails to resolve.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;

    const close = (): void => setOpen(false);

    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape") return;
      // Stop the session's Escape handler from also firing and offering to quit.
      e.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    };

    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) === true) return;
      if (target instanceof Element && target.closest("[data-term-panel]") !== null) return;
      setOpen(false);
    };

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    // Closing on scroll is steadier than tracking a moving anchor.
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);

    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const term = lookupTerm(slug);

  // An unresolved slug is a build-time failure (content:check). If one ever ships,
  // show the words rather than a control that does nothing.
  if (!term) {
    if (import.meta.env.DEV) console.warn(`[glossary] no definition for [[${slug}]]`);
    return <span>{display}</span>;
  }

  const openPanel = (): void => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;

    // Decided from available space in one pass — no measure-and-reflow loop.
    const openUpward = window.innerHeight - r.bottom < PANEL_SPACE && r.top > PANEL_SPACE;
    setPos({
      top: openUpward ? Math.max(GAP, r.top - PANEL_SPACE - 6) : r.bottom + 6,
      left: Math.min(Math.max(GAP, r.left), window.innerWidth - PANEL_WIDTH - GAP),
    });
    setOpen(true);
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="term-trigger"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? setOpen(false) : openPanel())}
        onMouseEnter={() => {
          // Hover-to-open on pointer devices only; touch uses the click.
          if (!open && window.matchMedia("(hover: hover)").matches) openPanel();
        }}
        onMouseLeave={(e) => {
          if (!window.matchMedia("(hover: hover)").matches) return;
          // Keep it open if the pointer moved into the panel itself.
          const to = e.relatedTarget;
          if (to instanceof Element && to.closest("[data-term-panel]") !== null) return;
          setOpen(false);
        }}
      >
        {display}
      </button>

      {open && pos && <TermPanel term={term} top={pos.top} left={pos.left} />}
    </>
  );
}

/**
 * Non-interactive term rendering, for prose that already sits inside a control
 * (a choice button, for instance). A <button> inside a <button> is invalid HTML and
 * swallows the click, so these get the same underline plus a native tooltip.
 */
function TermStatic({ slug, display }: { slug: string; display: string }) {
  const term = lookupTerm(slug);
  if (!term) return <span>{display}</span>;
  return (
    <span className="term-trigger" title={`${term.term}: ${term.plain}`}>
      {display}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Renderers
 * ------------------------------------------------------------------ */

/**
 * One line of prose with terms and emphasis resolved. No block structure.
 *
 * Set `interactive={false}` when this sits inside a button or other control.
 */
export function Inline({
  text,
  interactive = true,
}: {
  text: string;
  interactive?: boolean;
}): ReactNode {
  return parseInline(text).map((node, i) => {
    switch (node.kind) {
      case "text":
        return <span key={i}>{node.text}</span>;
      case "strong":
        return (
          <strong key={i} className="font-semibold text-fg">
            {node.text}
          </strong>
        );
      case "em":
        return <em key={i}>{node.text}</em>;
      case "term":
        return interactive ? (
          <TermTrigger key={i} slug={node.slug} display={node.display} />
        ) : (
          <TermStatic key={i} slug={node.slug} display={node.display} />
        );
    }
  });
}

/** A full body: paragraphs split on blank lines, each with inline markup resolved. */
export function Prose({
  text,
  className = "",
  interactive = true,
}: {
  text: string;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div className={`prose-lesson ${className}`}>
      {paragraphs(text).map((p, i) => (
        <p key={i}>
          <Inline text={p} interactive={interactive} />
        </p>
      ))}
    </div>
  );
}
