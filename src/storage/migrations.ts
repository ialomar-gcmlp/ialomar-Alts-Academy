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
 * Empty at v1 — the first entry appears when M2 adds scheduling state.
 */
export const migrations: Record<number, Migration> = {};

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
