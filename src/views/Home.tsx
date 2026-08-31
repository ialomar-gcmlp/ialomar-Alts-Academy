/**
 * Home — topics with their mastery, due counts and prerequisite locks.
 *
 * M3 turns this into the visual skill tree and M6 into the time-budgeted
 * "Start studying" entry point. What matters here is that the scheduler and mastery
 * engine are observable: if a review is due, you can see it and act on it.
 */

import { useMemo, useState } from "react";

import { manifest, manifestTopic } from "../content/loader";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { formatAgo } from "../lib/time";
import {
  domainProgress,
  dueQuestionIds,
  topicProgress,
  type TopicProgress,
} from "../state/selectors";
import { useApp } from "../state/store";
import { Badge, Button, Card, PageTitle } from "../ui/primitives";

function MasteryBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${Math.round(value * 100)}%` }}
        />
      </div>
      <span className="shrink-0 text-[12px] text-fg-subtle tnum">
        {Math.round(value * 100)}%
      </span>
    </div>
  );
}

function TopicCard({ progress }: { progress: TopicProgress }) {
  const { topic, unlocked, blockedBy, dueCount, mastery, started } = progress;
  const minutes = topic.estMinutes + Math.round(topic.questionSeconds / 60);

  return (
    <Card
      className={`flex flex-col ${unlocked ? "transition-colors hover:border-border-strong" : "opacity-70"}`}
    >
      <button
        type="button"
        onClick={() => navigate(`topic/${topic.id}`)}
        className="flex flex-1 flex-col p-5 text-left"
      >
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {topic.examRelevance.map((exam) => (
            <Badge key={exam} tone={exam === "practical" ? "accent" : "neutral"}>
              {exam === "practical" ? "on the job" : exam}
            </Badge>
          ))}
          {dueCount > 0 && <Badge tone="flag">{dueCount} due</Badge>}
          {topic.needsReview && <Badge tone="neutral">check</Badge>}
        </div>

        <h3 className="text-[17px] font-semibold leading-snug text-fg">{topic.title}</h3>
        <p className="mt-1.5 flex-1 text-[14px] leading-relaxed text-fg-muted">{topic.summary}</p>

        {started ? (
          <div className="mt-4">
            <MasteryBar value={mastery} />
          </div>
        ) : (
          <div className="mt-4 flex items-center gap-3 text-[13px] text-fg-subtle tnum">
            <span>~{minutes} min</span>
            <span aria-hidden>·</span>
            <span>
              {topic.questionCount} question{topic.questionCount === 1 ? "" : "s"}
            </span>
            <span aria-hidden>·</span>
            <span className="capitalize">{topic.level}</span>
          </div>
        )}
      </button>

      {/* A lock has to explain itself, or it just looks broken. */}
      {!unlocked && blockedBy.length > 0 && (
        <p className="border-t border-border-base px-5 py-2.5 text-[12.5px] leading-relaxed text-fg-subtle">
          Best done after{" "}
          {blockedBy.map((id) => manifestTopic(id)?.title ?? id).join(" and ")} — you can still
          open it.
        </p>
      )}
    </Card>
  );
}

export function Home() {
  const progress = useApp((s) => s.progress);
  const startReviewSession = useApp((s) => s.startReviewSession);
  const [starting, setStarting] = useState(false);

  // One timestamp for the whole render, so every derived number agrees.
  const now = useMemo(() => Date.now(), [progress]);
  const topics = useMemo(() => topicProgress(progress, now), [progress, now]);
  const domains = useMemo(() => domainProgress(topics), [topics]);
  const due = useMemo(() => dueQuestionIds(progress, now), [progress, now]);

  const totalQuestions = manifest.topics.reduce((n, t) => n + t.questionCount, 0);
  const answeredEver = Object.keys(progress.questions).length;
  const lastStudied = Object.values(progress.topics)
    .map((t) => t.lastStudiedAt)
    .filter((v): v is number => v !== null)
    .sort((a, b) => b - a)[0];

  const beginReview = async (): Promise<void> => {
    setStarting(true);
    try {
      const count = await startReviewSession(due);
      if (count > 0) navigate("review");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div>
      <PageTitle title="What would you like to learn?">
        Pick a topic to read the lesson, then work through its questions. Every specialist
        term is underlined — tap or hover it for a plain-English definition.
      </PageTitle>

      {/* Due reviews come first: they are the thing with a deadline. */}
      {due.length > 0 && (
        <Card className="mb-8 flex flex-wrap items-center justify-between gap-4 border-accent/40 p-5">
          <div>
            <p className="font-medium text-fg">
              {due.length} question{due.length === 1 ? "" : "s"} due for review
            </p>
            <p className="mt-0.5 text-[14px] text-fg-muted">
              Mixed across topics, most overdue first. This is the part that makes it stick.
            </p>
          </div>
          <Button size="lg" onClick={() => void beginReview()} disabled={starting}>
            {starting ? "Loading…" : "Review now"}
          </Button>
        </Card>
      )}

      <p className="mb-8 text-[13px] text-fg-subtle tnum">
        {manifest.topics.length} topics · {totalQuestions} questions ·{" "}
        {manifest.glossaryCount} glossary terms
        {answeredEver > 0 && ` · ${answeredEver} seen`}
        {lastStudied !== undefined && ` · last studied ${formatAgo(lastStudied, now)}`}
      </p>

      <div className="space-y-10">
        {domains.map((domain) => (
          <section key={domain.domain}>
            <div className="mb-3 flex items-baseline justify-between gap-4">
              <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
                {DOMAIN_LABELS[domain.domain as Domain]}
              </h2>
              {domain.mastery > 0 && (
                <span className="text-[12px] text-fg-subtle tnum">
                  {Math.round(domain.mastery * 100)}% mastery
                </span>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {domain.topics.map((t) => (
                <TopicCard key={t.topic.id} progress={t} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
