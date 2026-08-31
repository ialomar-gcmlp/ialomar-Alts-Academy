/**
 * Session — the answer loop.
 *
 * The confidence tag is required before submitting. That is deliberate: calibration
 * data is what makes confident-and-wrong resurface fast and unsure-and-right still
 * schedule a review (CLAUDE.md §6), and it is worth one extra keystroke.
 *
 * Fully keyboard-driven: 1-9 pick, C/U/G tag confidence, Enter submit then advance,
 * Space reveals the explanation, Esc leaves.
 */

import { useEffect, useMemo, useState } from "react";

import { manifestTopic } from "../content/loader";
import { CONFIDENCE_LABELS, CONFIDENCE_LEVELS, isAnswerable, type Confidence } from "../engine/grading";
import { formatDueIn } from "../lib/time";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { selectCurrentItem, useApp } from "../state/store";
import { LessonBlockView } from "../ui/blocks/LessonBlocks";
import { Button, Card, EmptyState, Kbd } from "../ui/primitives";
import { Prose } from "../ui/Prose";
import { QuestionView, choiceCount } from "../ui/questions/QuestionView";
import { Result } from "./Result";

const CONFIDENCE_KEYS: Record<Confidence, string> = {
  confident: "C",
  unsure: "U",
  guessing: "G",
};

const CONFIDENCE_STYLES: Record<Confidence, { on: string; off: string }> = {
  confident: {
    on: "border-confident bg-confident text-accent-fg",
    off: "border-border-strong text-confident hover:bg-surface-2",
  },
  unsure: {
    on: "border-unsure bg-unsure text-accent-fg",
    off: "border-border-strong text-unsure hover:bg-surface-2",
  },
  guessing: {
    on: "border-guessing bg-guessing text-accent-fg",
    off: "border-border-strong text-guessing hover:bg-surface-2",
  },
};

export function Session({ topicId }: { topicId?: string }) {
  const session = useApp((s) => s.session);
  const item = useApp(selectCurrentItem);
  // Selected one at a time on purpose: Zustand v5 has no default equality check, so
  // a selector returning a fresh object would re-render on every store change.
  const setResponse = useApp((s) => s.setResponse);
  const setConfidence = useApp((s) => s.setConfidence);
  const submit = useApp((s) => s.submit);
  const next = useApp((s) => s.next);
  const reveal = useApp((s) => s.reveal);
  const endQuiz = useApp((s) => s.endQuiz);

  const [showExitConfirm, setShowExitConfirm] = useState(false);

  // A reload lands here with no session in memory. Go back to wherever the session
  // came from rather than showing an empty shell. (M6 restores it from storage instead.)
  useEffect(() => {
    if (!session) navigate(topicId === undefined ? "" : `topic/${topicId}`, { replace: true });
  }, [session, topicId]);

  const graded = item?.grade ?? null;
  const answerable = item !== null && isAnswerable(item.question, item.response);
  const canSubmit = answerable && item?.confidence != null && graded === null;

  const advance = (): void => {
    if (graded === null) {
      if (canSubmit) submit();
      return;
    }
    next();
  };

  const numberKeys = useMemo(() => {
    if (!item || graded !== null) return {};
    const count = choiceCount(item.question);
    const map: Record<string, () => void> = {};

    for (let i = 0; i < Math.min(count, 9); i++) {
      map[String(i + 1)] = () => {
        if (item.question.type === "tfj") {
          const current = item.response?.kind === "tfj" ? item.response : null;
          setResponse({
            kind: "tfj",
            isTrue: current?.isTrue ?? null,
            justificationIndex: i,
          });
        } else {
          setResponse({ kind: "choice", choiceIndex: i });
        }
      };
    }

    // True/false needs its own keys, since the digits are taken by justifications.
    if (item.question.type === "tfj") {
      const current = item.response?.kind === "tfj" ? item.response : null;
      map["t"] = () =>
        setResponse({ kind: "tfj", isTrue: true, justificationIndex: current?.justificationIndex ?? null });
      map["f"] = () =>
        setResponse({ kind: "tfj", isTrue: false, justificationIndex: current?.justificationIndex ?? null });
    }

    return map;
  }, [item, graded, setResponse]);

  useHotkeys(
    {
      ...numberKeys,
      c: () => graded === null && setConfidence("confident"),
      u: () => graded === null && setConfidence("unsure"),
      g: () => graded === null && setConfidence("guessing"),
      Enter: advance,
      Space: () => item !== null && !item.revealed && reveal(),
      Escape: () => setShowExitConfirm(true),
    },
    session !== null && session.finishedAt === null,
  );

  if (!session) return null;

  if (session.finishedAt !== null) {
    return <Result />;
  }

  if (!item) {
    return <EmptyState title="This topic has no questions yet." />;
  }

  const total = session.items.length;
  const position = session.index + 1;
  const conceptBlock =
    item.question.concept === undefined
      ? undefined
      : session.lessonBlocks[item.topicId]?.find((b) => b.id === item.question.concept);

  // The one case that earns a stronger intervention: sure and wrong.
  const confidentMiss = graded !== null && !graded.correct && item.confidence === "confident";

  return (
    <div>
      {/* Progress */}
      <div className="mb-6">
        <div className="mb-2 flex items-baseline justify-between text-[13px] text-fg-muted">
          <span className="font-medium text-fg">{session.title}</span>
          <span className="tnum">
            {position} of {total}
          </span>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${(session.index / total) * 100}%` }}
          />
        </div>
      </div>

      <Card className="p-5 sm:p-7">
        <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          {session.mode === "review" && (
            <span className="text-accent">{manifestTopic(item.topicId)?.title ?? item.topicId}</span>
          )}
          {session.mode === "drill" && (
            <span className="text-accent">
              {item.drill?.direction === "meaning-to-term" ? "Meaning to term" : "Term to meaning"}
            </span>
          )}
          {session.mode !== "drill" && <span>Difficulty {item.question.difficulty}/5</span>}
          {item.wasFlaggedForReteach && (
            <span className="text-unsure">· missed twice before</span>
          )}
          {item.question.needsReview === true && (
            <span className="text-flag">· flagged for review</span>
          )}
        </div>

        <QuestionView
          question={item.question}
          response={item.response}
          grade={graded}
          onRespond={setResponse}
          onSubmit={() => canSubmit && submit()}
        />

        {/* Confidence — required before submitting */}
        {graded === null && (
          <div className="mt-7 border-t border-border-base pt-5">
            <div className="mb-2.5 text-[13px] text-fg-muted">
              How sure are you? <span className="text-fg-subtle">(this shapes when it comes back)</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {CONFIDENCE_LEVELS.map((level) => {
                const on = item.confidence === level;
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setConfidence(level)}
                    aria-pressed={on}
                    className={`inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-[14px] font-medium ${on ? CONFIDENCE_STYLES[level].on : CONFIDENCE_STYLES[level].off}`}
                  >
                    {CONFIDENCE_LABELS[level]}
                    <span
                      className={`rounded px-1 font-mono text-[10px] ${on ? "bg-black/15" : "bg-surface-2"}`}
                    >
                      {CONFIDENCE_KEYS[level]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Verdict + explanation */}
        {graded !== null && (
          <div className="mt-7 border-t border-border-base pt-5">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span
                className={`text-[15px] font-semibold ${graded.correct ? "text-correct" : "text-incorrect"}`}
              >
                {graded.correct ? "Correct" : "Not quite"}
              </span>
              {item.confidence !== null && (
                <span className="text-[13px] text-fg-subtle">
                  · you said {CONFIDENCE_LABELS[item.confidence].toLowerCase()}
                </span>
              )}
            </div>

            {/* Calibration feedback — the point of tagging confidence */}
            {confidentMiss && (
              <p className="mb-4 rounded-md border border-incorrect bg-incorrect-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-incorrect">
                You were sure and it was wrong — the most useful kind of mistake, and the one
                worth slowing down for. This will come back soon.
              </p>
            )}
            {!graded.correct && item.confidence === "guessing" && (
              <p className="mb-4 text-[14px] text-fg-muted">
                Wrong, but you knew you were guessing — that is well-calibrated. Read the
                explanation and it will come back.
              </p>
            )}
            {graded.correct && item.confidence !== "confident" && (
              <p className="mb-4 text-[14px] text-fg-muted">
                Right, but you were not sure. It will come back sooner than a confident
                answer would, so the knowledge sticks.
              </p>
            )}

            <Prose text={item.question.explanation} className="text-[15px]" />

            {/* Re-teach rather than just marking it wrong */}
            {confidentMiss && conceptBlock !== undefined && (
              <div className="mt-5 rounded-lg border border-border-strong bg-surface-2 p-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
                  Worth re-reading
                </div>
                <LessonBlockView block={conceptBlock} />
              </div>
            )}

            {item.scheduled !== null && (
              <p className="mt-4 text-[13px] text-fg-subtle">
                Back {formatDueIn(item.scheduled.dueAt, Date.now())}.
                {item.scheduled.needsReteach
                  ? " Missed twice running, so it will come back easier and with the concept attached."
                  : ""}
              </p>
            )}

            {item.question.needsReview === true && item.question.reviewNote != null && (
              <p className="mt-4 rounded-md border border-flag bg-flag-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-flag">
                <strong className="font-semibold">Verify this one: </strong>
                {item.question.reviewNote}
              </p>
            )}
          </div>
        )}
      </Card>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button variant="ghost" size="sm" onClick={() => setShowExitConfirm(true)}>
          Leave <Kbd>Esc</Kbd>
        </Button>

        <div className="flex items-center gap-3">
          {graded === null && !answerable && (
            <span className="text-[13px] text-fg-subtle">Choose an answer</span>
          )}
          {graded === null && answerable && item.confidence === null && (
            <span className="text-[13px] text-fg-subtle">Now tag your confidence</span>
          )}
          <Button size="lg" disabled={graded === null && !canSubmit} onClick={advance}>
            {graded === null
              ? "Check answer"
              : session.index === total - 1
                ? "See results"
                : "Next question"}{" "}
            <Kbd>Enter</Kbd>
          </Button>
        </div>
      </div>

      {showExitConfirm && (
        <Card className="mt-5 p-5">
          <p className="font-medium text-fg">Leave this set?</p>
          <p className="mt-1 text-[14px] text-fg-muted">
            M1 does not save partial progress yet — session resume arrives in M6.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                endQuiz();
                navigate(topicId === undefined ? "" : `topic/${topicId}`);
              }}
            >
              Leave
            </Button>
            <Button variant="ghost" onClick={() => setShowExitConfirm(false)}>
              Keep going
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
