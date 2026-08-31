/**
 * Progress — level, streak, badges and the skill tree.
 *
 * Everything here reports on retention rather than effort. There is no "answers
 * given" or "hours studied" figure anywhere on the page, because rewarding those was
 * explicitly out of scope.
 */

import { useMemo } from "react";

import { BADGES, badgeById } from "../engine/badges";
import { DOMAIN_LABELS, type Domain } from "../content/schema";
import { navigate } from "../lib/hashRouter";
import { formatMinutes } from "../lib/time";
import { domainProgress, level, streak, topicProgress } from "../state/selectors";
import { useApp } from "../state/store";
import { DOMAIN_MONOGRAM, domainStyle } from "../ui/domain";
import { Icon } from "../ui/icons";
import { Badge, Card, Meter, Monogram, PageTitle, Ring } from "../ui/primitives";
import { SkillTree, SkillTreeLegend } from "../ui/SkillTree";

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

      <div className="mt-10">
        <EffectsSwitch />
      </div>
    </div>
  );
}
