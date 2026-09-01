/**
 * Vignette flattening.
 *
 * The cases that matter are the ones that would corrupt scheduling or budgeting
 * silently: a sub that loses its inheritance, a parent id leaking into the
 * schedulable set, and the case-reading cost landing on the wrong sub (or on all
 * of them).
 */

import { describe, expect, it } from "vitest";

import {
  flattenQuestions,
  groupVignetteSiblings,
  schedulableCount,
} from "./flatten";
import { DEFAULT_QUESTION_SECONDS } from "./timing";
import type { Question } from "./schema";

const mcq = (id: string, over: Partial<Extract<Question, { type: "mcq" }>> = {}): Question => ({
  id,
  type: "mcq",
  difficulty: 2,
  tags: ["t"],
  stem: "Standalone?",
  explanation: "Because.",
  choices: ["a", "b"],
  answerIndex: 0,
  rationales: ["right", "wrong"],
  ...over,
});

const vignette = (): Question => ({
  id: "funds-case-01-q1",
  type: "vignette",
  difficulty: 4,
  tags: ["waterfall"],
  concept: "waterfall-mechanics",
  explanation: "Case-level explanation.",
  needsReview: true,
  reviewNote: "verify the carry figure",
  stem: "An LP commits 100 to a fund. ".repeat(20), // ~120 words of case
  exhibits: [
    { kind: "text", title: "Terms", body: "Carry 20% over an 8% hurdle." },
    {
      kind: "table",
      title: "Cash flows",
      headers: ["Year", "Amount"],
      rows: [
        ["1", "-50"],
        ["4", "130"],
      ],
    },
  ],
  subQuestions: [
    {
      id: "funds-case-01-q1a",
      type: "mcq",
      stem: "What is the hurdle?",
      explanation: "It is 8%.",
      choices: ["8%", "20%"],
      answerIndex: 0,
      rationales: ["yes", "that is the carry"],
    },
    {
      id: "funds-case-01-q1b",
      type: "numeric",
      stem: "Compute the carry.",
      explanation: "Worked in the lesson.",
      answer: 6,
      tolerance: 0.1,
      toleranceType: "abs",
    },
    {
      id: "funds-case-01-q1c",
      type: "mcq",
      stem: "Who bears the clawback risk?",
      explanation: "The GP.",
      choices: ["GP", "LP"],
      answerIndex: 0,
      rationales: ["yes", "no"],
    },
  ],
});

describe("flattenQuestions", () => {
  it("passes standalone questions through untouched", () => {
    const q = mcq("a-01-q1");
    const flat = flattenQuestions([q]);
    expect(flat).toEqual([{ question: q, vignette: null }]);
  });

  it("explodes a vignette into its subs and never emits the parent", () => {
    const flat = flattenQuestions([vignette()]);
    expect(flat.map((f) => f.question.id)).toEqual([
      "funds-case-01-q1a",
      "funds-case-01-q1b",
      "funds-case-01-q1c",
    ]);
    expect(flat.every((f) => f.question.type !== "vignette")).toBe(true);
  });

  it("subs inherit difficulty, tags, concept and the review flag from the parent", () => {
    // These live only on the parent in the authored file; losing them would make a
    // hard case schedule as difficulty undefined and drop off the review queue.
    const flat = flattenQuestions([vignette()]);
    for (const f of flat) {
      expect(f.question.difficulty).toBe(4);
      expect(f.question.tags).toEqual(["waterfall"]);
      expect(f.question.concept).toBe("waterfall-mechanics");
      expect(f.question.needsReview).toBe(true);
      expect(f.question.reviewNote).toBe("verify the carry figure");
    }
  });

  it("keeps each sub's own stem, answer fields and explanation", () => {
    const flat = flattenQuestions([vignette()]);
    const numeric = flat[1]?.question;
    expect(numeric?.type).toBe("numeric");
    if (numeric?.type !== "numeric") return;
    expect(numeric.answer).toBe(6);
    expect(numeric.explanation).toBe("Worked in the lesson.");
  });

  it("attaches the case to every sub with position and total", () => {
    const flat = flattenQuestions([vignette()]);
    expect(flat.map((f) => f.vignette?.index)).toEqual([1, 2, 3]);
    expect(flat.every((f) => f.vignette?.total === 3)).toBe(true);
    expect(flat.every((f) => f.vignette?.id === "funds-case-01-q1")).toBe(true);
    expect(flat[0]?.vignette?.exhibits).toHaveLength(2);
  });

  it("charges the case-reading time to the first sub only", () => {
    // Charging it to all subs would make the composer think a 4-question case costs
    // four readings; charging it to none would blow the session budget instead.
    const flat = flattenQuestions([vignette()]);
    const first = flat[0]?.question.estSeconds ?? 0;
    const second = flat[1]?.question.estSeconds ?? 0;
    const third = flat[2]?.question.estSeconds ?? 0;

    expect(first).toBeGreaterThan(DEFAULT_QUESTION_SECONDS.mcq);
    expect(second).toBe(DEFAULT_QUESTION_SECONDS.numeric);
    expect(third).toBe(DEFAULT_QUESTION_SECONDS.mcq);
  });

  it("preserves surrounding standalone questions in order", () => {
    const flat = flattenQuestions([mcq("a-01-q1"), vignette(), mcq("a-01-q9")]);
    expect(flat.map((f) => f.question.id)).toEqual([
      "a-01-q1",
      "funds-case-01-q1a",
      "funds-case-01-q1b",
      "funds-case-01-q1c",
      "a-01-q9",
    ]);
  });
});

describe("schedulableCount", () => {
  it("counts subs, not the vignette parent", () => {
    // Off-by-one per vignette here breaks mastery's coverage share: states exist for
    // 3 subs, so a count of 4 (parent included) could never reach full coverage.
    expect(schedulableCount([vignette()])).toBe(3);
    expect(schedulableCount([mcq("a-01-q1"), vignette()])).toBe(4);
    expect(schedulableCount([])).toBe(0);
  });
});

describe("groupVignetteSiblings", () => {
  it("pulls scattered siblings together at the first one met, in case order", () => {
    const flat = flattenQuestions([vignette(), mcq("a-01-q1"), mcq("a-01-q2")]);
    const [subA, subB, subC, lone1, lone2] = flat as [
      (typeof flat)[0],
      (typeof flat)[0],
      (typeof flat)[0],
      (typeof flat)[0],
      (typeof flat)[0],
    ];
    // Dueness ordering interleaved them, and put a later sub first.
    const shuffled = [subC, lone1, subA, lone2, subB];

    const grouped = groupVignetteSiblings(shuffled);
    expect(grouped.map((f) => f.question.id)).toEqual([
      "funds-case-01-q1a",
      "funds-case-01-q1b",
      "funds-case-01-q1c",
      "a-01-q1",
      "a-01-q2",
    ]);
  });

  it("leaves a list with no vignettes alone", () => {
    const flat = flattenQuestions([mcq("a-01-q1"), mcq("a-01-q2")]);
    expect(groupVignetteSiblings(flat)).toEqual(flat);
  });

  it("does not invent siblings that were not in the session", () => {
    // Only sub B is due: the session gets sub B alone (with its case for context),
    // not the whole vignette dragged back in.
    const flat = flattenQuestions([vignette()]);
    const onlyB = [flat[1] as (typeof flat)[0]];
    expect(groupVignetteSiblings(onlyB).map((f) => f.question.id)).toEqual([
      "funds-case-01-q1b",
    ]);
  });
});
