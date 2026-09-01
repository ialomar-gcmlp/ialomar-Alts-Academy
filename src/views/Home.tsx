/**
 * Home — where a session starts.
 *
 * Ordered by what should happen next, not by what is tidiest to list: the one big
 * button first, then anything due, then today's momentum, then the topics themselves
 * grouped by domain. Each domain carries its own colour and monogram (src/ui/domain.ts)
 * so a page of thirty-eight cards still has landmarks in it.
 */

import { useMemo, useState } from "react";

import { manifest, manifestTopic } from "../content/loader";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { shiftDay } from "../engine/streak";
import { navigate } from "../lib/hashRouter";
import { formatAgo } from "../lib/time";
import {
  domainProgress,
  dueQuestionIds,
  level,
  streak,
  topicProgress,
  type TopicProgress,
} from "../state/selectors";
import { selectResumableSession, useApp } from "../state/store";
import { savedProgressSummary } from "../state/sessionPersist";
import { backupNudge } from "../storage/transfer";
import type { SavedSession } from "../storage/progressSchema";
import { dayKey } from "../storage/progressSchema";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import { Badge, Button, Card, Meter, Monogram, Ring } from "../ui/primitives";

/* ------------------------------------------------------------------ *
 * Hero
 * ------------------------------------------------------------------ */

/**
 * The last seven days, as dots.
 *
 * A streak number tells you where you are; the dots tell you what you did, which is
 * the version that makes a gap feel worth closing. A frozen day is drawn differently
 * from a day that counted, because pretending they are the same would be a lie the
 * user could catch.
 */
function WeekStrip() {
  const progress = useApp((s) => s.progress);
  const goalSeconds = progress.settings.dailyGoalMinutes * 60;
  const frozen = useMemo(
    () => new Set(progress.gamification.frozenDays),
    [progress.gamification.frozenDays],
  );

  const days = useMemo(() => {
    const today = dayKey(Date.now());
    return Array.from({ length: 7 }, (_, i) => {
      const key = shiftDay(today, i - 6);
      const day = progress.daily[key];
      const seconds = day?.seconds ?? 0;
      const qualified = seconds >= goalSeconds && (day?.reviews ?? 0) >= 1;
      return {
        key,
        label: new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
          weekday: "narrow",
        }),
        state: qualified
          ? "hit"
          : frozen.has(key)
            ? "frozen"
            : seconds > 0
              ? "partial"
              : "empty",
        isToday: i === 6,
      } as const;
    });
  }, [progress.daily, goalSeconds, frozen]);

  const styles = {
    hit: "bg-streak text-white",
    partial: "bg-streak/25 text-streak",
    frozen: "bg-accent-soft text-accent",
    empty: "bg-surface-2 text-fg-subtle",
  } as const;

  return (
    <div className="flex items-end gap-1.5">
      {days.map((day) => (
        <div key={day.key} className="flex flex-col items-center gap-1">
          <span
            title={`${day.key}${day.state === "frozen" ? " — freeze used" : ""}`}
            className={`flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold ${styles[day.state]} ${
              day.isToday ? "ring-2 ring-fg/20" : ""
            }`}
          >
            {day.state === "hit" ? <Icon name="check" size={13} /> : day.label}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Offer to pick up an unfinished session.
 *
 * Shown above everything else, because a half-finished set is the most likely thing
 * the user came back for. Both actions are explicit — an abandoned session that
 * silently resumed itself would be worse than one that asks.
 */
/**
 * Where a resumed session lives. All three render the same view, but the URL should
 * say which one it is — landing an exam on #/review is misleading, and the route is
 * what the user sees if they reload again.
 */
function resumeRoute(saved: SavedSession): string {
  if (saved.mode === "exam") return "exam";
  if (saved.topicId !== null) return `quiz/${saved.topicId}`;
  return "review";
}

/**
 * A single line about backing up, and only when it is warranted.
 *
 * On the home page because that is where the user actually is; the buttons live on
 * the Progress page, so this links there rather than duplicating them. `backupNudge`
 * decides when — nothing until there is something worth losing.
 */
function BackupNudge() {
  const progress = useApp((s) => s.progress);
  const nudge = backupNudge(progress, Date.now());

  if (!nudge.due || nudge.message === null) return null;

  return (
    <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-subtle">
      <Icon name="alert" size={13} className="shrink-0 text-flag" />
      {nudge.message}
      <button
        type="button"
        onClick={() => navigate("progress")}
        className="underline decoration-dotted underline-offset-2 hover:text-fg-muted"
      >
        Export a copy
      </button>
    </p>
  );
}

function ResumeCard() {
  const saved = useApp(selectResumableSession);
  const resumeSaved = useApp((s) => s.resumeSaved);
  const discardSaved = useApp((s) => s.discardSaved);
  const [busy, setBusy] = useState(false);

  if (saved === null) return null;

  const { answered, total, remaining } = savedProgressSummary(saved);

  const pickUp = async (): Promise<void> => {
    setBusy(true);
    try {
      const ok = await resumeSaved();
      // A snapshot whose content has since changed cannot be rebuilt; the store has
      // already discarded it, so the card simply disappears.
      if (ok) navigate(resumeRoute(saved));
    } finally {
      setBusy(false);
    }
  };

  return (
    // A solid accent bar down the left edge and a full-strength tint, because a 30%
    // wash on white was invisible: this card has to catch the eye before the hero.
    // The tint sits on the inner element, not the Card — Card's own bg-surface is the
    // same specificity, so which one won would depend on stylesheet order.
    <Card className="mb-6 overflow-hidden border-accent/50 p-0">
      <div className="flex bg-accent-soft">
        <span className="w-1.5 shrink-0 bg-accent" aria-hidden="true" />
        <div className="flex flex-1 flex-wrap items-center justify-between gap-4 p-4 sm:p-5">
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
              <Icon name="clock" size={13} />
              Unfinished session
            </div>
            <p className="mt-1 text-[16px] font-bold text-fg">{saved.title}</p>
            <p className="mt-0.5 text-[13.5px] text-fg-muted tnum">
              {answered} of {total} answered · {remaining} left ·{" "}
              {formatAgo(saved.savedAt, Date.now())}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="vivid"
              onClick={() => void pickUp()}
              disabled={busy}
            >
              <Icon name="arrow" size={15} />
              {busy ? "Loading…" : "Pick up where I left off"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={discardSaved}
              disabled={busy}
            >
              Discard
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Hero({
  due,
  starting,
  onReview,
  suggestion,
}: {
  due: string[];
  starting: boolean;
  onReview: () => void;
  suggestion: TopicProgress | undefined;
}) {
  const progress = useApp((s) => s.progress);
  const info = level(progress);
  const streakInfo = streak(progress, Date.now());
  const goalPct = Math.min(1, streakInfo.secondsToday / streakInfo.goalSeconds);
  /** Never answered anything. Not the same as "nothing due today". */
  const firstRun = Object.keys(progress.questions).length === 0;

  return (
    <Card className="mb-8 overflow-hidden">
      {/* A stripe of every domain colour: the app's own palette as a header. */}
      <div className="flex h-1.5">
        {(Object.keys(DOMAIN_MONOGRAM) as Domain[]).map((domain) => (
          <span
            key={domain}
            className="d-fill flex-1"
            style={domainStyle(domain)}
          />
        ))}
      </div>

      {/* Column on a phone: side by side, the rings squeezed the headline into six
          lines of two words. */}
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:items-start sm:justify-between sm:gap-6 sm:p-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold leading-tight tracking-tight text-fg sm:text-[30px]">
            {/* A first-time user has nothing to pick up, and telling them otherwise
                is the first thing they read. */}
            {firstRun
              ? "Start here."
              : due.length > 0
                ? `${due.length} question${due.length === 1 ? "" : "s"} ready to come back`
                : streakInfo.todayQualified
                  ? "Today is already banked."
                  : "Pick up where you left off."}
          </h1>

          <p className="mt-1.5 max-w-measure text-[14.5px] leading-relaxed text-fg-muted">
            {firstRun
              ? "Every topic is a short lesson and then questions on it. Answer honestly about how sure you are — that is what decides when each question comes back."
              : due.length > 0
                ? "Reviews are the half that makes it stick — mixed across topics, most overdue first."
                : suggestion !== undefined
                  ? `Nothing due right now, so this is a good moment for something new: ${suggestion.topic.title}.`
                  : "Every specialist term is underlined — tap or hover it for a plain-English definition."}
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-2.5">
            {due.length > 0 ? (
              <Button
                variant="vivid"
                size="xl"
                onClick={onReview}
                disabled={starting}
              >
                <Icon name="bolt" size={17} />
                {starting ? "Loading…" : `Review ${due.length}`}
              </Button>
            ) : (
              suggestion !== undefined && (
                <Button
                  variant="vivid"
                  size="xl"
                  onClick={() => navigate(`topic/${suggestion.topic.id}`)}
                >
                  <Icon name="arrow" size={17} />
                  Start studying
                </Button>
              )
            )}

            {due.length > 0 && suggestion !== undefined && (
              <Button
                variant="secondary"
                size="lg"
                onClick={() => navigate(`topic/${suggestion.topic.id}`)}
              >
                Learn something new
              </Button>
            )}
          </div>
        </div>

        {/* Today's numbers, big enough to read without leaning in. */}
        <div className="flex shrink-0 items-center gap-6 sm:gap-5">
          <div className="text-center">
            <Ring
              value={goalPct}
              size={72}
              thickness={7}
              color="var(--p-streak)"
            >
              <span className="flex flex-col items-center leading-none">
                <Icon
                  name="flame"
                  size={16}
                  className={`text-streak ${streakInfo.todayQualified ? "flame-live" : ""}`}
                />
                <span className="mt-0.5 text-[15px] font-bold text-fg tnum">
                  {streakInfo.current}
                </span>
              </span>
            </Ring>
            <div className="mt-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
              day streak
            </div>
          </div>

          <div className="text-center">
            <Ring
              value={info.progress}
              size={72}
              thickness={7}
              color="var(--p-accent)"
            >
              <span className="flex flex-col items-center leading-none">
                <span className="text-[15px] font-bold text-fg tnum">
                  {info.level}
                </span>
                <span className="text-[9px] font-bold uppercase tracking-wider text-fg-subtle">
                  lvl
                </span>
              </span>
            </Ring>
            <div className="mx-auto mt-1 max-w-20 text-[11px] font-bold uppercase leading-tight tracking-wider text-fg-subtle">
              {info.title}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border-base px-5 py-3 sm:px-6">
        <WeekStrip />
        <div className="flex items-center gap-2 text-[12.5px] text-fg-muted tnum">
          <Icon name="bolt" size={13} className="text-xp" />
          <span className="font-semibold text-fg">
            {progress.gamification.xp.toLocaleString()} XP
          </span>
          {info.next !== null && (
            <span className="text-fg-subtle">
              · {(info.next - progress.gamification.xp).toLocaleString()} to{" "}
              {info.nextTitle}
            </span>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Topic cards
 * ------------------------------------------------------------------ */

function TopicCard({ progress }: { progress: TopicProgress }) {
  const { topic, unlocked, blockedBy, dueCount, mastery, started } = progress;
  const minutes = topic.estMinutes + Math.round(topic.questionSeconds / 60);

  return (
    <Card
      style={domainStyle(topic.domain)}
      className={`d-border flex flex-col overflow-hidden ${unlocked ? "lift" : "opacity-75"}`}
    >
      <span className="d-rail h-1 w-full" aria-hidden />

      <button
        type="button"
        onClick={() => navigate(`topic/${topic.id}`)}
        className="flex flex-1 flex-col p-4 text-left"
      >
        <div className="mb-2.5 flex items-start gap-2.5">
          <Monogram code={DOMAIN_MONOGRAM[topic.domain]} size={32} />
          <div className="min-w-0 flex-1">
            <h3 className="text-[16px] font-bold leading-snug text-fg">
              {topic.title}
            </h3>
          </div>
          {started && (
            <Ring value={mastery} size={30} thickness={3.5} color="var(--d)">
              <span className="text-[9px] font-bold text-fg-muted tnum">
                {Math.round(mastery * 100)}
              </span>
            </Ring>
          )}
        </div>

        <p className="flex-1 text-[13.5px] leading-relaxed text-fg-muted">
          {topic.summary}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {dueCount > 0 && (
            <Badge tone="flag">
              <Icon name="clock" size={11} />
              {dueCount} due
            </Badge>
          )}
          {topic.examRelevance.map((exam) => (
            <Badge
              key={exam}
              tone={exam === "practical" ? "domain" : "neutral"}
            >
              {exam === "practical" ? "on the job" : exam}
            </Badge>
          ))}
          {!started && (
            <span className="ml-auto text-[12px] text-fg-subtle tnum">
              ~{minutes} min · {topic.questionCount}q
            </span>
          )}
        </div>

        {started && (
          <div className="mt-2.5">
            <Meter value={mastery} color="var(--d)" height={4} />
          </div>
        )}
      </button>

      {/* A lock has to explain itself, or it just looks broken. */}
      {!unlocked && blockedBy.length > 0 && (
        <p className="flex items-start gap-1.5 border-t border-border-base px-4 py-2 text-[12px] leading-relaxed text-fg-subtle">
          <Icon name="lock" size={12} className="mt-0.5" />
          <span>
            Best done after{" "}
            {blockedBy
              .map((id) => manifestTopic(id)?.title ?? id)
              .join(" and ")}
          </span>
        </p>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Page
 * ------------------------------------------------------------------ */

export function Home() {
  const progress = useApp((s) => s.progress);
  const startReviewSession = useApp((s) => s.startReviewSession);
  const [starting, setStarting] = useState(false);

  // One timestamp for the whole render, so every derived number agrees.
  const now = useMemo(() => Date.now(), [progress]);
  const topics = useMemo(() => topicProgress(progress, now), [progress, now]);
  const domains = useMemo(() => domainProgress(topics), [topics]);
  const due = useMemo(() => dueQuestionIds(progress, now), [progress, now]);

  /**
   * What to offer when nothing is due: the first unlocked topic not yet started,
   * falling back to the weakest started one. Deliberately not random — the same
   * card being there tomorrow is what makes it a plan rather than a slot machine.
   */
  const suggestion = useMemo(() => {
    const fresh = topics.find((t) => t.unlocked && !t.started);
    if (fresh) return fresh;
    return [...topics]
      .filter((t) => t.started)
      .sort((a, b) => a.mastery - b.mastery)[0];
  }, [topics]);

  const totalQuestions = manifest.topics.reduce(
    (n, t) => n + t.questionCount,
    0,
  );
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
      <BackupNudge />
      <ResumeCard />

      <Hero
        due={due}
        starting={starting}
        onReview={() => void beginReview()}
        suggestion={suggestion}
      />

      <p className="mb-6 text-[12.5px] text-fg-subtle tnum">
        {manifest.topics.length} topics · {totalQuestions} questions ·{" "}
        {manifest.glossaryCount} glossary terms
        {answeredEver > 0 && ` · ${answeredEver} seen`}
        {lastStudied !== undefined &&
          ` · last studied ${formatAgo(lastStudied, now)}`}
      </p>

      <div className="space-y-9">
        {domains.map((domain) => {
          const d = domain.domain as Domain;
          const dueHere = domain.topics.reduce((n, t) => n + t.dueCount, 0);

          return (
            <section key={domain.domain} style={domainStyle(d)}>
              <div className="mb-3 flex items-center gap-2.5">
                <Monogram code={DOMAIN_MONOGRAM[d]} size={28} />
                <h2 className="d-text text-[14px] font-bold uppercase tracking-wider">
                  {DOMAIN_LABELS[d]}
                </h2>
                <span className="text-[12px] text-fg-subtle tnum">
                  {domain.topics.length}
                </span>

                <span className="ml-auto flex items-center gap-3">
                  {dueHere > 0 && (
                    <Badge tone="flag">
                      <Icon name="clock" size={11} />
                      {dueHere} due
                    </Badge>
                  )}
                  {domain.mastery > 0 && (
                    <span className="flex items-center gap-2">
                      <span className="w-20">
                        <Meter
                          value={domain.mastery}
                          color="var(--d)"
                          height={5}
                        />
                      </span>
                      <span className="text-[12px] font-semibold text-fg-muted tnum">
                        {Math.round(domain.mastery * 100)}%
                      </span>
                    </span>
                  )}
                </span>
              </div>

              <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                {domain.topics.map((t) => (
                  <TopicCard key={t.topic.id} progress={t} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
