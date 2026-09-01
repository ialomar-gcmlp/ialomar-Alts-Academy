/**
 * Storage and migration tests.
 *
 * Progress is the one thing in this app that cannot be regenerated, so the failure
 * modes matter more than the happy path: refusing to write over state from a newer
 * build, keeping a backup before migrating, and booting cleanly on corrupt input.
 */

import { beforeEach, describe, expect, it } from "vitest";

import { __setAdapter, flush, load, save } from "./index";
import { createMemoryAdapter, type StorageAdapter } from "./localStorageAdapter";
import { migrate, migrations, type UnknownState } from "./migrations";
import { PROGRESS_SCHEMA_VERSION, defaultProgress, progressSchema } from "./progressSchema";

const KEY = "alts-academy:progress";

let adapter: StorageAdapter;

beforeEach(() => {
  adapter = createMemoryAdapter();
  __setAdapter(adapter);
});

describe("migrate", () => {
  it("is a no-op when already at the current version", () => {
    const state: UnknownState = { schemaVersion: PROGRESS_SCHEMA_VERSION, settings: {} };
    const out = migrate(state);
    expect(out.status).toBe("ok");
    if (out.status === "ok") {
      expect(out.migrated).toBe(false);
      expect(out.to).toBe(PROGRESS_SCHEMA_VERSION);
    }
  });

  it("refuses state from a newer version instead of coercing it", () => {
    // The important case. Silently downgrading would discard real history.
    const out = migrate({ schemaVersion: PROGRESS_SCHEMA_VERSION + 5 });
    expect(out.status).toBe("too-new");
    if (out.status === "too-new") {
      expect(out.found).toBe(PROGRESS_SCHEMA_VERSION + 5);
      expect(out.supported).toBe(PROGRESS_SCHEMA_VERSION);
    }
  });

  it("reports an unmigratable version rather than guessing", () => {
    const out = migrate({ schemaVersion: 0 }, PROGRESS_SCHEMA_VERSION);
    // No step registered from v0, so it must refuse, not invent one.
    expect(out.status).toBe("unmigratable");
  });

  it("applies a chain of steps in order and stamps the new version", () => {
    // A temporary two-step chain, to prove the mechanism works beyond one hop.
    const saved = { one: migrations[1], two: migrations[2] };
    migrations[1] = (s) => ({ ...s, addedInV2: true });
    migrations[2] = (s) => ({ ...s, addedInV3: true });
    try {
      const out = migrate({ schemaVersion: 1, keep: "me" }, 3);
      expect(out.status).toBe("ok");
      if (out.status === "ok") {
        expect(out.state).toMatchObject({
          schemaVersion: 3,
          keep: "me",
          addedInV2: true,
          addedInV3: true,
        });
        expect(out.migrated).toBe(true);
        expect(out.from).toBe(1);
      }
    } finally {
      if (saved.one) migrations[1] = saved.one;
      else delete migrations[1];
      if (saved.two) migrations[2] = saved.two;
      else delete migrations[2];
    }
  });
});

describe("migration v1 -> v2", () => {
  /** Exactly what a v1 install had on disk: settings and meta, nothing else. */
  const v1 = {
    schemaVersion: 1,
    settings: {
      theme: "dark",
      sessionLength: 20,
      dailyGoalMinutes: 15,
      validateContentInProd: false,
    },
    meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: null },
  };

  it("produces state that satisfies the current schema", () => {
    const out = migrate(v1);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;

    const parsed = progressSchema.safeParse(out.state);
    expect(parsed.success).toBe(true);
  });

  it("carries the user's settings and createdAt across untouched", () => {
    // The whole promise of migrations: an update never costs you your history.
    const out = migrate(v1);
    if (out.status !== "ok") throw new Error("expected ok");

    expect(out.state).toMatchObject({
      schemaVersion: PROGRESS_SCHEMA_VERSION,
      settings: { theme: "dark", sessionLength: 20, dailyGoalMinutes: 15 },
      meta: { createdAt: "2026-01-01T00:00:00.000Z" },
    });
  });

  it("initialises the new collections empty", () => {
    const out = migrate(v1);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state).toMatchObject({ questions: {}, topics: {}, events: [], daily: {} });
  });

  it("runs end to end through load(), keeping a backup of the v1 blob", async () => {
    await adapter.set(KEY, JSON.stringify(v1));

    const { state, status } = await load();
    expect(status).toEqual({ kind: "loaded", migratedFrom: 1 });
    expect(state.settings.dailyGoalMinutes).toBe(15);
    expect(state.questions).toEqual({});

    const backup = await adapter.get("alts-academy:progress.backup.v1");
    expect(backup).toBe(JSON.stringify(v1));
  });
});

describe("load", () => {
  it("returns defaults on a fresh install", async () => {
    const { state, status } = await load();
    expect(status.kind).toBe("fresh");
    expect(state.schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);
  });

  it("round-trips a saved state", async () => {
    const original = defaultProgress();
    original.settings.dailyGoalMinutes = 25;
    original.settings.sessionLength = 45;
    save(original);
    await flush();

    const { state, status } = await load();
    expect(status.kind).toBe("loaded");
    expect(state.settings.dailyGoalMinutes).toBe(25);
    expect(state.settings.sessionLength).toBe(45);
  });

  it("boots on defaults when the stored blob is not JSON", async () => {
    await adapter.set(KEY, "{ this is not json");
    const { state, status } = await load();
    expect(status.kind).toBe("corrupt");
    expect(state.schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);
  });

  it("keeps a backup and boots on defaults when the shape is invalid", async () => {
    // Right version, wrong contents — the case a bad hand-edit or a partial write
    // would produce.
    await adapter.set(
      KEY,
      JSON.stringify({ schemaVersion: PROGRESS_SCHEMA_VERSION, settings: { theme: "puce" } }),
    );

    const { status } = await load();
    expect(status.kind).toBe("corrupt");

    const backup = await adapter.get(`alts-academy:progress.backup.v${PROGRESS_SCHEMA_VERSION}`);
    expect(backup).not.toBeNull();
    expect(backup).toContain("puce");
  });

  it("blocks writes after refusing newer state, so history is not overwritten", async () => {
    const future = JSON.stringify({ schemaVersion: PROGRESS_SCHEMA_VERSION + 1, settings: {} });
    await adapter.set(KEY, future);

    const { status } = await load();
    expect(status.kind).toBe("refused");

    save(defaultProgress());
    await flush();

    expect(await adapter.get(KEY)).toBe(future);
  });
});

describe("save", () => {
  it("mirrors the theme to its own key for the pre-paint script", async () => {
    const state = defaultProgress();
    state.settings.theme = "dark";
    save(state);
    expect(await adapter.get("alts-academy:theme")).toBe("dark");
  });

  it("coalesces a burst of writes into the latest state", async () => {
    const a = defaultProgress();
    a.settings.dailyGoalMinutes = 10;
    const b = defaultProgress();
    b.settings.dailyGoalMinutes = 30;

    save(a);
    save(b);
    await flush();

    const raw = await adapter.get(KEY);
    expect(raw).toContain('"dailyGoalMinutes":30');
    expect(raw).not.toContain('"dailyGoalMinutes":10');
  });
});

describe("migration v2 -> v3", () => {
  /** A v2 install: scheduling state and daily aggregates, no gamification. */
  const v2 = {
    schemaVersion: 2,
    settings: {
      theme: "light",
      sessionLength: 10,
      dailyGoalMinutes: 10,
      validateContentInProd: false,
    },
    questions: {
      "quant-tvm-01-q1": {
        id: "quant-tvm-01-q1",
        topicId: "quant-tvm-01",
        difficulty: 3,
        ease: 2.6,
        intervalDays: 3,
        dueAt: 1780000000000,
        reps: 2,
        lapses: 1,
        consecutiveMisses: 0,
        lastGrade: 5,
        lastAnsweredAt: 1779000000000,
        lastConfidence: "confident",
        correctCount: 2,
        totalCount: 3,
        everCorrect: true,
        needsReteach: false,
      },
    },
    topics: { "quant-tvm-01": { attempts: 3, lastStudiedAt: 1779000000000 } },
    events: [
      { q: "quant-tvm-01-q1", t: "quant-tvm-01", at: 1779000000000, ok: true, c: "confident", d: 3, g: 5, s: 25 },
    ],
    daily: {
      "2026-06-01": {
        answered: 3,
        correct: 2,
        seconds: 400,
        byConfidence: {
          confident: { correct: 2, total: 2 },
          unsure: { correct: 0, total: 1 },
          guessing: { correct: 0, total: 0 },
        },
      },
    },
    meta: { createdAt: "2026-05-01T00:00:00.000Z", lastExportAt: null },
  };

  it("produces state that satisfies the current schema", () => {
    const out = migrate(v2);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(progressSchema.safeParse(out.state).success).toBe(true);
  });

  it("keeps every scheduling interval and every answer intact", () => {
    // The point of the exercise: an update must not cost the user their history.
    const out = migrate(v2);
    if (out.status !== "ok") throw new Error("expected ok");

    expect(out.state).toMatchObject({
      questions: { "quant-tvm-01-q1": { ease: 2.6, intervalDays: 3, lapses: 1 } },
      topics: { "quant-tvm-01": { attempts: 3 } },
      meta: { createdAt: "2026-05-01T00:00:00.000Z" },
    });
    expect((out.state["events"] as unknown[]).length).toBe(1);
  });

  it("adds gamification at zero rather than inventing a total", () => {
    const out = migrate(v2);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state["gamification"]).toEqual({ xp: 0, badges: [], frozenDays: [] });
  });

  it("backfills reviews and xp on existing days without touching their other fields", () => {
    const out = migrate(v2);
    if (out.status !== "ok") throw new Error("expected ok");

    const day = (out.state["daily"] as Record<string, Record<string, unknown>>)["2026-06-01"];
    expect(day).toMatchObject({ answered: 3, correct: 2, seconds: 400, reviews: 0, xp: 0 });
  });

  it("runs end to end through load(), keeping a v2 backup", async () => {
    await adapter.set(KEY, JSON.stringify(v2));

    const { state, status } = await load();
    expect(status).toEqual({ kind: "loaded", migratedFrom: 2 });
    expect(state.gamification.xp).toBe(0);
    expect(state.questions["quant-tvm-01-q1"]?.intervalDays).toBe(3);

    expect(await adapter.get("alts-academy:progress.backup.v2")).toBe(JSON.stringify(v2));
  });

  it("chains v1 all the way to the current version", async () => {
    // A user who skipped a release must still land somewhere valid.
    const v1 = {
      schemaVersion: 1,
      settings: { theme: "dark", sessionLength: 5, dailyGoalMinutes: 20, validateContentInProd: false },
      meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: null },
    };
    await adapter.set(KEY, JSON.stringify(v1));

    const { state, status } = await load();
    expect(status).toEqual({ kind: "loaded", migratedFrom: 1 });
    expect(state.schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);
    expect(state.settings.dailyGoalMinutes).toBe(20);
    expect(state.gamification).toEqual({ xp: 0, badges: [], frozenDays: [] });
  });
});

describe("migration v3 -> v4", () => {
  const v3 = {
    schemaVersion: 3,
    settings: {
      theme: "light",
      sessionLength: 20,
      dailyGoalMinutes: 15,
      validateContentInProd: false,
    },
    gamification: { xp: 480, badges: [{ id: "groundwork", earnedAt: 1780000000000 }], frozenDays: ["2026-06-03"] },
    questions: {},
    topics: {},
    events: [],
    daily: {
      "2026-06-04": {
        answered: 8,
        correct: 7,
        seconds: 900,
        reviews: 4,
        xp: 95,
        byConfidence: {
          confident: { correct: 6, total: 6 },
          unsure: { correct: 1, total: 2 },
          guessing: { correct: 0, total: 0 },
        },
      },
    },
    meta: { createdAt: "2026-05-01T00:00:00.000Z", lastExportAt: null },
  };

  it("produces state that satisfies the current schema", () => {
    const out = migrate(v3);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(progressSchema.safeParse(out.state).success).toBe(true);
  });

  it("adds the glossary collections empty", () => {
    const out = migrate(v3);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state["termsSeen"]).toEqual({});
    expect(out.state["termDrills"]).toEqual({});
  });

  it("leaves XP, badges, freezes and daily history untouched", () => {
    // The point of every migration: nothing the user earned is lost.
    const out = migrate(v3);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state["gamification"]).toEqual(v3.gamification);
    expect(out.state["daily"]).toEqual(v3.daily);
  });

  it("chains v1 all the way to v4", async () => {
    const v1 = {
      schemaVersion: 1,
      settings: { theme: "dark", sessionLength: 45, dailyGoalMinutes: 30, validateContentInProd: false },
      meta: { createdAt: "2026-01-01T00:00:00.000Z", lastExportAt: null },
    };
    await adapter.set(KEY, JSON.stringify(v1));

    const { state, status } = await load();
    expect(status).toEqual({ kind: "loaded", migratedFrom: 1 });
    expect(state.schemaVersion).toBe(PROGRESS_SCHEMA_VERSION);
    expect(state.settings.dailyGoalMinutes).toBe(30);
    expect(state.termsSeen).toEqual({});
    expect(state.termDrills).toEqual({});
  });
});

describe("migration v5 -> v6", () => {
  const v5 = {
    schemaVersion: 5,
    settings: {
      theme: "light",
      sessionLength: 10,
      dailyGoalMinutes: 10,
      validateContentInProd: false,
      effects: "full",
    },
    gamification: { xp: 900, badges: [], frozenDays: [] },
    questions: {
      "quant-tvm-01-q1": {
        id: "quant-tvm-01-q1",
        topicId: "quant-tvm-01",
        difficulty: 2,
        ease: 2.5,
        intervalDays: 3,
        dueAt: 1790000000000,
        reps: 2,
        lapses: 0,
        consecutiveMisses: 0,
        lastGrade: 5,
        lastAnsweredAt: 1789000000000,
        lastConfidence: "confident",
        correctCount: 2,
        totalCount: 2,
        everCorrect: true,
        needsReteach: false,
      },
    },
    topics: {},
    termsSeen: {},
    termDrills: {},
    events: [],
    daily: {},
    meta: { createdAt: "2026-05-01T00:00:00.000Z", lastExportAt: null },
  };

  it("produces state that satisfies the current schema", () => {
    const out = migrate(v5);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(progressSchema.safeParse(out.state).success).toBe(true);
  });

  it("starts with no saved session and no exam history", () => {
    // Nothing to reconstruct: a v5 user could not have had either.
    const out = migrate(v5);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state["activeSession"]).toBeNull();
    expect(out.state["exams"]).toEqual([]);
  });

  it("leaves scheduling state and XP untouched", () => {
    const out = migrate(v5);
    if (out.status !== "ok") throw new Error("expected ok");
    expect(out.state["questions"]).toEqual(v5.questions);
    expect(out.state["gamification"]).toEqual(v5.gamification);
  });
});

describe("migration v4 -> v5", () => {
  const v4 = {
    schemaVersion: 4,
    settings: {
      theme: "dark",
      sessionLength: 20,
      dailyGoalMinutes: 15,
      validateContentInProd: false,
    },
    gamification: { xp: 1200, badges: [], frozenDays: [] },
    questions: {},
    topics: {},
    termsSeen: { "capital-call": 1780000000000 },
    termDrills: {},
    events: [],
    daily: {},
    meta: { createdAt: "2026-05-01T00:00:00.000Z", lastExportAt: null },
  };

  it("produces state that satisfies the current schema", () => {
    const out = migrate(v4);
    expect(out.status).toBe("ok");
    if (out.status !== "ok") return;
    expect(progressSchema.safeParse(out.state).success).toBe(true);
  });

  it("defaults an existing user to full effects, not calm", () => {
    // Opting a user out of a new feature they never asked to opt out of is worse
    // than showing it to them once with a one-click switch.
    const out = migrate(v4);
    if (out.status !== "ok") throw new Error("expected ok");
    const settings = out.state["settings"] as Record<string, unknown>;
    expect(settings["effects"]).toBe("full");
  });

  it("keeps every other setting and all earned progress", () => {
    const out = migrate(v4);
    if (out.status !== "ok") throw new Error("expected ok");
    const settings = out.state["settings"] as Record<string, unknown>;
    expect(settings["theme"]).toBe("dark");
    expect(settings["dailyGoalMinutes"]).toBe(15);
    expect(out.state["gamification"]).toEqual(v4.gamification);
    expect(out.state["termsSeen"]).toEqual(v4.termsSeen);
  });

  it("survives a settings object that is missing entirely", () => {
    const out = migrate({ ...v4, settings: undefined });
    if (out.status !== "ok") throw new Error("expected ok");
    expect((out.state["settings"] as Record<string, unknown>)["effects"]).toBe("full");
  });
});
