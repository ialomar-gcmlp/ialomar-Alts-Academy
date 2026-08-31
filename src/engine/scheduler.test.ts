/**
 * Scheduler tests.
 *
 * Pins down the whole confidence-to-grade table from CLAUDE.md §6, the lapse
 * behaviour, the interval floor and ceiling, the guessing cap, and the re-teach
 * trigger. `now` is injected, so every interval is asserted exactly rather than
 * approximately.
 */

import { describe, expect, it } from "vitest";

import { DAY_MS, MINUTE_MS, SCHEDULER } from "./constants";
import type { Confidence } from "./grading";
import {
  dueStates,
  gradeFor,
  isDue,
  nextEase,
  reviewForecast,
  sm2Scheduler,
  type QuestionState,
} from "./scheduler";

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);
const fresh = (difficulty = 3): QuestionState =>
  sm2Scheduler.create("quant-tvm-01-q1", "quant-tvm-01", difficulty, T0);

const answer = (
  state: QuestionState,
  correct: boolean,
  confidence: Confidence,
  now = T0,
): QuestionState => sm2Scheduler.next(state, { correct, confidence }, now);

/** Days between `now` and the state's due time. */
const dueInDays = (state: QuestionState, now = T0): number => (state.dueAt - now) / DAY_MS;

describe("gradeFor — the confidence table", () => {
  it("maps every combination exactly as documented", () => {
    expect(gradeFor({ correct: true, confidence: "confident" })).toBe(5);
    expect(gradeFor({ correct: true, confidence: "unsure" })).toBe(3);
    expect(gradeFor({ correct: true, confidence: "guessing" })).toBe(3);
    expect(gradeFor({ correct: false, confidence: "guessing" })).toBe(1);
    expect(gradeFor({ correct: false, confidence: "unsure" })).toBe(1);
    expect(gradeFor({ correct: false, confidence: "confident" })).toBe(0);
  });

  it("reserves grade 0 for confident-and-wrong alone", () => {
    // The distinction the whole design rests on: being sure and wrong is a broken
    // model, not a memory lapse, and only it earns the harshest treatment.
    const zeros = (["confident", "unsure", "guessing"] as const).filter(
      (c) => gradeFor({ correct: false, confidence: c }) === 0,
    );
    expect(zeros).toEqual(["confident"]);
  });
});

describe("nextEase", () => {
  it("rewards a confident pass and penalises an unsure one", () => {
    expect(nextEase(2.5, 5)).toBeCloseTo(2.6, 5);
    expect(nextEase(2.5, 3)).toBeCloseTo(2.36, 5);
  });

  it("penalises a confident miss hardest", () => {
    expect(nextEase(2.5, 0)).toBeCloseTo(1.7, 5);
    expect(nextEase(2.5, 1)).toBeCloseTo(1.96, 5);
  });

  it("never leaves the bounds, however many times it is pushed", () => {
    let low = 2.5;
    for (let i = 0; i < 20; i++) low = nextEase(low, 0);
    expect(low).toBe(SCHEDULER.MIN_EASE);

    let high = 2.5;
    for (let i = 0; i < 20; i++) high = nextEase(high, 5);
    expect(high).toBe(SCHEDULER.MAX_EASE);
  });
});

describe("create", () => {
  it("makes a question due immediately with no history", () => {
    const s = fresh();
    expect(s.dueAt).toBe(T0);
    expect(isDue(s, T0)).toBe(true);
    expect(s.reps).toBe(0);
    expect(s.totalCount).toBe(0);
    expect(s.everCorrect).toBe(false);
    expect(s.needsReteach).toBe(false);
    expect(s.ease).toBe(SCHEDULER.INITIAL_EASE);
  });
});

describe("passing", () => {
  it("uses the documented ladder for the first two reps", () => {
    const first = answer(fresh(), true, "confident");
    expect(first.intervalDays).toBe(SCHEDULER.FIRST_INTERVAL_DAYS);
    expect(dueInDays(first)).toBe(1);

    const second = answer(first, true, "confident", T0 + DAY_MS);
    expect(second.intervalDays).toBe(SCHEDULER.SECOND_INTERVAL_DAYS);
    expect(second.reps).toBe(2);
  });

  it("grows from the previous interval on the third rep and beyond", () => {
    let s = answer(fresh(), true, "confident");
    s = answer(s, true, "confident", T0 + DAY_MS);
    const easeBeforeThird = s.ease;
    s = answer(s, true, "confident", T0 + 4 * DAY_MS);

    // Standard SM-2 ordering: schedule on the ease as it was, then update it.
    expect(s.intervalDays).toBe(Math.round(SCHEDULER.SECOND_INTERVAL_DAYS * easeBeforeThird));
    expect(s.reps).toBe(3);
  });

  it("counts a correct answer and sets everCorrect", () => {
    const s = answer(fresh(), true, "unsure");
    expect(s.correctCount).toBe(1);
    expect(s.totalCount).toBe(1);
    expect(s.everCorrect).toBe(true);
  });

  it("never exceeds the interval ceiling however long the streak", () => {
    let s = fresh();
    let now = T0;
    for (let i = 0; i < 30; i++) {
      s = answer(s, true, "confident", now);
      now += s.intervalDays * DAY_MS;
    }
    expect(s.intervalDays).toBe(SCHEDULER.MAX_INTERVAL_DAYS);
  });
});

describe("guessing", () => {
  it("caps interval growth, so one lucky guess cannot bury a question", () => {
    let s = fresh();
    let now = T0;
    for (let i = 0; i < 8; i++) {
      s = answer(s, true, "guessing", now);
      now += s.intervalDays * DAY_MS;
      expect(s.intervalDays).toBeLessThanOrEqual(SCHEDULER.GUESS_INTERVAL_CAP_DAYS);
    }
  });

  it("does not claw back an interval already earned by confident answers", () => {
    // This is what keeps a CORRECT answer from ever reducing mastery.
    let s = fresh();
    let now = T0;
    for (let i = 0; i < 5; i++) {
      s = answer(s, true, "confident", now);
      now += s.intervalDays * DAY_MS;
    }
    const earned = s.intervalDays;
    expect(earned).toBeGreaterThan(SCHEDULER.GUESS_INTERVAL_CAP_DAYS);

    const afterGuess = answer(s, true, "guessing", now);
    expect(afterGuess.intervalDays).toBe(earned);
    expect(afterGuess.intervalDays).toBeGreaterThanOrEqual(earned);
  });

  it("still advances the repetition count", () => {
    const s = answer(fresh(), true, "guessing");
    expect(s.reps).toBe(1);
  });
});

describe("failing", () => {
  it("brings a confident miss back inside the same session", () => {
    const s = answer(fresh(), false, "confident");
    expect(s.dueAt).toBe(T0 + SCHEDULER.HARD_LAPSE_MINUTES * MINUTE_MS);
    expect(s.intervalDays).toBe(0);
    expect(s.reps).toBe(0);
    expect(s.lapses).toBe(1);
  });

  it("brings an unsure or guessed miss back the next day, not in ten minutes", () => {
    for (const confidence of ["unsure", "guessing"] as const) {
      const s = answer(fresh(), false, confidence);
      expect(dueInDays(s)).toBe(SCHEDULER.SOFT_LAPSE_DAYS);
    }
  });

  it("resets a long interval completely", () => {
    let s = fresh();
    let now = T0;
    for (let i = 0; i < 5; i++) {
      s = answer(s, true, "confident", now);
      now += s.intervalDays * DAY_MS;
    }
    expect(s.intervalDays).toBeGreaterThan(20);

    const lapsed = answer(s, false, "confident", now);
    expect(lapsed.intervalDays).toBe(0);
    expect(lapsed.reps).toBe(0);
    // Lapses are history and must survive, unlike reps.
    expect(lapsed.lapses).toBe(1);
  });

  it("restarts the ladder at the bottom after a lapse", () => {
    const lapsed = answer(fresh(), false, "confident");
    const recovered = answer(lapsed, true, "confident", T0 + DAY_MS);
    expect(recovered.intervalDays).toBe(SCHEDULER.FIRST_INTERVAL_DAYS);
    expect(recovered.reps).toBe(1);
  });
});

describe("adaptive difficulty — re-teach rather than just mark wrong", () => {
  it("does not trigger on a single miss", () => {
    expect(answer(fresh(), false, "unsure").needsReteach).toBe(false);
  });

  it("triggers on the second consecutive miss", () => {
    const once = answer(fresh(), false, "unsure");
    const twice = answer(once, false, "unsure", T0 + DAY_MS);
    expect(twice.consecutiveMisses).toBe(2);
    expect(twice.needsReteach).toBe(true);
  });

  it("clears once the question is answered correctly", () => {
    let s = answer(fresh(), false, "unsure");
    s = answer(s, false, "unsure", T0 + DAY_MS);
    expect(s.needsReteach).toBe(true);

    s = answer(s, true, "unsure", T0 + 2 * DAY_MS);
    expect(s.needsReteach).toBe(false);
    expect(s.consecutiveMisses).toBe(0);
  });

  it("does not count non-consecutive misses toward the trigger", () => {
    let s = answer(fresh(), false, "unsure");
    s = answer(s, true, "confident", T0 + DAY_MS);
    s = answer(s, false, "unsure", T0 + 2 * DAY_MS);
    expect(s.consecutiveMisses).toBe(1);
    expect(s.needsReteach).toBe(false);
  });
});

describe("dueStates", () => {
  it("returns only due questions, most overdue first", () => {
    const a = { ...fresh(), id: "a", dueAt: T0 - 5 * DAY_MS };
    const b = { ...fresh(), id: "b", dueAt: T0 - DAY_MS };
    const c = { ...fresh(), id: "c", dueAt: T0 + DAY_MS };

    expect(dueStates([c, b, a], T0).map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("treats exactly-now as due", () => {
    expect(dueStates([{ ...fresh(), dueAt: T0 }], T0)).toHaveLength(1);
  });
});

describe("reviewForecast", () => {
  it("buckets by day and folds everything overdue into day 0", () => {
    const states = [
      { ...fresh(), dueAt: T0 - 10 * DAY_MS }, // long overdue
      { ...fresh(), dueAt: T0 }, // now
      { ...fresh(), dueAt: T0 + 1.5 * DAY_MS }, // day 1
      { ...fresh(), dueAt: T0 + 2 * DAY_MS }, // day 2
      { ...fresh(), dueAt: T0 + 30 * DAY_MS }, // beyond the window
    ];
    expect(reviewForecast(states, T0, 7)).toEqual([2, 1, 1, 0, 0, 0, 0]);
  });

  it("returns all zeros when nothing is scheduled", () => {
    expect(reviewForecast([], T0, 3)).toEqual([0, 0, 0]);
  });
});
