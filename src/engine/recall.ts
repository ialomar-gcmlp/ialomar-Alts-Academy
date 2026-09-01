/**
 * Free recall: the user's own one-sentence answer to "what is worth keeping?"
 *
 * The learning event is the writing — generating a summary from memory is a
 * different act from recognising an answer, and it is the one thing the app never
 * asked for before this. The stored note is secondary: it gets re-met once at the
 * top of the topic's next visit, then ages out.
 *
 * Deliberately not graded, not scored, and worth no XP. The moment a note earns
 * points, the honest one-sentence summary becomes a keyword-stuffing exercise.
 */

import type { ProgressState, RecallNote } from "../storage/progressSchema";

export const RECALL = {
  /** Notes kept per topic. Enough to see your understanding move; not an archive. */
  KEEP: 3,
  /** Schema cap is 500; the UI stops earlier because a summary is one sentence. */
  MAX_LENGTH: 280,
} as const;

/**
 * Append a note to a topic's list, newest last, keeping the most recent RECALL.KEEP.
 *
 * Returns the notes map unchanged (same reference) for blank input, so callers can
 * cheaply skip persistence when nothing was written.
 */
export function addRecallNote(
  notes: ProgressState["recallNotes"],
  topicId: string,
  text: string,
  now: number,
): ProgressState["recallNotes"] {
  const trimmed = text.trim().slice(0, RECALL.MAX_LENGTH);
  if (trimmed === "") return notes;

  const existing = notes[topicId] ?? [];
  return {
    ...notes,
    [topicId]: [...existing, { text: trimmed, at: now }].slice(-RECALL.KEEP),
  };
}

/** The note to re-meet: the most recent one, or null. */
export function latestRecallNote(
  notes: ProgressState["recallNotes"],
  topicId: string,
): RecallNote | null {
  const list = notes[topicId];
  return list === undefined || list.length === 0 ? null : (list[list.length - 1] ?? null);
}
