/**
 * Spaced repetition scheduling.
 *
 * SM-2, modified so that the confidence tag is part of the grade rather than a
 * side channel (CLAUDE.md §6). Behind a `Scheduler` interface so an FSRS
 * implementation can replace it later without touching a single call site.
 *
 * Everything here is pure and takes `now` as a parameter — no Date.now() inside —
 * so the tests can assert exact intervals rather than approximate ones.
 */

import type { Confidence } from "./grading";
import { DAY_MS, MINUTE_MS, SCHEDULER } from "./constants";

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

export interface QuestionState {
  id: string;
  topicId: string;
  /** Copied from the question at first encounter, so mastery can weight by difficulty
   *  without loading lesson bodies just to read a number. */
  difficulty: number;
  /** SM-2 ease factor. Higher means intervals grow faster. */
  ease: number;
  /** Current interval in days. 0 means "still in learning / lapsed". */
  intervalDays: number;
  dueAt: number;
  /** Consecutive successful reps. Resets to 0 on any miss. */
  reps: number;
  /** Lifetime misses. Never resets — it is history, not state. */
  lapses: number;
  consecutiveMisses: number;
  lastGrade: number | null;
  lastAnsweredAt: number | null;
  lastConfidence: Confidence | null;
  correctCount: number;
  totalCount: number;
  /** True once answered correctly at least once. Drives mastery coverage. */
  everCorrect: boolean;
  /**
   * Set when the user has missed this twice running: the next encounter should
   * re-teach and step difficulty down rather than just asking again.
   */
  needsReteach: boolean;
}

export interface Outcome {
  correct: boolean;
  confidence: Confidence;
}

export interface Scheduler {
  /** Fresh state for a question never seen before. Due immediately. */
  create(id: string, topicId: string, difficulty: number, now: number): QuestionState;
  next(state: QuestionState, outcome: Outcome, now: number): QuestionState;
}

/* ------------------------------------------------------------------ *
 * Confidence -> grade
 * ------------------------------------------------------------------ */

/**
 * The table from CLAUDE.md §6, in code. This is the heart of the design: the same
 * right answer is worth a different amount depending on whether the user knew it.
 */
export function gradeFor(outcome: Outcome): number {
  const { correct, confidence } = outcome;

  if (correct) {
    // Unsure-and-right and guessed-and-right both grade 3, which advances the
    // repetition but damps ease. Guessing is additionally interval-capped below.
    return confidence === "confident" ? 5 : 3;
  }
  // Confident-and-wrong is the only grade 0: the model is wrong, not the recall.
  return confidence === "confident" ? 0 : 1;
}

export const PASS_GRADE = 3;

/** Standard SM-2 ease adjustment: +0.1 at grade 5, -0.14 at 3, -0.8 at 0. */
export function nextEase(ease: number, grade: number): number {
  const delta = 0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02);
  return clamp(ease + delta, SCHEDULER.MIN_EASE, SCHEDULER.MAX_EASE);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------------ *
 * The scheduler
 * ------------------------------------------------------------------ */

export const sm2Scheduler: Scheduler = {
  create(id, topicId, difficulty, now) {
    return {
      id,
      topicId,
      difficulty,
      ease: SCHEDULER.INITIAL_EASE,
      intervalDays: 0,
      dueAt: now,
      reps: 0,
      lapses: 0,
      consecutiveMisses: 0,
      lastGrade: null,
      lastAnsweredAt: null,
      lastConfidence: null,
      correctCount: 0,
      totalCount: 0,
      everCorrect: false,
      needsReteach: false,
    };
  },

  next(state, outcome, now) {
    const grade = gradeFor(outcome);
    const passed = grade >= PASS_GRADE;

    const common = {
      ...state,
      ease: nextEase(state.ease, grade),
      lastGrade: grade,
      lastAnsweredAt: now,
      lastConfidence: outcome.confidence,
      totalCount: state.totalCount + 1,
      correctCount: state.correctCount + (outcome.correct ? 1 : 0),
      everCorrect: state.everCorrect || outcome.correct,
    };

    if (!passed) {
      const consecutiveMisses = state.consecutiveMisses + 1;
      // Grade 0 (confident and wrong) returns inside this session; grade 1 tomorrow.
      const dueAt =
        grade === 0
          ? now + SCHEDULER.HARD_LAPSE_MINUTES * MINUTE_MS
          : now + SCHEDULER.SOFT_LAPSE_DAYS * DAY_MS;

      return {
        ...common,
        intervalDays: 0,
        reps: 0,
        lapses: state.lapses + 1,
        consecutiveMisses,
        needsReteach: consecutiveMisses >= SCHEDULER.RETEACH_AFTER_CONSECUTIVE_MISSES,
        dueAt,
      };
    }

    const reps = state.reps + 1;
    let intervalDays: number;

    if (reps === 1) {
      intervalDays = SCHEDULER.FIRST_INTERVAL_DAYS;
    } else if (reps === 2) {
      intervalDays = SCHEDULER.SECOND_INTERVAL_DAYS;
    } else {
      // Grow from the previous interval, using the ease as it was before this answer
      // (standard SM-2 order: schedule on the old ease, then update it).
      intervalDays = Math.round(state.intervalDays * state.ease);
    }

    // A lucky guess earns no growth beyond the cap — but it never claws back an
    // interval already earned. Clamping downward would let a CORRECT answer reduce
    // mastery, which breaks the invariant the mastery tests rely on.
    if (outcome.confidence === "guessing") {
      const ceiling = Math.max(SCHEDULER.GUESS_INTERVAL_CAP_DAYS, state.intervalDays);
      intervalDays = Math.min(intervalDays, ceiling);
    }

    intervalDays = clamp(intervalDays, SCHEDULER.FIRST_INTERVAL_DAYS, SCHEDULER.MAX_INTERVAL_DAYS);

    return {
      ...common,
      intervalDays,
      reps,
      consecutiveMisses: 0,
      // A correct answer clears the re-teach flag: the gap has been closed.
      needsReteach: false,
      dueAt: now + intervalDays * DAY_MS,
    };
  },
};

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

export function isDue(state: QuestionState, now: number): boolean {
  return state.dueAt <= now;
}

/** Due questions, most overdue first — the ones at greatest risk of being forgotten. */
export function dueStates(
  states: Iterable<QuestionState>,
  now: number,
): QuestionState[] {
  return [...states].filter((s) => isDue(s, now)).sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * Review load forecast: how many questions fall due on each of the next `days` days,
 * counting anything already overdue into day 0. Feeds the analytics view in M6.
 */
export function reviewForecast(
  states: Iterable<QuestionState>,
  now: number,
  days: number,
): number[] {
  const buckets = new Array<number>(days).fill(0);
  for (const state of states) {
    const offset = Math.floor((state.dueAt - now) / DAY_MS);
    const bucket = Math.max(0, offset);
    if (bucket < days) {
      // Non-null: bucket is bounded by days and buckets has that length.
      buckets[bucket] = (buckets[bucket] ?? 0) + 1;
    }
  }
  return buckets;
}
