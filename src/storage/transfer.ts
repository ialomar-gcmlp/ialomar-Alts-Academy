/**
 * Export and import: the only way progress leaves this machine, and the only reason
 * a browser wiping its storage is survivable.
 *
 * Three things this file is careful about, because an import replaces everything:
 *
 *  1. **It validates before it replaces.** The file goes through the same migration
 *     chain and the same Zod schema as stored progress, so an export from an older
 *     build imports cleanly and a corrupt one is refused with a reason rather than
 *     half-applied.
 *
 *  2. **It describes what is about to happen in the user's terms** — how many answers,
 *     over what dates, how much XP — for both the incoming file and the state it would
 *     replace. "Import?" is not a question anyone can answer safely.
 *
 *  3. **It refuses a file that is not ours** rather than trying to interpret it. A
 *     stray JSON file that happens to have a `questions` key is not progress.
 *
 * No network anywhere: export is a Blob the browser saves, import is a file the user
 * picks. Both work with the tab offline.
 */

import { migrate, type UnknownState } from "./migrations";
import {
  PROGRESS_SCHEMA_VERSION,
  progressSchema,
  type ProgressState,
} from "./progressSchema";

/** Marks a file as ours, so an unrelated JSON file is refused rather than parsed. */
const MAGIC = "alts-academy-progress";

export interface ExportEnvelope {
  format: typeof MAGIC;
  /** The app's progress schema version at the time of export. */
  schemaVersion: number;
  exportedAt: string;
  progress: ProgressState;
}

export function exportEnvelope(progress: ProgressState, now: number): ExportEnvelope {
  return {
    format: MAGIC,
    schemaVersion: PROGRESS_SCHEMA_VERSION,
    exportedAt: new Date(now).toISOString(),
    progress,
  };
}

/** `alts-academy-progress-2026-08-31.json` — sorts chronologically in a folder. */
export function exportFilename(now: number): string {
  const d = new Date(now);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `alts-academy-progress-${d.getFullYear()}-${month}-${day}.json`;
}

export function serializeExport(progress: ProgressState, now: number): string {
  // Indented: this is a file a person may open, and it costs nothing here.
  return JSON.stringify(exportEnvelope(progress, now), null, 2);
}

/* ------------------------------------------------------------------ *
 * Summaries
 * ------------------------------------------------------------------ */

export interface ProgressSummary {
  answers: number;
  xp: number;
  topics: number;
  exams: number;
  /** ISO dates of the first and last day with recorded activity, or null. */
  from: string | null;
  to: string | null;
  days: number;
}

/**
 * What a state contains, for the confirm step.
 *
 * The span comes from the daily aggregates rather than the answer log, because the log
 * is trimmed to a rolling window and would understate a long history.
 */
export function summarize(state: ProgressState): ProgressSummary {
  const days = Object.keys(state.daily).filter((key) => {
    const day = state.daily[key];
    return day !== undefined && day.answered > 0;
  });
  days.sort();

  return {
    answers: Object.keys(state.questions).length,
    xp: Math.round(state.gamification.xp),
    topics: Object.keys(state.topics).length,
    exams: state.exams.length,
    from: days[0] ?? null,
    to: days[days.length - 1] ?? null,
    days: days.length,
  };
}

/** One sentence naming what the import would replace, for the confirm step. */
export function replacementSentence(
  incoming: ProgressSummary,
  current: ProgressSummary,
): string {
  const span =
    incoming.from === null
      ? "no recorded activity"
      : incoming.from === incoming.to
        ? `activity on ${incoming.from}`
        : `activity spanning ${incoming.from} to ${incoming.to}`;

  const replacing =
    current.answers === 0
      ? "You have nothing recorded yet, so nothing is lost."
      : `This replaces your current ${current.answers} answered question${current.answers === 1 ? "" : "s"} and ${current.xp.toLocaleString()} XP. That cannot be undone from inside the app — export first if you are unsure.`;

  return `The file holds ${incoming.answers} answered question${incoming.answers === 1 ? "" : "s"}, ${incoming.xp.toLocaleString()} XP and ${span}. ${replacing}`;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export type ImportResult =
  | {
      status: "ok";
      state: ProgressState;
      /** True when the file came from an older schema and was migrated on the way in. */
      migrated: boolean;
      fromVersion: number;
      summary: ProgressSummary;
    }
  | { status: "error"; detail: string };

/**
 * Validate a file's contents into progress, or say why not.
 *
 * Every failure returns a sentence the user can act on. "Invalid file" tells them
 * nothing; "this looks like an export from a newer version of the app" tells them what
 * to do next.
 */
export function parseImport(text: string): ImportResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    return {
      status: "error",
      detail: `That file is not valid JSON — ${(err as Error).message}`,
    };
  }

  if (typeof json !== "object" || json === null || Array.isArray(json)) {
    return { status: "error", detail: "That file does not contain an object." };
  }

  const envelope = json as Record<string, unknown>;
  if (envelope["format"] !== MAGIC) {
    return {
      status: "error",
      detail:
        "That file was not exported by Alts Academy. Import only accepts a file this app produced.",
    };
  }

  const inner = envelope["progress"];
  if (typeof inner !== "object" || inner === null) {
    return { status: "error", detail: "The file is missing its progress data." };
  }

  const outcome = migrate(inner as UnknownState);

  if (outcome.status === "too-new") {
    return {
      status: "error",
      detail: `That export came from a newer version of the app (schema v${outcome.found}; this build reads v${outcome.supported}). Update the app and import it again — nothing has been changed.`,
    };
  }

  if (outcome.status === "unmigratable") {
    return {
      status: "error",
      detail: `That export is from schema v${outcome.from} and there is no upgrade path from v${outcome.missingStep}.`,
    };
  }

  const parsed = progressSchema.safeParse(outcome.state);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      status: "error",
      detail: `The file did not validate: ${first === undefined ? "unknown problem" : `${first.path.join(".")} ${first.message}`}.`,
    };
  }

  return {
    status: "ok",
    state: parsed.data,
    migrated: outcome.migrated,
    fromVersion: outcome.from,
    summary: summarize(parsed.data),
  };
}

/* ------------------------------------------------------------------ *
 * The nudge
 * ------------------------------------------------------------------ */

export const BACKUP_NUDGE = {
  /** Days since the last export before it is worth mentioning. */
  AFTER_DAYS: 14,
  /** Or this many answers recorded since then, whichever comes first. */
  AFTER_ANSWERS: 100,
} as const;

export interface BackupNudge {
  due: boolean;
  /** Ready to render, or null when nothing needs saying. */
  message: string | null;
  neverExported: boolean;
  daysSince: number | null;
  answersSince: number;
}

/**
 * Whether to mention backing up, and why.
 *
 * Deliberately quiet: nothing at all until there is something worth losing, and one
 * line when there is. An app that nags about backups on day one gets its warnings
 * ignored by the time they matter.
 *
 * Answers since the last export are counted from the answer log. That log is trimmed
 * to a rolling window, which is fine here — the threshold is a hundred answers, well
 * inside it.
 */
export function backupNudge(state: ProgressState, now: number): BackupNudge {
  const answers = Object.keys(state.questions).length;
  const lastExport =
    state.meta.lastExportAt === null ? null : Date.parse(state.meta.lastExportAt);
  const since = lastExport === null || Number.isNaN(lastExport) ? null : lastExport;

  const answersSince =
    since === null ? answers : state.events.filter((event) => event.at > since).length;
  const daysSince =
    since === null ? null : Math.floor((now - since) / (24 * 60 * 60 * 1000));

  // Nothing to lose yet, so nothing to say.
  if (answers === 0) {
    return { due: false, message: null, neverExported: since === null, daysSince, answersSince };
  }

  if (since === null) {
    const due = answers >= BACKUP_NUDGE.AFTER_ANSWERS / 4;
    return {
      due,
      neverExported: true,
      daysSince: null,
      answersSince,
      message: due
        ? `You have never exported. Everything is in this browser's storage — clearing site data would take ${answers} answered questions with it.`
        : null,
    };
  }

  const stale = daysSince !== null && daysSince >= BACKUP_NUDGE.AFTER_DAYS;
  const busy = answersSince >= BACKUP_NUDGE.AFTER_ANSWERS;

  if (!stale && !busy) {
    return { due: false, message: null, neverExported: false, daysSince, answersSince };
  }

  return {
    due: true,
    neverExported: false,
    daysSince,
    answersSince,
    message: busy
      ? `${answersSince} answers since your last export. Worth saving a copy.`
      : `Last exported ${daysSince} days ago. Worth saving a copy.`,
  };
}

/** Human form of `meta.lastExportAt` for the data card. */
export function lastExportLabel(state: ProgressState, now: number): string {
  if (state.meta.lastExportAt === null) return "Never exported";

  const at = Date.parse(state.meta.lastExportAt);
  if (Number.isNaN(at)) return "Never exported";

  const days = Math.floor((now - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "Exported today";
  if (days === 1) return "Exported yesterday";
  return `Exported ${days} days ago`;
}
