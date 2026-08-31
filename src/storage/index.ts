/**
 * The storage module. The only door to persisted state.
 *
 * Responsibilities: read on boot, migrate if needed, back up before migrating,
 * debounce writes, and force a flush when the tab is going away so that closing it
 * mid-session never loses an answer (CLAUDE.md §7).
 */

import {
  createLocalStorageAdapter,
  type StorageAdapter,
} from "./localStorageAdapter";
import { migrate, type UnknownState } from "./migrations";
import {
  PROGRESS_SCHEMA_VERSION,
  defaultProgress,
  progressSchema,
  type ProgressState,
  type Theme,
} from "./progressSchema";

const KEY = "alts-academy:progress";
const BACKUP_KEY = (v: number): string => `alts-academy:progress.backup.v${v}`;
/** Read before first paint by the inline script in index.html — keep the key in step. */
const THEME_KEY = "alts-academy:theme";

const WRITE_DEBOUNCE_MS = 250;

export type LoadStatus =
  | { kind: "fresh" }
  | { kind: "loaded"; migratedFrom?: number }
  | { kind: "unavailable" }
  | { kind: "refused"; found: number; supported: number }
  | { kind: "corrupt"; detail: string };

export interface LoadResult {
  state: ProgressState;
  status: LoadStatus;
}

let adapter: StorageAdapter = createLocalStorageAdapter();
let pending: ProgressState | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set when the stored blob is newer than this build; blocks all writes. */
let writesBlocked = false;

/** Test seam. */
export function __setAdapter(next: StorageAdapter): void {
  adapter = next;
  pending = null;
  writesBlocked = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export async function load(): Promise<LoadResult> {
  if (!adapter.available) {
    return { state: defaultProgress(), status: { kind: "unavailable" } };
  }

  const raw = await adapter.get(KEY);
  if (raw === null) return { state: defaultProgress(), status: { kind: "fresh" } };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    return {
      state: defaultProgress(),
      status: { kind: "corrupt", detail: `stored progress is not valid JSON — ${(err as Error).message}` },
    };
  }

  if (typeof parsedJson !== "object" || parsedJson === null) {
    return {
      state: defaultProgress(),
      status: { kind: "corrupt", detail: "stored progress is not an object" },
    };
  }

  const outcome = migrate(parsedJson as UnknownState);

  if (outcome.status === "too-new") {
    // Do not touch it. A newer build wrote this, and coercing it would discard history.
    writesBlocked = true;
    return {
      state: defaultProgress(),
      status: { kind: "refused", found: outcome.found, supported: outcome.supported },
    };
  }

  if (outcome.status === "unmigratable") {
    return {
      state: defaultProgress(),
      status: {
        kind: "corrupt",
        detail: `no migration from schema version ${outcome.missingStep}`,
      },
    };
  }

  if (outcome.migrated) {
    // Stash the original before the migrated shape is ever written back.
    await adapter.set(BACKUP_KEY(outcome.from), raw);
  }

  const validated = progressSchema.safeParse(outcome.state);
  if (!validated.success) {
    // Keep whatever was there for forensics, but boot on defaults rather than
    // running on a half-valid shape.
    await adapter.set(BACKUP_KEY(outcome.from), raw);
    return {
      state: defaultProgress(),
      status: {
        kind: "corrupt",
        detail: validated.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
    };
  }

  return {
    state: validated.data,
    status: outcome.migrated
      ? { kind: "loaded", migratedFrom: outcome.from }
      : { kind: "loaded" },
  };
}

/** Queue a write. Coalesces bursts; the last state within the window wins. */
export function save(state: ProgressState): void {
  if (writesBlocked) return;
  pending = state;

  // The theme is mirrored to its own key so index.html can apply it before first
  // paint without parsing the whole progress blob.
  adapter.setSync(THEME_KEY, state.settings.theme);

  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, WRITE_DEBOUNCE_MS);
}

export async function flush(): Promise<void> {
  if (writesBlocked || pending === null) return;
  const state = pending;
  pending = null;
  await adapter.set(KEY, JSON.stringify(state));
}

/** Synchronous last resort, for pagehide/visibilitychange. */
export function flushSync(): void {
  if (writesBlocked || pending === null) return;
  const state = pending;
  pending = null;
  adapter.setSync(KEY, JSON.stringify(state));
}

/**
 * Flush on the ways a tab actually goes away. `pagehide` fires where `beforeunload`
 * is unreliable (mobile Safari especially), and `visibilitychange` catches the
 * common case of switching apps and never coming back.
 */
export function installFlushHandlers(): () => void {
  const onHide = (): void => flushSync();
  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") flushSync();
  };

  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export { PROGRESS_SCHEMA_VERSION, defaultProgress };
export type { ProgressState, Theme };
