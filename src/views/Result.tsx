/**
 * Result — the end-of-session summary.
 *
 * Three things, in the order they matter: what you got right, what is coming back
 * and when, and one sentence on what to focus on next.
 *
 * Calibration is reported alongside score on purpose. The score is the less
 * interesting number — being wrong while sure is the thing worth acting on.
 */

import { CONFIDENCE_LABELS, type Confidence } from "../engine/grading";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { formatDueIn } from "../lib/time";
import { useApp, type QuizItem } from "../state/store";
import { Button, Card, Kbd, PageTitle } from "../ui/primitives";
import { Inline } from "../ui/Prose";

/** Static, because Tailwind cannot see a class name built at runtime. */
const CONFIDENCE_TEXT: Record<Confidence, string> = {
  confident: "text-confident",
  unsure: "text-unsure",
  guessing: "text-guessing",
};

interface Tally {
  correct: number;
  total: number;
  confidentWrong: QuizItem[];
  unsureRight: QuizItem[];
  wrong: QuizItem[];
  byConfidence: Record<Confidence, { correct: number; total: number }>;
  /** Everything the scheduler will show again within a day. */
  returningSoon: QuizItem[];
}

const DAY_MS = 86_400_000;

function tally(items: QuizItem[], now: number): Tally {
  const graded = items.filter((i) => i.grade !== null);
  const byConfidence: Tally["byConfidence"] = {
    confident: { correct: 0, total: 0 },
    unsure: { correct: 0, total: 0 },
    guessing: { correct: 0, total: 0 },
  };

  for (const item of graded) {
    if (item.confidence === null) continue;
    const bucket = byConfidence[item.confidence];
    bucket.total += 1;
    if (item.grade?.correct === true) bucket.correct += 1;
  }

  return {
    correct: graded.filter((i) => i.grade?.correct === true).length,
    total: graded.length,
    confidentWrong: graded.filter((i) => i.confidence === "confident" && i.grade?.correct !== true),
    unsureRight: graded.filter((i) => i.confidence !== "confident" && i.grade?.correct === true),
    wrong: graded.filter((i) => i.grade?.correct !== true),
    byConfidence,
    // Sorted soonest first, which is the order the user will actually meet them.
    returningSoon: graded
      .filter((i) => i.scheduled !== null && i.scheduled.dueAt - now <= 2 * DAY_MS)
      .sort((a, b) => (a.scheduled?.dueAt ?? 0) - (b.scheduled?.dueAt ?? 0)),
  };
}

/** One sentence on what to do next, ordered by what actually matters. */
function focusSentence(t: Tally): string {
  if (t.total === 0) return "Nothing answered yet.";

  if (t.confidentWrong.length > 0) {
    return `Start with the ${t.confidentWrong.length === 1 ? "question" : `${t.confidentWrong.length} questions`} you were sure about and got wrong — a confident miss means the underlying model is off, not just the recall. The scheduler has already pulled them forward.`;
  }
  if (t.wrong.length > 0) {
    return `Re-read the concepts behind the ${t.wrong.length} you missed. You flagged uncertainty on ${t.wrong.length === 1 ? "it" : "them"}, which is the right instinct — now close the gap.`;
  }
  if (t.unsureRight.length > 0) {
    return `All correct, but you were unsure on ${t.unsureRight.length} of them. Those are scheduled back sooner than a confident answer would be — right-but-unsure fades fastest.`;
  }
  return "Clean sweep, and you were sure throughout. Intervals have stretched accordingly; move on to a harder topic rather than re-reading this one.";
}

function ItemLine({ item, now }: { item: QuizItem; now: number }) {
  const q = item.question;
  const stem = q.type === "strategyId" ? q.description : "stem" in q ? q.stem : "Question";

  return (
    <li className="flex items-start gap-2.5 py-1.5 text-[14px] leading-relaxed">
      <span
        aria-hidden
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${item.grade?.correct === true ? "bg-correct" : "bg-incorrect"}`}
      />
      <span className="flex-1 text-fg-muted">
        <Inline text={stem.length > 100 ? `${stem.slice(0, 100)}…` : stem} interactive={false} />
      </span>
      {item.scheduled !== null && (
        <span className="shrink-0 text-[13px] text-fg-subtle tnum">
          {formatDueIn(item.scheduled.dueAt, now)}
        </span>
      )}
    </li>
  );
}

export function Result() {
  const session = useApp((s) => s.session);
  const endQuiz = useApp((s) => s.endQuiz);

  const leave = (): void => {
    const topicId = session?.topicId;
    endQuiz();
    navigate(topicId === null || topicId === undefined ? "" : `topic/${topicId}`);
  };

  useHotkeys({ Enter: leave }, session !== null);

  if (!session) return null;

  const now = session.finishedAt ?? Date.now();
  const t = tally(session.items, now);
  const pct = t.total === 0 ? 0 : Math.round((t.correct / t.total) * 100);
  const minutes = Math.max(1, Math.round((now - session.startedAt) / 60000));

  return (
    <div>
      <PageTitle eyebrow={session.title} title="Set complete" />

      {/* Score and calibration side by side — calibration is the more useful half */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Card className="p-5">
          <div className="text-[13px] text-fg-muted">Score</div>
          <div className="mt-1 text-3xl font-semibold text-fg tnum">
            {t.correct}
            <span className="text-fg-subtle">/{t.total}</span>
            <span className="ml-2 text-lg font-normal text-fg-muted">{pct}%</span>
          </div>
          <div className="mt-1 text-[13px] text-fg-subtle tnum">
            {minutes} min{minutes === 1 ? "" : "s"}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-2 text-[13px] text-fg-muted">Calibration</div>
          <dl className="space-y-1 text-[14px]">
            {(["confident", "unsure", "guessing"] as const).map((level) => {
              const b = t.byConfidence[level];
              if (b.total === 0) return null;
              return (
                <div key={level} className="flex items-baseline justify-between gap-3">
                  <dt className={CONFIDENCE_TEXT[level]}>{CONFIDENCE_LABELS[level]}</dt>
                  <dd className="text-fg-muted tnum">
                    {b.correct}/{b.total} right
                  </dd>
                </div>
              );
            })}
          </dl>
          {t.confidentWrong.length > 0 && (
            <p className="mt-3 text-[13px] leading-relaxed text-incorrect">
              {t.confidentWrong.length} confident{" "}
              {t.confidentWrong.length === 1 ? "answer was" : "answers were"} wrong.
            </p>
          )}
        </Card>
      </div>

      {/* What to focus on next */}
      <Card className="mb-6 p-5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-accent">
          What to focus on next
        </div>
        <p className="max-w-measure leading-relaxed text-fg">{focusSentence(t)}</p>
      </Card>

      {/* Coming back — real scheduling, from the scheduler itself */}
      <Card className="mb-6 p-5">
        <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Coming back soon
        </div>
        {t.returningSoon.length === 0 ? (
          <p className="text-[14px] text-fg-muted">
            Nothing due in the next couple of days — every question in this set has been
            pushed further out.
          </p>
        ) : (
          <>
            <p className="mb-2 text-[14px] text-fg-muted">
              {t.returningSoon.length} of {t.total} return within two days.
            </p>
            <ul className="divide-y divide-border-base">
              {t.returningSoon.map((item) => (
                <ItemLine key={item.question.id} item={item} now={now} />
              ))}
            </ul>
          </>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={leave}>
          {session.topicId === null ? "Done" : "Back to the lesson"} <Kbd>Enter</Kbd>
        </Button>
        <Button
          variant="secondary"
          size="lg"
          onClick={() => {
            endQuiz();
            navigate("");
          }}
        >
          All topics
        </Button>
      </div>
    </div>
  );
}
