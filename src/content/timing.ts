/**
 * How long a question is expected to take.
 *
 * Shared by the manifest builder and the session composer, because the composer's
 * promise — never leave the user mid-question when time runs out (CLAUDE.md §6) —
 * only holds if both agree on the estimate.
 */

import type { Question, QuestionType } from "./schema";

/** Defaults in seconds, used when a question omits `estSeconds`. */
export const DEFAULT_QUESTION_SECONDS: Record<QuestionType, number> = {
  mcq: 45,
  numeric: 75,
  tfj: 45,
  match: 60,
  chartRead: 90,
  strategyId: 60,
  vignette: 240,
};

/**
 * Reading a lesson block. Rough, but the session composer only needs to be right
 * enough to avoid overrunning — it re-checks against the real clock as it goes.
 * ~200 words/minute for unfamiliar technical prose is deliberately conservative.
 */
const WORDS_PER_SECOND = 200 / 60;

export function questionSeconds(q: Pick<Question, "type"> & { estSeconds?: number }): number {
  return q.estSeconds ?? DEFAULT_QUESTION_SECONDS[q.type];
}

export function estimateReadSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(3, Math.round(words / WORDS_PER_SECOND));
}
