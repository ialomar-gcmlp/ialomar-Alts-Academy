/**
 * Glossary drill.
 *
 * Terms get their own spaced repetition, using the same scheduler as questions but a
 * separate store (`termDrills`). Separate on purpose: a drill is not part of any
 * topic, so mixing them into `questions` would inflate the due count with items the
 * topic review session cannot build, and would muddle topic mastery.
 *
 * Both directions are drilled, because recognising a word and producing it are
 * different skills:
 *   term-to-meaning   "net exposure" -> which definition is this?
 *   meaning-to-term   "longs minus shorts" -> which term is this?
 *
 * Distractors are drawn from the same domain first. A definition is much harder to
 * pick out from three neighbouring concepts than from three unrelated ones, and the
 * near-misses are where the real confusion lives.
 */

import type { GlossaryTerm } from "../content/schema";
import { hashString, mulberry32, sample, shuffle } from "../lib/rng";
import type { Confidence } from "./grading";
import { isDue, sm2Scheduler, type QuestionState } from "./scheduler";
import { xpForAnswer, type XpAward } from "./xp";
import {
  dayKey,
  emptyDailyAggregate,
  type AnswerEvent,
  type ProgressState,
} from "../storage/progressSchema";

export const DRILL_DIRECTIONS = ["term-to-meaning", "meaning-to-term"] as const;
export type DrillDirection = (typeof DRILL_DIRECTIONS)[number];

const DIRECTION_SUFFIX: Record<DrillDirection, string> = {
  "term-to-meaning": "t2m",
  "meaning-to-term": "m2t",
};

/** Difficulty credited to a drill. Lower than a real question, because it is recall. */
export const DRILL_DIFFICULTY = 2;
export const DRILL_CHOICES = 4;

export interface IndexedTerm extends GlossaryTerm {
  domain: string;
}

/**
 * Namespaced so a drill can never collide with a content question id, and so the
 * `term:` prefix makes the origin obvious in a stored answer log.
 */
export function drillId(slug: string, direction: DrillDirection): string {
  return `term:${slug}:${DIRECTION_SUFFIX[direction]}`;
}

export interface DrillItem {
  id: string;
  slug: string;
  direction: DrillDirection;
  /** The prompt: a term, or a definition. */
  prompt: string;
  choices: string[];
  answerIndex: number;
  /** Index-aligned with choices, same contract as authored content. */
  rationales: string[];
  term: IndexedTerm;
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export interface DrillPoolOptions {
  /** Terms the user has met in a lesson. Drilling an unseen term is unfair. */
  seen: ReadonlySet<string>;
  /** Existing drill scheduling state, keyed by drill id. */
  drills: Readonly<Record<string, QuestionState>>;
  now: number;
  /** Allow terms never seen, when there are not enough seen ones to fill a set. */
  allowUnseen?: boolean;
}

/**
 * Which terms to drill, in priority order:
 *   1. drills that have come due (most overdue first)
 *   2. seen terms never drilled
 *   3. everything else, only if `allowUnseen`
 */
export function drillPool(
  terms: readonly IndexedTerm[],
  options: DrillPoolOptions,
): IndexedTerm[] {
  const { seen, drills, now, allowUnseen = false } = options;

  const dueScore = (slug: string): number | null => {
    let soonest: number | null = null;
    for (const direction of DRILL_DIRECTIONS) {
      const state = drills[drillId(slug, direction)];
      if (state && isDue(state, now)) {
        soonest = soonest === null ? state.dueAt : Math.min(soonest, state.dueAt);
      }
    }
    return soonest;
  };

  const everDrilled = (slug: string): boolean =>
    DRILL_DIRECTIONS.some((d) => drills[drillId(slug, d)] !== undefined);

  const due: { term: IndexedTerm; at: number }[] = [];
  const fresh: IndexedTerm[] = [];
  const rest: IndexedTerm[] = [];

  for (const term of terms) {
    const isSeen = seen.has(term.slug);
    const at = dueScore(term.slug);

    if (at !== null) due.push({ term, at });
    else if (isSeen && !everDrilled(term.slug)) fresh.push(term);
    else if (allowUnseen && !isSeen) rest.push(term);
  }

  due.sort((a, b) => a.at - b.at);
  return [...due.map((d) => d.term), ...fresh, ...rest];
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */

/**
 * Build a drill set. Deterministic for a given seed, so a re-render cannot reshuffle
 * the options out from under the answer index.
 */
export function buildDrill(
  pool: readonly IndexedTerm[],
  allTerms: readonly IndexedTerm[],
  count: number,
  seed: number,
): DrillItem[] {
  // Fewer than four terms makes a four-choice question impossible.
  if (allTerms.length < DRILL_CHOICES) return [];

  const items: DrillItem[] = [];
  const chosen = pool.slice(0, count);

  chosen.forEach((term, index) => {
    // Alternate directions so both are always exercised, whatever the set size.
    const direction = DRILL_DIRECTIONS[index % DRILL_DIRECTIONS.length] ?? "term-to-meaning";
    const item = buildDrillItem(term, allTerms, direction, seed + index);
    if (item) items.push(item);
  });

  return items;
}

export function buildDrillItem(
  term: IndexedTerm,
  allTerms: readonly IndexedTerm[],
  direction: DrillDirection,
  seed: number,
): DrillItem | null {
  const rng = mulberry32(seed ^ hashString(term.slug));

  const others = allTerms.filter((t) => t.slug !== term.slug);
  if (others.length < DRILL_CHOICES - 1) return null;

  // Same domain first — near-misses are where the confusion actually is.
  const sameDomain = others.filter((t) => t.domain === term.domain);
  const elsewhere = others.filter((t) => t.domain !== term.domain);

  const distractors = [
    ...sample(sameDomain, DRILL_CHOICES - 1, rng),
    ...sample(elsewhere, DRILL_CHOICES - 1, rng),
  ].slice(0, DRILL_CHOICES - 1);

  const options = shuffle([term, ...distractors], rng);
  const answerIndex = options.findIndex((t) => t.slug === term.slug);
  if (answerIndex < 0) return null;

  const isTermToMeaning = direction === "term-to-meaning";

  return {
    id: drillId(term.slug, direction),
    slug: term.slug,
    direction,
    prompt: isTermToMeaning ? term.term : term.plain,
    choices: options.map((t) => (isTermToMeaning ? t.plain : t.term)),
    answerIndex,
    rationales: options.map((t) =>
      t.slug === term.slug
        ? isTermToMeaning
          ? `Correct. More formally: ${t.formal}`
          : `Correct — that is ${t.term}. More formally: ${t.formal}`
        : isTermToMeaning
          ? `That is the definition of ${t.term}.`
          : `${t.term} means: ${t.plain}`,
    ),
    term,
  };
}

/* ------------------------------------------------------------------ *
 * Recording
 * ------------------------------------------------------------------ */

export interface DrillAnswer {
  drillId: string;
  slug: string;
  domain: string;
  correct: boolean;
  confidence: Confidence;
  seconds: number;
}

export interface DrillRecordResult {
  progress: ProgressState;
  state: QuestionState;
  xp: XpAward;
  wasReview: boolean;
}

/**
 * Record a drill answer. Deliberately parallel to engine/record.ts: same XP rules,
 * same daily aggregate, same once-per-day cap — a glossary review is a real review
 * and counts toward the streak. Only the scheduling state lives elsewhere.
 */
export function recordDrillAnswer(
  progress: ProgressState,
  answer: DrillAnswer,
  now: number,
): DrillRecordResult {
  const previous = progress.termDrills[answer.drillId] ?? null;
  const before =
    previous ?? sm2Scheduler.create(answer.drillId, answer.domain, DRILL_DIFFICULTY, now);

  const wasReview = previous !== null && isDue(previous, now);

  const state = sm2Scheduler.next(
    before,
    { correct: answer.correct, confidence: answer.confidence },
    now,
  );

  const key = dayKey(now);
  const day = progress.daily[key] ?? emptyDailyAggregate();

  const xp = xpForAnswer({
    questionId: answer.drillId,
    difficulty: DRILL_DIFFICULTY,
    correct: answer.correct,
    confidence: answer.confidence,
    previous,
    earnedToday: day.xp,
    events: progress.events,
    now,
  });

  const event: AnswerEvent = {
    q: answer.drillId,
    t: answer.domain,
    at: now,
    ok: answer.correct,
    c: answer.confidence,
    d: DRILL_DIFFICULTY,
    g: state.lastGrade ?? 0,
    s: Math.max(0, Math.round(answer.seconds)),
  };

  const tally = day.byConfidence[answer.confidence];

  return {
    state,
    xp,
    wasReview,
    progress: {
      ...progress,
      termDrills: { ...progress.termDrills, [answer.drillId]: state },
      events: [...progress.events, event],
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
    },
  };
}

/* ------------------------------------------------------------------ *
 * Per-term status, for the glossary page
 * ------------------------------------------------------------------ */

export type TermStatus = "unseen" | "seen" | "drilled" | "shaky" | "known";

export interface TermProgress {
  slug: string;
  status: TermStatus;
  seenAt: number | null;
  /** Drill attempts across both directions. */
  attempts: number;
  correct: number;
  /** Directions with a due drill right now. */
  dueCount: number;
  /** Best interval reached, in days, across both directions. */
  intervalDays: number;
}

export function termProgress(
  slug: string,
  progress: Pick<ProgressState, "termsSeen" | "termDrills">,
  now: number,
): TermProgress {
  const seenAt = progress.termsSeen[slug] ?? null;

  let attempts = 0;
  let correct = 0;
  let dueCount = 0;
  let intervalDays = 0;
  let anyDrilled = false;

  for (const direction of DRILL_DIRECTIONS) {
    const state = progress.termDrills[drillId(slug, direction)];
    if (!state) continue;
    anyDrilled = true;
    attempts += state.totalCount;
    correct += state.correctCount;
    intervalDays = Math.max(intervalDays, state.intervalDays);
    if (isDue(state, now)) dueCount += 1;
  }

  let status: TermStatus;
  if (!anyDrilled) status = seenAt === null ? "unseen" : "seen";
  else if (attempts > 0 && correct / attempts < 0.6) status = "shaky";
  // "Known" means it has survived a real gap, not that it was right once.
  else if (intervalDays >= 7) status = "known";
  else status = "drilled";

  return { slug, status, seenAt, attempts, correct, dueCount, intervalDays };
}

export const TERM_STATUS_LABELS: Record<TermStatus, string> = {
  unseen: "Not yet met",
  seen: "Seen in a lesson",
  drilled: "Drilled",
  shaky: "Shaky",
  known: "Known",
};
