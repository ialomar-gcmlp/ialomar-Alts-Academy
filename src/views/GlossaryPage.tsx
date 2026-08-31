/**
 * Glossary — searchable, grouped by domain.
 *
 * M1 is the browsable reference. M4 adds "seen" / "quizzed on" state and the drill
 * mode that tests both directions.
 */

import { useMemo, useState } from "react";

import { glossary } from "../content/loader";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { useHotkeys } from "../lib/keyboard";
import { Card, EmptyState, Kbd, PageTitle } from "../ui/primitives";

export function GlossaryPage() {
  const [query, setQuery] = useState("");
  const terms = useMemo(() => [...glossary.values()], []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return terms;
    // Search the definitions too — you often remember the idea, not the label.
    return terms.filter(
      (t) =>
        t.term.toLowerCase().includes(q) ||
        t.slug.includes(q) ||
        t.plain.toLowerCase().includes(q) ||
        t.formal.toLowerCase().includes(q),
    );
  }, [terms, query]);

  const byDomain = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const term of [...filtered].sort((a, b) => a.term.localeCompare(b.term))) {
      const list = map.get(term.domain);
      if (list) list.push(term);
      else map.set(term.domain, [term]);
    }
    return map;
  }, [filtered]);

  useHotkeys({
    "/": () => document.getElementById("glossary-search")?.focus(),
  });

  return (
    <div>
      <PageTitle title="Glossary">
        Every term is defined once, here, and referenced from every lesson — so a
        definition can never drift between topics.
      </PageTitle>

      <div className="mb-8 flex items-center gap-3">
        <input
          id="glossary-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search terms and definitions"
          className="w-full max-w-sm rounded-md border border-border-strong bg-surface px-3 py-2 text-[15px] outline-none focus:border-accent"
        />
        <span className="hidden shrink-0 text-[13px] text-fg-subtle sm:inline">
          <Kbd>/</Kbd> to search
        </span>
      </div>

      <p className="mb-6 text-[13px] text-fg-subtle tnum">
        {filtered.length} of {terms.length} terms
      </p>

      {filtered.length === 0 ? (
        <EmptyState title="No terms match that search.">
          Try a shorter query, or search the definition rather than the label.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {[...byDomain.entries()].map(([domain, list]) => (
            <section key={domain}>
              <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
                {DOMAIN_LABELS[domain as Domain] ?? domain}
              </h2>
              <div className="space-y-3">
                {list.map((term) => (
                  <Card key={term.slug} className="p-4">
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                      <h3 className="font-semibold text-fg">{term.term}</h3>
                      {term.needsReview === true && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-flag">
                          unverified
                        </span>
                      )}
                    </div>
                    <p className="max-w-measure text-[15px] leading-relaxed text-fg">
                      {term.plain}
                    </p>
                    <p className="mt-2 max-w-measure text-[13.5px] leading-relaxed text-fg-muted">
                      {term.formal}
                    </p>
                    {term.seeAlso.length > 0 && (
                      <p className="mt-2.5 text-[13px] text-fg-subtle">
                        Related:{" "}
                        {term.seeAlso
                          .map((slug) => glossary.get(slug)?.term ?? slug)
                          .join(", ")}
                      </p>
                    )}
                  </Card>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
