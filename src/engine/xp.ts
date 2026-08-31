/**
 * XP and levels.
 *
 * The design constraint was "I don't want to be able to farm points by clicking
 * through", so the rules are deliberately stingy:
 *
 *   - a wrong answer earns nothing
 *   - a question earns XP at most ONCE PER DAY, however many times it is answered
 *   - a right-but-guessed answer earns 30% of a right-and-confident one
 *   - past a daily soft cap, further XP is discounted to a quarter
 *   - the one generous case is reviving something previously missed
 *
 * The "once per day" check reads the answer log rather than keeping a separate
 * ledger, so there is no second source of truth to fall out of step.
 */

import { LEVELS, XP } from "./constants";
import type { Confidence } from "./grading";
import { PASS_GRADE, type QuestionState } from "./scheduler";
import { dayKey, type AnswerEvent } from "../storage/progressSchema";

export interface XpInput {
  questionId: string;
  difficulty: number;
  correct: boolean;
  confidence: Confidence;
  /** Scheduling state BEFORE this answer, or null if never seen. */
  previous: QuestionState | null;
  /** XP already earned today, for the soft cap. */
  earnedToday: number;
  /** The answer log, to check whether this question already paid out today. */
  events: readonly AnswerEvent[];
  now: number;
}

export type XpSkipReason = "incorrect" | "already-earned-today";

export interface XpAward {
  total: number;
  /** Present when nothing was awarded, so the UI can explain the zero. */
  skipped: XpSkipReason | null;
  base: number;
  difficultyMultiplier: number;
  calibrationMultiplier: number;
  revivalBonus: number;
  /** True when the daily soft cap discounted this award. */
  discounted: boolean;
}

const noAward = (skipped: XpSkipReason): XpAward => ({
  total: 0,
  skipped,
  base: 0,
  difficultyMultiplier: 0,
  calibrationMultiplier: 0,
  revivalBonus: 0,
  discounted: false,
});

/** Has this question already paid out today? */
export function alreadyEarnedToday(
  questionId: string,
  events: readonly AnswerEvent[],
  now: number,
): boolean {
  const today = dayKey(now);
  // Scan backwards: today's answers are at the end of the log.
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (!event) continue;
    if (dayKey(event.at) !== today) break;
    // Only a *correct* prior answer counts as having been paid — a miss earned nothing,
    // so getting it right later in the day should still be rewarded.
    if (event.q === questionId && event.ok) return true;
  }
  return false;
}

/**
 * A revival is getting right something you had previously missed — the question had
 * lapsed at least once and its last answer was a miss.
 */
export function isRevival(previous: QuestionState | null, correct: boolean): boolean {
  if (!correct || previous === null) return false;
  if (previous.lapses === 0) return false;
  return previous.lastGrade !== null && previous.lastGrade < PASS_GRADE;
}

export function xpForAnswer(input: XpInput): XpAward {
  if (!input.correct) return noAward("incorrect");
  if (alreadyEarnedToday(input.questionId, input.events, input.now)) {
    return noAward("already-earned-today");
  }

  const difficultyIndex = Math.min(
    Math.max(Math.round(input.difficulty) - 1, 0),
    XP.DIFFICULTY_MULTIPLIERS.length - 1,
  );
  const difficultyMultiplier = XP.DIFFICULTY_MULTIPLIERS[difficultyIndex] ?? 1;
  const calibrationMultiplier = XP.CALIBRATION[input.confidence];
  const revivalBonus = isRevival(input.previous, input.correct) ? XP.REVIVAL_BONUS : 0;

  const raw = XP.BASE_CORRECT * difficultyMultiplier * calibrationMultiplier + revivalBonus;
  const discounted = input.earnedToday >= XP.DAILY_SOFT_CAP;
  const total = Math.max(1, Math.round(discounted ? raw * XP.OVER_CAP_MULTIPLIER : raw));

  return {
    total,
    skipped: null,
    base: XP.BASE_CORRECT,
    difficultyMultiplier,
    calibrationMultiplier,
    revivalBonus,
    discounted,
  };
}

/* ------------------------------------------------------------------ *
 * Levels
 * ------------------------------------------------------------------ */

export interface LevelInfo {
  level: number;
  title: string;
  /** XP at which this level began. */
  floor: number;
  /** XP needed for the next level, or null at the top. */
  next: number | null;
  nextTitle: string | null;
  /** 0..1 through the current level; 1 at the top level. */
  progress: number;
}

export function levelFor(xp: number): LevelInfo {
  const total = Math.max(0, xp);

  let index = 0;
  for (let i = 0; i < LEVELS.length; i++) {
    const entry = LEVELS[i];
    if (entry && total >= entry.xp) index = i;
  }

  // Non-null: LEVELS is a non-empty const array and index is clamped into it.
  const current = LEVELS[index] as (typeof LEVELS)[number];
  const upcoming = LEVELS[index + 1] ?? null;

  return {
    level: current.level,
    title: current.title,
    floor: current.xp,
    next: upcoming?.xp ?? null,
    nextTitle: upcoming?.title ?? null,
    progress:
      upcoming === null
        ? 1
        : Math.min(1, Math.max(0, (total - current.xp) / (upcoming.xp - current.xp))),
  };
}
