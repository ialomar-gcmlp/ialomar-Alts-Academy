/**
 * Progress migrations.
 *
 * One function per version step, applied in order. Rules from CLAUDE.md §7:
 *  - every step gets its own test
 *  - the pre-migration blob is stashed before anything is rewritten
 *  - state from a NEWER version than this code knows about must not be written to,
 *    because coercing it would silently discard the user's history
 *
 * Progress is the one thing in this app that cannot be regenerated. Treat it that way.
 */

import { PROGRESS_SCHEMA_VERSION } from "./progressSchema";

export type UnknownState = Record<string, unknown>;
export type Migration = (state: UnknownState) => UnknownState;

/**
 * Keyed by the version being migrated FROM. `migrations[1]` upgrades v1 to v2.
 *
 * Each step must be additive and total: given any valid state at version N it has to
 * produce a valid state at N+1, without reading anything it cannot be sure exists.
 */
export const migrations: Record<number, Migration> = {
  /**
   * v1 -> v2: introduce scheduling state, per-topic facts, the answer log and daily
   * aggregates. A v1 user has settings and nothing else, so every new field starts
   * empty — their settings and createdAt carry across untouched.
   */
  1: (state) => ({
    ...state,
    questions: {},
    topics: {},
    events: [],
    daily: {},
  }),

  /**
   * v2 -> v3: add gamification, plus `reviews` and `xp` to each daily aggregate.
   *
   * Existing days get zeros rather than a guess. The review count could in principle
   * be reconstructed from the answer log, but the log is trimmed and the scheduling
   * state that would say whether each answer was a review has since moved on — so a
   * reconstruction would be a fabrication. A v2 user starts their streak fresh,
   * which is honest, and keeps every answer and every interval.
   */
  2: (state) => {
    const daily = isRecord(state["daily"]) ? state["daily"] : {};
    const upgraded: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(daily)) {
      upgraded[key] = isRecord(value) ? { ...value, reviews: 0, xp: 0 } : value;
    }

    return {
      ...state,
      daily: upgraded,
      gamification: { xp: 0, badges: [], frozenDays: [] },
    };
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type MigrationOutcome =
  | { status: "ok"; state: UnknownState; from: number; to: number; migrated: boolean }
  | { status: "too-new"; found: number; supported: number }
  | { status: "unmigratable"; from: number; missingStep: number };

export function migrate(
  raw: UnknownState,
  target: number = PROGRESS_SCHEMA_VERSION,
): MigrationOutcome {
  const from = typeof raw["schemaVersion"] === "number" ? raw["schemaVersion"] : 0;

  if (from > target) {
    // Written by a newer build of the app. Refusing is the whole point.
    return { status: "too-new", found: from, supported: target };
  }

  let state = raw;
  let version = from;

  while (version < target) {
    const step = migrations[version];
    if (!step) return { status: "unmigratable", from, missingStep: version };
    state = step(state);
    version += 1;
    state = { ...state, schemaVersion: version };
  }

  return { status: "ok", state, from, to: version, migrated: from !== version };
}
