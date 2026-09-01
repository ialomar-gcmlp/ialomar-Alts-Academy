/**
 * Result — the end-of-session summary.
 *
 * Three things, in the order they matter: what you got right, what is coming back
 * and when, and one sentence on what to focus on next.
 *
 * Calibration is reported alongside score on purpose. The score is the less
 * interesting number — being wrong while sure is the thing worth acting on.
 */

import { useEffect, useMemo, useState } from "react";

import { badgeById } from "../engine/badges";
import { CONFIDENCE_LABELS, type Confidence } from "../engine/grading";
import { navigate } from "../lib/hashRouter";
import { useHotkeys } from "../lib/keyboard";
import { formatDueIn } from "../lib/time";
import { useApp, type QuizItem } from "../state/store";
import { Icon } from "../ui/icons";
import { RECALL, latestRecallNote } from "../engine/recall";
import { Badge, Button, Card, Kbd, Meter, Ring, StatTile } from "../ui/primitives";
import { Inline } from "../ui/Prose";

/** Static, because Tailwind cannot see a class name built at runtime. */
const CONFIDENCE_TEXT: Record<Confidence, string> = {
  confident: "text-confident",
  unsure: "text-unsure",
  guessing: "text-guessing",
};

/** The same three colours as CSS vars, for the SVG and canvas-free bars. */
const CONFIDENCE_VAR: Record<Confidence, string> = {
  confident: "var(--p-conf-confident)",
  unsure: "var(--p-conf-unsure)",
  guessing: "var(--p-conf-guessing)",
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

/**
 * A number that arrives rather than appears.
 *
 * Sixteen frames over ~600ms, then the exact value — never an approximation left on
 * screen. Calm mode and reduced-motion are handled by skipping straight to the end,
 * because a count-up cannot be "shortened" by CSS.
 */
function CountUp({ to, animate }: { to: number; animate: boolean }) {
  const [shown, setShown] = useState(animate ? 0 : to);

  useEffect(() => {
    if (!animate) {
      setShown(to);
      return;
    }
    let frame = 0;
    const steps = 16;
    const id = setInterval(() => {
      frame += 1;
      if (frame >= steps) {
        setShown(to);
        clearInterval(id);
        return;
      }
      // Ease-out, so it slows into the final figure.
      setShown(Math.round(to * (1 - Math.pow(1 - frame / steps, 3))));
    }, 38);
    return () => clearInterval(id);
  }, [to, animate]);

  return <>{shown.toLocaleString()}</>;
}

/** Eight bits of colour for a clean sweep. Pure decoration, aria-hidden, one shot. */
function Confetti() {
  const bits = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => ({
        colour: [
          "var(--d-alternatives)",
          "var(--p-xp-bright)",
          "var(--d-fund-structures)",
          "var(--d-corporate-issuers)",
          "var(--d-portfolio-risk)",
        ][i % 5],
        left: `${8 + (i * 6.4) % 84}%`,
        dx: `${-40 + ((i * 37) % 80)}px`,
        dy: `${40 + ((i * 23) % 60)}px`,
        dr: `${-180 + ((i * 71) % 360)}deg`,
        delay: `${(i % 5) * 45}ms`,
      })),
    [],
  );

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map((bit, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: bit.left,
            top: "18%",
            background: bit.colour,
            animationDelay: bit.delay,
            ["--dx" as string]: bit.dx,
            ["--dy" as string]: bit.dy,
            ["--dr" as string]: bit.dr,
          }}
        />
      ))}
    </span>
  );
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

/**
 * Free recall, at the moment it works best: the session is done, the material is
 * fresh, and summarising it from memory is a different act from the recognising the
 * questions asked for. Optional on purpose — never blocks leaving — and worth no XP:
 * the moment a note earns points, the honest sentence becomes keyword stuffing.
 *
 * Topic sessions only. A mixed review spans topics, so "what is worth keeping from
 * this?" has no single home for the answer.
 */
function RecallPrompt({ topicId }: { topicId: string }) {
  const notes = useApp((s) => s.progress.recallNotes);
  const saveRecallNote = useApp((s) => s.saveRecallNote);
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);

  const previous = latestRecallNote(notes, topicId);

  const commit = (): void => {
    if (draft.trim() === "") return;
    saveRecallNote(topicId, draft);
    setSaved(true);
  };

  if (saved) {
    return (
      <Card className="mb-6 p-5">
        <p className="flex items-center gap-2 text-[14px] font-medium text-correct">
          <Icon name="check" size={15} />
          Kept. It comes back the next time you open this topic.
        </p>
      </Card>
    );
  }

  return (
    <Card className="mb-6 p-5">
      <h2 className="text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Before you go
      </h2>
      <p className="mt-1 text-[14px] text-fg-muted">
        One sentence, from memory: what is worth keeping from this?
      </p>

      {previous !== null && (
        <p className="mt-2 rounded-md bg-surface-2 px-3 py-2 text-[13px] leading-relaxed text-fg-subtle">
          Last time you said: <em className="text-fg-muted">{previous.text}</em>
        </p>
      )}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves; Shift+Enter makes a rare second line. stopPropagation so
          // the session-level Enter hotkey (leave) does not fire from inside it.
          e.stopPropagation();
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
        }}
        maxLength={RECALL.MAX_LENGTH}
        rows={2}
        placeholder="The one idea, in your own words…"
        className="mt-3 w-full resize-none rounded-lg border border-border-strong bg-surface px-3 py-2 text-[14.5px] leading-relaxed text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-4 focus:ring-accent/15"
      />

      <div className="mt-2 flex items-center justify-between gap-3">
        <span className="text-[12px] text-fg-subtle">
          Optional — skipping costs nothing, writing it is the rehearsal.
        </span>
        <Button size="sm" variant="secondary" onClick={commit} disabled={draft.trim() === ""}>
          Keep it
        </Button>
      </div>
    </Card>
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
  const sessionXp = session.items.reduce((n, i) => n + i.xpAwarded, 0);
  const repeatedToday = session.items.filter((i) => i.xpSkipped === "already-earned-today").length;
  const pct = t.total === 0 ? 0 : Math.round((t.correct / t.total) * 100);
  const minutes = Math.max(1, Math.round((now - session.startedAt) / 60000));

  const effects = useApp((st) => st.progress.settings.effects);
  const animate = effects === "full";
  const perfect = t.total > 0 && t.correct === t.total;

  return (
    <div>
      {/* The headline is the outcome, not the word "results". A clean sweep gets to
          say so; anything else names the thing worth fixing. */}
      <Card className="relative mb-6 overflow-hidden">
        {perfect && animate && <Confetti />}
        <span
          aria-hidden
          className={`block h-1.5 w-full ${perfect ? "bg-correct" : t.confidentWrong.length > 0 ? "bg-incorrect" : "bg-accent"}`}
        />

        <div className="flex flex-wrap items-center gap-6 p-5 sm:p-6">
          <Ring
            value={t.total === 0 ? 0 : t.correct / t.total}
            size={104}
            thickness={9}
            color={perfect ? "var(--p-correct)" : "var(--p-accent)"}
          >
            <span className="flex flex-col items-center leading-none">
              <span className="text-[26px] font-bold text-fg tnum">
                <CountUp to={pct} animate={animate} />%
              </span>
              <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wider text-fg-subtle tnum">
                {t.correct}/{t.total}
              </span>
            </span>
          </Ring>

          <div className="min-w-0 flex-1">
            <div className="text-[11px] font-bold uppercase tracking-widest text-accent">
              {session.title}
            </div>
            <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-tight text-fg sm:text-[28px]">
              {perfect
                ? "Clean sweep."
                : t.confidentWrong.length > 0
                  ? `${t.confidentWrong.length} sure and wrong`
                  : t.wrong.length === 0
                    ? "All correct."
                    : `${t.correct} of ${t.total}`}
            </h1>

            <div className="mt-3 flex flex-wrap items-center gap-4">
              <span className="flex items-center gap-1.5 text-[19px] font-bold text-xp tnum">
                <Icon name="bolt" size={17} />+<CountUp to={sessionXp} animate={animate} /> XP
              </span>
              <span className="flex items-center gap-1.5 text-[13px] text-fg-muted tnum">
                <Icon name="clock" size={13} />
                {minutes} min{minutes === 1 ? "" : "s"}
              </span>
              {t.returningSoon.length > 0 && (
                <span className="flex items-center gap-1.5 text-[13px] text-fg-muted tnum">
                  <Icon name="target" size={13} />
                  {t.returningSoon.length} back within 2 days
                </span>
              )}
            </div>

            {sessionXp === 0 && t.total > 0 && (
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-subtle">
                {repeatedToday > 0
                  ? "No XP: these questions had already paid out today. Come back tomorrow."
                  : "No XP — it only comes from correct answers."}
              </p>
            )}
          </div>
        </div>
      </Card>

      {session.mode === "learn" && session.topicId !== null && (
        <RecallPrompt topicId={session.topicId} />
      )}

      {/* New badges lead, because they are the only thing here the user has not
          already seen question by question. */}
      {session.badgesEarned.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {session.badgesEarned.map((earned, i) => {
            const badge = badgeById.get(earned.id);
            if (!badge) return null;
            return (
              <Card
                key={earned.id}
                className="anim-pop flex items-start gap-3 border-xp/40 bg-xp/8 p-4"
                style={{ animationDelay: `${i * 90}ms` }}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-xp/15 text-xp">
                  <Icon name="trophy" size={20} />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[15px] font-bold text-fg">{badge.name}</span>
                    <Badge tone="xp">new</Badge>
                  </div>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-fg-muted">
                    {badge.description}
                  </p>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Calibration. The more useful half of the page: being wrong while sure is
          the thing worth acting on, so it gets bars rather than a line of text. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {(["confident", "unsure", "guessing"] as const).map((lvl) => {
          const b = t.byConfidence[lvl];
          if (b.total === 0) return null;
          const rate = b.correct / b.total;
          return (
            <StatTile
              key={lvl}
              label={CONFIDENCE_LABELS[lvl]}
              color={CONFIDENCE_VAR[lvl]}
              value={
                <span className={CONFIDENCE_TEXT[lvl]}>
                  {b.correct}
                  <span className="text-fg-subtle">/{b.total}</span>
                </span>
              }
              sub={
                <span className="mt-1.5 block">
                  <Meter value={rate} color={CONFIDENCE_VAR[lvl]} height={5} />
                </span>
              }
            />
          );
        })}
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
