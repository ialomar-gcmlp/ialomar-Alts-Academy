/**
 * LaTeX rendering, lazily loaded.
 *
 * KaTeX plus its fonts is the heaviest thing in the app, so it is behind a dynamic
 * import: pages without a formula never fetch it. It is bundled rather than served
 * from a CDN, so the app still works offline (CLAUDE.md §1.3).
 *
 * Until it resolves — and if it fails outright — the plain-English reading of the
 * formula is shown. That is the more important half of a formula block anyway.
 */

import { useEffect, useState } from "react";

type KatexRenderer = (latex: string, options: Record<string, unknown>) => string;

let renderer: KatexRenderer | null = null;
let loading: Promise<KatexRenderer | null> | null = null;

async function loadKatex(): Promise<KatexRenderer | null> {
  if (renderer) return renderer;
  loading ??= (async () => {
    try {
      const [katex] = await Promise.all([
        import("katex"),
        import("katex/dist/katex.min.css"),
      ]);
      renderer = katex.default.renderToString.bind(katex.default) as KatexRenderer;
      return renderer;
    } catch (err) {
      console.error("[formula] KaTeX failed to load; falling back to plain text", err);
      return null;
    }
  })();
  return loading;
}

export function Formula({
  latex,
  display = true,
  className = "",
}: {
  latex: string;
  display?: boolean;
  className?: string;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void loadKatex().then((render) => {
      if (cancelled) return;
      if (!render) {
        setFailed(true);
        return;
      }
      try {
        setHtml(
          render(latex, {
            displayMode: display,
            throwOnError: false,
            // LaTeX comes from our own content files, never user input, and trust:false
            // keeps KaTeX from emitting raw HTML even so.
            trust: false,
            strict: "ignore",
          }),
        );
      } catch (err) {
        console.error("[formula] render failed", latex, err);
        setFailed(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [latex, display]);

  if (failed) {
    return (
      <code className={`block font-mono text-sm text-fg-muted ${className}`}>{latex}</code>
    );
  }

  if (html === null) {
    // Reserve roughly the right height so the lesson does not jump when it lands.
    return <div className={`h-9 ${className}`} aria-hidden />;
  }

  return (
    <div
      className={className}
      // KaTeX output, generated from our own content with trust:false.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
