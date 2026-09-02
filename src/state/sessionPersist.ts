/**
 * Turning a live session into something small enough to save after every answer,
 * and back again.
 *
 * Two rules shape the format, and both exist to avoid having two sources of truth:
 *
 *  1. Store the RESPONSE, not the grade. Grading is a pure function of question and
 *     response, so the grade can be recomputed. Storing it would let a saved grade
 *     disagree with the content after a fix.
 *
 *  2. Store xpAwarded and dueAt, and never recompute them. Those were applied to
 *     the rest of progress when the answer was recorded. Recomputing would either
 *     double-count XP or silently reschedule the question.
 *
 * Glossary drills are deliberately NOT resumable: their questions are generated
 * from the glossary with a seeded RNG rather than loaded by id, so an id alone
 * cannot rebuild one. A drill is also two minutes long, which makes resuming it
 * worth less than the machinery would cost.
 */

import { gradeAnswer } from "../engine/grading";
import { prepareQuestion } from "../engine/prepare";
import { pausedClock } from "../engine/activeTime";
import type { FlatQuestion } from "../content/flatten";
import type { LessonBlock } from "../content/schema";
import type { SavedItem, SavedSession } from "../storage/progressSchema";
import type { QuizItem, QuizSession } from "./store";

/**
 * Snapshot a session for storage, or null when it should not be saved.
 *
 * Returns null for drills (cannot be rebuilt) and for finished sessions (there is
 * nothing to resume — the result screen is not work in progress).
 */
export function toSaved(session: QuizSession, now: number): SavedSession | null {
  if (session.mode === "drill") return null;
  if (session.finishedAt !== null) return null;

  return {
    mode: session.mode,
    title: session.title,
    topicId: session.topicId,
    examDomain: session.examDomain,
    index: session.index,
    startedAt: session.startedAt,
    savedAt: now,
    // The clock is never saved running: a saved session is by definition not being
    // looked at, so any span in progress has already been banked by the caller.
    activeMs: session.clock.accumulatedMs,
    badgesEarned: session.badgesEarned,
    items: session.items.map(
      (item): SavedItem => ({
        questionId: item.question.id,
        topicId: item.topicId,
        response: item.response,
        confidence: item.confidence,
        answered: item.grade !== null,
        xpAwarded: item.xpAwarded,
        dueAt: item.scheduled?.dueAt ?? null,
        activeMs: item.activeMs,
      }),
    ),
  };
}

export interface RebuildResult {
  session: QuizSession;
  /** Questions whose content could no longer be found, and were dropped. */
  droppedIds: string[];
}

/**
 * Rebuild a live session from a snapshot.
 *
 * `lookup` supplies the question for an id — the caller loads the topics first.
 * A question that no longer exists is dropped rather than fatal: content changes
 * between sessions, and losing one item is better than refusing to resume.
 *
 * Returns null when nothing usable survived, so the caller can discard the
 * snapshot instead of presenting an empty session.
 */
export function fromSaved(
  saved: SavedSession,
  // FlatQuestion, not Question: a vignette sub needs its case rebuilt alongside it,
  // and the snapshot deliberately stores neither — both derive from content.
  lookup: (questionId: string) => FlatQuestion | undefined,
  lessonBlocks: Record<string, LessonBlock[]>,
  needsReteach: (questionId: string) => boolean,
): RebuildResult | null {
  const droppedIds: string[] = [];
  const items: QuizItem[] = [];
  /** How many surviving items sit before the saved index, to move it correctly. */
  let indexShift = 0;

  saved.items.forEach((savedItem, position) => {
    const flat = lookup(savedItem.questionId);
    // Re-dealt with the SAME seed the session was built with (the snapshot's
    // startedAt), so the choices land in the same order and a saved response index
    // still points at the choice it was given against. Skipping this — or seeding
    // with anything else — would silently regrade answers against reshuffled options.
    const question =
      flat === undefined ? undefined : prepareQuestion(flat.question, saved.startedAt);
    if (flat === undefined || question === undefined) {
      droppedIds.push(savedItem.questionId);
      if (position < saved.index) indexShift += 1;
      return;
    }

    // Recomputed, not restored — see the note at the top of this file.
    const grade =
      savedItem.answered && savedItem.response !== null
        ? gradeAnswer(question, savedItem.response)
        : null;

    items.push({
      question,
      topicId: savedItem.topicId,
      response: savedItem.response,
      confidence: savedItem.confidence,
      grade,
      // An answered question shows its explanation, exactly as it did before.
      revealed: grade !== null,
      activeMs: savedItem.activeMs,
      // Deliberately not reconstructed beyond the due date: the scheduler already
      // holds the authoritative state, and this field only feeds "back tomorrow".
      scheduled:
        savedItem.dueAt === null
          ? null
          : { ...PLACEHOLDER_STATE, id: question.id, topicId: savedItem.topicId, dueAt: savedItem.dueAt },
      wasFlaggedForReteach: needsReteach(question.id),
      xpAwarded: savedItem.xpAwarded,
      xpSkipped: null,
      drill: null,
      vignette: flat.vignette,
    });
  });

  if (items.length === 0) return null;

  const index = Math.min(Math.max(0, saved.index - indexShift), items.length - 1);

  return {
    droppedIds,
    session: {
      mode: saved.mode,
      title: saved.title,
      topicId: saved.topicId,
      examDomain: saved.examDomain,
      lessonBlocks,
      items,
      index,
      startedAt: saved.startedAt,
      finishedAt: null,
      badgesEarned: saved.badgesEarned,
      // Restored paused. The view resumes it once it is actually on screen.
      clock: pausedClock(saved.activeMs),
    },
  };
}

/**
 * Filler for the parts of a QuestionState the UI never reads on a restored item.
 *
 * The real state lives in progress.questions and is authoritative. This exists only
 * so `scheduled.dueAt` can drive the "comes back in ..." line without inventing a
 * second copy of the scheduling record.
 */
const PLACEHOLDER_STATE = {
  id: "",
  topicId: "",
  difficulty: 0,
  ease: 0,
  intervalDays: 0,
  dueAt: 0,
  reps: 0,
  lapses: 0,
  consecutiveMisses: 0,
  lastGrade: null,
  lastAnsweredAt: null,
  lastConfidence: null,
  correctCount: 0,
  totalCount: 0,
  everCorrect: false,
  needsReteach: false,
} as const;

/** Distinct topic ids in a snapshot, for loading before a rebuild. */
export function savedTopicIds(saved: SavedSession): string[] {
  return [...new Set(saved.items.map((item) => item.topicId))];
}

/** How much of a saved session is already done, for the resume prompt. */
export function savedProgressSummary(saved: SavedSession): {
  answered: number;
  total: number;
  remaining: number;
} {
  const answered = saved.items.filter((item) => item.answered).length;
  return { answered, total: saved.items.length, remaining: saved.items.length - answered };
}
