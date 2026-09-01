/**
 * The exam result: a mark, a diagnosis, and the whole paper to go back through.
 *
 * Separate from `Result` because an exam ends differently. There is no calibration
 * to report — an exam never asked how sure you were — and there is a marking pass
 * that the other modes do question by question as they go. The review is the part
 * that makes the exam worth sitting: a score on its own teaches nothing.
 *
 * A question left blank when the clock ran out is shown as **not reached** and marked
 * wrong, matching how it was scored. Hiding it would make a timed-out paper look like
 * a shorter one.
 */

import { useMemo, useState } from "react";

import { DOMAIN_LABELS, type Domain, type LessonBlock } from "../content/schema";
import { examBreakdown, hasExpired, scoreExam } from "../engine/exam";
import { manifestTopic } from "../content/loader";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { formatDueIn } from "../lib/time";
import { useApp, type QuizItem } from "../state/store";
import { LessonBlockView } from "../ui/blocks/LessonBlocks";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import { Prose, Inline } from "../ui/Prose";
import { QuestionView } from "../ui/questions/QuestionView";
import { VignettePanel } from "../ui/questions/VignettePanel";
import { Badge, Button, Card, Kbd, Meter, Monogram, Ring } from "../ui/primitives";

export function ExamResult() {
  const session = useApp((s) => s.session);
  const endQuiz = useApp((s) => s.endQuiz);
  // The first thing worth reading is open from the start — a wall of collapsed rows
  // invites closing the page. Seeded as state rather than forced open by position, so
  // that row can still be collapsed like any other.
  const [openId, setOpenId] = useState<string | null>(() => {
    if (!session) return null;
    const firstMiss = session.items.find((item) => item.grade?.correct !== true);
    return (firstMiss ?? session.items[0])?.question.id ?? null;
  });

  const leave = (): void => {
    endQuiz();
    navigate("exams");
  };

  useHotkeys({ Enter: leave }, session !== null);

  if (!session) return null;

  const domain = (session.examDomain ?? "") as Domain;
  const finishedAt = session.finishedAt ?? Date.now();
  const score = scoreExam(
    session.items.map((item) => ({
      correct: item.grade === null ? null : item.grade.correct,
    })),
  );
  const pct = Math.round(score.fraction * 100);
  const minutes = Math.max(1, Math.round((finishedAt - session.startedAt) / 60_000));
  const notReached = score.total - score.answered;
  // Blank answers mean one of two different things, and the wording has to match:
  // the clock beat you, or you handed the paper in early.
  const expired = hasExpired(session.startedAt, score.total, finishedAt);

  const rows = examBreakdown(
    session.items.map((item) => ({
      topicId: item.topicId,
      correct: item.grade === null ? null : item.grade.correct,
    })),
  );

  // Wrong first, in paper order within that: the point of the review is the misses,
  // but the order should still be recognisable as the exam you just sat.
  const missed = session.items.filter((item) => item.grade?.correct !== true);

  return (
    <div style={domainStyle(domain)}>
      <Card className="d-border relative mb-6 overflow-hidden p-0">
        <span
          aria-hidden
          className={`block h-1.5 w-full ${score.passed ? "bg-correct" : "bg-incorrect"}`}
        />

        <div className="flex flex-wrap items-center gap-6 p-5 sm:p-6">
          <Ring
            value={score.fraction}
            size={104}
            thickness={9}
            color={score.passed ? "var(--p-correct)" : "var(--p-incorrect)"}
          >
            <span className="flex flex-col items-center leading-none">
              <span className="text-[26px] font-bold text-fg tnum">{pct}%</span>
              <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-fg-subtle tnum">
                {score.correct}/{score.total}
              </span>
            </span>
          </Ring>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest">
              <Monogram code={DOMAIN_MONOGRAM[domain]} size={20} />
              <span className="d-text">{DOMAIN_LABELS[domain]} exam</span>
            </div>

            <h1 className="mt-1.5 flex flex-wrap items-center gap-3 text-[24px] font-bold leading-tight tracking-tight text-fg sm:text-[28px]">
              {score.passed ? "Passed." : "Not this time."}
              <Badge tone={score.passed ? "correct" : "incorrect"}>
                pass mark {Math.round(score.passFraction * 100)}%
              </Badge>
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-4 text-[13px] text-fg-muted tnum">
              <span className="flex items-center gap-1.5">
                <Icon name="clock" size={13} />
                {minutes} min{minutes === 1 ? "" : "s"}
              </span>
              {notReached > 0 && (
                <span className="flex items-center gap-1.5 text-incorrect">
                  <Icon name="alert" size={13} />
                  {notReached} not reached
                </span>
              )}
              <span className="flex items-center gap-1.5">
                <Icon name="bolt" size={13} />
                {session.items.reduce((n, i) => n + i.xpAwarded, 0)} XP
              </span>
            </div>

            <p className="mt-3 max-w-measure text-[14px] leading-relaxed text-fg-muted">
              {verdictSentence(score.passed, notReached, expired, rows)}
            </p>
          </div>
        </div>
      </Card>

      {/* The diagnosis. Weakest topic first, because this list is a to-do. */}
      <h2 className="mb-3 text-[15px] font-bold text-fg">By topic</h2>
      <Card className="mb-6 divide-y divide-border-base p-0">
        {rows.map((row) => {
          const title = manifestTopic(row.topicId)?.title ?? row.topicId;
          const share = row.correct / row.total;
          return (
            <div key={row.topicId} className="flex items-center gap-4 px-4 py-3">
              <button
                type="button"
                onClick={() => navigate(`topic/${row.topicId}`)}
                className="min-w-0 flex-1 text-left text-[14px] font-medium text-fg hover:underline"
              >
                {title}
              </button>
              <span className="w-24 shrink-0">
                <Meter
                  value={share}
                  color={share === 1 ? "var(--p-correct)" : share === 0 ? "var(--p-incorrect)" : "var(--p-accent)"}
                />
              </span>
              <span className="w-12 shrink-0 text-right text-[13px] text-fg-muted tnum">
                {row.correct}/{row.total}
              </span>
            </div>
          );
        })}
      </Card>

      {/* The review. Misses lead; the full paper is one click away. */}
      <h2 className="mb-3 text-[15px] font-bold text-fg">
        {missed.length === 0 ? "The paper" : `What went wrong (${missed.length})`}
      </h2>

      <div className="space-y-3">
        {(missed.length === 0 ? session.items : missed).map((item) => (
          <ReviewRow
            key={item.question.id}
            item={item}
            n={session.items.indexOf(item) + 1}
            open={openId === item.question.id}
            onToggle={() =>
              setOpenId(openId === item.question.id ? null : item.question.id)
            }
            lessonBlocks={session.lessonBlocks[item.topicId] ?? []}
          />
        ))}
      </div>

      {missed.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer text-[13.5px] text-fg-muted hover:text-fg">
            Show the {score.total - missed.length} you got right
          </summary>
          <div className="mt-3 space-y-3">
            {session.items
              .filter((item) => item.grade?.correct === true)
              .map((item) => (
                <ReviewRow
                  key={item.question.id}
                  item={item}
                  n={session.items.indexOf(item) + 1}
                  open={openId === item.question.id}
                  onToggle={() =>
                    setOpenId(openId === item.question.id ? null : item.question.id)
                  }
                  lessonBlocks={session.lessonBlocks[item.topicId] ?? []}
                />
              ))}
          </div>
        </details>
      )}

      <div className="mt-8 flex flex-wrap gap-2">
        <Button size="lg" onClick={leave}>
          Back to exams <Kbd>Enter</Kbd>
        </Button>
        <Button variant="secondary" onClick={() => navigate("")}>
          Topics
        </Button>
      </div>
    </div>
  );
}

/** One sentence on what the mark means and where to go, ordered by what matters. */
function verdictSentence(
  passed: boolean,
  notReached: number,
  expired: boolean,
  rows: { topicId: string; correct: number; total: number }[],
): string {
  const weakest = rows[0];
  const weakestTitle =
    weakest === undefined ? null : (manifestTopic(weakest.topicId)?.title ?? weakest.topicId);

  if (notReached > 0 && expired) {
    return `You ran out of time with ${notReached} left, and those count as wrong — pace is part of the result. ${
      passed
        ? "You passed anyway."
        : "Sitting it again with an eye on the clock is worth more than more reading."
    }`;
  }
  if (notReached > 0) {
    return `You handed it in with ${notReached} unanswered, and a blank counts as wrong. ${
      passed ? "Still a pass." : "The mark is what it is; the misses below are the useful part."
    }`;
  }
  if (passed && rows.every((row) => row.correct === row.total)) {
    return "Every topic clean. The scheduler still has these coming back — passing once is not the same as retaining.";
  }
  if (passed) {
    return `Passed, with ${weakestTitle} the weakest patch. Every answer here went to the scheduler, so the misses are already queued to come back.`;
  }
  return `Start with ${weakestTitle}. Every answer went to the scheduler, so the misses are queued — clear those before sitting this again.`;
}

/**
 * One question from the paper: the mark, the stem, and the full question with its
 * explanation when opened.
 *
 * Collapsed by default. A twenty-question paper fully expanded is a wall of text
 * nobody reads; the mark and the stem are enough to decide what to look at.
 */
function ReviewRow({
  item,
  n,
  open,
  onToggle,
  lessonBlocks,
}: {
  item: QuizItem;
  n: number;
  open: boolean;
  onToggle: () => void;
  lessonBlocks: LessonBlock[];
}) {
  const q = item.question;
  const stem = q.type === "strategyId" ? q.description : "stem" in q ? q.stem : "Question";
  const correct = item.grade?.correct === true;
  const answered = item.grade !== null;

  const conceptBlock = useMemo(
    () =>
      q.concept === undefined
        ? undefined
        : lessonBlocks.find((block) => block.id === q.concept),
    [q.concept, lessonBlocks],
  );

  return (
    <Card className="overflow-hidden p-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 p-4 text-left hover:bg-surface-2"
      >
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white ${
            correct ? "bg-correct" : answered ? "bg-incorrect" : "bg-border-strong"
          }`}
        >
          <Icon name={correct ? "check" : "cross"} size={13} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            <span className="tnum">Q{n}</span>
            <span>{manifestTopic(item.topicId)?.title ?? item.topicId}</span>
            {!answered && <span className="text-incorrect">· not reached</span>}
            {item.scheduled !== null && (
              <span className="normal-case tracking-normal text-fg-subtle tnum">
                · back {formatDueIn(item.scheduled.dueAt, Date.now())}
              </span>
            )}
          </span>
          {/* Hidden when open: the question below repeats the stem in full, and two
              copies of it one above the other reads as a rendering bug. */}
          {!open && (
            <span className="mt-1 block text-[14.5px] leading-relaxed text-fg">
              <Inline text={stem} interactive={false} />
            </span>
          )}
        </span>

        <span className="mt-1 shrink-0 text-fg-subtle">
          <Icon
            name="arrow"
            size={14}
            className={open ? "-rotate-90" : "rotate-90"}
          />
        </span>
      </button>

      {open && (
        <div className="border-t border-border-base p-4 sm:p-5">
          {/* A vignette sub is meaningless without its case, especially in a review
              of a paper sat an hour ago. */}
          {item.vignette !== null && <VignettePanel context={item.vignette} />}

          {/* Read-only: the same renderer as the exam, with grading shown and no
              handler that could change the answer after the fact. */}
          <QuestionView
            question={q}
            response={item.response}
            grade={item.grade}
            onRespond={() => undefined}
            onSubmit={() => undefined}
          />

          <div className="mt-5 border-t border-border-base pt-4">
            <Prose text={q.explanation} className="text-[14.5px]" />
          </div>

          {!correct && conceptBlock !== undefined && (
            <div className="mt-5 rounded-lg border border-border-strong bg-surface-2 p-4">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                Worth re-reading
              </div>
              <LessonBlockView block={conceptBlock} />
            </div>
          )}

          {q.needsReview === true && q.reviewNote != null && (
            <p className="mt-4 rounded-md border border-flag bg-flag-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-flag">
              <strong className="font-semibold">Verify this one: </strong>
              {q.reviewNote}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
