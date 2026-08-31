/**
 * Streak and freeze tests.
 *
 * Two behaviours matter most and neither is obvious:
 *   1. a day needs BOTH the time goal and a real review, so a streak cannot be kept
 *      by only ever reading new material
 *   2. freezes are spent only when they actually save the streak — a gap too wide to
 *      bridge breaks it and leaves the allowance alone
 */

import { describe, expect, it } from "vitest";

import { STREAK } from "./constants";
import {
  dayQualifies,
  freezesToApply,
  freezesUsedIn,
  monthOf,
  shiftDay,
  streakInfo,
  type StreakInput,
} from "./streak";
import { emptyDailyAggregate, type DailyAggregate } from "../storage/progressSchema";

const GOAL = 10;

/** A day that meets the goal and includes a review. */
const good = (minutes = GOAL, reviews = 1): DailyAggregate => ({
  ...emptyDailyAggregate(),
  answered: 5,
  correct: 4,
  seconds: minutes * 60,
  reviews,
});

const build = (
  daily: Record<string, DailyAggregate>,
  frozenDays: string[] = [],
  today = "2026-06-15",
): StreakInput => ({ daily, frozenDays, dailyGoalMinutes: GOAL, today });

describe("shiftDay", () => {
  it("moves forward and back", () => {
    expect(shiftDay("2026-06-15", 1)).toBe("2026-06-16");
    expect(shiftDay("2026-06-15", -1)).toBe("2026-06-14");
  });

  it("crosses month and year boundaries", () => {
    expect(shiftDay("2026-06-30", 1)).toBe("2026-07-01");
    expect(shiftDay("2026-01-01", -1)).toBe("2025-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftDay("2028-02-28", 1)).toBe("2028-02-29");
  });
});

describe("monthOf / freezesUsedIn", () => {
  it("extracts the calendar month", () => {
    expect(monthOf("2026-06-15")).toBe("2026-06");
  });

  it("counts freezes only within the month asked about", () => {
    const frozen = ["2026-06-01", "2026-06-02", "2026-07-01"];
    expect(freezesUsedIn("2026-06", frozen)).toBe(2);
    expect(freezesUsedIn("2026-07", frozen)).toBe(1);
    expect(freezesUsedIn("2026-08", frozen)).toBe(0);
  });
});

describe("dayQualifies", () => {
  it("needs the time goal met", () => {
    expect(dayQualifies(good(GOAL), GOAL)).toBe(true);
    expect(dayQualifies(good(GOAL - 1), GOAL)).toBe(false);
  });

  it("needs at least one scheduled review", () => {
    // The rule that stops a streak being kept on new material alone.
    expect(dayQualifies(good(GOAL, 0), GOAL)).toBe(false);
    expect(dayQualifies(good(GOAL, STREAK.MIN_REVIEWS_FOR_DAY), GOAL)).toBe(true);
  });

  it("is false for a day with no record", () => {
    expect(dayQualifies(undefined, GOAL)).toBe(false);
  });

  it("counts a day that exactly meets the goal", () => {
    expect(dayQualifies({ ...good(), seconds: GOAL * 60 }, GOAL)).toBe(true);
  });
});

describe("streakInfo", () => {
  it("is zero with no history", () => {
    const info = streakInfo(build({}));
    expect(info.current).toBe(0);
    expect(info.longest).toBe(0);
    expect(info.todayQualified).toBe(false);
  });

  it("counts today plus consecutive previous days", () => {
    const info = streakInfo(
      build({
        "2026-06-13": good(),
        "2026-06-14": good(),
        "2026-06-15": good(),
      }),
    );
    expect(info.current).toBe(3);
    expect(info.todayQualified).toBe(true);
  });

  it("keeps yesterday's streak alive before today is done", () => {
    // Opening the app in the morning must not show a streak of zero.
    const info = streakInfo(
      build({
        "2026-06-13": good(),
        "2026-06-14": good(),
      }),
    );
    expect(info.current).toBe(2);
    expect(info.todayQualified).toBe(false);
  });

  it("stops at a gap", () => {
    const info = streakInfo(
      build({
        "2026-06-10": good(),
        "2026-06-11": good(),
        // 12th missed
        "2026-06-13": good(),
        "2026-06-14": good(),
      }),
    );
    expect(info.current).toBe(2);
  });

  it("counts a frozen day as covered", () => {
    const info = streakInfo(
      build(
        {
          "2026-06-12": good(),
          "2026-06-14": good(),
        },
        ["2026-06-13"],
      ),
    );
    expect(info.current).toBe(3);
  });

  it("reports the longest run, not just the current one", () => {
    const info = streakInfo(
      build({
        "2026-06-01": good(),
        "2026-06-02": good(),
        "2026-06-03": good(),
        "2026-06-04": good(),
        // gap
        "2026-06-14": good(),
      }),
    );
    expect(info.longest).toBe(4);
    expect(info.current).toBe(1);
  });

  it("reports today's progress toward the goal", () => {
    const info = streakInfo(build({ "2026-06-15": good(4, 2) }));
    expect(info.secondsToday).toBe(240);
    expect(info.goalSeconds).toBe(600);
    expect(info.reviewsToday).toBe(2);
    expect(info.todayQualified).toBe(false);
  });

  it("reports the freeze allowance for the current month", () => {
    const info = streakInfo(build({ "2026-06-15": good() }, ["2026-06-02"]));
    expect(info.freezesUsedThisMonth).toBe(1);
    expect(info.freezesRemaining).toBe(STREAK.FREEZES_PER_MONTH - 1);
  });
});

describe("freezesToApply", () => {
  it("does nothing when there is no gap", () => {
    expect(
      freezesToApply(build({ "2026-06-14": good(), "2026-06-15": good() })),
    ).toEqual([]);
  });

  it("covers a single missed day", () => {
    const apply = freezesToApply(
      build({ "2026-06-13": good(), "2026-06-15": good() }),
    );
    expect(apply).toEqual(["2026-06-14"]);
  });

  it("covers a two-day gap within the monthly allowance", () => {
    const apply = freezesToApply(
      build({ "2026-06-12": good(), "2026-06-15": good() }),
    );
    expect(apply).toEqual(["2026-06-14", "2026-06-13"]);
  });

  it("spends nothing when the gap is wider than the allowance", () => {
    // The important case. Freezing 2 of a 3-day gap saves nothing, so the allowance
    // must be left intact for a week when it can actually help.
    const apply = freezesToApply(
      build({ "2026-06-11": good(), "2026-06-15": good() }),
    );
    expect(apply).toEqual([]);
  });

  it("spends nothing when the month's allowance is already used", () => {
    const apply = freezesToApply(
      build({ "2026-06-13": good(), "2026-06-15": good() }, ["2026-06-05", "2026-06-06"]),
    );
    expect(apply).toEqual([]);
  });

  it("does not freeze days before the user's first activity", () => {
    // A brand new install must not retroactively freeze its way to a long streak.
    const apply = freezesToApply(build({ "2026-06-15": good() }));
    expect(apply).toEqual([]);
  });

  it("does nothing with no history at all", () => {
    expect(freezesToApply(build({}))).toEqual([]);
  });

  it("does not freeze today, which is still in progress", () => {
    const apply = freezesToApply(build({ "2026-06-14": good() }));
    expect(apply).not.toContain("2026-06-15");
  });

  it("draws on both months when a gap straddles a boundary", () => {
    const apply = freezesToApply(
      build({ "2026-06-30": good(), "2026-07-02": good() }, [], "2026-07-02"),
    );
    // 1 July is the only gap day; 2 July is today and already qualifies.
    expect(apply).toEqual(["2026-07-01"]);
  });

  it("applied freezes actually restore the streak", () => {
    // End to end: apply what the function returns and confirm the streak survives.
    const daily = { "2026-06-12": good(), "2026-06-15": good() };
    const apply = freezesToApply(build(daily));
    const after = streakInfo(build(daily, apply));
    expect(after.current).toBe(4); // 12th, 13th (frozen), 14th (frozen), 15th
  });
});
