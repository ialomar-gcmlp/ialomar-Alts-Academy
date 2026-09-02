/**
 * Encounter preparation (seeded choice shuffling).
 *
 * The failure modes that matter are silent corruption, not missing shuffles: a
 * rationale drifting off its choice, the answer index pointing at a wrong option
 * after the deal, or a resumed session dealing a different order than the one the
 * saved response was given against.
 */

import { describe, expect, it } from "vitest";

import { isNumericChoiceList, prepareQuestion } from "./prepare";
import { gradeAnswer } from "./grading";
import type { Question } from "../content/schema";

const mcq = (over: Partial<Extract<Question, { type: "mcq" }>> = {}): Question => ({
  id: "quant-tvm-01-q1",
  type: "mcq",
  difficulty: 2,
  tags: ["t"],
  stem: "Which statement is right?",
  explanation: "Because.",
  choices: ["alpha", "bravo", "charlie", "delta"],
  answerIndex: 2,
  rationales: ["why alpha is wrong", "why bravo is wrong", "why charlie is RIGHT", "why delta is wrong"],
  ...over,
});

const tfj = (): Question => ({
  id: "fsa-ebitda-01-q4",
  type: "tfj",
  difficulty: 3,
  tags: ["t"],
  stem: "True or false?",
  explanation: "Because.",
  isTrue: false,
  justifications: ["j0", "j1 CORRECT", "j2", "j3"],
  justificationIndex: 1,
  rationales: ["r0", "r1 right", "r2", "r3"],
});

const T0 = 1_800_000_000_000;

/** A seed that actually moves this question's choices, found rather than assumed. */
function movingSeed(question: Question): number {
  for (let k = 0; k < 50; k++) {
    const dealt = prepareQuestion(question, T0 + k);
    if (question.type === "mcq" && dealt.type === "mcq") {
      if (dealt.choices.join() !== question.choices.join()) return T0 + k;
    }
  }
  throw new Error("no seed moved the choices in 50 tries — shuffle is broken");
}

describe("prepareQuestion — mcq family", () => {
  it("keeps every rationale glued to its choice through the deal", () => {
    // The schema's index alignment is what makes "why the one you picked is wrong"
    // possible; a shuffle that broke it would diagnose the wrong misconception.
    const base = mcq();
    for (let k = 0; k < 10; k++) {
      const dealt = prepareQuestion(base, T0 + k);
      if (dealt.type !== "mcq") throw new Error("type changed");
      dealt.choices.forEach((choice, i) => {
        const word = choice; // "alpha" etc.
        expect(dealt.rationales[i]).toContain(word === "charlie" ? "charlie is RIGHT" : `${word} is wrong`);
      });
    }
  });

  it("moves answerIndex with the correct choice", () => {
    const base = mcq();
    const dealt = prepareQuestion(base, movingSeed(base));
    if (dealt.type !== "mcq") throw new Error("type changed");
    expect(dealt.choices[dealt.answerIndex]).toBe("charlie");
  });

  it("grades the dealt question consistently with the displayed order", () => {
    const base = mcq();
    const dealt = prepareQuestion(base, movingSeed(base));
    if (dealt.type !== "mcq") throw new Error("type changed");
    const right = gradeAnswer(dealt, { kind: "choice", choiceIndex: dealt.answerIndex });
    const wrong = gradeAnswer(dealt, { kind: "choice", choiceIndex: (dealt.answerIndex + 1) % 4 });
    expect(right.correct).toBe(true);
    expect(wrong.correct).toBe(false);
  });

  it("is deterministic for a given session start — what makes resume safe", () => {
    // A resumed session re-deals from (question id, startedAt) stored in the
    // snapshot; the saved response index only stays meaningful if the deal repeats.
    const a = prepareQuestion(mcq(), T0 + 12345);
    const b = prepareQuestion(mcq(), T0 + 12345);
    expect(a).toEqual(b);
  });

  it("deals differently across sessions, at least sometimes", () => {
    const orders = new Set<string>();
    for (let k = 0; k < 12; k++) {
      const dealt = prepareQuestion(mcq(), T0 + k * 60_000);
      if (dealt.type === "mcq") orders.add(dealt.choices.join("|"));
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it("gives different questions different deals in the same session", () => {
    const q1 = prepareQuestion(mcq({ id: "quant-tvm-01-q1" }), T0);
    const q2 = prepareQuestion(mcq({ id: "quant-tvm-01-q2" }), T0);
    // Not guaranteed for one pair in general, but with this fixed seed it must hold;
    // if it ever fails, the per-question half of the seed has stopped contributing.
    if (q1.type !== "mcq" || q2.type !== "mcq") throw new Error("type changed");
    expect(q1.choices.join() !== q2.choices.join() || q1.answerIndex !== q2.answerIndex).toBe(
      true,
    );
  });

  it("leaves numeric option lists in authored order", () => {
    const base = mcq({
      choices: ["$1,250", "$1,375", "$1,500", "$1,625"],
      answerIndex: 1,
      rationales: ["a", "b", "c", "d"],
    });
    for (let k = 0; k < 8; k++) {
      expect(prepareQuestion(base, T0 + k)).toBe(base);
    }
  });
});

describe("prepareQuestion — tfj", () => {
  it("shuffles justifications with their rationales and remaps the index", () => {
    const base = tfj();
    let moved = false;
    for (let k = 0; k < 20; k++) {
      const dealt = prepareQuestion(base, T0 + k);
      if (dealt.type !== "tfj") throw new Error("type changed");
      expect(dealt.isTrue).toBe(false); // the verdict never moves
      expect(dealt.justifications[dealt.justificationIndex]).toBe("j1 CORRECT");
      expect(dealt.rationales[dealt.justificationIndex]).toBe("r1 right");
      if (base.type === "tfj" && dealt.justifications.join() !== base.justifications.join())
        moved = true;
    }
    expect(moved).toBe(true);
  });
});

describe("prepareQuestion — types with nothing to shuffle", () => {
  it("returns numeric questions untouched (for now — variants are their defence)", () => {
    const numeric: Question = {
      id: "quant-tvm-01-q2",
      type: "numeric",
      difficulty: 2,
      tags: ["t"],
      stem: "Compute.",
      explanation: "Worked.",
      answer: 42,
      tolerance: 0.1,
      toleranceType: "abs",
    };
    expect(prepareQuestion(numeric, T0)).toBe(numeric);
  });
});

describe("isNumericChoiceList", () => {
  it("recognises money, percentages, multiples and units", () => {
    expect(isNumericChoiceList(["$1,250", "8.5%", "2.0x", "45 bps"])).toBe(true);
    expect(isNumericChoiceList(["1.2 years", "3 years"])).toBe(true);
  });

  it("rejects lists with any prose in them", () => {
    expect(isNumericChoiceList(["8%", "20%", "It depends on the hurdle"])).toBe(false);
    expect(isNumericChoiceList([])).toBe(false);
  });
});
