/**
 * Mastery tests.
 *
 * The headline case is the monotonicity invariant — evaluated at one instant, a
 * correct answer must never lower mastery — checked both directly and by brute
 * force over a long random answer sequence. That property is what makes the number
 * trustworthy enough to gate topic unlocks on.
 */

import { describe, expect, it } from "vitest";

import { DAY_MS, MASTERY } from "./constants";
import type { Confidence } from "./grading";
import {
  blockingPrereqs,
  bossUnlocked,
  domainMastery,
  evidenceStrength,
  geometricMean,
  isUnlocked,
  topicMastery,
  weakAreas,
} from "./mastery";
import { sm2Scheduler, type QuestionState } from "./scheduler";

const T0 = Date.UTC(2026, 0, 1, 9, 0, 0);

const make = (id: string, difficulty = 3): QuestionState =>
  sm2Scheduler.create(id, "quant-tvm-01", difficulty, T0);

const answer = (
  s: QuestionState,
  correct: boolean,
  confidence: Confidence,
  now: number,
): QuestionState => sm2Scheduler.next(s, { correct, confidence }, now);

/** Answer a question correctly and confidently `times` times, spaced by its interval. */
function drill(id: string, times: number, from = T0): { state: QuestionState; now: number } {
  let state = make(id);
  let now = from;
  for (let i = 0; i < times; i++) {
    state = answer(state, true, "confident", now);
    now += state.intervalDays * DAY_MS;
  }
  return { state, now };
}

describe("geometricMean", () => {
  it("returns zero if any component is zero", () => {
    // The reason for choosing it: no component can be compensated for by another.
    expect(geometricMean([0, 1, 1], [1, 1, 1])).toBe(0);
    expect(geometricMean([0.5, 0, 0.9], [1, 1, 1])).toBe(0);
  });

  it("returns the shared value when all components agree", () => {
    expect(geometricMean([0.64, 0.64, 0.64], [1, 1, 1])).toBeCloseTo(0.64, 6);
  });

  it("sits below the arithmetic mean when components disagree", () => {
    const g = geometricMean([0.2, 0.9, 0.9], [1, 1, 1]);
    expect(g).toBeLessThan((0.2 + 0.9 + 0.9) / 3);
  });
});

describe("evidenceStrength", () => {
  it("is full strength for an answer given right now", () => {
    expect(evidenceStrength(T0, T0)).toBe(1);
  });

  it("halves at the half-life", () => {
    const halfLife = T0 + MASTERY.RETENTION_HALF_LIFE_DAYS * DAY_MS;
    expect(evidenceStrength(T0, halfLife)).toBeCloseTo(0.5, 6);
  });

  it("is zero when there is no answer at all", () => {
    expect(evidenceStrength(null, T0)).toBe(0);
  });
});

describe("topicMastery", () => {
  it("is zero for a topic never touched", () => {
    const m = topicMastery("quant-tvm-01", [], 9, T0);
    expect(m.mastery).toBe(0);
    expect(m.started).toBe(false);
  });

  it("stays low after a single correct answer to one of nine questions", () => {
    // One right answer is not one-ninth of mastery — coverage is low AND nothing
    // has been retained over time yet.
    const m = topicMastery("quant-tvm-01", [answer(make("q1"), true, "confident", T0)], 9, T0);
    expect(m.started).toBe(true);
    expect(m.coverage).toBeCloseTo(1 / 9, 6);
    expect(m.mastery).toBeLessThan(0.3);
  });

  it("reaches high mastery only after sustained, spaced, correct practice", () => {
    const states: QuestionState[] = [];
    let latest = T0;
    for (let i = 0; i < 9; i++) {
      const { state, now } = drill(`q${i}`, 6);
      states.push(state);
      latest = Math.max(latest, now);
    }
    // Evaluate right after the last answer, so nothing has gone stale.
    const evalAt = Math.max(...states.map((s) => s.lastAnsweredAt ?? T0));
    const m = topicMastery("quant-tvm-01", states, 9, evalAt);

    expect(m.coverage).toBe(1);
    expect(m.stability).toBe(1);
    expect(m.mastery).toBeGreaterThan(0.9);
  });

  it("decays when a topic is neglected", () => {
    const { state } = drill("q1", 4);
    const answeredAt = state.lastAnsweredAt ?? T0;

    const fresh = topicMastery("t", [state], 1, answeredAt).mastery;
    const stale = topicMastery(
      "t",
      [state],
      1,
      answeredAt + 4 * MASTERY.RETENTION_HALF_LIFE_DAYS * DAY_MS,
    ).mastery;

    expect(stale).toBeLessThan(fresh);
    expect(stale).toBeGreaterThan(0);
  });

  it("weights harder questions more heavily", () => {
    // Same evidence, but the failing question is the hard one in the second topic.
    const easyWrong = [
      answer(make("q1", 1), false, "unsure", T0),
      answer(make("q2", 5), true, "confident", T0),
    ];
    const hardWrong = [
      answer(make("q1", 1), true, "confident", T0),
      answer(make("q2", 5), false, "unsure", T0),
    ];

    const a = topicMastery("t", easyWrong, 2, T0);
    const b = topicMastery("t", hardWrong, 2, T0);
    expect(a.retention).toBeGreaterThan(b.retention);
  });

  it("counts unanswered questions against coverage", () => {
    const states = [answer(make("q1"), true, "confident", T0)];
    const narrow = topicMastery("t", states, 1, T0);
    const wide = topicMastery("t", states, 20, T0);
    expect(wide.mastery).toBeLessThan(narrow.mastery);
  });
});

describe("monotonicity — a correct answer must never lower mastery", () => {
  it("holds for each confidence level on a single question", () => {
    for (const confidence of ["confident", "unsure", "guessing"] as const) {
      let state = make("q1");
      let now = T0;

      for (let rep = 0; rep < 8; rep++) {
        const before = topicMastery("t", [state], 4, now).mastery;
        const after = sm2Scheduler.next(state, { correct: true, confidence }, now);
        const afterMastery = topicMastery("t", [after], 4, now).mastery;

        expect(afterMastery).toBeGreaterThanOrEqual(before);
        state = after;
        now += Math.max(1, state.intervalDays) * DAY_MS;
      }
    }
  });

  it("holds across a long mixed sequence of answers and questions", () => {
    // Brute force, deterministic: a small LCG rather than Math.random, so a failure
    // is reproducible.
    let seed = 12345;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    const confidences: Confidence[] = ["confident", "unsure", "guessing"];
    const states = new Map<string, QuestionState>();
    for (let i = 0; i < 6; i++) states.set(`q${i}`, make(`q${i}`, 1 + (i % 5)));

    let now = T0;
    for (let step = 0; step < 400; step++) {
      const id = `q${Math.floor(rand() * 6)}`;
      const state = states.get(id);
      if (!state) continue;

      const correct = rand() < 0.6;
      const confidence = confidences[Math.floor(rand() * 3)] ?? "unsure";

      const before = topicMastery("t", [...states.values()], 6, now).mastery;
      states.set(id, sm2Scheduler.next(state, { correct, confidence }, now));
      const after = topicMastery("t", [...states.values()], 6, now).mastery;

      if (correct) {
        expect(after).toBeGreaterThanOrEqual(before - 1e-12);
      }

      now += Math.floor(rand() * 3) * DAY_MS;
    }
  });
});

describe("domainMastery", () => {
  it("is zero with no topics", () => {
    expect(domainMastery([])).toBe(0);
  });

  it("weights topics by their question count", () => {
    const value = domainMastery([
      { mastery: 1, totalQuestions: 9 },
      { mastery: 0, totalQuestions: 3 },
    ]);
    expect(value).toBeCloseTo(9 / 12, 6);
  });

  it("counts an untouched topic as zero rather than ignoring it", () => {
    // A domain is not mastered because you did well in the one topic you opened.
    const partial = domainMastery([
      { mastery: 1, totalQuestions: 10 },
      { mastery: 0, totalQuestions: 10 },
    ]);
    expect(partial).toBeCloseTo(0.5, 6);
  });
});

describe("unlock gates", () => {
  const mastery = new Map([
    ["quant-tvm-01", 0.8],
    ["econ-curve-01", 0.4],
  ]);

  it("opens a topic with no prerequisites", () => {
    expect(isUnlocked([], mastery)).toBe(true);
  });

  it("opens a topic once every prerequisite clears the threshold", () => {
    expect(isUnlocked(["quant-tvm-01"], mastery)).toBe(true);
  });

  it("keeps a topic shut when any prerequisite is short", () => {
    expect(isUnlocked(["quant-tvm-01", "econ-curve-01"], mastery)).toBe(false);
  });

  it("treats an unknown prerequisite as unmet rather than met", () => {
    // Failing open here would silently defeat the whole prerequisite graph.
    expect(isUnlocked(["never-heard-of-it-01"], mastery)).toBe(false);
  });

  it("names which prerequisites are blocking, so the UI can explain the lock", () => {
    expect(blockingPrereqs(["quant-tvm-01", "econ-curve-01"], mastery)).toEqual([
      "econ-curve-01",
    ]);
  });

  it("sits exactly on the threshold as unlocked", () => {
    const edge = new Map([["a-b-01", MASTERY.UNLOCK_THRESHOLD]]);
    expect(isUnlocked(["a-b-01"], edge)).toBe(true);
  });
});

describe("bossUnlocked", () => {
  it("needs both domain mastery and breadth of topics started", () => {
    expect(bossUnlocked(0.75, 9, 10)).toBe(true);
    expect(bossUnlocked(0.65, 10, 10)).toBe(false); // mastery short
    expect(bossUnlocked(0.75, 5, 10)).toBe(false); // breadth short
  });

  it("is shut for an empty domain", () => {
    expect(bossUnlocked(1, 0, 0)).toBe(false);
  });
});

describe("weakAreas", () => {
  it("returns started, shaky topics weakest first", () => {
    const topics = [
      { topicId: "a", mastery: 0.9, started: true },
      { topicId: "b", mastery: 0.2, started: true },
      { topicId: "c", mastery: 0.4, started: true },
      { topicId: "d", mastery: 0, started: false },
    ].map((t) => ({ ...t, coverage: 0, retention: 0, stability: 0, attempted: 1, totalQuestions: 5 }));

    // 'd' is excluded: never started is a gap to learn, not a weakness to drill.
    expect(weakAreas(topics).map((t) => t.topicId)).toEqual(["b", "c"]);
  });
});
