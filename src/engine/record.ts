/**
 * Recording an answer into persisted progress.
 *
 * A pure function from (progress, answer) to new progress, so the whole
 * scheduling-XP-badges-bookkeeping path is testable without React or a browser. The
 * store calls it and hands the result to the storage module; it does no bookkeeping
 * itself.
 *
 * Order matters here. XP is computed from the state BEFORE this answer (a revival
 * bonus depends on the previous grade) and from the event log before this answer is
 * appended (the once-per-day check must not see itself).
 */

import { HISTORY, DAY_MS } from "./constants";
import { newlyEarned, type BadgeContext, type EarnedBadge } from "./badges";
import type { Confidence } from "./grading";
import { isDue, sm2Scheduler, type QuestionState, type Scheduler } from "./scheduler";
import { xpForAnswer, type XpAward } from "./xp";
import {
  dayKey,
  emptyDailyAggregate,
  type AnswerEvent,
  type ProgressState,
} from "../storage/progressSchema";

export interface RecordedAnswer {
  questionId: string;
  topicId: string;
  difficulty: number;
  correct: boolean;
  confidence: Confidence;
  /** Wall time the user actually spent on this question. */
  seconds: number;
}

export interface RecordResult {
  progress: ProgressState;
  /** The question's state after scheduling — the UI reports when it will return. */
  state: QuestionState;
  xp: XpAward;
  /** Badges earned by this answer, for the end-of-session summary. */
  badges: EarnedBadge[];
  /** True when this answer was a scheduled review rather than new material. */
  wasReview: boolean;
}

export interface RecordOptions {
  scheduler?: Scheduler;
  /**
   * Supplies the mastery figures the badge predicates need. Passed in rather than
   * imported so this module stays independent of the content manifest and remains
   * testable with synthetic topics.
   */
  badgeContext?: (progress: ProgressState) => Omit<BadgeContext, "questions" | "events">;
}

export function recordAnswer(
  progress: ProgressState,
  answer: RecordedAnswer,
  now: number,
  options: RecordOptions = {},
): RecordResult {
  const scheduler = options.scheduler ?? sm2Scheduler;

  const previous = progress.questions[answer.questionId] ?? null;
  const before =
    previous ?? scheduler.create(answer.questionId, answer.topicId, answer.difficulty, now);

  // A review is a question that already had history and had come due. New material
  // and same-session repeats are not reviews, which is what keeps the streak honest.
  const wasReview = previous !== null && isDue(previous, now);

  const state = scheduler.next(
    before,
    { correct: answer.correct, confidence: answer.confidence },
    now,
  );

  const key = dayKey(now);
  const day = progress.daily[key] ?? emptyDailyAggregate();

  // Computed before the event is appended, so the once-per-day check cannot see it.
  const xp = xpForAnswer({
    questionId: answer.questionId,
    difficulty: answer.difficulty,
    correct: answer.correct,
    confidence: answer.confidence,
    previous,
    earnedToday: day.xp,
    events: progress.events,
    now,
  });

  const event: AnswerEvent = {
    q: answer.questionId,
    t: answer.topicId,
    at: now,
    ok: answer.correct,
    c: answer.confidence,
    d: answer.difficulty,
    g: state.lastGrade ?? 0,
    s: Math.max(0, Math.round(answer.seconds)),
  };

  const tally = day.byConfidence[answer.confidence];
  const topic = progress.topics[answer.topicId] ?? { attempts: 0, lastStudiedAt: null };
  const events = trimEvents([...progress.events, event], now);
  const questions = { ...progress.questions, [answer.questionId]: state };

  const withoutBadges: ProgressState = {
    ...progress,
    questions,
    topics: {
      ...progress.topics,
      [answer.topicId]: { attempts: topic.attempts + 1, lastStudiedAt: now },
    },
    events,
    daily: {
      ...progress.daily,
      [key]: {
        answered: day.answered + 1,
        correct: day.correct + (answer.correct ? 1 : 0),
        seconds: day.seconds + event.s,
        reviews: day.reviews + (wasReview ? 1 : 0),
        xp: day.xp + xp.total,
        byConfidence: {
          ...day.byConfidence,
          [answer.confidence]: {
            correct: tally.correct + (answer.correct ? 1 : 0),
            total: tally.total + 1,
          },
        },
      },
    },
    gamification: {
      ...progress.gamification,
      xp: progress.gamification.xp + xp.total,
    },
  };

  // Badges are evaluated last, against the state this answer produced.
  const badges = options.badgeContext
    ? newlyEarned(
        {
          ...options.badgeContext(withoutBadges),
          questions: Object.values(questions),
          events,
        },
        progress.gamification.badges,
        now,
      )
    : [];

  return {
    state,
    xp,
    badges,
    wasReview,
    progress:
      badges.length === 0
        ? withoutBadges
        : {
            ...withoutBadges,
            gamification: {
              ...withoutBadges.gamification,
              badges: [...withoutBadges.gamification.badges, ...badges],
            },
          },
  };
}

/**
 * Keep the answer log bounded on both age and count. Daily aggregates are permanent,
 * so trimming here loses per-answer detail but never the long-run picture — which is
 * what keeps the whole store inside a comfortable localStorage budget.
 */
export function trimEvents(events: AnswerEvent[], now: number): AnswerEvent[] {
  const cutoff = now - HISTORY.MAX_EVENT_AGE_DAYS * DAY_MS;
  const recent = events.filter((e) => e.at >= cutoff);
  return recent.length <= HISTORY.MAX_EVENTS
    ? recent
    : recent.slice(recent.length - HISTORY.MAX_EVENTS);
}
