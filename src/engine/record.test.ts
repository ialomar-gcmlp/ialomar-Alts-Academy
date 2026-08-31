/**
 * Recording tests.
 *
 * Covers the bookkeeping that sits between the scheduler and storage: creating state
 * on first sight, keeping the answer log bounded, and — the one that matters most —
 * never mutating the progress object it was handed.
 */

import { describe, expect, it } from "vitest";

import { DAY_MS, HISTORY } from "./constants";
import { recordAnswer, trimEvents, type RecordedAnswer } from "./record";
import { dayKey, defaultProgress, type AnswerEvent } from "../storage/progressSchema";

const T0 = Date.UTC(2026, 5, 15, 9, 0, 0);

const answer = (over: Partial<RecordedAnswer> = {}): RecordedAnswer => ({
  questionId: "quant-tvm-01-q1",
  topicId: "quant-tvm-01",
  difficulty: 3,
  correct: true,
  confidence: "confident",
  seconds: 30,
  ...over,
});

describe("recordAnswer", () => {
  it("creates scheduling state the first time a question is seen", () => {
    const { progress, state } = recordAnswer(defaultProgress(), answer(), T0);

    expect(Object.keys(progress.questions)).toEqual(["quant-tvm-01-q1"]);
    expect(state.totalCount).toBe(1);
    expect(state.reps).toBe(1);
    expect(state.difficulty).toBe(3);
    expect(state.dueAt).toBeGreaterThan(T0);
  });

  it("advances existing state rather than replacing it", () => {
    const first = recordAnswer(defaultProgress(), answer(), T0);
    const second = recordAnswer(first.progress, answer(), T0 + DAY_MS);

    expect(second.state.totalCount).toBe(2);
    expect(second.state.reps).toBe(2);
    expect(second.state.lapses).toBe(0);
  });

  it("does not mutate the progress it was given", () => {
    // The store hands its current state in and swaps in the result; mutating the
    // input would make React's change detection unreliable and corrupt history.
    const before = defaultProgress();
    const snapshot = JSON.stringify(before);

    recordAnswer(before, answer(), T0);

    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("appends one event carrying the grade the scheduler assigned", () => {
    const { progress } = recordAnswer(defaultProgress(), answer({ confidence: "unsure" }), T0);
    const event = progress.events[0];

    expect(progress.events).toHaveLength(1);
    expect(event).toMatchObject({
      q: "quant-tvm-01-q1",
      t: "quant-tvm-01",
      at: T0,
      ok: true,
      c: "unsure",
      g: 3, // unsure + correct
      s: 30,
    });
  });

  it("rounds and floors the recorded seconds", () => {
    const a = recordAnswer(defaultProgress(), answer({ seconds: 12.6 }), T0);
    expect(a.progress.events[0]?.s).toBe(13);

    const b = recordAnswer(defaultProgress(), answer({ seconds: -5 }), T0);
    expect(b.progress.events[0]?.s).toBe(0);
  });

  it("builds the daily aggregate, split by confidence", () => {
    let progress = defaultProgress();
    progress = recordAnswer(progress, answer({ correct: true, confidence: "confident" }), T0).progress;
    progress = recordAnswer(
      progress,
      answer({ questionId: "quant-tvm-01-q2", correct: false, confidence: "confident" }),
      T0,
    ).progress;
    progress = recordAnswer(
      progress,
      answer({ questionId: "quant-tvm-01-q3", correct: true, confidence: "guessing" }),
      T0,
    ).progress;

    const day = progress.daily[dayKey(T0)];
    expect(day).toMatchObject({
      answered: 3,
      correct: 2,
      seconds: 90,
      byConfidence: {
        confident: { correct: 1, total: 2 },
        unsure: { correct: 0, total: 0 },
        guessing: { correct: 1, total: 1 },
      },
    });
  });

  it("keeps separate aggregates for separate days", () => {
    let progress = defaultProgress();
    progress = recordAnswer(progress, answer(), T0).progress;
    progress = recordAnswer(progress, answer(), T0 + 2 * DAY_MS).progress;

    expect(Object.keys(progress.daily)).toHaveLength(2);
  });

  it("tracks topic attempts and last studied time", () => {
    let progress = defaultProgress();
    progress = recordAnswer(progress, answer(), T0).progress;
    progress = recordAnswer(progress, answer({ questionId: "quant-tvm-01-q2" }), T0 + 1000).progress;

    expect(progress.topics["quant-tvm-01"]).toEqual({
      attempts: 2,
      lastStudiedAt: T0 + 1000,
    });
  });

  it("schedules a confident miss back inside the same session", () => {
    const { state } = recordAnswer(
      defaultProgress(),
      answer({ correct: false, confidence: "confident" }),
      T0,
    );
    expect(state.dueAt - T0).toBeLessThan(DAY_MS);
    expect(state.lastGrade).toBe(0);
  });
});

describe("trimEvents", () => {
  const event = (at: number): AnswerEvent => ({
    q: "q",
    t: "t",
    at,
    ok: true,
    c: "confident",
    d: 3,
    g: 5,
    s: 10,
  });

  it("leaves a small log alone", () => {
    const events = [event(T0 - DAY_MS), event(T0)];
    expect(trimEvents(events, T0)).toHaveLength(2);
  });

  it("drops events older than the age limit", () => {
    const events = [
      event(T0 - (HISTORY.MAX_EVENT_AGE_DAYS + 10) * DAY_MS),
      event(T0 - DAY_MS),
    ];
    expect(trimEvents(events, T0)).toHaveLength(1);
  });

  it("caps the count, keeping the most recent", () => {
    const events = Array.from({ length: HISTORY.MAX_EVENTS + 50 }, (_, i) =>
      event(T0 - (HISTORY.MAX_EVENTS + 50 - i) * 1000),
    );
    const trimmed = trimEvents(events, T0);

    expect(trimmed).toHaveLength(HISTORY.MAX_EVENTS);
    expect(trimmed.at(-1)?.at).toBe(events.at(-1)?.at);
  });

  it("stays bounded across many sequential recordings", () => {
    // The property that actually matters: the store cannot grow without limit.
    let progress = defaultProgress();
    for (let i = 0; i < HISTORY.MAX_EVENTS + 200; i++) {
      progress = recordAnswer(progress, answer({ questionId: `q${i % 40}` }), T0 + i * 1000).progress;
    }
    expect(progress.events.length).toBeLessThanOrEqual(HISTORY.MAX_EVENTS);
  });
});

describe("recordAnswer — XP", () => {
  it("awards XP for a correct answer and adds it to the running total", () => {
    const { progress, xp } = recordAnswer(defaultProgress(), answer(), T0);
    expect(xp.total).toBeGreaterThan(0);
    expect(progress.gamification.xp).toBe(xp.total);
    expect(progress.daily[dayKey(T0)]?.xp).toBe(xp.total);
  });

  it("awards nothing for a wrong answer", () => {
    const { progress, xp } = recordAnswer(defaultProgress(), answer({ correct: false }), T0);
    expect(xp.total).toBe(0);
    expect(xp.skipped).toBe("incorrect");
    expect(progress.gamification.xp).toBe(0);
  });

  it("does not pay the same question twice in one day", () => {
    // The anti-farming rule, end to end through the real recording path.
    const first = recordAnswer(defaultProgress(), answer(), T0);
    const second = recordAnswer(first.progress, answer(), T0 + 60_000);

    expect(second.xp.total).toBe(0);
    expect(second.xp.skipped).toBe("already-earned-today");
    expect(second.progress.gamification.xp).toBe(first.xp.total);
  });

  it("pays the same question again the following day", () => {
    const first = recordAnswer(defaultProgress(), answer(), T0);
    const second = recordAnswer(first.progress, answer(), T0 + DAY_MS);
    expect(second.xp.total).toBeGreaterThan(0);
  });

  it("pays a revival bonus for getting a previously missed question right", () => {
    const missed = recordAnswer(
      defaultProgress(),
      answer({ correct: false, confidence: "confident" }),
      T0,
    );
    const revived = recordAnswer(missed.progress, answer(), T0 + DAY_MS);
    expect(revived.xp.revivalBonus).toBeGreaterThan(0);
  });
});

describe("recordAnswer — review counting", () => {
  it("does not count a first encounter as a review", () => {
    // New material must not qualify a streak day on its own.
    const { wasReview, progress } = recordAnswer(defaultProgress(), answer(), T0);
    expect(wasReview).toBe(false);
    expect(progress.daily[dayKey(T0)]?.reviews).toBe(0);
  });

  it("counts an answer to a question that had come due", () => {
    const first = recordAnswer(defaultProgress(), answer(), T0);
    // First answer scheduled it a day out; answer it once it is due.
    const due = first.progress.questions["quant-tvm-01-q1"]?.dueAt ?? T0;
    const second = recordAnswer(first.progress, answer(), due + 1000);

    expect(second.wasReview).toBe(true);
    expect(second.progress.daily[dayKey(due + 1000)]?.reviews).toBe(1);
  });

  it("does not count a same-session repeat as a review", () => {
    const first = recordAnswer(defaultProgress(), answer(), T0);
    const second = recordAnswer(first.progress, answer(), T0 + 30_000);
    expect(second.wasReview).toBe(false);
  });
});

describe("recordAnswer — badges", () => {
  const badgeContext = () => ({
    topics: [
      { topicId: "quant-tvm-01", domain: "quantitative-methods" as const, mastery: 0.9, started: true },
    ],
    domains: [{ domain: "quantitative-methods" as const, mastery: 0.9, topicCount: 3 }],
  });

  it("awards nothing when no context is supplied", () => {
    const { badges } = recordAnswer(defaultProgress(), answer(), T0);
    expect(badges).toEqual([]);
  });

  it("earns and persists badges the answer qualified for", () => {
    const { progress, badges } = recordAnswer(defaultProgress(), answer(), T0, { badgeContext });
    expect(badges.length).toBeGreaterThan(0);
    expect(progress.gamification.badges.map((b) => b.id)).toEqual(badges.map((b) => b.id));
  });

  it("does not re-award a badge already held", () => {
    const first = recordAnswer(defaultProgress(), answer(), T0, { badgeContext });
    const second = recordAnswer(first.progress, answer({ questionId: "quant-tvm-01-q2" }), T0, {
      badgeContext,
    });

    expect(second.badges).toEqual([]);
    expect(second.progress.gamification.badges).toHaveLength(
      first.progress.gamification.badges.length,
    );
  });
});
