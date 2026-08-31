/**
 * Streaks and freeze days.
 *
 * A day counts only if BOTH conditions hold: the daily goal in minutes was met, and
 * at least one scheduled review was completed. The second half is what stops a
 * streak being farmable by reading new material and never coming back to anything.
 *
 * Two freeze days per calendar month cover days that would otherwise break the
 * streak. The rule that makes them worth having: freezes are only spent if they
 * actually save the streak. If the gap is too wide to cover, the streak breaks and
 * the allowance is left untouched rather than being burned for nothing.
 */

import { STREAK } from "./constants";
import type { DailyAggregate } from "../storage/progressSchema";

export interface StreakInput {
  daily: Readonly<Record<string, DailyAggregate>>;
  frozenDays: readonly string[];
  dailyGoalMinutes: number;
  /** Today's local day key. */
  today: string;
}

export interface StreakInfo {
  current: number;
  longest: number;
  todayQualified: boolean;
  secondsToday: number;
  reviewsToday: number;
  goalSeconds: number;
  freezesUsedThisMonth: number;
  freezesRemaining: number;
}

/* ------------------------------------------------------------------ *
 * Day key arithmetic
 * ------------------------------------------------------------------ */

/** Shift a YYYY-MM-DD key by whole days, in local time. */
export function shiftDay(key: string, delta: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y ?? 1970, (m ?? 1) - 1, (d ?? 1));
  date.setDate(date.getDate() + delta);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** "2026-08-31" -> "2026-08". Freezes are allowanced per calendar month. */
export function monthOf(key: string): string {
  return key.slice(0, 7);
}

/* ------------------------------------------------------------------ *
 * Qualification
 * ------------------------------------------------------------------ */

export function dayQualifies(
  day: DailyAggregate | undefined,
  dailyGoalMinutes: number,
): boolean {
  if (!day) return false;
  return (
    day.seconds >= dailyGoalMinutes * 60 && day.reviews >= STREAK.MIN_REVIEWS_FOR_DAY
  );
}

export function freezesUsedIn(month: string, frozenDays: readonly string[]): number {
  return frozenDays.filter((d) => monthOf(d) === month).length;
}

/* ------------------------------------------------------------------ *
 * Freeze application
 * ------------------------------------------------------------------ */

/** How far back to look. Beyond this the streak is long gone anyway. */
const MAX_LOOKBACK_DAYS = 400;

/**
 * Decide which days to freeze, given where the user currently stands.
 *
 * Returns the day keys to ADD to frozenDays — empty when nothing needs freezing, or
 * when the gap is too wide for the remaining allowance to bridge. Pure: the caller
 * persists the result.
 */
export function freezesToApply(input: StreakInput): string[] {
  const { daily, frozenDays, dailyGoalMinutes, today } = input;

  const days = Object.keys(daily);
  if (days.length === 0) return [];

  // Never freeze a day before the user had any activity at all.
  const firstActive = days.sort()[0];
  if (firstActive === undefined) return [];

  const frozen = new Set(frozenDays);
  const covered = (key: string): boolean =>
    frozen.has(key) || dayQualifies(daily[key], dailyGoalMinutes);

  // Today is still in progress, so the gap to bridge runs from yesterday backwards.
  const gap: string[] = [];
  let cursor = shiftDay(today, -1);

  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    if (cursor < firstActive) return []; // ran out of history; nothing to preserve
    if (covered(cursor)) break; // reached the live streak — the gap ends here
    gap.push(cursor);
    cursor = shiftDay(cursor, -1);
  }

  if (gap.length === 0) return [];

  // Only spend freezes if they cover the WHOLE gap. A partial cover saves nothing
  // and would waste the allowance.
  const budget = new Map<string, number>();
  for (const day of gap) {
    const month = monthOf(day);
    const used =
      budget.get(month) ?? freezesUsedIn(month, frozenDays);
    if (used >= STREAK.FREEZES_PER_MONTH) return [];
    budget.set(month, used + 1);
  }

  return gap;
}

/* ------------------------------------------------------------------ *
 * The streak itself
 * ------------------------------------------------------------------ */

export function streakInfo(input: StreakInput): StreakInfo {
  const { daily, frozenDays, dailyGoalMinutes, today } = input;

  const frozen = new Set(frozenDays);
  const covered = (key: string): boolean =>
    frozen.has(key) || dayQualifies(daily[key], dailyGoalMinutes);

  const todayDay = daily[today];
  const todayQualified = dayQualifies(todayDay, dailyGoalMinutes);

  // Today counts if it qualifies; either way the run of previous days still stands,
  // so a streak does not read as zero first thing in the morning.
  let current = todayQualified ? 1 : 0;
  let cursor = shiftDay(today, -1);
  for (let i = 0; i < MAX_LOOKBACK_DAYS; i++) {
    if (!covered(cursor)) break;
    current += 1;
    cursor = shiftDay(cursor, -1);
  }

  return {
    current,
    longest: longestStreak(daily, frozenDays, dailyGoalMinutes, today),
    todayQualified,
    secondsToday: todayDay?.seconds ?? 0,
    reviewsToday: todayDay?.reviews ?? 0,
    goalSeconds: dailyGoalMinutes * 60,
    freezesUsedThisMonth: freezesUsedIn(monthOf(today), frozenDays),
    freezesRemaining: Math.max(
      0,
      STREAK.FREEZES_PER_MONTH - freezesUsedIn(monthOf(today), frozenDays),
    ),
  };
}

function longestStreak(
  daily: Readonly<Record<string, DailyAggregate>>,
  frozenDays: readonly string[],
  dailyGoalMinutes: number,
  today: string,
): number {
  const frozen = new Set(frozenDays);
  const keys = [...new Set([...Object.keys(daily), ...frozenDays])].sort();
  const first = keys[0];
  if (first === undefined) return 0;

  let best = 0;
  let run = 0;
  let cursor = first;

  for (let i = 0; i < MAX_LOOKBACK_DAYS && cursor <= today; i++) {
    if (frozen.has(cursor) || dayQualifies(daily[cursor], dailyGoalMinutes)) {
      run += 1;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
    cursor = shiftDay(cursor, 1);
  }

  return best;
}
