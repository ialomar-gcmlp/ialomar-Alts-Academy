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
import { PROGRESS_SCHEMA_VERSION, defaultProgress } from "./progressSchema";

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

  it("applies a registered chain in order and stamps the new version", () => {
    // Register a temporary chain so the mechanism is tested before M2 adds a real one.
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
      delete migrations[1];
      delete migrations[2];
    }
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
