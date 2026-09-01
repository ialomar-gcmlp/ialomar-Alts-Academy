/**
 * Progress — the dashboard: level, streak, accuracy over time, calibration, what is
 * coming back, mastery by domain, the skill tree and badges.
 *
 * Everything here reports on retention rather than effort. There is still no "answers
 * given" or "hours studied" headline anywhere on the page, because rewarding those was
 * explicitly out of scope; counts appear only as the denominator of an accuracy figure,
 * where leaving them out would be the dishonest choice.
 */

import { useMemo, useRef, useState } from "react";

import {
  accuracyByHour,
  accuracyTrend,
  bestStudyHours,
  calibration,
  calibrationVerdict,
  dailySeries,
  examSeries,
} from "../engine/analytics";
import { BADGES, badgeById } from "../engine/badges";
import { CONFIDENCE_LABELS, type Confidence } from "../engine/grading";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { formatMinutes } from "../lib/time";
import {
  domainProgress,
  forecast,
  level,
  streak,
  topicProgress,
} from "../state/selectors";
import { useApp } from "../state/store";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import { Badge, Button, Card, Meter, Monogram, PageTitle, Ring } from "../ui/primitives";
import { SkillTree, SkillTreeLegend } from "../ui/SkillTree";
import {
  backupNudge,
  lastExportLabel,
  parseImport,
  replacementSentence,
  summarize,
  type ImportResult,
} from "../storage/transfer";
import { Sparkline, type SparkPoint } from "../ui/charts/Sparkline";

function LevelCard() {
  const progress = useApp((s) => s.progress);
  const info = useMemo(() => level(progress), [progress]);
  const xp = progress.gamification.xp;

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <Ring value={info.progress} size={64} thickness={7} color="var(--p-accent)">
          <span className="text-[19px] font-bold text-fg tnum">{info.level}</span>
        </Ring>

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            Level {info.level}
          </div>
          <div className="text-[18px] font-bold leading-tight text-fg">{info.title}</div>
          <div className="mt-1 flex items-center gap-1.5 text-[15px] font-bold text-xp tnum">
            <Icon name="bolt" size={14} />
            {xp.toLocaleString()} XP
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Meter value={info.progress} color="var(--p-accent)" height={7} />
        <p className="mt-2 text-[12.5px] text-fg-subtle tnum">
          {info.next === null
            ? "Top level reached."
            : `${(info.next - xp).toLocaleString()} XP to ${info.nextTitle}`}
        </p>
      </div>

      <p className="mt-4 border-t border-border-base pt-3 text-[12.5px] leading-relaxed text-fg-subtle">
        XP comes from correct answers only, once per question per day, scaled by
        difficulty and by how sure you were. Answering the same question repeatedly
        earns nothing.
      </p>
    </Card>
  );
}

function StreakCard() {
  const progress = useApp((s) => s.progress);
  const info = useMemo(() => streak(progress, Date.now()), [progress]);

  const pct = Math.min(100, Math.round((info.secondsToday / info.goalSeconds) * 100));

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <Ring value={pct / 100} size={64} thickness={7} color="var(--p-streak)">
          <Icon
            name="flame"
            size={22}
            className={`text-streak ${info.todayQualified ? "flame-live" : ""}`}
          />
        </Ring>

        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            Streak
          </div>
          <div className="text-[18px] font-bold leading-tight text-fg tnum">
            {info.current} day{info.current === 1 ? "" : "s"}
          </div>
          <div className="mt-1 text-[12.5px] text-fg-subtle tnum">
            longest {info.longest}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Meter
          value={pct / 100}
          color={info.todayQualified ? "var(--p-correct)" : "var(--p-streak)"}
          height={7}
        />
        <p className="mt-2 text-[12.5px] text-fg-subtle tnum">
          {info.todayQualified
            ? "Today counts."
            : `${formatMinutes(info.secondsToday)} of ${formatMinutes(info.goalSeconds)} today`}
        </p>
      </div>

      {/* Both conditions, spelled out — a day silently not counting is infuriating. */}
      {!info.todayQualified && (
        <ul className="mt-3 space-y-1 text-[12.5px] text-fg-muted">
          <li className="flex items-center gap-2">
            <span aria-hidden className={info.secondsToday >= info.goalSeconds ? "text-correct" : "text-fg-subtle"}>
              {info.secondsToday >= info.goalSeconds ? "✓" : "○"}
            </span>
            Reach your {formatMinutes(info.goalSeconds)} goal
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className={info.reviewsToday >= 1 ? "text-correct" : "text-fg-subtle"}>
              {info.reviewsToday >= 1 ? "✓" : "○"}
            </span>
            Complete at least one scheduled review
          </li>
        </ul>
      )}

      <p className="mt-4 border-t border-border-base pt-3 text-[12.5px] leading-relaxed text-fg-subtle">
        {info.freezesRemaining} freeze day{info.freezesRemaining === 1 ? "" : "s"} left this
        month. They are spent automatically, and only when they can bridge the whole gap.
      </p>
    </Card>
  );
}

function Badges() {
  const earned = useApp((s) => s.progress.gamification.badges);
  const earnedIds = useMemo(() => new Set(earned.map((b) => b.id)), [earned]);

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
          Badges
        </h2>
        <span className="text-[12px] text-fg-subtle tnum">
          {earnedIds.size} of {BADGES.length}
        </span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {BADGES.map((badge) => {
          const has = earnedIds.has(badge.id);
          const definition = badgeById.get(badge.id);
          return (
            <Card
              key={badge.id}
              className={`flex items-start gap-3 p-4 ${has ? "border-xp/40 bg-xp/8" : "opacity-65"}`}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                  has ? "bg-xp/15 text-xp" : "bg-surface-2 text-fg-subtle"
                }`}
              >
                <Icon name={has ? "trophy" : "lock"} size={17} />
              </span>
              <div className="min-w-0">
                <div className="mb-0.5 flex flex-wrap items-center gap-2">
                  <span className="text-[14px] font-bold text-fg">{badge.name}</span>
                  {has ? <Badge tone="xp">earned</Badge> : <Badge tone="neutral">locked</Badge>}
                </div>
                <p className="text-[13px] leading-relaxed text-fg-muted">
                  {has ? badge.description : (definition?.requirement ?? badge.requirement)}
                </p>
              </div>
            </Card>
          );
        })}
      </div>

      <p className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
        Badges are for mastery and calibration only. Nothing here can be earned by
        spending time or answering volume.
      </p>
    </section>
  );
}

/**
 * Mastery per domain, in each domain's own colour.
 *
 * Eleven bars is the fastest read on this page: where you are strong, where you have
 * not started, and — since mastery decays — where something you did know is fading.
 */
/**
 * Windows the accuracy chart offers. Thirty days is the default: long enough to show
 * a trend, short enough that a bad week still shows up in it.
 */
const WINDOWS = [
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 90, label: "90d" },
] as const;

/**
 * Accuracy over time.
 *
 * Days with nothing answered are gaps in the line, not zeros — see `Sparkline`. The
 * sentence underneath is the point of the card: a chart shows movement, a sentence
 * says whether the movement means anything.
 */
function AccuracyCard() {
  const daily = useApp((s) => s.progress.daily);
  const [days, setDays] = useState<number>(30);
  const now = Date.now();

  const series = useMemo(() => dailySeries(daily, now, days), [daily, now, days]);
  const trend = accuracyTrend(series);

  const points: SparkPoint[] = series.map((point) => ({
    label: new Date(point.at).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }),
    value: point.accuracy,
    detail: point.answered === 0 ? undefined : `${point.correct} of ${point.answered}`,
  }));

  const activeDays = series.filter((point) => point.answered > 0).length;

  return (
    <Card className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
          Accuracy over time
        </h2>

        <div className="flex gap-1">
          {WINDOWS.map((window) => (
            <button
              key={window.days}
              type="button"
              onClick={() => setDays(window.days)}
              aria-pressed={days === window.days}
              className={`rounded-md px-2 py-0.5 text-[12px] font-semibold tnum ${
                days === window.days
                  ? "bg-accent text-accent-fg"
                  : "text-fg-subtle hover:bg-surface-2 hover:text-fg"
              }`}
            >
              {window.label}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-[12.5px] text-fg-subtle tnum">
        {activeDays} of the last {days} days answered · gaps are days you did not study
      </p>

      <Sparkline
        points={points}
        color="var(--p-accent)"
        ariaLabel={`Accuracy per day over the last ${days} days`}
      />

      <p className="mt-3 text-[13.5px] leading-relaxed text-fg-muted">
        {trendSentence(trend, days)}
      </p>
    </Card>
  );
}

function trendSentence(trend: ReturnType<typeof accuracyTrend>, days: number): string {
  if (trend.answered === 0) {
    return `Nothing answered in the last ${days} days, so there is no trend to report.`;
  }
  if (trend.deltaPoints === null) {
    return "Not enough spread across the window to compare halves yet — keep going and this becomes a trend.";
  }

  const after = Math.round((trend.after ?? 0) * 100);
  if (trend.deltaPoints > 2) {
    return `${after}% across the recent half, up ${trend.deltaPoints} points on the earlier half. Accuracy rising while questions keep coming back is the shape you want.`;
  }
  if (trend.deltaPoints < -2) {
    return `${after}% across the recent half, down ${Math.abs(trend.deltaPoints)} points. Usually this means intervals have stretched far enough that reviews are genuinely harder — the scheduler working, not a problem.`;
  }
  return `${after}% across the recent half, flat against the earlier one.`;
}

/**
 * Calibration — the number this app is really about.
 *
 * Next to accuracy on purpose: being wrong while sure is the finding worth acting on,
 * and it is invisible in a score. Exam answers are excluded, because an exam records
 * a confidence it never asked for.
 */
function CalibrationCard() {
  const events = useApp((s) => s.progress.events);
  const cal = useMemo(() => calibration(events), [events]);

  const tone: Record<Confidence, { bar: string; text: string }> = {
    confident: { bar: "var(--p-conf-confident)", text: "text-confident" },
    unsure: { bar: "var(--p-conf-unsure)", text: "text-unsure" },
    guessing: { bar: "var(--p-conf-guessing)", text: "text-guessing" },
  };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Calibration
      </h2>
      <p className="mb-4 text-[12.5px] text-fg-subtle tnum">
        How often each claim turned out to be right
        {cal.excluded > 0 && ` · ${cal.excluded} exam answers excluded`}
      </p>

      <div className="space-y-3">
        {cal.buckets.map((bucket) => (
          <div key={bucket.confidence}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className={`font-semibold ${tone[bucket.confidence].text}`}>
                {CONFIDENCE_LABELS[bucket.confidence]}
              </span>
              <span className="text-fg-muted tnum">
                {bucket.accuracy === null
                  ? "—"
                  : `${Math.round(bucket.accuracy * 100)}% of ${bucket.total}`}
              </span>
            </div>
            <Meter value={bucket.accuracy ?? 0} color={tone[bucket.confidence].bar} />
          </div>
        ))}
      </div>

      <p className="mt-4 text-[13.5px] leading-relaxed text-fg-muted">
        {calibrationVerdict(cal)}
      </p>
    </Card>
  );
}

/**
 * What is coming back, and when.
 *
 * Seven days, because that is the horizon a plan can act on: a tall bar on Thursday
 * is a reason to do a longer session on Wednesday. The first bar counts everything
 * already due, however overdue.
 */
function ForecastCard() {
  const progress = useApp((s) => s.progress);
  const now = Date.now();
  const days = useMemo(() => forecast(progress, now, 7), [progress, now]);
  const peak = Math.max(1, ...days);
  const total = days.reduce((n, d) => n + d, 0);

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Next seven days
      </h2>
      <p className="mb-4 text-[12.5px] text-fg-subtle tnum">
        {total === 0
          ? "Nothing scheduled — everything you have answered is resting"
          : `${total} question${total === 1 ? "" : "s"} come back this week`}
      </p>

      <div className="flex items-end gap-1.5">
        {days.map((count, i) => {
          const at = now + i * 86_400_000;
          const label =
            i === 0
              ? "Now"
              : new Date(at).toLocaleDateString(undefined, { weekday: "narrow" });
          return (
            <div key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] font-semibold text-fg-muted tnum">
                {count === 0 ? "" : count}
              </span>

              {/* Every day gets a track, so a day with nothing due reads as an empty
                  column rather than a hairline that could be a rendering artefact. */}
              <div
                className="flex w-full items-end rounded bg-surface-2"
                style={{ height: 56 }}
                title={`${count} due ${i === 0 ? "now" : new Date(at).toLocaleDateString()}`}
              >
                {count > 0 && (
                  <div
                    className={`w-full rounded ${i === 0 ? "bg-accent" : "bg-accent/45"}`}
                    style={{ height: `${Math.max(6, (count / peak) * 56)}px` }}
                  />
                )}
              </div>

              <span className="text-[11px] text-fg-subtle">{label}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/**
 * Exam marks and when you answer best.
 *
 * Both are omitted until there is enough to say: one attempt is not a trend, and an
 * hour with three answers in it is not a time of day.
 */
function AnalyticsFooter() {
  const progress = useApp((s) => s.progress);
  const exams = useMemo(() => examSeries(progress.exams), [progress.exams]);
  const hours = useMemo(
    () => bestStudyHours(accuracyByHour(progress.events)),
    [progress.events],
  );

  if (exams.length === 0 && hours.best === null) return null;

  const hour = (h: number): string =>
    new Date(2026, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" });

  const latest = exams[exams.length - 1];
  const best = exams.length === 0 ? 0 : Math.max(...exams.map((e) => e.fraction));

  return (
    <Card className="p-5">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Also worth knowing
      </h2>

      <ul className="space-y-2.5 text-[13.5px] leading-relaxed text-fg-muted">
        {latest !== undefined && (
          <li className="flex items-start gap-2">
            <Icon name="target" size={14} className="mt-1 shrink-0 text-accent" />
            <span>
              {exams.length === 1
                ? `One exam sat: ${Math.round(latest.fraction * 100)}% on ${DOMAIN_LABELS[latest.domain as Domain] ?? latest.domain}.`
                : `${exams.length} exams sat, most recently ${Math.round(latest.fraction * 100)}%. Best so far ${Math.round(best * 100)}%.`}
            </span>
          </li>
        )}

        {hours.best !== null && hours.worst !== null && (
          <li className="flex items-start gap-2">
            <Icon name="clock" size={14} className="mt-1 shrink-0 text-accent" />
            <span>
              You answer best around {hour(hours.best.hour)} (
              {Math.round((hours.best.accuracy ?? 0) * 100)}% of {hours.best.answered}) and
              worst around {hour(hours.worst.hour)} (
              {Math.round((hours.worst.accuracy ?? 0) * 100)}% of {hours.worst.answered}).
              Worth putting the harder material in the better slot.
            </span>
          </li>
        )}
      </ul>
    </Card>
  );
}

function DomainBoard() {
  const progress = useApp((s) => s.progress);
  const now = useMemo(() => Date.now(), [progress]);
  const domains = useMemo(
    () => domainProgress(topicProgress(progress, now)),
    [progress, now],
  );

  return (
    <section className="mb-10">
      <h2 className="mb-3 text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Mastery by domain
      </h2>

      <Card className="divide-y divide-border-base">
        {domains.map((entry) => {
          const d = entry.domain as Domain;
          const started = entry.topics.filter((t) => t.started).length;
          return (
            <div
              key={entry.domain}
              style={domainStyle(d)}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <Monogram code={DOMAIN_MONOGRAM[d]} size={26} />
              <span className="w-40 shrink-0 truncate text-[13.5px] font-semibold text-fg">
                {DOMAIN_LABELS[d]}
              </span>
              <span className="flex-1">
                <Meter value={entry.mastery} color="var(--d)" height={7} />
              </span>
              <span className="w-10 shrink-0 text-right text-[12.5px] font-bold text-fg-muted tnum">
                {Math.round(entry.mastery * 100)}%
              </span>
              <span className="w-20 shrink-0 text-right text-[11.5px] text-fg-subtle tnum">
                {started}/{entry.topics.length} started
              </span>
            </div>
          );
        })}
      </Card>
    </section>
  );
}

/** Motion, in one place, next to the numbers it decorates. */
/**
 * Export and import.
 *
 * The one destructive action in the app, so it is a two-step: pick a file, read what
 * it holds and what it would replace, then confirm. The summary is in the user's terms
 * — answers, XP, dates — because "Import?" is not a question anyone can answer safely.
 *
 * No network: export is a Blob the browser saves, import is a file the user picks.
 */
function DataCard() {
  const progress = useApp((s) => s.progress);
  const exportProgress = useApp((s) => s.exportProgress);
  const importProgress = useApp((s) => s.importProgress);

  const fileInput = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<ImportResult | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const now = Date.now();
  const nudge = backupNudge(progress, now);
  const current = summarize(progress);

  const download = (): void => {
    const { text, filename } = exportProgress();
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    // Revoked on the next tick: Safari needs the element to have been clicked first.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setDone(`Saved ${filename}`);
  };

  const pick = async (file: File | undefined): Promise<void> => {
    setDone(null);
    if (file === undefined) return;
    setPending(parseImport(await file.text()));
    // Cleared so picking the same file twice still fires a change event.
    if (fileInput.current !== null) fileInput.current.value = "";
  };

  const confirmImport = (): void => {
    if (pending === null || pending.status !== "ok") return;
    importProgress(pending.state);
    setPending(null);
    setDone(
      `Imported ${pending.summary.answers} answered question${pending.summary.answers === 1 ? "" : "s"}${pending.migrated ? `, upgraded from schema v${pending.fromVersion}` : ""}.`,
    );
  };

  return (
    <Card className="p-5">
      <h2 className="mb-1 text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
        Your data
      </h2>
      <p className="mb-4 max-w-measure text-[13px] leading-relaxed text-fg-muted">
        Everything lives in this browser's storage — there is no account and nothing
        leaves the machine. An export is the only copy that survives clearing site data
        or moving to another computer.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={download}>
          <Icon name="arrow" size={15} className="rotate-90" />
          Export
        </Button>
        <Button variant="ghost" onClick={() => fileInput.current?.click()}>
          Import a file
        </Button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <span className="text-[12.5px] text-fg-subtle tnum">
          {lastExportLabel(progress, now)}
          {current.answers > 0 && ` · ${current.answers} answered questions here`}
        </span>
      </div>

      {nudge.due && nudge.message !== null && pending === null && (
        <p className="mb-4 flex items-start gap-2 rounded-md border border-flag bg-flag-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-flag">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          {nudge.message}
        </p>
      )}

      {done !== null && (
        <p className="mb-4 rounded-md border border-correct bg-correct-soft px-3.5 py-2.5 text-[13px] text-correct">
          {done}
        </p>
      )}

      {pending !== null && pending.status === "error" && (
        <div className="rounded-md border border-incorrect bg-incorrect-soft px-3.5 py-2.5 text-[13px] leading-relaxed text-incorrect">
          <p>{pending.detail}</p>
          <button
            type="button"
            onClick={() => setPending(null)}
            className="mt-2 underline decoration-dotted underline-offset-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {pending !== null && pending.status === "ok" && (
        <div className="rounded-lg border border-flag bg-flag-soft p-4">
          <p className="font-semibold text-fg">Replace everything with this file?</p>
          <p className="mt-1.5 max-w-measure text-[13.5px] leading-relaxed text-fg-muted">
            {replacementSentence(pending.summary, current)}
          </p>
          {pending.migrated && (
            <p className="mt-2 text-[12.5px] text-fg-subtle">
              The file is from schema v{pending.fromVersion} and will be upgraded on
              import.
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="danger" onClick={confirmImport}>
              Replace my progress
            </Button>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EffectsSwitch() {
  const effects = useApp((s) => s.progress.settings.effects);
  const toggleEffects = useApp((s) => s.toggleEffects);

  return (
    <Card className="mb-10 flex flex-wrap items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 text-[14px] font-bold text-fg">
          <Icon name="spark" size={14} className={effects === "full" ? "text-xp" : ""} />
          Celebration and movement
        </div>
        <p className="mt-0.5 max-w-measure text-[13px] leading-relaxed text-fg-muted">
          {effects === "full"
            ? "XP bursts, streak flicker and score animations are on. Colours and numbers are unaffected either way."
            : "Calm mode: every colour and number stays, nothing moves. Your operating system's reduced-motion setting does this too."}
        </p>
      </div>
      <button
        type="button"
        onClick={toggleEffects}
        aria-pressed={effects === "full"}
        className={`press shrink-0 rounded-lg border-2 px-4 py-2 text-[13.5px] font-bold ${
          effects === "full"
            ? "border-xp/50 bg-xp/10 text-xp"
            : "border-border-strong text-fg-muted hover:bg-surface-2"
        }`}
      >
        {effects === "full" ? "On" : "Calm"}
      </button>
    </Card>
  );
}

export function Progress() {
  const progress = useApp((s) => s.progress);
  const now = useMemo(() => Date.now(), [progress]);
  const topics = useMemo(() => topicProgress(progress, now), [progress, now]);

  return (
    <div>
      <PageTitle title="Progress">
        Mastery decays if you leave it, so these numbers move in both directions. That is
        the point — they describe what you would remember today, not what you once read.
      </PageTitle>

      <div className="mb-10 grid gap-4 sm:grid-cols-2">
        <LevelCard />
        <StreakCard />
      </div>

      {/* The dashboard proper: how it is going, whether the confidence tags mean
          anything, and what is coming back. */}
      <section className="mb-10 grid gap-4 lg:grid-cols-2">
        <AccuracyCard />
        <CalibrationCard />
        <ForecastCard />
        <AnalyticsFooter />
      </section>

      <DomainBoard />

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-[13px] font-bold uppercase tracking-wider text-fg-subtle">
            Skill tree
          </h2>
          <SkillTreeLegend />
        </div>
        <SkillTree topics={topics} onSelect={(id) => navigate(`topic/${id}`)} />
        <p className="mt-3 text-[12.5px] leading-relaxed text-fg-subtle">
          Rows are prerequisite depth, not subject — a dashed line is a prerequisite you
          have not reached 60% on yet. Nothing is truly locked; the tree is advice about
          order, not a gate.
        </p>
      </section>

      <Badges />

      <div className="mt-10 grid gap-4 lg:grid-cols-2">
        <EffectsSwitch />
        <DataCard />
      </div>
    </div>
  );
}
