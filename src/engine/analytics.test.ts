/**
 * Dashboard statistics.
 *
 * These are claims about the user's learning, so the tests target the three ways a
 * plausible implementation reads better than the truth: hiding the days nothing was
 * answered, counting exam answers as a confidence claim, and averaging daily
 * percentages so a one-question day outweighs a forty-question one.
 */

import { describe, expect, it } from "vitest";

import {
  accuracyByHour,
  accuracyTrend,
  bestStudyHours,
  calibration,
  calibrationVerdict,
  dailySeries,
  examSeries,
} from "./analytics";
import { CALIBRATION } from "./constants";
import { dayKey, type AnswerEvent, type DailyAggregate } from "../storage/progressSchema";
import type { Confidence } from "./grading";

const DAY = 86_400_000;
/** Midday, so the local-day arithmetic never lands on a boundary. */
const NOW = new Date(2026, 7, 31, 12, 0, 0).getTime();

function day(over: Partial<DailyAggregate> = {}): DailyAggregate {
  return {
    answered: 0,
    correct: 0,
    seconds: 0,
    reviews: 0,
    xp: 0,
    byConfidence: {
      confident: { correct: 0, total: 0 },
      unsure: { correct: 0, total: 0 },
      guessing: { correct: 0, total: 0 },
    },
    ...over,
  };
}

function event(over: Partial<AnswerEvent> = {}): AnswerEvent {
  return {
    q: "q1",
    t: "quant-tvm-01",
    at: NOW,
    ok: true,
    c: "confident",
    d: 3,
    g: 5,
    s: 20,
    x: false,
    ...over,
  };
}

describe("dailySeries", () => {
  it("returns one point per day, oldest first", () => {
    const series = dailySeries({}, NOW, 7);
    expect(series).toHaveLength(7);
    expect(series[0]?.at).toBeLessThan(series[6]?.at ?? 0);
  });

  it("includes days with nothing answered", () => {
    // The failure this guards against: plotting only active days turns a week with
    // two good sessions into a flat line and hides the gap.
    const series = dailySeries({ [dayKey(NOW)]: day({ answered: 10, correct: 9 }) }, NOW, 7);
    expect(series.filter((p) => p.answered === 0)).toHaveLength(6);
  });

  it("reports accuracy as null on an empty day, not zero", () => {
    // Zero would read as "everything was wrong", which is a different claim.
    const series = dailySeries({}, NOW, 3);
    expect(series.every((p) => p.accuracy === null)).toBe(true);
  });

  it("computes accuracy and minutes for a day with activity", () => {
    const series = dailySeries(
      { [dayKey(NOW)]: day({ answered: 8, correct: 6, seconds: 630, xp: 42, reviews: 5 }) },
      NOW,
      2,
    );
    const today = series[1];
    expect(today?.accuracy).toBe(0.75);
    expect(today?.minutes).toBe(11);
    expect(today?.xp).toBe(42);
    expect(today?.reviews).toBe(5);
  });

  it("ignores days outside the window", () => {
    const old = dayKey(NOW - 30 * DAY);
    const series = dailySeries({ [old]: day({ answered: 99, correct: 99 }) }, NOW, 7);
    expect(series.reduce((n, p) => n + p.answered, 0)).toBe(0);
  });
});

describe("accuracyTrend", () => {
  it("weights by answers rather than averaging daily rates", () => {
    // Older half: 1 of 1 on a quiet day. Newer half: 20 of 40 on a busy one.
    // A mean of percentages would report 100% then 50%; weighting gives the truth.
    const series = dailySeries(
      {
        [dayKey(NOW - 3 * DAY)]: day({ answered: 1, correct: 1 }),
        [dayKey(NOW)]: day({ answered: 40, correct: 20 }),
      },
      NOW,
      4,
    );
    const trend = accuracyTrend(series);
    expect(trend.before).toBe(1);
    expect(trend.after).toBe(0.5);
    expect(trend.deltaPoints).toBe(-50);
    expect(trend.answered).toBe(41);
  });

  it("reports no delta when a half has no answers", () => {
    const trend = accuracyTrend(dailySeries({ [dayKey(NOW)]: day({ answered: 4, correct: 4 }) }, NOW, 8));
    expect(trend.before).toBeNull();
    expect(trend.deltaPoints).toBeNull();
  });

  it("handles an empty window", () => {
    expect(accuracyTrend([])).toEqual({ before: null, after: null, deltaPoints: null, answered: 0 });
  });
});

describe("calibration", () => {
  const spread = (specs: [Confidence, boolean][]) =>
    specs.map(([c, ok], i) => event({ c, ok, q: `q${i}` }));

  it("buckets by claimed confidence, highest claim first", () => {
    const cal = calibration(
      spread([
        ["confident", true],
        ["confident", true],
        ["unsure", true],
        ["unsure", false],
        ["guessing", false],
      ]),
    );
    expect(cal.buckets.map((b) => b.confidence)).toEqual(["confident", "unsure", "guessing"]);
    expect(cal.buckets[0]?.accuracy).toBe(1);
    expect(cal.buckets[1]?.accuracy).toBe(0.5);
    expect(cal.buckets[2]?.accuracy).toBe(0);
  });

  it("excludes exam answers, which claimed no confidence", () => {
    // An exam records a neutral confidence it never asked for. Counting it would
    // report an "unsure" claim the user never made.
    const cal = calibration([
      event({ c: "unsure", ok: true }),
      event({ c: "unsure", ok: false, x: true }),
      event({ c: "unsure", ok: false, x: true }),
    ]);
    expect(cal.answered).toBe(1);
    expect(cal.excluded).toBe(2);
    expect(cal.buckets[1]?.accuracy).toBe(1);
  });

  it("reports an empty bucket as null rather than zero", () => {
    const cal = calibration([event({ c: "confident", ok: true })]);
    expect(cal.buckets[2]?.accuracy).toBeNull();
  });

  it("sees the ordered shape a calibrated person produces", () => {
    const cal = calibration(
      spread([
        ["confident", true],
        ["confident", true],
        ["confident", true],
        ["confident", true],
        ["unsure", true],
        ["unsure", false],
        ["guessing", false],
        ["guessing", false],
      ]),
    );
    expect(cal.ordered).toBe(true);
    expect(cal.confidentMissRate).toBe(0);
    expect(cal.guessHitRate).toBe(0);
  });

  it("spots confidence that does not track accuracy", () => {
    const cal = calibration(
      spread([
        ["confident", false],
        ["confident", false],
        ["unsure", true],
        ["unsure", true],
      ]),
    );
    expect(cal.ordered).toBe(false);
  });

  it("skips empty buckets when judging the order", () => {
    // Nothing tagged unsure must not break the comparison between the other two.
    const cal = calibration(
      spread([
        ["confident", true],
        ["guessing", false],
      ]),
    );
    expect(cal.ordered).toBe(true);
  });

  it("handles an empty log", () => {
    const cal = calibration([]);
    expect(cal.answered).toBe(0);
    expect(cal.confidentMissRate).toBeNull();
    expect(cal.ordered).toBe(true);
  });
});

describe("calibrationVerdict", () => {
  const many = (c: Confidence, ok: boolean, n: number) =>
    Array.from({ length: n }, (_, i) => event({ c, ok, q: `q${c}${ok}${i}` }));

  it("refuses to draw a conclusion from too few answers", () => {
    expect(calibrationVerdict(calibration(many("confident", false, 5)))).toContain(
      "Not enough answers",
    );
  });

  it("leads with confident misses when they are there", () => {
    const events = [...many("confident", true, 20), ...many("confident", false, 20)];
    const verdict = calibrationVerdict(calibration(events));
    expect(verdict).toContain("sure about");
    expect(verdict).toContain("50%");
  });

  it("calls out under-claiming when guesses land too often", () => {
    const events = [
      ...many("confident", true, 20),
      ...many("guessing", true, 15),
      ...many("guessing", false, 5),
    ];
    expect(calibrationVerdict(calibration(events))).toContain("under-claiming");
  });

  it("says so when the calibration is good", () => {
    const events = [
      ...many("confident", true, 19),
      ...many("confident", false, 1),
      ...many("unsure", true, 6),
      ...many("unsure", false, 4),
      ...many("guessing", true, 2),
      ...many("guessing", false, 8),
    ];
    expect(calibrationVerdict(calibration(events))).toContain("Well calibrated");
  });

  it("uses the documented floor, not a hard-coded one", () => {
    expect(CALIBRATION.CONFIDENT_FLOOR).toBeGreaterThan(0.5);
    expect(CALIBRATION.MIN_ANSWERS).toBeGreaterThan(0);
  });
});

describe("examSeries", () => {
  it("orders attempts oldest first and computes each share", () => {
    const series = examSeries([
      { domain: "alts", finishedAt: 300, correct: 15, total: 20, passed: true },
      { domain: "alts", finishedAt: 100, correct: 10, total: 20, passed: false },
    ]);
    expect(series.map((p) => p.at)).toEqual([100, 300]);
    expect(series[1]?.fraction).toBe(0.75);
  });

  it("drops an attempt with no questions rather than dividing by zero", () => {
    expect(examSeries([{ domain: "a", finishedAt: 1, correct: 0, total: 0, passed: false }])).toEqual([]);
  });
});

describe("accuracyByHour", () => {
  const at = (hour: number) => new Date(2026, 7, 30, hour, 30, 0).getTime();

  it("returns all 24 hours, with null accuracy where nothing was answered", () => {
    const buckets = accuracyByHour([event({ at: at(9) })]);
    expect(buckets).toHaveLength(24);
    expect(buckets[9]?.accuracy).toBe(1);
    expect(buckets[10]?.accuracy).toBeNull();
  });

  it("counts exam answers — the exclusion is about confidence, not timing", () => {
    const buckets = accuracyByHour([event({ at: at(7), x: true, ok: false })]);
    expect(buckets[7]?.answered).toBe(1);
    expect(buckets[7]?.accuracy).toBe(0);
  });
});

describe("bestStudyHours", () => {
  const bucket = (hour: number, answered: number, correct: number) => ({
    hour,
    answered,
    correct,
    accuracy: answered === 0 ? null : correct / answered,
  });

  it("says nothing until there are enough answers in an hour", () => {
    // Reporting a best time from three answers would be presenting noise as a finding.
    const out = bestStudyHours([bucket(9, 3, 3), bucket(22, 2, 0)]);
    expect(out.best).toBeNull();
    expect(out.worst).toBeNull();
  });

  it("picks the strongest and weakest hours that clear the bar", () => {
    const n = CALIBRATION.MIN_ANSWERS_PER_HOUR;
    const out = bestStudyHours([bucket(8, n, n), bucket(14, n, Math.floor(n / 2)), bucket(23, 1, 0)]);
    expect(out.best?.hour).toBe(8);
    expect(out.worst?.hour).toBe(14);
  });
});
