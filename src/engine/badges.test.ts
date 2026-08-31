/**
 * Badge tests.
 *
 * The two calibration badges are the ones worth pinning down, because each is
 * designed to resist a specific gaming strategy: "Well Calibrated" cannot be won by
 * tagging everything Confident, and "Knows the Gaps" rewards being genuinely unsure
 * rather than just clicking Guessing on things you know.
 */

import { describe, expect, it } from "vitest";

import { BADGES, badgeById, newlyEarned, type BadgeContext } from "./badges";
import { sm2Scheduler, type QuestionState } from "./scheduler";
import type { AnswerEvent } from "../storage/progressSchema";
import type { Confidence } from "./grading";

const T0 = Date.UTC(2026, 5, 15, 12, 0, 0);

const ctx = (over: Partial<BadgeContext> = {}): BadgeContext => ({
  topics: [],
  domains: [],
  questions: [],
  events: [],
  ...over,
});

const events = (specs: { c: Confidence; ok: boolean }[]): AnswerEvent[] =>
  specs.map((spec, i) => ({
    q: `q${i}`,
    t: "quant-tvm-01",
    at: T0 + i * 1000,
    ok: spec.ok,
    c: spec.c,
    d: 3,
    g: spec.ok ? 5 : 0,
    s: 20,
  }));

const repeat = (n: number, c: Confidence, ok: boolean) =>
  Array.from({ length: n }, () => ({ c, ok }));

const has = (id: string, context: BadgeContext): boolean =>
  badgeById.get(id)?.earned(context) ?? false;

describe("badge definitions", () => {
  it("have unique ids", () => {
    const ids = BADGES.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all carry a name, description and requirement", () => {
    for (const badge of BADGES) {
      expect(badge.name.length).toBeGreaterThan(0);
      expect(badge.description.length).toBeGreaterThan(0);
      expect(badge.requirement.length).toBeGreaterThan(0);
    }
  });

  it("none are earned by an empty profile", () => {
    // A fresh install must show every badge locked.
    for (const badge of BADGES) {
      expect(badge.earned(ctx())).toBe(false);
    }
  });

  it("none reward time spent or raw volume", () => {
    // The brief was explicit. 500 answers with nothing learned earns nothing.
    const grind = ctx({ events: events(repeat(500, "confident", false)) });
    for (const badge of BADGES) {
      expect(badge.earned(grind)).toBe(false);
    }
  });
});

describe("mastery badges", () => {
  const topics = (masteries: number[]) =>
    masteries.map((mastery, i) => ({
      topicId: `t${i}`,
      domain: "quantitative-methods" as const,
      mastery,
      started: true,
    }));

  it("Groundwork needs one topic at 60%", () => {
    expect(has("groundwork", ctx({ topics: topics([0.59]) }))).toBe(false);
    expect(has("groundwork", ctx({ topics: topics([0.6]) }))).toBe(true);
  });

  it("Solid Ground needs one topic at 85%", () => {
    expect(has("solid-ground", ctx({ topics: topics([0.84]) }))).toBe(false);
    expect(has("solid-ground", ctx({ topics: topics([0.85]) }))).toBe(true);
  });

  it("Breadth needs three topics at 60%, not one very good one", () => {
    expect(has("breadth", ctx({ topics: topics([1, 1]) }))).toBe(false);
    expect(has("breadth", ctx({ topics: topics([0.6, 0.7, 0.9]) }))).toBe(true);
  });

  it("Halfway In and Domain Authority track domain mastery", () => {
    const domains = (m: number, topicCount = 3) => [
      { domain: "economics" as const, mastery: m, topicCount },
    ];
    expect(has("halfway-in", ctx({ domains: domains(0.5) }))).toBe(true);
    expect(has("domain-authority", ctx({ domains: domains(0.5) }))).toBe(false);
    expect(has("domain-authority", ctx({ domains: domains(0.8) }))).toBe(true);
  });

  it("Day Job is specific to alternatives, not any domain", () => {
    const other = ctx({ domains: [{ domain: "economics", mastery: 0.95, topicCount: 5 }] });
    const alts = ctx({ domains: [{ domain: "alternatives", mastery: 0.7, topicCount: 5 }] });
    expect(has("day-job", other)).toBe(false);
    expect(has("day-job", alts)).toBe(true);
  });
});

describe("Well Calibrated", () => {
  it("needs enough confident answers", () => {
    const few = ctx({
      events: events([...repeat(20, "confident", true), ...repeat(5, "unsure", true)]),
    });
    expect(has("well-calibrated", few)).toBe(false);
  });

  it("needs confident accuracy at 90%", () => {
    const sloppy = ctx({
      events: events([
        ...repeat(20, "confident", true),
        ...repeat(10, "confident", false),
        ...repeat(10, "unsure", true),
      ]),
    });
    expect(has("well-calibrated", sloppy)).toBe(false);
  });

  it("cannot be won by tagging everything Confident", () => {
    // 100% confident accuracy but zero admitted doubt — the clause that blocks the
    // obvious gaming strategy of never selecting Unsure or Guessing.
    const overconfident = ctx({ events: events(repeat(40, "confident", true)) });
    expect(has("well-calibrated", overconfident)).toBe(false);
  });

  it("is earned by accurate confidence plus some admitted doubt", () => {
    const good = ctx({
      events: events([
        ...repeat(27, "confident", true),
        ...repeat(1, "confident", false),
        ...repeat(6, "unsure", true),
      ]),
    });
    expect(has("well-calibrated", good)).toBe(true);
  });
});

describe("Knows the Gaps", () => {
  it("needs enough guessed answers to mean anything", () => {
    const few = ctx({ events: events(repeat(10, "guessing", false)) });
    expect(has("knows-the-gaps", few)).toBe(false);
  });

  it("is not earned by someone who guesses on things they know", () => {
    // Guessing and being right most of the time means the tag is being misused.
    const sandbagger = ctx({
      events: events([...repeat(15, "guessing", true), ...repeat(5, "guessing", false)]),
    });
    expect(has("knows-the-gaps", sandbagger)).toBe(false);
  });

  it("is earned when guesses are genuinely usually wrong", () => {
    const honest = ctx({
      events: events([...repeat(14, "guessing", false), ...repeat(4, "guessing", true)]),
    });
    expect(has("knows-the-gaps", honest)).toBe(true);
  });
});

describe("Sure Footed", () => {
  it("needs at least fifty answers", () => {
    expect(has("sure-footed", ctx({ events: events(repeat(49, "confident", true)) }))).toBe(
      false,
    );
  });

  it("is broken by a single confident miss inside the window", () => {
    const broken = ctx({
      events: events([...repeat(30, "confident", true), { c: "confident", ok: false }, ...repeat(19, "unsure", true)]),
    });
    expect(has("sure-footed", broken)).toBe(false);
  });

  it("looks only at the most recent fifty, so an old miss can be moved past", () => {
    const recovered = ctx({
      events: events([
        { c: "confident", ok: false },
        ...repeat(60, "confident", true),
      ]),
    });
    expect(has("sure-footed", recovered)).toBe(true);
  });

  it("tolerates wrong answers that were not claimed as confident", () => {
    const honest = ctx({
      events: events([...repeat(25, "confident", true), ...repeat(25, "guessing", false)]),
    });
    expect(has("sure-footed", honest)).toBe(true);
  });
});

describe("Second Time Sticks", () => {
  /** A question missed once, then answered correctly twice. */
  const recovered = (id: string): QuestionState => {
    let s = sm2Scheduler.create(id, "quant-tvm-01", 3, T0);
    s = sm2Scheduler.next(s, { correct: false, confidence: "confident" }, T0);
    s = sm2Scheduler.next(s, { correct: true, confidence: "confident" }, T0 + 86400000);
    s = sm2Scheduler.next(s, { correct: true, confidence: "confident" }, T0 + 2 * 86400000);
    return s;
  };

  it("needs ten recoveries", () => {
    const nine = ctx({ questions: Array.from({ length: 9 }, (_, i) => recovered(`q${i}`)) });
    const ten = ctx({ questions: Array.from({ length: 10 }, (_, i) => recovered(`q${i}`)) });
    expect(has("second-time-sticks", nine)).toBe(false);
    expect(has("second-time-sticks", ten)).toBe(true);
  });

  it("does not count questions that were never missed", () => {
    const clean = Array.from({ length: 20 }, (_, i) => {
      let s = sm2Scheduler.create(`q${i}`, "t", 3, T0);
      s = sm2Scheduler.next(s, { correct: true, confidence: "confident" }, T0);
      s = sm2Scheduler.next(s, { correct: true, confidence: "confident" }, T0 + 86400000);
      return s;
    });
    expect(has("second-time-sticks", ctx({ questions: clean }))).toBe(false);
  });

  it("does not count a question still in a missed state", () => {
    const stillWrong = Array.from({ length: 20 }, (_, i) => {
      let s = sm2Scheduler.create(`q${i}`, "t", 3, T0);
      s = sm2Scheduler.next(s, { correct: false, confidence: "confident" }, T0);
      return s;
    });
    expect(has("second-time-sticks", ctx({ questions: stillWrong }))).toBe(false);
  });
});

describe("newlyEarned", () => {
  const earning = ctx({
    topics: [
      { topicId: "t0", domain: "quantitative-methods", mastery: 0.9, started: true },
    ],
  });

  it("returns only badges not already held", () => {
    const first = newlyEarned(earning, [], T0);
    expect(first.map((b) => b.id).sort()).toEqual(["groundwork", "solid-ground"]);

    const second = newlyEarned(earning, first, T0);
    expect(second).toEqual([]);
  });

  it("stamps the time earned", () => {
    expect(newlyEarned(earning, [], T0)[0]?.earnedAt).toBe(T0);
  });

  it("never revokes: a mastery dip does not remove a held badge", () => {
    const held = newlyEarned(earning, [], T0);
    const dipped = ctx({
      topics: [{ topicId: "t0", domain: "quantitative-methods", mastery: 0.1, started: true }],
    });
    // newlyEarned reports additions only; the caller keeps the existing list.
    expect(newlyEarned(dipped, held, T0)).toEqual([]);
    expect(held).toHaveLength(2);
  });
});

describe("domain badges require a domain worth the name", () => {
  it("are not earned by a domain with fewer than three topics", () => {
    // Otherwise a single-topic domain awards the domain badge before the topic one,
    // which is exactly what happened the first time this shipped.
    const thin = ctx({
      domains: [{ domain: "quantitative-methods", mastery: 1, topicCount: 1 }],
    });
    expect(has("halfway-in", thin)).toBe(false);
    expect(has("domain-authority", thin)).toBe(false);
  });

  it("are earned once the domain is large enough", () => {
    const proper = ctx({
      domains: [{ domain: "quantitative-methods", mastery: 0.85, topicCount: 3 }],
    });
    expect(has("halfway-in", proper)).toBe(true);
    expect(has("domain-authority", proper)).toBe(true);
  });

  it("gates Day Job the same way", () => {
    const thin = ctx({ domains: [{ domain: "alternatives", mastery: 1, topicCount: 2 }] });
    expect(has("day-job", thin)).toBe(false);
  });
});
