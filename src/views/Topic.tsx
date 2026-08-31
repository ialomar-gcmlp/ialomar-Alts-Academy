/**
 * Topic — the lesson.
 *
 * Loads the topic body lazily, renders its blocks, and hands off to the quiz.
 */

import { useEffect, useState } from "react";

import { loadTopic } from "../content/loader";
import { DOMAIN_LABELS, type Topic as TopicData } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { useApp } from "../state/store";
import { Lesson } from "../ui/blocks/LessonBlocks";
import { Badge, Button, Card, EmptyState, Kbd, PageTitle } from "../ui/primitives";

export function Topic({ id }: { id: string }) {
  const [topic, setTopic] = useState<TopicData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startTopicQuiz = useApp((s) => s.startTopicQuiz);

  useEffect(() => {
    let cancelled = false;
    setTopic(null);
    setError(null);

    loadTopic(id)
      .then((loaded) => {
        if (!cancelled) setTopic(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

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
    <article>
      <PageTitle eyebrow={DOMAIN_LABELS[topic.domain]} title={topic.title}>
        {topic.summary}
      </PageTitle>

      <div className="mb-8 flex flex-wrap items-center gap-2 text-[13px] text-fg-subtle">
        {topic.examRelevance.map((exam) => (
          <Badge key={exam} tone={exam === "practical" ? "accent" : "neutral"}>
            {exam === "practical" ? "on the job" : exam}
          </Badge>
        ))}
        <span className="tnum">~{topic.estMinutes} min read</span>
        <span aria-hidden>·</span>
        <span className="tnum">
          {topic.questions.length} questions, ~{questionMinutes} min
        </span>
      </div>

      <Lesson blocks={topic.lesson} />

      <Card className="mt-10 flex flex-wrap items-center justify-between gap-4 p-5">
        <div>
          <p className="font-medium text-fg">Ready to test it?</p>
          <p className="mt-0.5 text-[14px] text-fg-muted">
            {topic.questions.length} questions. You will tag how confident you are on each
            one — that matters more than the score.
          </p>
        </div>
        <Button size="lg" onClick={begin}>
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
