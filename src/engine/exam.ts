/**
 * Mock exams: eligibility, composition, timing and scoring.
 *
 * An exam is a measurement, and the app is the thing being measured — so this file
 * exists to keep the flattering shortcuts out. Three rules follow from that:
 *
 *  1. **Gated.** An exam you sit before covering the material returns a number that
 *     says nothing except that you have not covered the material. It unlocks at
 *     domain mastery ≥ 0.7 with ≥ 80% of topics started (MASTERY.BOSS_*), and the UI
 *     says which of the two is missing rather than showing a padlock.
 *
 *  2. **Wall-clock timed.** Every other clock in this app pauses when the tab is
 *     hidden, because credited study time should be honest. An exam is the opposite:
 *     the deadline is `startedAt + limit` and it keeps running while you are away.
 *     Coming back to an expired exam submits what you had.
 *
 *  3. **Spread across the domain, not clustered.** Composition takes one question
 *     from each topic before it takes a second from any, so a twenty-question exam
 *     over eight topics cannot draw twelve of them from one lesson.
 *
 * Pure and seeded — no Date.now(), no Math.random. `now` and `seed` are arguments so
 * the same exam can be rebuilt and the scoring can be tested.
 */

import { EXAM, MASTERY } from "./constants";
import { mulberry32, shuffle } from "../lib/rng";

/* ------------------------------------------------------------------ *
 * Eligibility
 * ------------------------------------------------------------------ */

export interface ExamRequirement {
  domain: string;
  unlocked: boolean;
  /** Domain mastery 0..1 and the threshold it must reach. */
  mastery: number;
  masteryNeeded: number;
  /** Topics with at least one answer, out of the domain's total. */
  topicsStarted: number;
  topicsTotal: number;
  startedNeeded: number;
  /** Questions available to draw from, and the minimum a real exam needs. */
  questionsAvailable: number;
  questionsNeeded: number;
  /**
   * Why it is locked, in the second person, ready to render. Null when unlocked.
   * One reason at a time — the nearest one — because a list of three requirements
   * reads as a wall rather than a next step.
   */
  blockedBy: string | null;
}

export function examRequirement(input: {
  domain: string;
  mastery: number;
  topicsStarted: number;
  topicsTotal: number;
  questionsAvailable: number;
}): ExamRequirement {
  const { domain, mastery, topicsStarted, topicsTotal, questionsAvailable } = input;

  const startedNeeded = Math.ceil(topicsTotal * MASTERY.BOSS_TOPICS_STARTED_FRACTION);
  const enoughQuestions = questionsAvailable >= EXAM.QUESTIONS_MIN;
  const enoughStarted = topicsTotal > 0 && topicsStarted >= startedNeeded;
  const enoughMastery = mastery >= MASTERY.BOSS_DOMAIN_MASTERY;

  // Ordered by how actionable each one is: read more topics, then get better at them.
  const blockedBy = !enoughQuestions
    ? `This domain has ${questionsAvailable} question${questionsAvailable === 1 ? "" : "s"}. An exam needs ${EXAM.QUESTIONS_MIN}.`
    : !enoughStarted
      ? `Open ${startedNeeded - topicsStarted} more topic${startedNeeded - topicsStarted === 1 ? "" : "s"} — an exam covers the whole domain, so ${startedNeeded} of ${topicsTotal} must be started.`
      : !enoughMastery
        ? `Mastery is ${Math.round(mastery * 100)}%. The exam opens at ${Math.round(MASTERY.BOSS_DOMAIN_MASTERY * 100)}% — keep reviewing what is due.`
        : null;

  return {
    domain,
    unlocked: blockedBy === null,
    mastery,
    masteryNeeded: MASTERY.BOSS_DOMAIN_MASTERY,
    topicsStarted,
    topicsTotal,
    startedNeeded,
    questionsAvailable,
    questionsNeeded: EXAM.QUESTIONS_MIN,
    blockedBy,
  };
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

export interface ExamCandidate {
  questionId: string;
  topicId: string;
  difficulty: number;
}

/**
 * Choose the questions for one attempt.
 *
 * Round-robin over topics — one each, then a second each, and so on — so coverage is
 * even whatever the topic sizes are. Within a topic the order is seeded-random, and
 * the final list is shuffled so the exam does not walk through topics in file order.
 *
 * The seed makes an attempt reproducible; passing `startedAt` as the seed gives a
 * different exam each sitting, which is what stops a repeat attempt from being a
 * memory test of the last one.
 */
export function composeExam(
  candidates: readonly ExamCandidate[],
  count: number,
  seed: number,
): ExamCandidate[] {
  if (candidates.length === 0 || count <= 0) return [];

  const rng = mulberry32(seed);

  // Group by topic, each group shuffled.
  const byTopic = new Map<string, ExamCandidate[]>();
  for (const candidate of candidates) {
    const list = byTopic.get(candidate.topicId);
    if (list === undefined) byTopic.set(candidate.topicId, [candidate]);
    else list.push(candidate);
  }
  const groups = shuffle([...byTopic.values()], rng).map((group) => shuffle(group, rng));

  const picked: ExamCandidate[] = [];
  let round = 0;
  // Bounded by the largest group, so the loop always terminates.
  const deepest = Math.max(...groups.map((group) => group.length));
  while (picked.length < count && round < deepest) {
    for (const group of groups) {
      const next = group[round];
      if (next !== undefined) picked.push(next);
      if (picked.length === count) break;
    }
    round += 1;
  }

  return shuffle(picked, rng);
}

/** How many questions this attempt should have, given what is available. */
export function examLength(questionsAvailable: number): number {
  return Math.min(EXAM.QUESTIONS_MAX, questionsAvailable);
}

/* ------------------------------------------------------------------ *
 * Timing
 * ------------------------------------------------------------------ */

/** The time budget for an exam of `count` questions, in milliseconds. */
export function examLimitMs(count: number): number {
  return Math.max(0, count) * EXAM.SECONDS_PER_QUESTION * 1000;
}

/** When the exam closes. Wall clock — see the note at the top of this file. */
export function examDeadline(startedAt: number, count: number): number {
  return startedAt + examLimitMs(count);
}

/** Milliseconds left, floored at zero. */
export function remainingMs(startedAt: number, count: number, now: number): number {
  return Math.max(0, examDeadline(startedAt, count) - now);
}

export function hasExpired(startedAt: number, count: number, now: number): boolean {
  return remainingMs(startedAt, count, now) === 0;
}

/** mm:ss for the countdown. Minutes are not padded; seconds always are. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/* ------------------------------------------------------------------ *
 * Scoring
 * ------------------------------------------------------------------ */

export interface ExamScore {
  correct: number;
  /** Every question in the attempt, including ones left blank when time ran out. */
  total: number;
  answered: number;
  fraction: number;
  passed: boolean;
  passFraction: number;
}

/**
 * Score an attempt.
 *
 * An unanswered question counts as wrong, not as absent: running out of time is part
 * of the result. Scoring only what was answered would let a slow attempt outscore a
 * complete one.
 */
export function scoreExam(items: readonly { correct: boolean | null }[]): ExamScore {
  const total = items.length;
  const answered = items.filter((item) => item.correct !== null).length;
  const correct = items.filter((item) => item.correct === true).length;
  const fraction = total === 0 ? 0 : correct / total;

  return {
    correct,
    total,
    answered,
    fraction,
    passed: total > 0 && fraction >= EXAM.PASS_FRACTION,
    passFraction: EXAM.PASS_FRACTION,
  };
}

/** Correct out of asked, per topic — the diagnostic the score itself cannot give. */
export function examBreakdown(
  items: readonly { topicId: string; correct: boolean | null }[],
): { topicId: string; correct: number; total: number }[] {
  const rows = new Map<string, { topicId: string; correct: number; total: number }>();

  for (const item of items) {
    const row = rows.get(item.topicId) ?? { topicId: item.topicId, correct: 0, total: 0 };
    row.total += 1;
    if (item.correct === true) row.correct += 1;
    rows.set(item.topicId, row);
  }

  // Weakest first: this list is a to-do, so the top of it should be where to go next.
  return [...rows.values()].sort((a, b) => a.correct / a.total - b.correct / b.total);
}

/** The best attempt on a domain, for the exam list. */
export function bestAttempt<T extends { domain: string; correct: number; total: number }>(
  attempts: readonly T[],
  domain: string,
): T | null {
  const mine = attempts.filter((attempt) => attempt.domain === domain && attempt.total > 0);
  if (mine.length === 0) return null;

  return mine.reduce((best, attempt) =>
    attempt.correct / attempt.total > best.correct / best.total ? attempt : best,
  );
}
