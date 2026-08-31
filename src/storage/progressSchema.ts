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
 *
 * Mastery is deliberately NOT stored. It is derived from question state on demand,
 * so there is no cache to go stale — the entire class of "the number on screen
 * disagrees with the data behind it" bug simply cannot occur.
 */

import { z } from "zod";

import { CONFIDENCE_LEVELS } from "../engine/grading";
import type { QuestionState } from "../engine/scheduler";

export const PROGRESS_SCHEMA_VERSION = 3;

export const themeSchema = z.enum(["light", "dark"]);
export const confidenceSchema = z.enum(CONFIDENCE_LEVELS);
export const sessionLengthSchema = z.union([
  z.literal(5),
  z.literal(10),
  z.literal(20),
  z.literal(45),
]);

export const settingsSchema = z.object({
  theme: themeSchema,
  /** Default session length in minutes. */
  sessionLength: sessionLengthSchema,
  dailyGoalMinutes: z.number().int().min(1).max(240),
  /** Force content schema validation in a production build. Off by default. */
  validateContentInProd: z.boolean(),
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

export const progressSchema = z.object({
  schemaVersion: z.number().int().positive(),
  settings: settingsSchema,
  gamification: gamificationSchema,
  questions: z.record(z.string(), questionStateSchema),
  topics: z.record(z.string(), topicStateSchema),
  events: z.array(answerEventSchema),
  daily: z.record(z.string(), dailyAggregateSchema),
  meta: z.object({
    createdAt: z.string(),
    lastExportAt: z.string().nullable(),
  }),
});

export type Theme = z.infer<typeof themeSchema>;
export type SessionLength = z.infer<typeof sessionLengthSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type TopicState = z.infer<typeof topicStateSchema>;
export type AnswerEvent = z.infer<typeof answerEventSchema>;
export type DailyAggregate = z.infer<typeof dailyAggregateSchema>;
export type EarnedBadge = z.infer<typeof earnedBadgeSchema>;
export type Gamification = z.infer<typeof gamificationSchema>;
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
    },
    gamification: { xp: 0, badges: [], frozenDays: [] },
    questions: {},
    topics: {},
    events: [],
    daily: {},
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
