/**
 * Active time accounting.
 *
 * This is one of the few places where a bug is silently self-serving: over-credited
 * time inflates the daily minutes figure, which satisfies the streak goal without
 * any studying. So the tests care most about the two cases that would do that — a
 * hidden tab and an abandoned one.
 */

import { describe, expect, it } from "vitest";

import {
  bankSpan,
  creditedSpanMs,
  elapsedMs,
  elapsedSeconds,
  isResumable,
  pause,
  pausedClock,
  resume,
  split,
  startClock,
} from "./activeTime";
import { ACTIVE_TIME } from "./constants";

const T0 = 1_800_000_000_000;
const SEC = 1000;

describe("creditedSpanMs", () => {
  it("credits a normal span in full", () => {
    expect(creditedSpanMs(T0, T0 + 30 * SEC)).toBe(30 * SEC);
  });

  it("credits nothing when the clock is not running", () => {
    expect(creditedSpanMs(null, T0 + 30 * SEC)).toBe(0);
  });

  it("caps a long span rather than crediting it", () => {
    // The abandoned-tab case: two hours of a visible page is not two hours of study.
    expect(creditedSpanMs(T0, T0 + 2 * 60 * 60 * SEC)).toBe(
      ACTIVE_TIME.MAX_SPAN_MS,
    );
  });

  it("credits zero rather than negative time when the clock moves backwards", () => {
    // A system clock adjustment must never subtract from banked study time.
    expect(creditedSpanMs(T0, T0 - 60 * SEC)).toBe(0);
  });
});

describe("pause and resume", () => {
  it("banks the running span on pause", () => {
    const clock = pause(startClock(T0), T0 + 20 * SEC);
    expect(clock.accumulatedMs).toBe(20 * SEC);
    expect(clock.runningSince).toBeNull();
  });

  it("does not accumulate while paused", () => {
    const paused = pause(startClock(T0), T0 + 20 * SEC);
    // An hour passes with the tab hidden.
    expect(elapsedMs(paused, T0 + 3600 * SEC)).toBe(20 * SEC);
  });

  it("resumes without losing banked time", () => {
    const paused = pause(startClock(T0), T0 + 20 * SEC);
    const running = resume(paused, T0 + 3600 * SEC);
    expect(elapsedMs(running, T0 + 3610 * SEC)).toBe(30 * SEC);
  });

  it("is idempotent in both directions", () => {
    const paused = pause(startClock(T0), T0 + 20 * SEC);
    expect(pause(paused, T0 + 40 * SEC)).toEqual(paused);

    const running = resume(paused, T0 + 40 * SEC);
    // A second resume must not restart the span and lose 10 seconds.
    expect(resume(running, T0 + 50 * SEC)).toEqual(running);
  });

  it("survives a hide/show cycle crediting only the visible time", () => {
    let clock = startClock(T0);
    clock = pause(clock, T0 + 15 * SEC); // read for 15s, then hid the tab
    clock = resume(clock, T0 + 900 * SEC); // came back 15 minutes later
    clock = pause(clock, T0 + 925 * SEC); // read for another 25s
    expect(elapsedSeconds(clock, T0 + 5000 * SEC)).toBe(40);
  });
});

describe("split", () => {
  it("banks the span and starts a new one", () => {
    const { banked, clock } = split(startClock(T0), T0 + 12 * SEC);
    expect(banked).toBe(12 * SEC);
    expect(clock.accumulatedMs).toBe(12 * SEC);
    expect(clock.runningSince).toBe(T0 + 12 * SEC);
  });

  it("caps the banked amount like any other span", () => {
    const { banked } = split(startClock(T0), T0 + 3600 * SEC);
    expect(banked).toBe(ACTIVE_TIME.MAX_SPAN_MS);
  });

  it("leaves a paused clock paused", () => {
    const paused = pausedClock(5 * SEC);
    const { banked, clock } = split(paused, T0);
    expect(banked).toBe(0);
    expect(clock.runningSince).toBeNull();
    expect(clock.accumulatedMs).toBe(5 * SEC);
  });

  it("splitting repeatedly across questions sums to the total elapsed", () => {
    // Three questions of 10, 20 and 30 seconds with no gaps.
    let clock = startClock(T0);
    const spans: number[] = [];
    for (const at of [10, 30, 60]) {
      const out = split(clock, T0 + at * SEC);
      spans.push(out.banked);
      clock = out.clock;
    }
    expect(spans).toEqual([10 * SEC, 20 * SEC, 30 * SEC]);
    expect(clock.accumulatedMs).toBe(60 * SEC);
  });
});

describe("pausedClock", () => {
  it("restores banked time without running", () => {
    const clock = pausedClock(45 * SEC);
    expect(clock.runningSince).toBeNull();
    expect(elapsedMs(clock, T0)).toBe(45 * SEC);
  });

  it("refuses to restore negative time", () => {
    expect(pausedClock(-100).accumulatedMs).toBe(0);
  });
});

describe("isResumable", () => {
  it("accepts a session saved minutes ago", () => {
    expect(isResumable(T0, T0 + 10 * 60 * SEC)).toBe(true);
  });

  it("accepts a session at the edge of the window", () => {
    expect(isResumable(T0, T0 + ACTIVE_TIME.RESUME_WINDOW_MS)).toBe(true);
  });

  it("rejects a session older than the window", () => {
    expect(isResumable(T0, T0 + ACTIVE_TIME.RESUME_WINDOW_MS + 1)).toBe(false);
  });

  it("rejects a session saved in the future", () => {
    // A clock adjustment should not make a stale session look fresh.
    expect(isResumable(T0, T0 - 1)).toBe(false);
  });
});

describe("bankSpan", () => {
  const items = () => [{ activeMs: 0 }, { activeMs: 0 }, { activeMs: 0 }];

  it("credits the span to the item on screen", () => {
    const out = bankSpan(startClock(T0), items(), 1, T0 + 30 * SEC, false);
    expect(out.items.map((i) => i.activeMs)).toEqual([0, 30 * SEC, 0]);
    expect(out.clock.runningSince).toBe(T0 + 30 * SEC);
  });

  it("stops the clock when asked, without losing the span", () => {
    const out = bankSpan(startClock(T0), items(), 0, T0 + 30 * SEC, true);
    expect(out.items[0]?.activeMs).toBe(30 * SEC);
    expect(out.clock).toEqual({ accumulatedMs: 30 * SEC, runningSince: null });
  });

  it("keeps sum(items) equal to the clock total across a hide/show cycle", () => {
    // The invariant that makes per-question times and the session total agree. It is
    // the hidden-tab path that used to break it: the span was banked into the clock
    // and never reached the item.
    let clock = startClock(T0);
    let list = items();

    // 20s on question 1, then the tab is hidden.
    ({ clock, items: list } = bankSpan(clock, list, 0, T0 + 20 * SEC, true));
    // Ten minutes away, then back for another 10s on the same question.
    clock = resume(clock, T0 + 620 * SEC);
    ({ clock, items: list } = bankSpan(clock, list, 0, T0 + 630 * SEC, false));
    // Move on and spend 15s on question 2.
    ({ clock, items: list } = bankSpan(clock, list, 1, T0 + 645 * SEC, true));

    expect(list.map((i) => i.activeMs)).toEqual([30 * SEC, 15 * SEC, 0]);
    const sum = list.reduce((total, i) => total + i.activeMs, 0);
    expect(sum).toBe(clock.accumulatedMs);
    expect(clock.accumulatedMs).toBe(45 * SEC);
  });

  it("caps a single span so an abandoned visible tab cannot inflate an item", () => {
    const out = bankSpan(
      startClock(T0),
      items(),
      0,
      T0 + 3 * 60 * 60 * SEC,
      true,
    );
    expect(out.items[0]?.activeMs).toBe(ACTIVE_TIME.MAX_SPAN_MS);
  });

  it("leaves items untouched when the clock is already paused", () => {
    const list = items();
    const out = bankSpan(pausedClock(5 * SEC), list, 0, T0, true);
    expect(out.items).toEqual(list);
    expect(out.banked).toBe(0);
  });

  it("does not fall over when the index is out of range", () => {
    // A rebuilt session can be shorter than the snapshot it came from.
    const out = bankSpan(startClock(T0), items(), 9, T0 + 10 * SEC, true);
    expect(out.items.map((i) => i.activeMs)).toEqual([0, 0, 0]);
    expect(out.clock.accumulatedMs).toBe(10 * SEC);
  });
});
