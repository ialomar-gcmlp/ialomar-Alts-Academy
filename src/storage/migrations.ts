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

  /**
   * v3 -> v4: glossary tracking.
   *
   * Both collections start empty. "Seen" could in principle be back-filled from the
   * topics the user has attempted, but that would mark terms as met on the strength
   * of a topic having been opened once — and terms seen is used to decide what is
   * fair to drill. Better to under-claim: the first lesson they open re-marks them.
   */
  3: (state) => ({
    ...state,
    termsSeen: {},
    termDrills: {},
  }),

  /**
   * v4 -> v5: the `effects` setting.
   *
   * Existing users get "full", which is the new default and a visible change to an
   * app they have already been using. That is the right way round: the setting is
   * reversible in one click, and defaulting them to "calm" would hide a feature
   * they never asked to opt out of. A missing or malformed settings object is
   * replaced rather than patched, since the schema validates it immediately after.
   */
  4: (state) => ({
    ...state,
    settings: isRecord(state["settings"])
      ? { ...state["settings"], effects: "full" }
      : { effects: "full" },
  }),

  /**
   * v5 -> v6: the resumable session snapshot and mock exam history.
   *
   * Both start empty, and there is nothing to reconstruct. A v5 user had no saved
   * session by definition — the feature did not exist — and no exam attempts. The
   * answer log could in principle be mined for something exam-shaped, but inventing
   * attempt records the user never sat would be a fabrication in a history they may
   * later rely on.
   */
  5: (state) => ({
    ...state,
    activeSession: null,
    exams: [],
  }),

  /**
   * v6 -> v7: answer events gain `x`, marking the ones that came from a mock exam.
   *
   * False for every existing event, which is a fact rather than a guess: exams did
   * not exist before v6, so no stored answer can have come from one. Calibration
   * reads this field to exclude exam answers, where no confidence was ever elicited.
   */
  6: (state) => ({
    ...state,
    events: Array.isArray(state["events"])
      ? state["events"].map((event) =>
          isRecord(event) ? { ...event, x: false } : event,
        )
      : [],
  }),

  /**
   * v7 -> v8: free-recall notes, keyed by topic.
   *
   * Starts empty — the notes are the user's own words, so there is nothing to
   * reconstruct and nothing it would be honest to invent.
   */
  7: (state) => ({
    ...state,
    recallNotes: {},
  }),
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
