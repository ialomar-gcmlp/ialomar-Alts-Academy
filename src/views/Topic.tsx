/**
 * Topic — the lesson.
 *
 * Loads the topic body lazily, renders its blocks, and hands off to the quiz.
 */

import { useEffect, useState } from "react";

import { loadTopic } from "../content/loader";
import { referencedSlugs } from "../content/markup";
import { collectProse } from "../content/walk";
import { DOMAIN_LABELS, type Topic as TopicData } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { latestRecallNote } from "../engine/recall";
import { useApp } from "../state/store";
import { Lesson } from "../ui/blocks/LessonBlocks";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Kbd,
  Monogram,
  PageTitle,
} from "../ui/primitives";

export function Topic({ id }: { id: string }) {
  const [topic, setTopic] = useState<TopicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startTopicQuiz = useApp((s) => s.startTopicQuiz);
  const recallNote = useApp((s) => latestRecallNote(s.progress.recallNotes, id));
  const markTermsSeen = useApp((s) => s.markTermsSeen);

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setError(null);

    loadTopic(id)
      .then((loaded) => {
        if (cancelled) return;
        setTopic(loaded);

        // Opening the lesson is what counts as meeting a term. This is what makes a
        // drill fair — the glossary drill only draws on terms already encountered.
        const slugs = new Set(
          collectProse(loaded).flatMap((field) => referencedSlugs(field.text)),
        );
        markTermsSeen([...slugs]);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id, markTermsSeen]);

  const begin = (): void => {
    if (!topic) return;
    startTopicQuiz(topic);
    navigate(`quiz/${topic.id}`);
  };

  useHotkeys({ Enter: begin }, topic !== null);

  if (error !== null) {
    return (
      <EmptyState title="That topic could not be loaded">
        <p className="mb-3">{error}</p>
        <Button variant="secondary" onClick={() => navigate("")}>
          Back to topics
        </Button>
      </EmptyState>
    );
  }

  if (!topic) {
    return <p className="text-fg-muted">Loading…</p>;
  }

  const questionMinutes = Math.round(
    topic.questions.reduce((n, q) => n + (q.estSeconds ?? 60), 0) / 60,
  );

  return (
    <article style={domainStyle(topic.domain)}>
      {/* The re-meeting half of free recall: what you wrote from memory last time,
          shown before you read again. Comparing it against the lesson is the point. */}
      {recallNote !== null && (
        <aside className="mb-5 rounded-lg border border-accent/40 bg-accent-soft/50 px-4 py-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-accent">
            Your note from last time
          </span>
          <p className="mt-1 text-[14.5px] leading-relaxed text-fg">{recallNote.text}</p>
        </aside>
      )}

      <div className="mb-4 flex items-center gap-2.5">
        <Monogram code={DOMAIN_MONOGRAM[topic.domain]} size={30} />
        <span className="d-text text-[12px] font-bold uppercase tracking-widest">
          {DOMAIN_LABELS[topic.domain]}
        </span>
      </div>

      <PageTitle title={topic.title}>{topic.summary}</PageTitle>

      <div className="mb-8 flex flex-wrap items-center gap-2 text-[13px] text-fg-subtle">
        {topic.examRelevance.map((exam) => (
          <Badge key={exam} tone={exam === "practical" ? "domain" : "neutral"}>
            {exam === "practical" ? "on the job" : exam}
          </Badge>
        ))}
        <span className="flex items-center gap-1 tnum">
          <Icon name="clock" size={12} />~{topic.estMinutes} min read
        </span>
        <span aria-hidden>·</span>
        <span className="tnum">
          {topic.questions.length} questions, ~{questionMinutes} min
        </span>
      </div>

      <Lesson blocks={topic.lesson} />

      <Card className="d-border mt-10 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="text-[16px] font-bold text-fg">Ready to test it?</p>
          <p className="mt-0.5 text-[14px] text-fg-muted">
            {topic.questions.length} questions. You will tag how confident you are on each
            one — that matters more than the score.
          </p>
        </div>
        <Button variant="vivid" size="xl" onClick={begin}>
          <Icon name="bolt" size={17} />
          Start questions <Kbd>Enter</Kbd>
        </Button>
      </Card>

      <div className="mt-6">
        <Button variant="ghost" size="sm" onClick={() => navigate("")}>
          ← All topics
        </Button>
      </div>
    </article>
  );
}
