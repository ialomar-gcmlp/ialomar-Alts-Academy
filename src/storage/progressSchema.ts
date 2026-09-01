/**
 * Persisted state schema.
 *
 * Versioned from the first commit so later milestones add fields through tested
 * migrations rather than by hoping (CLAUDE.md §7).
 *
 *   v1  settings + meta only
 *   v2  per-question scheduling state, per-topic facts, a bounded answer log,
 *       and permanent daily aggregates
 *   v3  gamification (XP, badges, frozen days) and a per-day review count
 *   v4  glossary: terms seen, and drill scheduling state per term/direction
 *   v5  the `effects` setting (full vs calm motion)
 *   v6  the resumable session snapshot, and mock exam attempts
 *
 * Mastery is deliberately NOT stored. It is derived from question state on demand,
 * so there is no cache to go stale — the entire class of "the number on screen
 * disagrees with the data behind it" bug simply cannot occur.
 */

import { z } from "zod";

import { CONFIDENCE_LEVELS } from "../engine/grading";
import type { QuestionState } from "../engine/scheduler";

export const PROGRESS_SCHEMA_VERSION = 7;

export const themeSchema = z.enum(["light", "dark"]);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const sessionLengthSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(20),
  z.literal(45),
]);

export const effectsSchema = z.enum(["full", "calm"]);

export const settingsSchema = z.object({
  theme: themeSchema,
  /** Default session length in minutes. */
  sessionLength: sessionLengthSchema,
  dailyGoalMinutes: z.number().int().min(1).max(240),
  /** Force content schema validation in a production build. Off by default. */
  validateContentInProd: z.boolean(),
  /**
   * Motion and celebration. "calm" keeps every colour and every number and drops
   * the movement — for a desk where a bar sweeping across the screen is the wrong
   * thing to have happen in a meeting. The OS reduced-motion preference does the
   * same job; this exists because the OS setting is global and this one is not.
   */
  effects: effectsSchema,
});

/* ------------------------------------------------------------------ *
 * Scheduling state
 * ------------------------------------------------------------------ */

export const questionStateSchema = z.object({
  id: z.string(),
  topicId: z.string(),
  difficulty: z.number(),
  ease: z.number(),
  intervalDays: z.number(),
  dueAt: z.number(),
  reps: z.number(),
  lapses: z.number(),
  consecutiveMisses: z.number(),
  lastGrade: z.number().nullable(),
  lastAnsweredAt: z.number().nullable(),
  lastConfidence: confidenceSchema.nullable(),
  correctCount: z.number(),
  totalCount: z.number(),
  everCorrect: z.boolean(),
  needsReteach: z.boolean(),
});

/*
 * Two-way assignability check between the Zod schema above and the engine's
 * QuestionState. If either gains, loses or renames a field, this stops compiling —
 * which is the point. A silent mismatch here would mean saved scheduling state
 * failing validation on the next load and the user's history being set aside.
 */
type SchemaQuestionState = z.infer<typeof questionStateSchema>;
const _schemaSatisfiesEngine: QuestionState = {} as SchemaQuestionState;
const _engineSatisfiesSchema: SchemaQuestionState = {} as QuestionState;
void _schemaSatisfiesEngine;
void _engineSatisfiesSchema;

/** Facts about a topic. Anything derivable (mastery) is computed, not stored. */
export const topicStateSchema = z.object({
  attempts: z.number().int().min(0),
  lastStudiedAt: z.number().nullable(),
});

/**
 * One answer. Keys are short because this is the only unbounded-by-nature structure
 * in the store and it is capped at 5,000 entries:
 *   q question id · t topic id · at timestamp · ok correct · c confidence
 *   d difficulty · g grade · s seconds spent
 */
export const answerEventSchema = z.object({
  q: z.string(),
  t: z.string(),
  at: z.number(),
  ok: z.boolean(),
  c: confidenceSchema,
  d: z.number(),
  g: z.number(),
  s: z.number(),
  /**
   * True when the answer came from a mock exam.
   *
   * Calibration is the reason this field exists. An exam never asks how sure you are,
   * so its answers are recorded at a neutral confidence — counting them as if the user
   * had claimed "unsure" would report a calibration they never expressed. Every other
   * statistic treats an exam answer like any other.
   */
  x: z.boolean(),
});

const confidenceTallySchema = z.object({
  correct: z.number().int().min(0),
  total: z.number().int().min(0),
});

/** Kept forever, so long-run analytics survive the answer log being trimmed. */
export const dailyAggregateSchema = z.object({
  answered: z.number().int().min(0),
  correct: z.number().int().min(0),
  seconds: z.number().min(0),
  /** Answers to questions that were already due — what makes a day count for the
   *  streak. Without it, a streak could be kept by only ever reading new material. */
  reviews: z.number().int().min(0),
  xp: z.number().min(0),
  byConfidence: z.object({
    confident: confidenceTallySchema,
    unsure: confidenceTallySchema,
    guessing: confidenceTallySchema,
  }),
});

export const earnedBadgeSchema = z.object({
  id: z.string(),
  earnedAt: z.number(),
});

/**
 * Facts that cannot be recomputed. XP has to be accumulated rather than derived,
 * because the answer log it would be derived from is deliberately trimmed — deriving
 * it would mean the user's total quietly falling as old answers aged out.
 */
export const gamificationSchema = z.object({
  xp: z.number().min(0),
  badges: z.array(earnedBadgeSchema),
  /** Day keys covered by a freeze, so the streak is reproducible across reloads. */
  frozenDays: z.array(z.string()),
});

/* ------------------------------------------------------------------ *
 * Resumable session (v6)
 * ------------------------------------------------------------------ */

/**
 * A saved session, small enough to write after every answer.
 *
 * Deliberately stores question IDs rather than question objects. The content is
 * already on disk and loads by id, so persisting it would duplicate megabytes into
 * localStorage for no benefit — and it would go stale the moment a topic is edited.
 *
 * The RESPONSE is stored and the grade is not: grading is a pure function of the
 * question and the response, so it can be recomputed on resume. Storing a grade
 * would create two sources of truth that could disagree after a content fix.
 *
 * `xpAwarded` and `dueAt` ARE stored, because those were already applied to the rest
 * of progress when the answer was recorded. Recomputing them would either double-
 * count the XP or silently reschedule the question.
 */
export const savedResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("choice"), choiceIndex: z.number().int() }),
  z.object({
    kind: z.literal("numeric"),
    value: z.number().nullable(),
    raw: z.string(),
  }),
  z.object({
    kind: z.literal("tfj"),
    isTrue: z.boolean().nullable(),
    justificationIndex: z.number().int().nullable(),
  }),
]);

export const savedItemSchema = z.object({
  questionId: z.string(),
  topicId: z.string(),
  response: savedResponseSchema.nullable(),
  confidence: confidenceSchema.nullable(),
  /** True once submitted. The response alone cannot say so — a picked answer is not a submitted one. */
  answered: z.boolean(),
  /** Already credited to gamification when the answer was recorded; never recomputed. */
  xpAwarded: z.number().min(0),
  /** Already written to the scheduler; kept only so the UI can say "back tomorrow". */
  dueAt: z.number().nullable(),
  /** Active milliseconds credited to this question. */
  activeMs: z.number().min(0),
});

export const savedSessionSchema = z.object({
  /** "drill" is absent by design — generated drills cannot be rebuilt from an id. */
  mode: z.enum(["learn", "review", "exam"]),
  title: z.string(),
  topicId: z.string().nullable(),
  /** Set for exam sessions, so the result can be recorded against the right domain. */
  examDomain: z.string().nullable(),
  items: z.array(savedItemSchema),
  index: z.number().int().min(0),
  startedAt: z.number(),
  savedAt: z.number(),
  /** Banked active time for the whole session. The clock is never saved running. */
  activeMs: z.number().min(0),
  badgesEarned: z.array(earnedBadgeSchema),
});

/** A completed mock exam. Kept permanently — it is a record of what you could do. */
export const examAttemptSchema = z.object({
  domain: z.string(),
  startedAt: z.number(),
  finishedAt: z.number(),
  correct: z.number().int().min(0),
  total: z.number().int().min(1),
  /** Whether the attempt met the pass threshold in force at the time. */
  passed: z.boolean(),
  /** Active seconds spent, for the record rather than for scoring. */
  seconds: z.number().min(0),
});

export const progressSchema = z.object({
  schemaVersion: z.number().int().positive(),
  settings: settingsSchema,
  gamification: gamificationSchema,
  questions: z.record(z.string(), questionStateSchema),
  topics: z.record(z.string(), topicStateSchema),
  /** slug -> when the term was first met in a lesson. */
  termsSeen: z.record(z.string(), z.number()),
  /**
   * Glossary drill scheduling, keyed by "term:{slug}:{t2m|m2t}". Held apart from
   * `questions` because a drill belongs to no topic: mixing them would inflate the
   * topic review queue with items it cannot build.
   */
  termDrills: z.record(z.string(), questionStateSchema),
  events: z.array(answerEventSchema),
  daily: z.record(z.string(), dailyAggregateSchema),
  /** In-flight session, or null. Written after every answer so a closed tab loses nothing. */
  activeSession: savedSessionSchema.nullable(),
  /** Completed mock exams, oldest first. */
  exams: z.array(examAttemptSchema),
  meta: z.object({
    createdAt: z.string(),
    lastExportAt: z.string().nullable(),
  }),
});

export type Theme = z.infer<typeof themeSchema>;
export type Effects = z.infer<typeof effectsSchema>;
export type SessionLength = z.infer<typeof sessionLengthSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type TopicState = z.infer<typeof topicStateSchema>;
export type AnswerEvent = z.infer<typeof answerEventSchema>;
export type DailyAggregate = z.infer<typeof dailyAggregateSchema>;
export type EarnedBadge = z.infer<typeof earnedBadgeSchema>;
export type Gamification = z.infer<typeof gamificationSchema>;
export type SavedResponse = z.infer<typeof savedResponseSchema>;
export type SavedItem = z.infer<typeof savedItemSchema>;
export type SavedSession = z.infer<typeof savedSessionSchema>;
export type ExamAttempt = z.infer<typeof examAttemptSchema>;
export type ProgressState = z.infer<typeof progressSchema>;

export function emptyDailyAggregate(): DailyAggregate {
  return {
    answered: 0,
    correct: 0,
    seconds: 0,
    reviews: 0,
    xp: 0,
    byConfidence: {
      confident: { correct: 0, total: 0 },
      unsure: { correct: 0, total: 0 },
      guessing: { correct: 0, total: 0 },
    },
  };
}

export function defaultProgress(now: Date = new Date()): ProgressState {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    settings: {
      theme: prefersDark() ? "dark" : "light",
      sessionLength: 10,
      dailyGoalMinutes: 10,
      validateContentInProd: false,
      effects: "full",
    },
    gamification: { xp: 0, badges: [], frozenDays: [] },
    questions: {},
    topics: {},
    termsSeen: {},
    termDrills: {},
    events: [],
    daily: {},
    activeSession: null,
    exams: [],
    meta: { createdAt: now.toISOString(), lastExportAt: null },
  };
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** Local calendar day key. Local, not UTC: a streak should follow the user's day. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}
