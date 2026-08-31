/**
 * Persisted state schema.
 *
 * Versioned from the first commit so that later milestones can add fields through
 * tested migrations rather than by hoping (CLAUDE.md §7). M1 persists settings only;
 * question scheduling state, mastery, events and gamification arrive in M2/M3 as
 * schema version bumps with migrations.
 */

import { z } from "zod";

export const PROGRESS_SCHEMA_VERSION = 1;

export const themeSchema = z.enum(["light", "dark"]);
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

export const progressSchema = z.object({
  schemaVersion: z.number().int().positive(),
  settings: settingsSchema,
  meta: z.object({
    createdAt: z.string(),
    lastExportAt: z.string().nullable(),
  }),
});

export type Theme = z.infer<typeof themeSchema>;
export type SessionLength = z.infer<typeof sessionLengthSchema>;
export type Settings = z.infer<typeof settingsSchema>;
export type ProgressState = z.infer<typeof progressSchema>;

export function defaultProgress(now: Date = new Date()): ProgressState {
  return {
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    settings: {
      theme: prefersDark() ? "dark" : "light",
      sessionLength: 10,
      dailyGoalMinutes: 10,
      validateContentInProd: false,
    },
    meta: { createdAt: now.toISOString(), lastExportAt: null },
  };
}

function prefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
