/**
 * Every threshold and tunable in the learning engine.
 *
 * Kept in one file on purpose (CLAUDE.md §6): scheduling and mastery are the parts
 * of this app that cannot be eyeballed for correctness, so the numbers that drive
 * them should be readable in one place rather than scattered as literals.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

export const SCHEDULER = {
  /** SM-2 ease factor bounds. Below ~1.3 intervals stop growing usefully. */
  INITIAL_EASE: 2.5,
  MIN_EASE: 1.3,
  MAX_EASE: 2.8,

  /** Interval after the first and second successful reps, in days. */
  FIRST_INTERVAL_DAYS: 1,
  SECOND_INTERVAL_DAYS: 3,
  MAX_INTERVAL_DAYS: 180,

  /**
   * A confident miss comes back inside the same sitting. This is the strongest
   * intervention the scheduler has, and it is reserved for the case where the
   * user's underlying model is wrong rather than their recall.
   */
  HARD_LAPSE_MINUTES: 10,
  /** An unsure or guessed miss: tomorrow, not in ten minutes. */
  SOFT_LAPSE_DAYS: 1,

  /**
   * A correct-but-guessed answer must not schedule far out. Being right by luck is
   * not mastery, and without this cap one fortunate guess buries a question for
   * months.
   */
  GUESS_INTERVAL_CAP_DAYS: 7,

  /** Two misses in a row stops being a recall problem and becomes a teaching problem. */
  RETEACH_AFTER_CONSECUTIVE_MISSES: 2,
} as const;

export const MASTERY = {
  /**
   * Weight of the three components. They multiply rather than average, so a topic
   * cannot look mastered on the strength of one component alone — you need coverage
   * AND retention AND some scheduling stability.
   */
  COVERAGE_WEIGHT: 1,
  RETENTION_WEIGHT: 1,
  STABILITY_WEIGHT: 1,

  /** Older answers count for less. At the half-life, an answer carries half its weight. */
  RETENTION_HALF_LIFE_DAYS: 30,

  /** An interval at or beyond this counts as fully stable. */
  STABILITY_TARGET_DAYS: 21,

  /** Difficulty 1..5 mapped to weight, so hard questions count for more. */
  DIFFICULTY_WEIGHTS: [1, 1.15, 1.3, 1.5, 1.75] as readonly number[],

  /** A topic unlocks when every prerequisite reaches this mastery. */
  UNLOCK_THRESHOLD: 0.6,

  /** Domain boss exam gates. */
  BOSS_DOMAIN_MASTERY: 0.7,
  BOSS_TOPICS_STARTED_FRACTION: 0.8,

  /** Below this, a started topic counts as a weak area worth drilling. */
  WEAK_AREA_CEILING: 0.5,
} as const;

export const HISTORY = {
  /** Raw answer log is a ring buffer; daily aggregates are kept permanently. */
  MAX_EVENTS: 5000,
  MAX_EVENT_AGE_DAYS: 548, // ~18 months
} as const;
