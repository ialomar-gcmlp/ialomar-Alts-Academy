/**
 * Recording an answer into persisted progress.
 *
 * A pure function from (progress, answer) to new progress, so the whole
 * scheduling-and-bookkeeping path is testable without React or a browser. The store
 * calls it and hands the result to the storage module; it does no bookkeeping itself.
 */

import { HISTORY, DAY_MS } from "./constants";
import type { Confidence } from "./grading";
import { sm2Scheduler, type QuestionState, type Scheduler } from "./scheduler";
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
}

export function recordAnswer(
  progress: ProgressState,
  answer: RecordedAnswer,
  now: number,
  scheduler: Scheduler = sm2Scheduler,
): RecordResult {
  const existing = progress.questions[answer.questionId];
  const before =
    existing ??
    scheduler.create(answer.questionId, answer.topicId, answer.difficulty, now);

  const state = scheduler.next(
    before,
    { correct: answer.correct, confidence: answer.confidence },
    now,
  );

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

  const key = dayKey(now);
  const day = progress.daily[key] ?? emptyDailyAggregate();
  const tally = day.byConfidence[answer.confidence];

  const topic = progress.topics[answer.topicId] ?? { attempts: 0, lastStudiedAt: null };

  return {
    state,
    progress: {
      ...progress,
      questions: { ...progress.questions, [answer.questionId]: state },
      topics: {
        ...progress.topics,
        [answer.topicId]: { attempts: topic.attempts + 1, lastStudiedAt: now },
      },
      events: trimEvents([...progress.events, event], now),
      daily: {
        ...progress.daily,
        [key]: {
          answered: day.answered + 1,
          correct: day.correct + (answer.correct ? 1 : 0),
          seconds: day.seconds + event.s,
          byConfidence: {
            ...day.byConfidence,
            [answer.confidence]: {
              correct: tally.correct + (answer.correct ? 1 : 0),
              total: tally.total + 1,
            },
          },
        },
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
