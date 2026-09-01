/**
 * The numbers the dashboard reports.
 *
 * Kept pure and separate from the view for the usual reason — these are claims about
 * the user's learning, and a claim should be testable. Three of them are easy to get
 * subtly wrong in a flattering direction, so they are the ones with the most tests:
 *
 *  - **Accuracy over time** must include days with nothing answered. Plotting only
 *    the days you studied turns a week of two good sessions into a flat line at 90%
 *    and hides the gap entirely.
 *
 *  - **Calibration** must exclude exam answers. An exam records a neutral confidence
 *    it never asked for (see EXAM.RECORDED_CONFIDENCE), so counting those would
 *    report an "unsure" claim the user never made.
 *
 *  - **The trend** must compare like with like: answered-weighted, not a mean of
 *    daily percentages, or one question answered on a quiet day counts as much as
 *    forty on a busy one.
 */

import { CALIBRATION, DAY_MS } from "./constants";
import { dayKey, type AnswerEvent, type DailyAggregate } from "../storage/progressSchema";
import type { Confidence } from "./grading";

/* ------------------------------------------------------------------ *
 * Daily series
 * ------------------------------------------------------------------ */

export interface DayPoint {
  /** Calendar day key, YYYY-MM-DD. */
  key: string;
  /** Midnight of that local day. */
  at: number;
  answered: number;
  correct: number;
  /** Null on a day with nothing answered — a gap, not a zero. */
  accuracy: number | null;
  minutes: number;
  xp: number;
  reviews: number;
}

/**
 * The last `days` calendar days, oldest first, including the ones with no activity.
 *
 * Accuracy is null rather than 0 on an empty day: zero would read as "everything was
 * wrong", which is a different and much worse statement than "nothing was answered".
 */
export function dailySeries(
  daily: Record<string, DailyAggregate>,
  now: number,
  days: number,
): DayPoint[] {
  const out: DayPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const at = startOfDay(now - i * DAY_MS);
    const key = dayKey(at);
    const day = daily[key];

    out.push({
      key,
      at,
      answered: day?.answered ?? 0,
      correct: day?.correct ?? 0,
      accuracy: day === undefined || day.answered === 0 ? null : day.correct / day.answered,
      minutes: Math.round((day?.seconds ?? 0) / 60),
      xp: day?.xp ?? 0,
      reviews: day?.reviews ?? 0,
    });
  }

  return out;
}

/** Local midnight. Days are the user's days, not UTC's. */
function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export interface Trend {
  /** Accuracy over the older half and the newer half of the window. */
  before: number | null;
  after: number | null;
  /** Percentage points of change, or null when either half has no answers. */
  deltaPoints: number | null;
  answered: number;
}

/**
 * Whether accuracy is moving, comparing the two halves of the window.
 *
 * Weighted by answers, not a mean of daily rates: averaging percentages lets a single
 * question answered on a quiet day count as much as forty on a busy one.
 */
export function accuracyTrend(series: readonly DayPoint[]): Trend {
  const half = Math.floor(series.length / 2);
  const older = series.slice(0, half);
  const newer = series.slice(half);

  const rate = (points: readonly DayPoint[]): number | null => {
    const answered = points.reduce((n, p) => n + p.answered, 0);
    if (answered === 0) return null;
    return points.reduce((n, p) => n + p.correct, 0) / answered;
  };

  const before = rate(older);
  const after = rate(newer);

  return {
    before,
    after,
    deltaPoints:
      before === null || after === null ? null : Math.round((after - before) * 100),
    answered: series.reduce((n, p) => n + p.answered, 0),
  };
}

/* ------------------------------------------------------------------ *
 * Calibration
 * ------------------------------------------------------------------ */

export interface CalibrationBucket {
  confidence: Confidence;
  correct: number;
  total: number;
  /** Null with nothing in the bucket — an empty claim has no accuracy. */
  accuracy: number | null;
}

export interface Calibration {
  buckets: CalibrationBucket[];
  answered: number;
  /** Answers excluded because they came from an exam, which asks no confidence. */
  excluded: number;
  /**
   * True when accuracy falls as claimed confidence falls — the shape a calibrated
   * person produces. Buckets with nothing in them are skipped rather than breaking it.
   */
  ordered: boolean;
  /** Share of confident answers that were wrong: the number worth acting on. */
  confidentMissRate: number | null;
  /** Share of guesses that were right — high means under-claiming, not luck. */
  guessHitRate: number | null;
}

const ORDER: Confidence[] = ["confident", "unsure", "guessing"];

export function calibration(events: readonly AnswerEvent[]): Calibration {
  // The one exclusion, and the reason this field exists on the event.
  const usable = events.filter((event) => !event.x);

  const buckets = ORDER.map((confidence): CalibrationBucket => {
    const mine = usable.filter((event) => event.c === confidence);
    const correct = mine.filter((event) => event.ok).length;
    return {
      confidence,
      correct,
      total: mine.length,
      accuracy: mine.length === 0 ? null : correct / mine.length,
    };
  });

  const filled = buckets.filter((bucket) => bucket.accuracy !== null);
  const ordered = filled.every(
    (bucket, i) => i === 0 || (filled[i - 1]?.accuracy ?? 0) >= (bucket.accuracy ?? 0),
  );

  const confident = buckets[0];
  const guessing = buckets[2];

  return {
    buckets,
    answered: usable.length,
    excluded: events.length - usable.length,
    ordered,
    confidentMissRate:
      confident === undefined || confident.accuracy === null ? null : 1 - confident.accuracy,
    guessHitRate: guessing?.accuracy ?? null,
  };
}

/**
 * One sentence on what the calibration means.
 *
 * Ordered by what is worth acting on, not by what sounds best: being wrong while sure
 * is the finding that changes behaviour, so it leads whenever it is present.
 */
export function calibrationVerdict(cal: Calibration): string {
  if (cal.answered < CALIBRATION.MIN_ANSWERS) {
    return `Not enough answers yet — calibration needs about ${CALIBRATION.MIN_ANSWERS} tagged answers before it says anything. ${cal.answered} so far.`;
  }

  const confident = cal.buckets[0];
  const guessing = cal.buckets[2];

  if (confident?.accuracy !== null && confident !== undefined) {
    if (confident.accuracy < CALIBRATION.CONFIDENT_FLOOR) {
      return `You are wrong on ${Math.round((1 - confident.accuracy) * 100)}% of the answers you are sure about. That gap is the most useful thing on this page: it means the model is off, not the recall, and those questions come back fastest.`;
    }
  }

  if (!cal.ordered) {
    return "Your confidence is not tracking your accuracy — you do better on answers you tag as unsure than on ones you are sure about. Slow down on the ones that feel obvious.";
  }

  if (guessing?.accuracy !== null && guessing !== undefined) {
    if (guessing.accuracy > CALIBRATION.GUESS_CEILING) {
      return `You get ${Math.round(guessing.accuracy * 100)}% of your guesses right, which means you are under-claiming. Tagging what you actually know pushes intervals out and saves you reviews.`;
    }
  }

  return "Well calibrated: your confidence tracks your accuracy, which is what makes the scheduling work. Keep tagging honestly.";
}

/* ------------------------------------------------------------------ *
 * Exam history
 * ------------------------------------------------------------------ */

export interface ExamPoint {
  domain: string;
  at: number;
  fraction: number;
  passed: boolean;
}

/** Attempts oldest first, for a chart of how the marks are moving. */
export function examSeries(
  attempts: readonly { domain: string; finishedAt: number; correct: number; total: number; passed: boolean }[],
): ExamPoint[] {
  return attempts
    .filter((attempt) => attempt.total > 0)
    .map((attempt) => ({
      domain: attempt.domain,
      at: attempt.finishedAt,
      fraction: attempt.correct / attempt.total,
      passed: attempt.passed,
    }))
    .sort((a, b) => a.at - b.at);
}

/* ------------------------------------------------------------------ *
 * Time of day
 * ------------------------------------------------------------------ */

export interface HourBucket {
  /** 0–23 local hour. */
  hour: number;
  answered: number;
  correct: number;
  accuracy: number | null;
}

/**
 * Accuracy by hour of day, from the answer log.
 *
 * Included because the honest answer to "when should I study?" is personal and
 * measurable, and this app is used in fragments across a working day. Exam answers
 * count here — the exclusion in `calibration` is about confidence, not timing.
 */
export function accuracyByHour(events: readonly AnswerEvent[]): HourBucket[] {
  const buckets = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    answered: 0,
    correct: 0,
    accuracy: null as number | null,
  }));

  for (const event of events) {
    const bucket = buckets[new Date(event.at).getHours()];
    if (bucket === undefined) continue;
    bucket.answered += 1;
    if (event.ok) bucket.correct += 1;
  }

  for (const bucket of buckets) {
    bucket.accuracy = bucket.answered === 0 ? null : bucket.correct / bucket.answered;
  }

  return buckets;
}

/**
 * The best and worst stretch of the day, over hours with enough answers to mean
 * something. Null when the log is too thin to say — which is most of the time early
 * on, and saying nothing is better than reporting noise as a finding.
 */
export function bestStudyHours(buckets: readonly HourBucket[]): {
  best: HourBucket | null;
  worst: HourBucket | null;
} {
  const usable = buckets.filter(
    (bucket) => bucket.answered >= CALIBRATION.MIN_ANSWERS_PER_HOUR,
  );
  if (usable.length < 2) return { best: null, worst: null };

  const sorted = [...usable].sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
  return { best: sorted[0] ?? null, worst: sorted[sorted.length - 1] ?? null };
}
