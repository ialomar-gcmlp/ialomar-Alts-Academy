/**
 * Glossary — searchable, grouped by domain, with per-term status.
 *
 * Terms are defined once in content/glossary and referenced everywhere, so a
 * definition shown here is the same one a lesson popover shows. This page adds the
 * two things a reference list cannot: which terms you have actually met, and which
 * you have been tested on.
 *
 * "Known" deliberately means a drill interval has stretched past a week, not that you
 * got it right once. Anything weaker reads as false comfort.
 */

import { useMemo, useState } from "react";

import { glossary } from "../content/loader";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import {
  TERM_STATUS_LABELS,
  termProgress,
  type TermStatus,
} from "../engine/glossary";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { useApp } from "../state/store";
import { Badge, Button, Card, EmptyState, Kbd, PageTitle } from "../ui/primitives";

const STATUS_TONE: Record<TermStatus, "neutral" | "accent" | "correct" | "flag"> = {
  unseen: "neutral",
  seen: "neutral",
  drilled: "accent",
  shaky: "flag",
  known: "correct",
};

type Filter = "all" | "seen" | "unseen" | "drilled" | "shaky";

const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "seen", label: "Met" },
  { id: "unseen", label: "Not yet met" },
  { id: "drilled", label: "Drilled" },
  { id: "shaky", label: "Shaky" },
];

const DRILL_SIZE = 12;

export function GlossaryPage() {
  const progress = useApp((s) => s.progress);
  const startDrillSession = useApp((s) => s.startDrillSession);

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [drillMessage, setDrillMessage] = useState<string | null>(null);

  const now = useMemo(() => Date.now(), [progress]);

  const terms = useMemo(
    () =>
      [...glossary.values()].map((term) => ({
        term,
        status: termProgress(term.slug, progress, now),
      })),
    [progress, now],
  );

  const counts = useMemo(() => {
    let met = 0;
    let drilled = 0;
    let known = 0;
    let due = 0;
    for (const { status } of terms) {
      if (status.status !== "unseen") met += 1;
      if (status.attempts > 0) drilled += 1;
      if (status.status === "known") known += 1;
      due += status.dueCount;
    }
    return { met, drilled, known, due };
  }, [terms]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    return terms.filter(({ term, status }) => {
      if (filter === "seen" && status.status === "unseen") return false;
      if (filter === "unseen" && status.status !== "unseen") return false;
      if (filter === "drilled" && status.attempts === 0) return false;
      if (filter === "shaky" && status.status !== "shaky") return false;

      if (q === "") return true;
      // Search the definitions too — you often remember the idea, not the label.
      return (
        term.term.toLowerCase().includes(q) ||
        term.slug.includes(q) ||
        term.plain.toLowerCase().includes(q) ||
        term.formal.toLowerCase().includes(q)
      );
    });
  }, [terms, query, filter]);

  const byDomain = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const entry of [...filtered].sort((a, b) => a.term.term.localeCompare(b.term.term))) {
      const list = map.get(entry.term.domain);
      if (list) list.push(entry);
      else map.set(entry.term.domain, [entry]);
    }
    return map;
  }, [filtered]);

  useHotkeys({
    "/": () => document.getElementById("glossary-search")?.focus(),
  });

  const beginDrill = (): void => {
    const count = startDrillSession(DRILL_SIZE);
    if (count === 0) {
      setDrillMessage("Not enough glossary terms yet to build a drill.");
      return;
    }
    navigate("drill");
  };

  return (
    <div>
      <PageTitle title="Glossary">
        Every term is defined once, here, and referenced from every lesson — so a
        definition can never drift between topics.
      </PageTitle>

      <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-medium text-fg">Glossary drill</p>
          <p className="mt-0.5 max-w-measure text-[14px] text-fg-muted">
            {counts.due > 0
              ? `${counts.due} term direction${counts.due === 1 ? "" : "s"} due. `
              : ""}
            Both directions: term to meaning, and meaning to term. Drills are scheduled
            like questions and count toward your daily review.
          </p>
          {drillMessage !== null && (
            <p className="mt-2 text-[13px] text-flag">{drillMessage}</p>
          )}
        </div>
        <Button size="lg" onClick={beginDrill}>
          Start drill
        </Button>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-3">
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

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`rounded-md px-2.5 py-1 text-[13px] ${
              filter === f.id
                ? "bg-accent-soft font-medium text-accent"
                : "text-fg-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <p className="mb-6 text-[13px] text-fg-subtle tnum">
        {filtered.length} of {terms.length} shown · {counts.met} met · {counts.drilled}{" "}
        drilled · {counts.known} known
      </p>

      {filtered.length === 0 ? (
        <EmptyState title="No terms match.">
          Try a shorter query, a different filter, or search the definition rather than
          the label.
        </EmptyState>
      ) : (
        <div className="space-y-10">
          {[...byDomain.entries()].map(([domain, list]) => (
            <section key={domain}>
              <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
                {DOMAIN_LABELS[domain as Domain] ?? domain}
              </h2>
              <div className="space-y-3">
                {list.map(({ term, status }) => (
                  <Card key={term.slug} className="p-4">
                    <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
                      <h3 className="font-semibold text-fg">{term.term}</h3>
                      <Badge tone={STATUS_TONE[status.status]}>
                        {TERM_STATUS_LABELS[status.status]}
                      </Badge>
                      {status.dueCount > 0 && <Badge tone="flag">due</Badge>}
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

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-fg-subtle">
                      {term.seeAlso.length > 0 && (
                        <span>
                          Related:{" "}
                          {term.seeAlso.map((slug) => glossary.get(slug)?.term ?? slug).join(", ")}
                        </span>
                      )}
                      {status.attempts > 0 && (
                        <span className="tnum">
                          drilled {status.correct}/{status.attempts} right
                        </span>
                      )}
                    </div>
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
