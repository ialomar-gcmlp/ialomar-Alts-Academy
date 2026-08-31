/**
 * Mastery math.
 *
 * Turns a pile of per-question scheduling state into one number per topic and one
 * per domain, used for the skill tree, unlock gates, weak-area drilling and the
 * analytics view.
 *
 * Three components, combined as a GEOMETRIC mean rather than an average:
 *
 *   coverage   how much of the topic you have got right at least once
 *   retention  whether your most recent answers passed, discounted by age
 *   stability  how far apart the scheduler has spread your reviews
 *
 * Geometric because they are not substitutes. Averaging would let a topic look
 * two-thirds mastered on coverage and retention alone, having been answered once
 * yesterday and never revisited — which is precisely the state the word "mastered"
 * should exclude. Multiplying means a zero anywhere is a zero overall.
 *
 * The invariant the tests pin down: **evaluated at the same instant, a correct
 * answer can never lower mastery.** Every component is individually non-decreasing
 * on a pass, which is also why the scheduler's guessing cap limits growth rather
 * than clamping an earned interval back down.
 */

import { DAY_MS, MASTERY } from "./constants";
import { PASS_GRADE, type QuestionState } from "./scheduler";

export interface TopicMastery {
  topicId: string;
  mastery: number;
  coverage: number;
  retention: number;
  stability: number;
  /** Questions in the topic with any answer history. */
  attempted: number;
  totalQuestions: number;
  started: boolean;
}

function difficultyWeight(difficulty: number): number {
  const index = Math.round(difficulty) - 1;
  return MASTERY.DIFFICULTY_WEIGHTS[index] ?? 1;
}

/**
 * How much an answer still counts, given how long ago it was. Halves every
 * RETENTION_HALF_LIFE_DAYS, so mastery decays with neglect rather than being a
 * permanent trophy.
 */
export function evidenceStrength(lastAnsweredAt: number | null, now: number): number {
  if (lastAnsweredAt === null) return 0;
  const ageDays = Math.max(0, (now - lastAnsweredAt) / DAY_MS);
  return 0.5 ** (ageDays / MASTERY.RETENTION_HALF_LIFE_DAYS);
}

export function topicMastery(
  topicId: string,
  states: QuestionState[],
  totalQuestions: number,
  now: number,
): TopicMastery {
  const empty: TopicMastery = {
    topicId,
    mastery: 0,
    coverage: 0,
    retention: 0,
    stability: 0,
    attempted: 0,
    totalQuestions,
    started: false,
  };

  if (totalQuestions <= 0 || states.length === 0) return empty;

  /* coverage — share of the whole topic answered correctly at least once */
  const everCorrect = states.filter((s) => s.everCorrect).length;
  const coverage = clamp01(everCorrect / totalQuestions);

  /* retention — did the LAST answer pass, discounted by how stale it is */
  let retentionNum = 0;
  let retentionDen = 0;
  /* stability — how far apart reviews have been spread */
  let stabilityNum = 0;
  let stabilityDen = 0;

  for (const state of states) {
    if (state.totalCount === 0) continue;
    const w = difficultyWeight(state.difficulty);

    const passed = state.lastGrade !== null && state.lastGrade >= PASS_GRADE;
    retentionNum += w * (passed ? evidenceStrength(state.lastAnsweredAt, now) : 0);
    retentionDen += w;

    stabilityNum += w * clamp01(state.intervalDays / MASTERY.STABILITY_TARGET_DAYS);
    stabilityDen += w;
  }

  if (retentionDen === 0) return empty;

  const retention = clamp01(retentionNum / retentionDen);
  const stability = clamp01(stabilityNum / stabilityDen);

  return {
    topicId,
    mastery: geometricMean(
      [coverage, retention, stability],
      [MASTERY.COVERAGE_WEIGHT, MASTERY.RETENTION_WEIGHT, MASTERY.STABILITY_WEIGHT],
    ),
    coverage,
    retention,
    stability,
    attempted: states.filter((s) => s.totalCount > 0).length,
    totalQuestions,
    started: true,
  };
}

/**
 * Domain mastery: topic mastery weighted by question count, so a 12-question topic
 * counts for more than a 4-question one. Topics never started count as zero — a
 * domain is not mastered because you did well in the one topic you opened.
 */
export function domainMastery(
  topics: { mastery: number; totalQuestions: number }[],
): number {
  const total = topics.reduce((n, t) => n + t.totalQuestions, 0);
  if (total === 0) return 0;
  return clamp01(
    topics.reduce((sum, t) => sum + t.mastery * t.totalQuestions, 0) / total,
  );
}

/* ------------------------------------------------------------------ *
 * Gates and selection
 * ------------------------------------------------------------------ */

/** A topic is available when every prerequisite has reached the unlock threshold. */
export function isUnlocked(
  prereqs: string[],
  masteryByTopic: ReadonlyMap<string, number>,
): boolean {
  return prereqs.every((id) => (masteryByTopic.get(id) ?? 0) >= MASTERY.UNLOCK_THRESHOLD);
}

/** Prerequisites still holding a topic shut — so the UI can say *why* it is locked. */
export function blockingPrereqs(
  prereqs: string[],
  masteryByTopic: ReadonlyMap<string, number>,
): string[] {
  return prereqs.filter((id) => (masteryByTopic.get(id) ?? 0) < MASTERY.UNLOCK_THRESHOLD);
}

export function bossUnlocked(
  domainMasteryValue: number,
  topicsStarted: number,
  topicsTotal: number,
): boolean {
  if (topicsTotal === 0) return false;
  return (
    domainMasteryValue >= MASTERY.BOSS_DOMAIN_MASTERY &&
    topicsStarted / topicsTotal >= MASTERY.BOSS_TOPICS_STARTED_FRACTION
  );
}

/** Started but shaky — the pool "Weak Areas" drills from, weakest first. */
export function weakAreas(topics: TopicMastery[]): TopicMastery[] {
  return topics
    .filter((t) => t.started && t.mastery < MASTERY.WEAK_AREA_CEILING)
    .sort((a, b) => a.mastery - b.mastery);
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Weighted geometric mean. A zero in any component gives zero overall, which is the
 * whole reason for choosing it.
 */
export function geometricMean(values: number[], weights: number[]): number {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  if (totalWeight <= 0) return 0;
  if (values.some((v) => v <= 0)) return 0;

  const logSum = values.reduce(
    (sum, v, i) => sum + (weights[i] ?? 0) * Math.log(v),
    0,
  );
  return clamp01(Math.exp(logSum / totalWeight));
}
