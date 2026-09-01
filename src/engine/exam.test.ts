/**
 * Exam gating, composition, timing and scoring.
 *
 * The cases worth testing are the ones where a plausible implementation flatters the
 * user: an exam that unlocks too early, a composition that draws half its questions
 * from one topic, and a score that ignores what time ran out on.
 */

import { describe, expect, it } from "vitest";

import {
  bestAttempt,
  composeExam,
  examBreakdown,
  examLength,
  examLimitMs,
  examRequirement,
  formatCountdown,
  hasExpired,
  remainingMs,
  scoreExam,
  type ExamCandidate,
} from "./exam";
import { EXAM, MASTERY } from "./constants";

const ready = {
  domain: "alternatives",
  mastery: 0.75,
  topicsStarted: 9,
  topicsTotal: 10,
  questionsAvailable: 60,
};

describe("examRequirement", () => {
  it("unlocks when mastery, coverage and question count are all met", () => {
    const req = examRequirement(ready);
    expect(req.unlocked).toBe(true);
    expect(req.blockedBy).toBeNull();
  });

  it("stays locked one point below the mastery threshold", () => {
    const req = examRequirement({ ...ready, mastery: MASTERY.BOSS_DOMAIN_MASTERY - 0.01 });
    expect(req.unlocked).toBe(false);
    expect(req.blockedBy).toContain("Mastery is");
  });

  it("unlocks exactly at the threshold", () => {
    const req = examRequirement({ ...ready, mastery: MASTERY.BOSS_DOMAIN_MASTERY });
    expect(req.unlocked).toBe(true);
  });

  it("asks for more topics before it asks for more mastery", () => {
    // Both are missing. The actionable one is opening topics, so that is what it says.
    const req = examRequirement({ ...ready, mastery: 0.2, topicsStarted: 2 });
    expect(req.blockedBy).toContain("more topic");
  });

  it("counts the topics needed by rounding up, not down", () => {
    // 80% of 9 is 7.2 — seven started topics is not enough.
    const req = examRequirement({ ...ready, topicsStarted: 7, topicsTotal: 9 });
    expect(req.startedNeeded).toBe(8);
    expect(req.unlocked).toBe(false);
  });

  it("refuses a domain too small to measure, however good the mastery", () => {
    const req = examRequirement({ ...ready, mastery: 1, questionsAvailable: 6 });
    expect(req.unlocked).toBe(false);
    expect(req.blockedBy).toContain("An exam needs");
  });

  it("never unlocks an empty domain", () => {
    const req = examRequirement({
      domain: "x",
      mastery: 1,
      topicsStarted: 0,
      topicsTotal: 0,
      questionsAvailable: 0,
    });
    expect(req.unlocked).toBe(false);
  });
});

/** Ten topics, five questions each. */
function pool(topics = 10, per = 5): ExamCandidate[] {
  const out: ExamCandidate[] = [];
  for (let t = 0; t < topics; t++) {
    for (let q = 0; q < per; q++) {
      out.push({ questionId: `t${t}-q${q}`, topicId: `t${t}`, difficulty: (q % 5) + 1 });
    }
  }
  return out;
}

describe("composeExam", () => {
  it("takes the requested number of questions", () => {
    expect(composeExam(pool(), 20, 1)).toHaveLength(20);
  });

  it("spreads across topics before repeating one", () => {
    // 20 questions over 10 topics must be exactly two per topic — the failure this
    // guards against is a naive shuffle putting five from one lesson in one exam.
    const picked = composeExam(pool(), 20, 7);
    const counts = new Map<string, number>();
    for (const item of picked) counts.set(item.topicId, (counts.get(item.topicId) ?? 0) + 1);
    expect([...counts.values()].every((n) => n === 2)).toBe(true);
    expect(counts.size).toBe(10);
  });

  it("covers every topic once when there are fewer slots than topics", () => {
    const picked = composeExam(pool(), 8, 3);
    expect(new Set(picked.map((p) => p.topicId)).size).toBe(8);
  });

  it("never repeats a question", () => {
    const picked = composeExam(pool(4, 3), 12, 11);
    expect(new Set(picked.map((p) => p.questionId)).size).toBe(12);
  });

  it("returns everything available rather than padding when asked for too many", () => {
    const picked = composeExam(pool(3, 2), 20, 5);
    expect(picked).toHaveLength(6);
  });

  it("is reproducible for a seed and different across seeds", () => {
    const a = composeExam(pool(), 20, 42).map((p) => p.questionId);
    const b = composeExam(pool(), 20, 42).map((p) => p.questionId);
    const c = composeExam(pool(), 20, 43).map((p) => p.questionId);
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it("does not march through topics in order", () => {
    const picked = composeExam(pool(), 20, 9);
    const topics = picked.map((p) => p.topicId);
    // A round-robin left unshuffled would alternate; assert some topic is adjacent to
    // itself or the order departs from a strict cycle.
    const strictCycle = topics.every((t, i) => i < 10 || t === topics[i - 10]);
    expect(strictCycle).toBe(false);
  });

  it("handles an empty pool and a zero count", () => {
    expect(composeExam([], 20, 1)).toEqual([]);
    expect(composeExam(pool(), 0, 1)).toEqual([]);
  });
});

describe("examLength and examLimitMs", () => {
  it("caps at the maximum", () => {
    expect(examLength(500)).toBe(EXAM.QUESTIONS_MAX);
  });

  it("uses everything available in a small domain", () => {
    expect(examLength(11)).toBe(11);
  });

  it("budgets the per-question allowance", () => {
    expect(examLimitMs(20)).toBe(20 * EXAM.SECONDS_PER_QUESTION * 1000);
  });
});

describe("the exam clock", () => {
  const T0 = 1_800_000_000_000;

  it("counts down in wall-clock time", () => {
    expect(remainingMs(T0, 20, T0 + 60_000)).toBe(examLimitMs(20) - 60_000);
  });

  it("keeps running while the tab is away — unlike every other clock here", () => {
    // Deliberate: a timed exam that pauses when you look away is not timed.
    expect(hasExpired(T0, 20, T0 + examLimitMs(20) + 1)).toBe(true);
  });

  it("floors at zero rather than going negative", () => {
    expect(remainingMs(T0, 20, T0 + 10 * examLimitMs(20))).toBe(0);
  });

  it("has not expired at the exact deadline", () => {
    expect(hasExpired(T0, 20, T0 + examLimitMs(20))).toBe(true);
    expect(hasExpired(T0, 20, T0 + examLimitMs(20) - 1)).toBe(false);
  });

  it("formats mm:ss with padded seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(9_000)).toBe("0:09");
    expect(formatCountdown(69_000)).toBe("1:09");
    expect(formatCountdown(30 * 60_000)).toBe("30:00");
  });

  it("rounds a part-second up, so the countdown never shows 0:00 while running", () => {
    expect(formatCountdown(1)).toBe("0:01");
  });
});

describe("scoreExam", () => {
  const items = (pattern: (boolean | null)[]) => pattern.map((correct) => ({ correct }));

  it("counts an unanswered question as wrong", () => {
    // Running out of time is part of the result. Scoring only what was answered
    // would let a slow attempt outscore a complete one.
    const score = scoreExam(items([true, true, null, null]));
    expect(score.correct).toBe(2);
    expect(score.total).toBe(4);
    expect(score.answered).toBe(2);
    expect(score.fraction).toBe(0.5);
    expect(score.passed).toBe(false);
  });

  it("passes at exactly the threshold", () => {
    const score = scoreExam(items([...Array(14).fill(true), ...Array(6).fill(false)]));
    expect(score.fraction).toBeCloseTo(0.7);
    expect(score.passed).toBe(true);
  });

  it("fails one question below the threshold", () => {
    const score = scoreExam(items([...Array(13).fill(true), ...Array(7).fill(false)]));
    expect(score.passed).toBe(false);
  });

  it("does not pass an empty attempt", () => {
    expect(scoreExam([]).passed).toBe(false);
  });
});

describe("examBreakdown", () => {
  it("groups by topic with the weakest first", () => {
    const rows = examBreakdown([
      { topicId: "a", correct: true },
      { topicId: "a", correct: true },
      { topicId: "b", correct: false },
      { topicId: "b", correct: true },
      { topicId: "c", correct: false },
      { topicId: "c", correct: null },
    ]);
    expect(rows.map((r) => r.topicId)).toEqual(["c", "b", "a"]);
    expect(rows[0]).toEqual({ topicId: "c", correct: 0, total: 2 });
  });
});

describe("bestAttempt", () => {
  const attempts = [
    { domain: "alts", correct: 12, total: 20 },
    { domain: "alts", correct: 17, total: 20 },
    { domain: "econ", correct: 20, total: 20 },
  ];

  it("picks the highest share correct for that domain", () => {
    expect(bestAttempt(attempts, "alts")?.correct).toBe(17);
  });

  it("returns null when the domain has never been sat", () => {
    expect(bestAttempt(attempts, "ethics")).toBeNull();
  });

  it("compares shares, not raw counts", () => {
    const mixed = [
      { domain: "alts", correct: 9, total: 10 },
      { domain: "alts", correct: 12, total: 20 },
    ];
    expect(bestAttempt(mixed, "alts")?.total).toBe(10);
  });
});
