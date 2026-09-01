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

/**
 * Active time accounting (src/engine/activeTime.ts).
 *
 * Study minutes drive the streak, so the time credited to a question has to be time
 * the user was actually present. The clock pauses when the tab is hidden; these two
 * numbers handle the cases the browser cannot tell us about.
 */
export const ACTIVE_TIME = {
  /**
   * The longest single uninterrupted span credited to one question. A visible tab is
   * not proof anyone is reading it, and no question in this app takes five minutes
   * of continuous attention. Replaces M1's blunt 300-second-per-question cap.
   */
  MAX_SPAN_MS: 5 * MINUTE_MS,

  /**
   * How old a saved session can be and still be offered for resuming. Long enough
   * to cover closing the tab and coming back after lunch; short enough that a
   * forgotten session from last week is not presented as work in progress.
   */
  RESUME_WINDOW_MS: 12 * HOUR_MS,
} as const;

export const HISTORY = {
  /** Raw answer log is a ring buffer; daily aggregates are kept permanently. */
  MAX_EVENTS: 5000,
  MAX_EVENT_AGE_DAYS: 548, // ~18 months
} as const;

/**
 * XP is designed to be unfarmable. The brief was explicit: reward accuracy and
 * retention, not volume. So a question earns XP at most once per day, a wrong answer
 * earns nothing, and a lucky guess earns very little even when it is right.
 */
export const XP = {
  /** Only a correct answer earns anything. */
  BASE_CORRECT: 10,

  /** By question difficulty 1..5 — harder questions are worth more. */
  DIFFICULTY_MULTIPLIERS: [1, 1.25, 1.5, 2, 2.5] as readonly number[],

  /**
   * By confidence, on a correct answer. XP tracks *knowledge*, so being right while
   * guessing is worth little — the honesty is rewarded through badges and through
   * the scheduler bringing it back, not through points.
   */
  CALIBRATION: { confident: 1, unsure: 0.7, guessing: 0.3 } as const,

  /** Getting something right that you had previously missed. The best kind of progress. */
  REVIVAL_BONUS: 15,

  /** Past this much in one day, further XP is heavily discounted rather than blocked. */
  DAILY_SOFT_CAP: 300,
  OVER_CAP_MULTIPLIER: 0.25,
} as const;

/**
 * Levels. Titles describe what the user can actually do at that point rather than
 * inventing ranks — this gets used at a work desk and should not read as a game.
 */
export const LEVELS = [
  { level: 1, title: "Orientation", xp: 0 },
  { level: 2, title: "Foundations", xp: 100 },
  { level: 3, title: "Fluent in the Basics", xp: 300 },
  { level: 4, title: "Comfortable with the Math", xp: 700 },
  { level: 5, title: "Reads a Fund Report", xp: 1400 },
  { level: 6, title: "Speaks the Language", xp: 2500 },
  { level: 7, title: "Diligence-Ready", xp: 4200 },
  { level: 8, title: "Cross-Domain Thinker", xp: 6800 },
  { level: 9, title: "Trusted Second Opinion", xp: 10500 },
  { level: 10, title: "Investment Committee Ready", xp: 15000 },
] as const;

export const STREAK = {
  /**
   * Two freeze days per calendar month, applied automatically to the first day that
   * would otherwise break the streak. A busy week should not destroy months of
   * momentum, but the allowance has to be small enough that the streak still means
   * something.
   */
  FREEZES_PER_MONTH: 2,
  /** A day only counts with at least this many scheduled reviews completed. */
  MIN_REVIEWS_FOR_DAY: 1,
} as const;
