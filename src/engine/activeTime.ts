/**
 * Active time accounting.
 *
 * The app credits study time to the daily total, which drives the streak. So the
 * question "how long did that take?" has to be answered honestly, and wall-clock
 * time answers it badly: a tab left open over lunch would report a forty-minute
 * question and inflate the day's minutes past the goal without any studying.
 *
 * M1 handled that with a blunt cap of 300 seconds per question. This replaces it
 * with a clock that only runs while the user is actually there:
 *
 *  - it PAUSES when the tab is hidden (the browser tells us), and
 *  - it CAPS any single uninterrupted span, because a visible tab is not proof that
 *    anyone is reading it.
 *
 * Kept as pure functions over a small record so the accounting is testable without
 * a browser. Every transition takes `now` explicitly rather than calling Date.now()
 * — the same discipline as the scheduler, and for the same reason.
 */

import { ACTIVE_TIME } from "./constants";

export interface ActiveClock {
  /** Time already banked, in milliseconds. Never decreases. */
  accumulatedMs: number;
  /** Start of the span currently running, or null while paused. */
  runningSince: number | null;
}

/** A clock that is running from `now`. */
export function startClock(now: number): ActiveClock {
  return { accumulatedMs: 0, runningSince: now };
}

/** A clock that exists but is not running — used when restoring a saved session. */
export function pausedClock(accumulatedMs: number): ActiveClock {
  return { accumulatedMs: Math.max(0, accumulatedMs), runningSince: null };
}

/**
 * The credited length of a span, which is where the honesty lives.
 *
 * A span is capped at MAX_SPAN_MS on the assumption that nobody looks at one
 * question for longer than that without stepping away. Negative spans — a clock
 * running from a future timestamp, which happens if the system clock moves
 * backwards — credit zero rather than subtracting time.
 */
export function creditedSpanMs(
  runningSince: number | null,
  now: number,
): number {
  if (runningSince === null) return 0;
  const raw = now - runningSince;
  if (raw <= 0) return 0;
  return Math.min(raw, ACTIVE_TIME.MAX_SPAN_MS);
}

/** Bank the current span and stop the clock. Idempotent when already paused. */
export function pause(clock: ActiveClock, now: number): ActiveClock {
  if (clock.runningSince === null) return clock;
  return {
    accumulatedMs:
      clock.accumulatedMs + creditedSpanMs(clock.runningSince, now),
    runningSince: null,
  };
}

/** Start the clock. Idempotent when already running — it does not restart the span. */
export function resume(clock: ActiveClock, now: number): ActiveClock {
  if (clock.runningSince !== null) return clock;
  return { ...clock, runningSince: now };
}

/**
 * Bank the current span and immediately start a new one.
 *
 * This is the transition used when moving between questions: the time so far
 * belongs to the question just answered, and the next span belongs to the next
 * question.
 */
export function split(
  clock: ActiveClock,
  now: number,
): { banked: number; clock: ActiveClock } {
  const banked = creditedSpanMs(clock.runningSince, now);
  return {
    banked,
    clock: {
      accumulatedMs: clock.accumulatedMs + banked,
      runningSince: clock.runningSince === null ? null : now,
    },
  };
}

/**
 * End the span in progress and credit it to the item at `index`.
 *
 * Every transition that stops a span has to credit it somewhere, or the time
 * disappears from the item while remaining in the session total. That asymmetry is
 * how per-question times end up under-reporting: pausing on a hidden tab banked the
 * span into the clock alone, so the question the user had been reading for a minute
 * was recorded as taking a second. Crediting here keeps one invariant true:
 *
 *   sum(items[].activeMs) === clock.accumulatedMs
 *
 * Generic over the item so this stays testable without the session type. `stop: true`
 * leaves the clock paused; `false` starts the next span immediately, which is the
 * move-to-the-next-question case.
 */
export function bankSpan<T extends { activeMs: number }>(
  clock: ActiveClock,
  items: readonly T[],
  index: number,
  now: number,
  stop: boolean,
): { clock: ActiveClock; items: T[]; banked: number } {
  const { banked, clock: split_ } = split(clock, now);
  const next = items.slice();
  const current = next[index];
  if (current !== undefined && banked > 0) {
    next[index] = { ...current, activeMs: current.activeMs + banked };
  }

  return {
    banked,
    items: next,
    clock: stop
      ? { accumulatedMs: split_.accumulatedMs, runningSince: null }
      : split_,
  };
}

/** Total active time including any span in progress. Safe to call while running. */
export function elapsedMs(clock: ActiveClock, now: number): number {
  return clock.accumulatedMs + creditedSpanMs(clock.runningSince, now);
}

/** Whole seconds, for the answer record. */
export function elapsedSeconds(clock: ActiveClock, now: number): number {
  return Math.round(elapsedMs(clock, now) / 1000);
}

/**
 * Whether a saved session is recent enough to offer resuming.
 *
 * The window exists because a session from three days ago is not a session you are
 * in the middle of — resuming it would present stale questions as unfinished work,
 * and the scheduler has moved on. Twelve hours covers "I closed the tab and came
 * back after lunch" and excludes "I forgot about this".
 */
export function isResumable(savedAt: number, now: number): boolean {
  const age = now - savedAt;
  return age >= 0 && age <= ACTIVE_TIME.RESUME_WINDOW_MS;
}
