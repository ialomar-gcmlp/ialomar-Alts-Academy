/**
 * Review queue — everything the content flags as unverified.
 *
 * Required by the content integrity rules (CLAUDE.md §1.5): where a formula,
 * convention or figure was not fully certain, the item carries needsReview plus a
 * note, and it surfaces here with its file path so it can be checked against a
 * primary source.
 *
 * Only topics whose manifest entry is flagged get loaded, so this page stays cheap
 * as the content grows.
 */

import { useEffect, useState } from "react";

import { glossary, loadTopic, manifest } from "../content/loader";
import type { Topic } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { Button, Card, EmptyState, PageTitle } from "../ui/primitives";

interface FlaggedItem {
  kind: "topic" | "question" | "term";
  file: string;
  label: string;
  note: string;
  topicId?: string;
}

function collect(topics: Topic[]): FlaggedItem[] {
  const out: FlaggedItem[] = [];

  for (const topic of topics) {
    const file = manifest.topics.find((t) => t.id === topic.id)?.file ?? topic.id;

    if (topic.needsReview) {
      out.push({
        kind: "topic",
        file,
        label: topic.title,
        note: topic.reviewNote ?? "Flagged with no note.",
        topicId: topic.id,
      });
    }

    for (const q of topic.questions) {
      if (q.needsReview !== true) continue;
      out.push({
        kind: "question",
        file,
        label: `${topic.title} — ${q.id}`,
        note: q.reviewNote ?? "Flagged with no note.",
        topicId: topic.id,
      });
    }
  }

  for (const term of glossary.values()) {
    if (term.needsReview !== true) continue;
    out.push({
      kind: "term",
      file: `content/glossary/${term.domain}.json`,
      label: term.term,
      note: term.reviewNote ?? "Flagged with no note.",
    });
  }

  return out;
}

const KIND_LABELS: Record<FlaggedItem["kind"], string> = {
  topic: "Topic",
  question: "Question",
  term: "Glossary term",
};

export function ReviewQueue() {
  const [items, setItems] = useState<FlaggedItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const flaggedTopics = manifest.topics.filter((t) => t.needsReview);

    void Promise.all(flaggedTopics.map((t) => loadTopic(t.id)))
      .then((topics) => {
        if (!cancelled) setItems(collect(topics));
      })
      .catch(() => {
        if (!cancelled) setItems(collect([]));
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageTitle title="Review queue">
        Items where a formula, convention or figure was not fully certain when written.
        They are flagged rather than guessed at — check these against a primary source
        before relying on them.
      </PageTitle>

      {items === null ? (
        <p className="text-fg-muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState title="Nothing flagged.">
          Every item in the current content set was written with confidence. That will
          change as the content grows — this page is where it will show up.
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {items.map((item, i) => (
            <Card key={`${item.file}-${i}`} className="p-4">
              <div className="mb-1.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-flag">
                  {KIND_LABELS[item.kind]}
                </span>
                <span className="font-medium text-fg">{item.label}</span>
              </div>
              <p className="max-w-measure text-[14px] leading-relaxed text-fg-muted">
                {item.note}
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-3">
                <code className="text-[12px] text-fg-subtle">{item.file}</code>
                {item.topicId !== undefined && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate(`topic/${item.topicId}`)}
                  >
                    Open topic →
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
