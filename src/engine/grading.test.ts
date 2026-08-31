/**
 * Grading tests.
 *
 * The full scheduler and mastery suite lands in M2. These cover the part that is
 * already live and already able to be wrong in a way the user would not notice: a
 * numeric answer accepted or rejected at the tolerance boundary, and true/false
 * questions that must require the reasoning as well as the verdict.
 */

import { describe, expect, it } from "vitest";

import type { Question } from "../content/schema";
import { gradeAnswer, isAnswerable, parseNumericInput, withinTolerance } from "./grading";

const mcq: Question = {
  id: "quant-tvm-01-q1",
  type: "mcq",
  difficulty: 2,
  tags: ["tvm"],
  explanation: "because",
  stem: "stem",
  choices: ["a", "b", "c"],
  answerIndex: 2,
  rationales: ["ra", "rb", "rc"],
};

const numeric: Question = {
  id: "quant-tvm-01-q2",
  type: "numeric",
  difficulty: 2,
  tags: ["tvm"],
  explanation: "because",
  stem: "stem",
  answer: 5955.08,
  tolerance: 1,
  toleranceType: "abs",
};

const tfj: Question = {
  id: "quant-tvm-01-q3",
  type: "tfj",
  difficulty: 3,
  tags: ["tvm"],
  explanation: "because",
  stem: "stem",
  isTrue: false,
  justifications: ["right reason", "wrong reason", "other"],
  justificationIndex: 0,
  rationales: ["r0", "r1", "r2"],
};

describe("withinTolerance", () => {
  it("accepts an exact answer", () => {
    expect(withinTolerance(100, 100, 0, "abs")).toBe(true);
  });

  it("accepts the tolerance boundary rather than rejecting it", () => {
    // A user who is exactly one unit out on a +/-1 question should pass, not fail
    // on a floating point hair.
    expect(withinTolerance(101, 100, 1, "abs")).toBe(true);
    expect(withinTolerance(99, 100, 1, "abs")).toBe(true);
  });

  it("rejects just outside the tolerance", () => {
    expect(withinTolerance(101.5, 100, 1, "abs")).toBe(false);
  });

  it("scales relative tolerance by the answer", () => {
    expect(withinTolerance(102, 100, 0.02, "rel")).toBe(true);
    expect(withinTolerance(103, 100, 0.02, "rel")).toBe(false);
  });

  it("handles a negative answer under relative tolerance", () => {
    // -37 bps with 2% tolerance: the band is 2% of |−37|, not of −37.
    expect(withinTolerance(-37.5, -37, 0.02, "rel")).toBe(true);
    expect(withinTolerance(-40, -37, 0.02, "rel")).toBe(false);
  });

  it("rejects non-finite input", () => {
    expect(withinTolerance(Number.NaN, 100, 1, "abs")).toBe(false);
    expect(withinTolerance(Number.POSITIVE_INFINITY, 100, 1, "abs")).toBe(false);
  });
});

describe("parseNumericInput", () => {
  it("accepts a plain number", () => {
    expect(parseNumericInput("5955.08")).toBe(5955.08);
  });

  it("tolerates the formatting a person actually types", () => {
    expect(parseNumericInput("$5,955.08")).toBe(5955.08);
    expect(parseNumericInput(" 11.6% ")).toBe(11.6);
    expect(parseNumericInput("-37")).toBe(-37);
  });

  it("returns null for input that is not yet a number", () => {
    expect(parseNumericInput("")).toBeNull();
    expect(parseNumericInput("-")).toBeNull();
    expect(parseNumericInput(".")).toBeNull();
    expect(parseNumericInput("abc")).toBeNull();
  });
});

describe("gradeAnswer — multiple choice", () => {
  it("marks the right choice correct and reports both indexes", () => {
    const grade = gradeAnswer(mcq, { kind: "choice", choiceIndex: 2 });
    expect(grade).toEqual({
      correct: true,
      pickedRationaleIndex: 2,
      correctIndex: 2,
      incomplete: false,
    });
  });

  it("reports which wrong choice was picked, so the UI can explain that one", () => {
    const grade = gradeAnswer(mcq, { kind: "choice", choiceIndex: 0 });
    expect(grade.correct).toBe(false);
    expect(grade.pickedRationaleIndex).toBe(0);
    expect(grade.correctIndex).toBe(2);
  });

  it("treats a missing response as incomplete rather than wrong", () => {
    // The distinction matters: an unanswered question must not be scored or scheduled.
    expect(gradeAnswer(mcq, null).incomplete).toBe(true);
    expect(gradeAnswer(mcq, { kind: "choice", choiceIndex: -1 }).incomplete).toBe(true);
  });
});

describe("gradeAnswer — numeric", () => {
  it("accepts an answer inside tolerance", () => {
    expect(gradeAnswer(numeric, { kind: "numeric", value: 5955.5, raw: "5955.5" }).correct).toBe(
      true,
    );
  });

  it("rejects an answer outside tolerance", () => {
    expect(gradeAnswer(numeric, { kind: "numeric", value: 5900, raw: "5900" }).correct).toBe(false);
  });

  it("is incomplete when the field has not parsed to a number", () => {
    expect(gradeAnswer(numeric, { kind: "numeric", value: null, raw: "-" }).incomplete).toBe(true);
  });
});

describe("gradeAnswer — true/false with justification", () => {
  it("requires both the verdict and the reason", () => {
    expect(
      gradeAnswer(tfj, { kind: "tfj", isTrue: false, justificationIndex: 0 }).correct,
    ).toBe(true);
  });

  it("marks a right verdict with the wrong reason as incorrect", () => {
    // This is the entire point of the type: a correct verdict alone is a coin flip.
    expect(
      gradeAnswer(tfj, { kind: "tfj", isTrue: false, justificationIndex: 1 }).correct,
    ).toBe(false);
  });

  it("marks a wrong verdict as incorrect even with the flagged reason", () => {
    expect(
      gradeAnswer(tfj, { kind: "tfj", isTrue: true, justificationIndex: 0 }).correct,
    ).toBe(false);
  });

  it("is incomplete until both halves are supplied", () => {
    expect(gradeAnswer(tfj, { kind: "tfj", isTrue: false, justificationIndex: null }).incomplete).toBe(
      true,
    );
    expect(gradeAnswer(tfj, { kind: "tfj", isTrue: null, justificationIndex: 0 }).incomplete).toBe(
      true,
    );
  });
});

describe("isAnswerable", () => {
  it("gates submission on a complete response", () => {
    expect(isAnswerable(mcq, null)).toBe(false);
    expect(isAnswerable(mcq, { kind: "choice", choiceIndex: 0 })).toBe(true);
    expect(isAnswerable(numeric, { kind: "numeric", value: null, raw: "" })).toBe(false);
    expect(isAnswerable(numeric, { kind: "numeric", value: 1, raw: "1" })).toBe(true);
    expect(isAnswerable(tfj, { kind: "tfj", isTrue: true, justificationIndex: null })).toBe(false);
  });

  it("rejects a response of the wrong shape for the question type", () => {
    expect(isAnswerable(mcq, { kind: "numeric", value: 1, raw: "1" })).toBe(false);
  });
});
