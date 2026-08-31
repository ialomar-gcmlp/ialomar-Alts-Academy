/**
 * XP tests.
 *
 * The brief's constraint was "I don't want to be able to farm points by clicking
 * through", so most of these are attempts to farm it: re-answering the same question,
 * spamming easy questions, tagging everything Confident. The anti-farming rules are
 * the specification, not a nicety.
 */

import { describe, expect, it } from "vitest";

import { DAY_MS, LEVELS, XP } from "./constants";
import { sm2Scheduler, type QuestionState } from "./scheduler";
import { alreadyEarnedToday, isRevival, levelFor, xpForAnswer, type XpInput } from "./xp";
import type { AnswerEvent } from "../storage/progressSchema";

const T0 = Date.UTC(2026, 5, 15, 12, 0, 0);

const event = (over: Partial<AnswerEvent> = {}): AnswerEvent => ({
  q: "quant-tvm-01-q1",
  t: "quant-tvm-01",
  at: T0,
  ok: true,
  c: "confident",
  d: 3,
  g: 5,
  s: 20,
  ...over,
});

const input = (over: Partial<XpInput> = {}): XpInput => ({
  questionId: "quant-tvm-01-q1",
  difficulty: 3,
  correct: true,
  confidence: "confident",
  previous: null,
  earnedToday: 0,
  events: [],
  now: T0,
  ...over,
});

describe("xpForAnswer — the basics", () => {
  it("pays base x difficulty x calibration for a confident correct answer", () => {
    const award = xpForAnswer(input({ difficulty: 3 }));
    // 10 base x 1.5 (difficulty 3) x 1.0 (confident)
    expect(award.total).toBe(15);
    expect(award.skipped).toBeNull();
  });

  it("pays more for harder questions", () => {
    const easy = xpForAnswer(input({ difficulty: 1 })).total;
    const hard = xpForAnswer(input({ difficulty: 5 })).total;
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBe(10);
    expect(hard).toBe(25);
  });

  it("clamps an out-of-range difficulty rather than producing NaN", () => {
    expect(xpForAnswer(input({ difficulty: 0 })).total).toBe(10);
    expect(xpForAnswer(input({ difficulty: 99 })).total).toBe(25);
  });
});

describe("xpForAnswer — cannot be farmed", () => {
  it("pays nothing for a wrong answer, whatever the confidence", () => {
    for (const confidence of ["confident", "unsure", "guessing"] as const) {
      const award = xpForAnswer(input({ correct: false, confidence }));
      expect(award.total).toBe(0);
      expect(award.skipped).toBe("incorrect");
    }
  });

  it("pays a question only once per day", () => {
    // The core anti-farming rule: answering the same thing repeatedly earns nothing.
    const events = [event({ at: T0 - 1000 })];
    const award = xpForAnswer(input({ events }));
    expect(award.total).toBe(0);
    expect(award.skipped).toBe("already-earned-today");
  });

  it("pays again the next day", () => {
    const events = [event({ at: T0 - DAY_MS })];
    expect(xpForAnswer(input({ events })).total).toBeGreaterThan(0);
  });

  it("still pays after an earlier MISS on the same question that day", () => {
    // A miss earned nothing, so getting it right later the same day should count —
    // otherwise the incentive is to avoid retrying something you got wrong.
    const events = [event({ at: T0 - 1000, ok: false, g: 0 })];
    expect(xpForAnswer(input({ events })).total).toBeGreaterThan(0);
  });

  it("does not confuse other questions answered today", () => {
    const events = [event({ q: "quant-tvm-01-q9", at: T0 - 1000 })];
    expect(xpForAnswer(input({ events })).total).toBeGreaterThan(0);
  });

  it("pays a guessed correct answer only a fraction of a confident one", () => {
    const confident = xpForAnswer(input({ confidence: "confident" })).total;
    const guessed = xpForAnswer(input({ confidence: "guessing" })).total;
    expect(guessed).toBeLessThan(confident / 2);
  });

  it("discounts heavily past the daily soft cap without blocking outright", () => {
    const normal = xpForAnswer(input()).total;
    const capped = xpForAnswer(input({ earnedToday: XP.DAILY_SOFT_CAP })).total;
    expect(capped).toBeLessThan(normal);
    expect(capped).toBeGreaterThan(0);
  });

  it("never awards a fractional or zero amount to a genuine correct answer", () => {
    const award = xpForAnswer(
      input({ difficulty: 1, confidence: "guessing", earnedToday: XP.DAILY_SOFT_CAP }),
    );
    expect(Number.isInteger(award.total)).toBe(true);
    expect(award.total).toBeGreaterThanOrEqual(1);
  });
});

describe("revival bonus", () => {
  const lapsed = (): QuestionState => {
    const fresh = sm2Scheduler.create("quant-tvm-01-q1", "quant-tvm-01", 3, T0);
    return sm2Scheduler.next(fresh, { correct: false, confidence: "confident" }, T0);
  };

  it("identifies a revival: previously missed, now right", () => {
    expect(isRevival(lapsed(), true)).toBe(true);
  });

  it("is not a revival if the answer is wrong again", () => {
    expect(isRevival(lapsed(), false)).toBe(false);
  });

  it("is not a revival for a question never missed", () => {
    const clean = sm2Scheduler.next(
      sm2Scheduler.create("q", "t", 3, T0),
      { correct: true, confidence: "confident" },
      T0,
    );
    expect(isRevival(clean, true)).toBe(false);
  });

  it("is not a revival if the last answer already passed", () => {
    // Lapsed long ago but recovered since — the bonus is for closing the gap, once.
    let s = lapsed();
    s = sm2Scheduler.next(s, { correct: true, confidence: "confident" }, T0 + DAY_MS);
    expect(isRevival(s, true)).toBe(false);
  });

  it("adds the bonus on top of the normal award", () => {
    const plain = xpForAnswer(input()).total;
    const revived = xpForAnswer(input({ previous: lapsed() }));
    expect(revived.revivalBonus).toBe(XP.REVIVAL_BONUS);
    expect(revived.total).toBe(plain + XP.REVIVAL_BONUS);
  });
});

describe("alreadyEarnedToday", () => {
  it("scans only today, not the whole log", () => {
    const events = [
      event({ at: T0 - 5 * DAY_MS }),
      event({ q: "other", at: T0 - 1000 }),
    ];
    expect(alreadyEarnedToday("quant-tvm-01-q1", events, T0)).toBe(false);
  });

  it("is false for an empty log", () => {
    expect(alreadyEarnedToday("q", [], T0)).toBe(false);
  });
});

describe("levelFor", () => {
  it("starts at level 1", () => {
    const info = levelFor(0);
    expect(info.level).toBe(1);
    expect(info.title).toBe("Orientation");
    expect(info.progress).toBe(0);
  });

  it("advances at each threshold, boundary included", () => {
    for (const entry of LEVELS) {
      expect(levelFor(entry.xp).level).toBe(entry.level);
    }
  });

  it("stays on a level just below the next threshold", () => {
    const second = LEVELS[1];
    if (!second) throw new Error("expected a second level");
    expect(levelFor(second.xp - 1).level).toBe(1);
  });

  it("reports progress through the current level", () => {
    const info = levelFor(200); // level 2 spans 100..300
    expect(info.level).toBe(2);
    expect(info.progress).toBeCloseTo(0.5, 6);
    expect(info.next).toBe(300);
  });

  it("caps at the top level with no next", () => {
    const top = LEVELS[LEVELS.length - 1];
    if (!top) throw new Error("expected a top level");
    const info = levelFor(top.xp * 10);
    expect(info.level).toBe(top.level);
    expect(info.next).toBeNull();
    expect(info.progress).toBe(1);
  });

  it("treats negative XP as zero rather than throwing", () => {
    expect(levelFor(-500).level).toBe(1);
  });

  it("has strictly increasing thresholds", () => {
    // A typo here would silently make a level unreachable.
    for (let i = 1; i < LEVELS.length; i++) {
      const prev = LEVELS[i - 1];
      const curr = LEVELS[i];
      if (!prev || !curr) continue;
      expect(curr.xp).toBeGreaterThan(prev.xp);
      expect(curr.level).toBe(prev.level + 1);
    }
  });
});
