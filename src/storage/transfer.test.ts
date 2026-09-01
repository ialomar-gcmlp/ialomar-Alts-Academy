/**
 * Export and import.
 *
 * An import replaces everything, so the tests concentrate on refusal: a file that is
 * not ours, a file from a newer build, a file that does not validate. Each has to fail
 * with a reason and change nothing — a partially applied import would be the worst
 * outcome in this app.
 */

import { describe, expect, it } from "vitest";

import {
  BACKUP_NUDGE,
  backupNudge,
  exportFilename,
  lastExportLabel,
  parseImport,
  replacementSentence,
  serializeExport,
  summarize,
} from "./transfer";
import { PROGRESS_SCHEMA_VERSION, defaultProgress, type ProgressState } from "./progressSchema";

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);
const DAY = 86_400_000;

function stateWith(over: Partial<ProgressState> = {}): ProgressState {
  return { ...defaultProgress(), ...over };
}

/** A state with something in it, so summaries have figures to report. */
function populated(): ProgressState {
  const base = defaultProgress();
  return {
    ...base,
    questions: {
      a: {
        id: "a",
        topicId: "quant-tvm-01",
        difficulty: 2,
        ease: 2.5,
        intervalDays: 3,
        dueAt: NOW + 3 * DAY,
        reps: 2,
        lapses: 0,
        consecutiveMisses: 0,
        lastGrade: 5,
        lastAnsweredAt: NOW,
        lastConfidence: "confident",
        correctCount: 2,
        totalCount: 2,
        everCorrect: true,
        needsReteach: false,
      },
    },
    topics: { "quant-tvm-01": { attempts: 2, lastStudiedAt: NOW } },
    gamification: { ...base.gamification, xp: 1234 },
    daily: {
      "2026-08-20": {
        answered: 6,
        correct: 5,
        seconds: 300,
        reviews: 3,
        xp: 60,
        byConfidence: {
          confident: { correct: 4, total: 4 },
          unsure: { correct: 1, total: 2 },
          guessing: { correct: 0, total: 0 },
        },
      },
      "2026-08-31": {
        answered: 4,
        correct: 4,
        seconds: 200,
        reviews: 4,
        xp: 48,
        byConfidence: {
          confident: { correct: 4, total: 4 },
          unsure: { correct: 0, total: 0 },
          guessing: { correct: 0, total: 0 },
        },
      },
      // A day the user opened the app without answering must not widen the span.
      "2026-09-05": {
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
      },
    },
  };
}

describe("export", () => {
  it("round-trips through import", () => {
    const state = populated();
    const result = parseImport(serializeExport(state, NOW));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state).toEqual(state);
    expect(result.migrated).toBe(false);
  });

  it("stamps the envelope with the schema version and format", () => {
    const envelope = JSON.parse(serializeExport(populated(), NOW)) as Record<string, unknown>;
    expect(envelope["format"]).toBe("alts-academy-progress");
    expect(envelope["schemaVersion"]).toBe(PROGRESS_SCHEMA_VERSION);
    expect(envelope["exportedAt"]).toBe(new Date(NOW).toISOString());
  });

  it("names the file by date so a folder of them sorts", () => {
    expect(exportFilename(Date.UTC(2026, 0, 5, 12))).toBe(
      "alts-academy-progress-2026-01-05.json",
    );
  });
});

describe("summarize", () => {
  it("counts answers, XP and topics", () => {
    const s = summarize(populated());
    expect(s.answers).toBe(1);
    expect(s.xp).toBe(1234);
    expect(s.topics).toBe(1);
  });

  it("spans only the days something was answered", () => {
    // A day with zero answered must not stretch the range — it would claim activity
    // on a day the user did nothing.
    const s = summarize(populated());
    expect(s.from).toBe("2026-08-20");
    expect(s.to).toBe("2026-08-31");
    expect(s.days).toBe(2);
  });

  it("reports nulls for an empty state rather than inventing a date", () => {
    const s = summarize(defaultProgress());
    expect(s.from).toBeNull();
    expect(s.to).toBeNull();
    expect(s.answers).toBe(0);
  });
});

describe("replacementSentence", () => {
  it("says what is being destroyed when there is something to destroy", () => {
    const sentence = replacementSentence(summarize(populated()), summarize(populated()));
    expect(sentence).toContain("replaces your current 1 answered question");
    expect(sentence).toContain("cannot be undone");
  });

  it("says nothing is lost when there is nothing to lose", () => {
    const sentence = replacementSentence(summarize(populated()), summarize(defaultProgress()));
    expect(sentence).toContain("nothing is lost");
  });

  it("collapses a single-day span", () => {
    const one = { ...summarize(populated()), from: "2026-08-31", to: "2026-08-31" };
    expect(replacementSentence(one, summarize(defaultProgress()))).toContain(
      "activity on 2026-08-31",
    );
  });
});

describe("parseImport refusals", () => {
  it("refuses a file that is not JSON, and says so", () => {
    const result = parseImport("not json at all");
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.detail).toContain("not valid JSON");
  });

  it("refuses JSON that is not an object", () => {
    expect(parseImport("[1,2,3]").status).toBe("error");
    expect(parseImport('"hello"').status).toBe("error");
  });

  it("refuses a file this app did not write", () => {
    // A stray JSON file that happens to have progress-shaped keys is not progress.
    const result = parseImport(JSON.stringify({ questions: {}, xp: 999 }));
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.detail).toContain("not exported by Alts Academy");
  });

  it("refuses an export from a newer build without touching anything", () => {
    const envelope = {
      format: "alts-academy-progress",
      schemaVersion: PROGRESS_SCHEMA_VERSION + 5,
      exportedAt: new Date(NOW).toISOString(),
      progress: { ...defaultProgress(), schemaVersion: PROGRESS_SCHEMA_VERSION + 5 },
    };
    const result = parseImport(JSON.stringify(envelope));
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.detail).toContain("newer version");
    expect(result.detail).toContain("nothing has been changed");
  });

  it("refuses an envelope with no progress inside", () => {
    const result = parseImport(
      JSON.stringify({ format: "alts-academy-progress", schemaVersion: 7 }),
    );
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.detail).toContain("missing its progress data");
  });

  it("names the field when validation fails", () => {
    const bad = {
      format: "alts-academy-progress",
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      progress: { ...defaultProgress(), gamification: { xp: "lots", badges: [], frozenDays: [] } },
    };
    const result = parseImport(JSON.stringify(bad));
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.detail).toContain("gamification.xp");
  });
});

describe("parseImport upgrades", () => {
  it("migrates an older export on the way in", () => {
    // The point of running the migration chain here: a file exported months ago from
    // an earlier build must still import.
    // What a real v6 export looks like: activeSession and exams present (migration
    // 5 -> 6 added them), but no `x` on the answer events yet.
    const v6 = {
      ...defaultProgress(),
      schemaVersion: 6,
      events: [
        { q: "a", t: "quant-tvm-01", at: NOW, ok: true, c: "confident", d: 2, g: 5, s: 30 },
      ],
    };
    const envelope = { format: "alts-academy-progress", schemaVersion: 6, progress: v6 };

    const result = parseImport(JSON.stringify(envelope));
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(6);
    expect(result.state.schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);
    // Migration 6 -> 7 marks pre-exam answers as not from an exam.
    expect(result.state.events[0]?.x).toBe(false);
  });
});

describe("backupNudge", () => {
  const exported = (at: number) =>
    stateWith({
      questions: populated().questions,
      meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: new Date(at).toISOString() },
    });

  it("says nothing when there is nothing recorded", () => {
    const nudge = backupNudge(defaultProgress(), NOW);
    expect(nudge.due).toBe(false);
    expect(nudge.message).toBeNull();
  });

  it("says nothing right after an export", () => {
    expect(backupNudge(exported(NOW - DAY), NOW).due).toBe(false);
  });

  it("speaks up once the export is stale", () => {
    const nudge = backupNudge(exported(NOW - (BACKUP_NUDGE.AFTER_DAYS + 1) * DAY), NOW);
    expect(nudge.due).toBe(true);
    expect(nudge.message).toContain("Last exported");
  });

  it("speaks up on volume even when the export is recent", () => {
    const state = stateWith({
      questions: populated().questions,
      meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: new Date(NOW - DAY).toISOString() },
      events: Array.from({ length: BACKUP_NUDGE.AFTER_ANSWERS }, (_, i) => ({
        q: `q${i}`,
        t: "quant-tvm-01",
        at: NOW - 1000,
        ok: true,
        c: "confident" as const,
        d: 2,
        g: 5,
        s: 20,
        x: false,
      })),
    });
    const nudge = backupNudge(state, NOW);
    expect(nudge.due).toBe(true);
    expect(nudge.message).toContain("answers since your last export");
  });

  it("does not count answers recorded before the last export", () => {
    const state = stateWith({
      questions: populated().questions,
      meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: new Date(NOW - DAY).toISOString() },
      events: Array.from({ length: 500 }, (_, i) => ({
        q: `q${i}`,
        t: "quant-tvm-01",
        at: NOW - 30 * DAY,
        ok: true,
        c: "confident" as const,
        d: 2,
        g: 5,
        s: 20,
        x: false,
      })),
    });
    expect(backupNudge(state, NOW).due).toBe(false);
  });

  it("mentions never having exported once there is enough to lose", () => {
    const many: ProgressState["questions"] = {};
    for (let i = 0; i < 40; i++) many[`q${i}`] = { ...populated().questions["a"]!, id: `q${i}` };
    const nudge = backupNudge(stateWith({ questions: many }), NOW);
    expect(nudge.due).toBe(true);
    expect(nudge.neverExported).toBe(true);
    expect(nudge.message).toContain("never exported");
  });

  it("stays quiet about never exporting on the first few answers", () => {
    // An app that nags on day one gets ignored by the time it matters.
    expect(backupNudge(stateWith({ questions: populated().questions }), NOW).due).toBe(false);
  });
});

describe("lastExportLabel", () => {
  it("handles never, today, yesterday and older", () => {
    expect(lastExportLabel(defaultProgress(), NOW)).toBe("Never exported");

    const at = (t: number) =>
      stateWith({ meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: new Date(t).toISOString() } });

    expect(lastExportLabel(at(NOW - 1000), NOW)).toBe("Exported today");
    expect(lastExportLabel(at(NOW - DAY), NOW)).toBe("Exported yesterday");
    expect(lastExportLabel(at(NOW - 9 * DAY), NOW)).toBe("Exported 9 days ago");
  });

  it("treats an unparseable timestamp as never rather than crashing", () => {
    const broken = stateWith({ meta: { createdAt: "x", lastExportAt: "not a date" } });
    expect(lastExportLabel(broken, NOW)).toBe("Never exported");
  });
});
