/**
 * Derived views over persisted progress.
 *
 * Mastery is computed here rather than stored (see the note in progressSchema.ts):
 * there is no cache, so there is nothing to go stale. Cheap enough to do on render —
 * it is a pass over a few thousand small objects at worst.
 */

import { manifest } from "../content/loader";
import type { Domain, ManifestTopic } from "../content/schema";
import {
  bossUnlocked,
  blockingPrereqs,
  domainMastery,
  isUnlocked,
  topicMastery,
  weakAreas,
  type TopicMastery,
} from "../engine/mastery";
import { dueStates, isDue, reviewForecast, type QuestionState } from "../engine/scheduler";
import type { BadgeContext } from "../engine/badges";
import { levelFor, type LevelInfo } from "../engine/xp";
import { freezesToApply, streakInfo, type StreakInfo } from "../engine/streak";
import { dayKey, type ProgressState } from "../storage/progressSchema";

export interface TopicProgress extends TopicMastery {
  topic: ManifestTopic;
  dueCount: number;
  unlocked: boolean;
  blockedBy: string[];
  needsReteachCount: number;
}

/** Question states grouped by the topic they belong to. */
function statesByTopic(progress: ProgressState): Map<string, QuestionState[]> {
  const out = new Map<string, QuestionState[]>();
  for (const state of Object.values(progress.questions)) {
    const list = out.get(state.topicId);
    if (list) list.push(state);
    else out.set(state.topicId, [state]);
  }
  return out;
}

/**
 * Per-topic progress for every topic in the manifest.
 *
 * Two passes on purpose: mastery has to be known for every topic before unlock can
 * be decided, because a topic's availability depends on its prerequisites' mastery.
 */
export function topicProgress(progress: ProgressState, now: number): TopicProgress[] {
  const grouped = statesByTopic(progress);

  const masteries = new Map<string, TopicMastery>();
  for (const topic of manifest.topics) {
    masteries.set(
      topic.id,
      topicMastery(topic.id, grouped.get(topic.id) ?? [], topic.questionCount, now),
    );
  }

  const masteryValues = new Map([...masteries].map(([id, m]) => [id, m.mastery]));

  return manifest.topics.map((topic) => {
    const states = grouped.get(topic.id) ?? [];
    // Non-null: every manifest topic got an entry in the loop above.
    const mastery = masteries.get(topic.id) as TopicMastery;

    return {
      ...mastery,
      topic,
      dueCount: states.filter((s) => isDue(s, now)).length,
      unlocked: isUnlocked(topic.prereqs, masteryValues),
      blockedBy: blockingPrereqs(topic.prereqs, masteryValues),
      needsReteachCount: states.filter((s) => s.needsReteach).length,
    };
  });
}

export interface DomainProgress {
  domain: Domain;
  mastery: number;
  topics: TopicProgress[];
  bossUnlocked: boolean;
}

export function domainProgress(topics: TopicProgress[]): DomainProgress[] {
  const grouped = new Map<Domain, TopicProgress[]>();
  for (const t of topics) {
    const list = grouped.get(t.topic.domain);
    if (list) list.push(t);
    else grouped.set(t.topic.domain, [t]);
  }

  return [...grouped.entries()].map(([domain, list]) => {
    const mastery = domainMastery(
      list.map((t) => ({ mastery: t.mastery, totalQuestions: t.totalQuestions })),
    );
    return {
      domain,
      mastery,
      topics: list,
      bossUnlocked: bossUnlocked(mastery, list.filter((t) => t.started).length, list.length),
    };
  });
}

/** Every due question id, most overdue first. */
export function dueQuestionIds(progress: ProgressState, now: number): string[] {
  return dueStates(Object.values(progress.questions), now).map((s) => s.id);
}

export function dueCount(progress: ProgressState, now: number): number {
  let n = 0;
  for (const state of Object.values(progress.questions)) if (isDue(state, now)) n += 1;
  return n;
}

export function forecast(progress: ProgressState, now: number, days = 7): number[] {
  return reviewForecast(Object.values(progress.questions), now, days);
}

export function weakTopics(topics: TopicProgress[]): TopicProgress[] {
  const weak = new Set(weakAreas(topics).map((t) => t.topicId));
  return topics.filter((t) => weak.has(t.topicId)).sort((a, b) => a.mastery - b.mastery);
}

/** Answered and correct counts for a calendar day key, for the streak and analytics. */
export function dayTotals(
  progress: ProgressState,
  key: string,
): { answered: number; correct: number; minutes: number } {
  const day = progress.daily[key];
  if (!day) return { answered: 0, correct: 0, minutes: 0 };
  return {
    answered: day.answered,
    correct: day.correct,
    minutes: Math.round(day.seconds / 60),
  };
}

/* ------------------------------------------------------------------ *
 * Gamification
 * ------------------------------------------------------------------ */

/**
 * The mastery half of the badge context. Passed into recordAnswer rather than
 * imported by it, so the engine stays independent of the content manifest.
 */
export function badgeContextFor(
  progress: ProgressState,
  now: number,
): Omit<BadgeContext, "questions" | "events"> {
  const topics = topicProgress(progress, now);
  return {
    topics: topics.map((t) => ({
      topicId: t.topicId,
      domain: t.topic.domain,
      mastery: t.mastery,
      started: t.started,
    })),
    domains: domainProgress(topics).map((d) => ({
      domain: d.domain,
      mastery: d.mastery,
      topicCount: d.topics.length,
    })),
  };
}

export function level(progress: ProgressState): LevelInfo {
  return levelFor(progress.gamification.xp);
}

export function streak(progress: ProgressState, now: number): StreakInfo {
  return streakInfo({
    daily: progress.daily,
    frozenDays: progress.gamification.frozenDays,
    dailyGoalMinutes: progress.settings.dailyGoalMinutes,
    today: dayKey(now),
  });
}

/**
 * Freeze days needed to keep the streak alive, if the allowance can cover the whole
 * gap. Called on boot and after answering; returns [] when there is nothing to do,
 * so the caller can skip the write.
 */
export function pendingFreezes(progress: ProgressState, now: number): string[] {
  return freezesToApply({
    daily: progress.daily,
    frozenDays: progress.gamification.frozenDays,
    dailyGoalMinutes: progress.settings.dailyGoalMinutes,
    today: dayKey(now),
  });
}
