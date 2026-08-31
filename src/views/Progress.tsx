/**
 * Progress — level, streak, badges and the skill tree.
 *
 * Everything here reports on retention rather than effort. There is no "answers
 * given" or "hours studied" figure anywhere on the page, because rewarding those was
 * explicitly out of scope.
 */

import { useMemo } from "react";

import { BADGES, badgeById } from "../engine/badges";
import { navigate } from "../lib/hashRouter";
import { formatMinutes } from "../lib/time";
import { level, streak, topicProgress } from "../state/selectors";
import { useApp } from "../state/store";
import { Badge, Card, PageTitle } from "../ui/primitives";
import { SkillTree, SkillTreeLegend } from "../ui/SkillTree";

function LevelCard() {
  const progress = useApp((s) => s.progress);
  const info = useMemo(() => level(progress), [progress]);
  const xp = progress.gamification.xp;

  return (
    <Card className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            Level {info.level}
          </div>
          <div className="mt-0.5 text-lg font-semibold text-fg">{info.title}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="text-2xl font-semibold text-fg tnum">{xp.toLocaleString()}</div>
          <div className="text-[12px] text-fg-subtle">XP</div>
        </div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full rounded-full bg-accent"
            style={{ width: `${Math.round(info.progress * 100)}%` }}
          />
        </div>
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
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
            Streak
          </div>
          <div className="mt-0.5 text-lg font-semibold text-fg tnum">
            {info.current} day{info.current === 1 ? "" : "s"}
          </div>
        </div>
        <div className="shrink-0 text-right text-[12px] text-fg-subtle tnum">
          longest {info.longest}
        </div>
      </div>

      <div className="mt-4">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            className={`h-full rounded-full ${info.todayQualified ? "bg-correct" : "bg-accent"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
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
            <Card key={badge.id} className={`p-4 ${has ? "" : "opacity-60"}`}>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold text-fg">{badge.name}</span>
                {has ? <Badge tone="accent">earned</Badge> : <Badge tone="neutral">locked</Badge>}
              </div>
              <p className="text-[13px] leading-relaxed text-fg-muted">
                {has ? badge.description : (definition?.requirement ?? badge.requirement)}
              </p>
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

      <section className="mb-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-4">
          <h2 className="text-[13px] font-semibold uppercase tracking-wider text-fg-subtle">
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
    </div>
  );
}
