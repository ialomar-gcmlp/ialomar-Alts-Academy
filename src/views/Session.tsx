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

import { useEffect, useMemo, useRef, useState } from "react";

import { manifestTopic } from "../content/loader";
import {
  CONFIDENCE_LABELS,
  CONFIDENCE_LEVELS,
  isAnswerable,
  type Confidence,
} from "../engine/grading";
import { formatCountdown, remainingMs } from "../engine/exam";
import { formatDueIn } from "../lib/time";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import {
  selectCurrentItem,
  selectResumableSession,
  useApp,
} from "../state/store";
import { LessonBlockView } from "../ui/blocks/LessonBlocks";
import { VignettePanel } from "../ui/questions/VignettePanel";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import {
  Button,
  Card,
  EmptyState,
  Kbd,
  Monogram,
  Pips,
  type PipState,
} from "../ui/primitives";
import { Prose } from "../ui/Prose";
import { QuestionView, choiceCount } from "../ui/questions/QuestionView";
import { ExamResult } from "./ExamResult";
import { Result } from "./Result";

const CONFIDENCE_KEYS: Record<Confidence, string> = {
  confident: "C",
  unsure: "U",
  guessing: "G",
};

const CONFIDENCE_STYLES: Record<Confidence, { on: string; off: string }> = {
  confident: {
    on: "border-confident bg-confident text-accent-fg shadow-sm scale-105",
    off: "border-confident/40 text-confident hover:bg-confident/10",
  },
  unsure: {
    on: "border-unsure bg-unsure text-accent-fg shadow-sm scale-105",
    off: "border-unsure/40 text-unsure hover:bg-unsure/10",
  },
  guessing: {
    on: "border-guessing bg-guessing text-accent-fg shadow-sm scale-105",
    off: "border-guessing/40 text-guessing hover:bg-guessing/10",
  },
};

/**
 * How many correct in a row, right now, in this session.
 *
 * Not persisted and not worth XP — a combo is feedback, not currency. It exists
 * because "four in a row" is a reason to answer a fifth, and the honest version of
 * that motivation is a counter that resets the moment you miss one.
 */
function comboAt(
  items: { grade: { correct: boolean } | null }[],
  index: number,
): number {
  let run = 0;
  for (let i = index; i >= 0; i--) {
    const grade = items[i]?.grade;
    if (grade === null || grade === undefined || !grade.correct) break;
    run += 1;
  }
  return run;
}

/**
 * The exam countdown.
 *
 * Ticks once a second — the only interval in the app — and calls `onExpire` when it
 * reaches zero. It reads wall clock deliberately: `remainingMs` is derived from
 * `startedAt`, so a tab that was hidden for ten minutes comes back showing ten
 * minutes gone, which is what being timed means.
 *
 * Checks on mount too, because the tab may have been shut for longer than the paper.
 */
function ExamClock({
  startedAt,
  count,
  onExpire,
}: {
  startedAt: number;
  count: number;
  onExpire: () => void;
}) {
  const [left, setLeft] = useState(() =>
    remainingMs(startedAt, count, Date.now()),
  );

  useEffect(() => {
    const tick = (): void => {
      const ms = remainingMs(startedAt, count, Date.now());
      setLeft(ms);
      if (ms === 0) onExpire();
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, count, onExpire]);

  // Under two minutes the colour changes as well as the number, so it registers
  // without being read.
  const urgent = left <= 2 * 60_000;

  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-bold tnum ${
        urgent ? "bg-incorrect/15 text-incorrect" : "bg-surface-2 text-fg-muted"
      }`}
      // Announced on the minute rather than every second, which would be unusable
      // with a screen reader.
      aria-live={left % 60_000 < 1000 ? "polite" : "off"}
    >
      <Icon name="clock" size={13} />
      {formatCountdown(left)}
      <span className="sr-only"> remaining</span>
    </span>
  );
}

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
  const finishExam = useApp((s) => s.finishExam);
  const resumable = useApp(selectResumableSession);
  const pauseSession = useApp((s) => s.pauseSession);
  const resumeSession = useApp((s) => s.resumeSession);

  const [showExitConfirm, setShowExitConfirm] = useState(false);

  /**
   * Written during render on purpose: it has to be true before the redirect effect
   * below runs on the commit where the session goes away.
   */
  const hadSession = useRef(false);
  if (session !== null) hadSession.current = true;

  /**
   * A reload lands here with no session in memory. If a snapshot survived, go to the
   * home page, which is where the offer to pick it up lives; otherwise fall back to
   * the topic the session came from rather than showing an empty shell.
   *
   * Only for a session that was never here. Ending one deliberately — Leave, or an
   * exam being submitted — navigates on its own, and this effect used to fire
   * afterwards and overwrite that with the home page, so every Leave went home
   * regardless of where it said it was going.
   */
  useEffect(() => {
    if (session || hadSession.current) return;
    const home = resumable !== null || topicId === undefined;
    navigate(home ? "" : `topic/${topicId}`, { replace: true });
  }, [session, topicId, resumable]);

  /**
   * Active-time bookkeeping. The clock runs only while this view is mounted AND the
   * tab is visible, so a session left open in a background tab credits nothing.
   *
   * Pausing also writes the snapshot, which matters because a tab closed while
   * hidden never fires another event — this is the last chance to record the time.
   */
  useEffect(() => {
    if (!session || session.finishedAt !== null) return;

    resumeSession();
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") pauseSession();
      else resumeSession();
    };
    // A reload or a closed tab never runs React cleanup, so the span in progress has
    // to be banked from a real unload event or it is lost. `pagehide` is the one that
    // fires reliably; pauseSession is idempotent, so overlapping events are harmless.
    const onPageHide = (): void => pauseSession();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      pauseSession();
    };
    // Deliberately keyed on the session's identity rather than the whole object:
    // re-running this on every answer would restart the span and lose the time.
  }, [
    session === null,
    session?.startedAt,
    session?.finishedAt,
    pauseSession,
    resumeSession,
  ]);

  const graded = item?.grade ?? null;
  const isExam = session?.mode === "exam";

  /**
   * Focus follows the question.
   *
   * Advancing replaces the card's contents while focus stays on the button that was
   * pressed, so a keyboard or screen-reader user is left pointing at "Next question"
   * with no idea what is now on screen. Moving focus to the question heading fixes
   * that, and `tabIndex={-1}` makes the heading focusable without adding a tab stop.
   */
  const stemRef = useRef<HTMLDivElement>(null);
  const positionKey = `${session?.startedAt ?? 0}:${session?.index ?? 0}`;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      // Not on mount: stealing focus on arrival would scroll a fresh page.
      firstRender.current = false;
      return;
    }
    stemRef.current?.focus();
  }, [positionKey]);
  const answerable =
    item !== null && isAnswerable(item.question, item.response);
  // An exam does not ask for confidence, so an answer is all it waits for.
  const canSubmit =
    answerable && graded === null && (isExam || item?.confidence != null);

  const advance = (): void => {
    if (graded === null) {
      if (!canSubmit) return;
      submit();
      // One press per question in an exam: answer and move on, with no marking in
      // between. `next` reads the store synchronously, so it sees the answer just
      // recorded — and on the last question it hands over to finishExam.
      if (isExam) next();
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
        setResponse({
          kind: "tfj",
          isTrue: true,
          justificationIndex: current?.justificationIndex ?? null,
        });
      map["f"] = () =>
        setResponse({
          kind: "tfj",
          isTrue: false,
          justificationIndex: current?.justificationIndex ?? null,
        });
    }

    return map;
  }, [item, graded, setResponse]);

  useHotkeys(
    {
      ...numberKeys,
      c: () => !isExam && graded === null && setConfidence("confident"),
      u: () => !isExam && graded === null && setConfidence("unsure"),
      g: () => !isExam && graded === null && setConfidence("guessing"),
      Enter: advance,
      Space: () => !isExam && item !== null && !item.revealed && reveal(),
      Escape: () => setShowExitConfirm(true),
    },
    session !== null && session.finishedAt === null,
  );

  if (!session) return null;

  if (session.finishedAt !== null) {
    // An exam ends on a marked paper, not a session summary — different enough to be
    // its own view rather than branches through Result.
    return session.mode === "exam" ? <ExamResult /> : <Result />;
  }

  if (!item) {
    return <EmptyState title="This topic has no questions yet." />;
  }

  const total = session.items.length;
  const position = session.index + 1;
  const combo = comboAt(session.items, session.index);
  const pips: PipState[] = session.items.map((entry, i) => {
    if (entry.grade !== null) {
      // Neutral in an exam: how it went is not information the candidate gets yet.
      if (isExam) return "answered";
      return entry.grade.correct ? "correct" : "wrong";
    }
    return i === session.index ? "current" : "todo";
  });
  const topicMeta = manifestTopic(item.topicId);
  const conceptBlock =
    item.question.concept === undefined
      ? undefined
      : session.lessonBlocks[item.topicId]?.find(
          (b) => b.id === item.question.concept,
        );

  // The one case that earns a stronger intervention: sure and wrong.
  const confidentMiss =
    graded !== null && !graded.correct && item.confidence === "confident";

  return (
    <div>
      {/* Progress. Dots rather than a bar: how many are left is a countable number,
          and each one carries how that question went. */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold text-fg">{session.title}</span>
          <span className="text-[13px] text-fg-subtle tnum">
            {position}/{total}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {combo >= 2 && (
            <span
              key={combo}
              className="anim-pop flex items-center gap-1 rounded-full bg-streak/15 px-2.5 py-1 text-[12.5px] font-bold text-streak tnum"
            >
              <Icon name="flame" size={13} className="flame-live" />
              {combo} in a row
            </span>
          )}
          {isExam && (
            <ExamClock
              startedAt={session.startedAt}
              count={total}
              onExpire={finishExam}
            />
          )}
          <Pips states={pips} />
        </div>
      </div>

      <Card
        className="d-border overflow-hidden p-0"
        style={
          topicMeta === undefined ? undefined : domainStyle(topicMeta.domain)
        }
      >
        <span className="d-rail block h-1 w-full" aria-hidden />

        <div className="p-5 sm:p-7">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            {topicMeta !== undefined && (
              <Monogram code={DOMAIN_MONOGRAM[topicMeta.domain]} size={22} />
            )}
            {session.mode === "review" && topicMeta !== undefined && (
              <span className="d-text">{topicMeta.title}</span>
            )}
            {session.mode === "drill" && (
              <span className="text-accent">
                {item.drill?.direction === "meaning-to-term"
                  ? "Meaning to term"
                  : "Term to meaning"}
              </span>
            )}
            {session.mode !== "drill" && (
              <span className="flex items-center gap-1">
                {/* Difficulty as pips, so it registers without being read. */}
                {[1, 2, 3, 4, 5].map((n) => (
                  <span
                    key={n}
                    aria-hidden
                    className={`h-1.5 w-1.5 rounded-full ${n <= item.question.difficulty ? "d-fill" : "bg-border-strong/50"}`}
                  />
                ))}
                <span className="ml-1">
                  difficulty {item.question.difficulty}/5
                </span>
              </span>
            )}
            {item.wasFlaggedForReteach && (
              <span className="text-unsure">· missed twice before</span>
            )}
            {item.question.needsReview === true && (
              <span className="text-flag">· flagged for review</span>
            )}
          </div>

          <div ref={stemRef} tabIndex={-1} className="outline-none">
            {item.vignette !== null && <VignettePanel context={item.vignette} />}
            <QuestionView
              question={item.question}
              response={item.response}
              grade={graded}
              onRespond={setResponse}
              onSubmit={() => canSubmit && submit()}
            />
          </div>

          {/* Confidence — required before submitting, and never asked in an exam */}
          {graded === null && !isExam && (
            <div className="mt-7 border-t border-border-base pt-5">
              <div className="mb-2.5 text-[13px] text-fg-muted">
                How sure are you?{" "}
                <span className="text-fg-subtle">
                  (this shapes when it comes back)
                </span>
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
                      className={`tap inline-flex items-center gap-2 rounded-md border px-3.5 py-1.5 text-[14px] font-medium ${on ? CONFIDENCE_STYLES[level].on : CONFIDENCE_STYLES[level].off}`}
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

          {/* Verdict + explanation. An exam marks the whole paper at the end.
              `role="status"` announces the outcome: without it the only signal that
              an answer was graded is colour and an icon. */}
          {graded !== null && !isExam && (
            <div
              className="mt-7 border-t border-border-base pt-5"
              role="status"
              aria-live="polite"
            >
              <div
                key={item.question.id}
                className={`anim-pop relative mb-4 flex flex-wrap items-center gap-2.5 overflow-visible rounded-lg px-3.5 py-2.5 ${
                  graded.correct
                    ? "bg-correct-soft text-correct"
                    : "bg-incorrect-soft text-incorrect"
                }`}
              >
                <span
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-white ${
                    graded.correct ? "bg-correct flare" : "bg-incorrect"
                  }`}
                >
                  <Icon name={graded.correct ? "check" : "cross"} size={16} />
                </span>
                <span className="text-[16px] font-bold">
                  {graded.correct ? "Correct" : "Not quite"}
                </span>
                {item.confidence !== null && (
                  <span className="text-[13px] opacity-75">
                    you said {CONFIDENCE_LABELS[item.confidence].toLowerCase()}
                  </span>
                )}

                {/* XP earned, leaving the answer it came from. Absence is information
                  too — a repeat question pays nothing and says so on the Result page. */}
                {item.xpAwarded > 0 && (
                  <span className="ml-auto flex items-center gap-1 text-[15px] font-bold text-xp tnum">
                    <span className="xp-burst flex items-center gap-1">
                      <Icon name="bolt" size={14} />+{item.xpAwarded} XP
                    </span>
                  </span>
                )}
              </div>

              {/* Calibration feedback — the point of tagging confidence */}
              {confidentMiss && (
                <p className="mb-4 rounded-md border border-incorrect bg-incorrect-soft px-3.5 py-2.5 text-[14px] leading-relaxed text-incorrect">
                  You were sure and it was wrong — the most useful kind of
                  mistake, and the one worth slowing down for. This will come
                  back soon.
                </p>
              )}
              {!graded.correct && item.confidence === "guessing" && (
                <p className="mb-4 text-[14px] text-fg-muted">
                  Wrong, but you knew you were guessing — that is
                  well-calibrated. Read the explanation and it will come back.
                </p>
              )}
              {graded.correct && item.confidence !== "confident" && (
                <p className="mb-4 text-[14px] text-fg-muted">
                  Right, but you were not sure. It will come back sooner than a
                  confident answer would, so the knowledge sticks.
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

              {item.question.needsReview === true &&
                item.question.reviewNote != null && (
                  <p className="mt-4 rounded-md border border-flag bg-flag-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-flag">
                    <strong className="font-semibold">Verify this one: </strong>
                    {item.question.reviewNote}
                  </p>
                )}
            </div>
          )}
        </div>
      </Card>

      {/* Controls */}
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowExitConfirm(true)}
        >
          Leave <Kbd>Esc</Kbd>
        </Button>

        <div className="flex items-center gap-3">
          {graded === null && !answerable && (
            <span className="text-[13px] text-fg-subtle">Choose an answer</span>
          )}
          {graded === null && answerable && !isExam && item.confidence === null && (
            <span className="text-[13px] text-fg-subtle">
              Now tag your confidence
            </span>
          )}
          <Button
            size="lg"
            disabled={graded === null && !canSubmit}
            onClick={advance}
          >
            {isExam
              ? session.index === total - 1
                ? "Submit paper"
                : "Next question"
              : graded === null
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
          <p className="font-medium text-fg">
            {isExam ? "Leave the exam?" : "Leave this set?"}
          </p>
          <p className="mt-1 text-[14px] text-fg-muted">
            {isExam
              ? "The clock keeps running — an exam is timed whether the tab is open or not. Come back before it expires and you carry on; come back after and it is marked as it stands."
              : "Your place is saved. You can pick this up from the home page for the next twelve hours — answers already submitted are recorded either way."}
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                endQuiz();
                // Back where you came from: the exam list, the topic, or home.
                navigate(
                  isExam ? "exams" : topicId === undefined ? "" : `topic/${topicId}`,
                );
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
