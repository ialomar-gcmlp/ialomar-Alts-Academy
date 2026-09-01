/**
 * Free-recall notes. Small surface, but two behaviours protect the design: blank
 * input must not write (the prompt is optional, and an empty note re-met later is
 * noise), and the per-topic list must not grow without bound.
 */

import { describe, expect, it } from "vitest";

import { RECALL, addRecallNote, latestRecallNote } from "./recall";

const T0 = 1_800_000_000_000;

describe("addRecallNote", () => {
  it("appends a trimmed note under its topic", () => {
    const notes = addRecallNote({}, "funds-waterfall-01", "  Carry is charged on gains, not value.  ", T0);
    expect(notes["funds-waterfall-01"]).toEqual([
      { text: "Carry is charged on gains, not value.", at: T0 },
    ]);
  });

  it("returns the same reference for blank input, so callers skip persistence", () => {
    const before = { "a-01": [{ text: "x", at: T0 }] };
    expect(addRecallNote(before, "a-01", "   ", T0)).toBe(before);
    expect(addRecallNote(before, "a-01", "", T0)).toBe(before);
  });

  it("keeps only the most recent RECALL.KEEP notes", () => {
    let notes: Record<string, { text: string; at: number }[]> = {};
    for (let i = 0; i < RECALL.KEEP + 2; i++) {
      notes = addRecallNote(notes, "a-01", `note ${i}`, T0 + i);
    }
    const list = notes["a-01"] ?? [];
    expect(list).toHaveLength(RECALL.KEEP);
    expect(list[0]?.text).toBe("note 2"); // the two oldest aged out
    expect(list[list.length - 1]?.text).toBe(`note ${RECALL.KEEP + 1}`);
  });

  it("caps runaway input at MAX_LENGTH rather than rejecting it", () => {
    const notes = addRecallNote({}, "a-01", "x".repeat(2000), T0);
    expect(notes["a-01"]?.[0]?.text).toHaveLength(RECALL.MAX_LENGTH);
  });

  it("does not disturb other topics", () => {
    const before = addRecallNote({}, "a-01", "first", T0);
    const after = addRecallNote(before, "b-01", "second", T0 + 1);
    expect(after["a-01"]).toEqual(before["a-01"]);
  });
});

describe("latestRecallNote", () => {
  it("returns the newest note", () => {
    let notes = addRecallNote({}, "a-01", "older", T0);
    notes = addRecallNote(notes, "a-01", "newer", T0 + 1);
    expect(latestRecallNote(notes, "a-01")?.text).toBe("newer");
  });

  it("returns null for a topic never written about", () => {
    expect(latestRecallNote({}, "a-01")).toBeNull();
  });
});
