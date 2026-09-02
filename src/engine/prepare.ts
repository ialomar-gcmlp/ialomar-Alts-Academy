/**
 * Prepare a question for one encounter: deal the choices in a fresh order.
 *
 * The scheduler re-asks the same question on purpose — retrieval at stretching
 * intervals is the learning. What it cannot defend against is memorising the
 * *surface* instead of the content: "the answer to the subscription-line one is the
 * second choice" works forever if choices always render in authored order. So each
 * encounter shuffles them, seeded, and the seed is the part that carries the design:
 *
 *   seed = hash(question id) ^ session start time
 *
 * - Stable within a session: re-renders never move options under the cursor, and a
 *   resumed session reproduces the same order, so a saved response index still
 *   points at the same choice text (the snapshot stores the index, not the text).
 * - Different across sessions: next week the position is no longer information.
 *
 * The question is permuted as a whole — choices, answerIndex and the index-aligned
 * rationales move together — so everything downstream (rendering, grading,
 * "why the one you picked is wrong") works unchanged on an internally consistent
 * object. Nothing persistent ever stores a choice position.
 *
 * Numeric-looking choice lists are left in authored (sorted) order: shuffling them
 * gains nothing — the memorisable surface there is the number itself, which the
 * variant mechanism handles — and every real exam presents numeric options sorted.
 */

import type { Question } from "../content/schema";
import { hashString, mulberry32, shuffle } from "../lib/rng";

/** Combine the two halves of the seed. `>>> 0` wraps the ms timestamp to 32 bits. */
function encounterSeed(questionId: string, sessionStartedAt: number): number {
  return (hashString(questionId) ^ (sessionStartedAt >>> 0)) >>> 0;
}

/**
 * True when every choice reads as a number ("$1,250", "8.5%", "2.0x", "45 bps").
 * Such lists stay in authored order — see the note at the top of the file.
 */
export function isNumericChoiceList(choices: readonly string[]): boolean {
  return (
    choices.length > 0 &&
    choices.every((choice) => {
      const stripped = choice
        .replace(/per year|years?|days?|bps|%|[x×~≈$€£,\s]/gi, "")
        .trim();
      return stripped !== "" && !Number.isNaN(Number(stripped));
    })
  );
}

/** A permutation of 0..n-1, plus where each original index landed. */
function dealOrder(n: number, seed: number): { order: number[]; landedAt: number[] } {
  const order = shuffle(
    Array.from({ length: n }, (_, i) => i),
    mulberry32(seed),
  );
  const landedAt = new Array<number>(n);
  order.forEach((original, displayed) => {
    landedAt[original] = displayed;
  });
  return { order, landedAt };
}

/**
 * The permuted copy of a question for this encounter, or the question itself when
 * there is nothing to shuffle. Pure: same inputs, same deal, every time — which is
 * what lets a resumed session rebuild the exact order a response was given against.
 */
export function prepareQuestion(question: Question, sessionStartedAt: number): Question {
  const seed = encounterSeed(question.id, sessionStartedAt);

  switch (question.type) {
    case "mcq":
    case "strategyId":
    case "chartRead": {
      if (isNumericChoiceList(question.choices)) return question;
      const { order, landedAt } = dealOrder(question.choices.length, seed);
      return {
        ...question,
        choices: order.map((i) => question.choices[i] as string),
        rationales: order.map((i) => question.rationales[i] as string),
        answerIndex: landedAt[question.answerIndex] as number,
      };
    }

    case "tfj": {
      // The verdict is fixed by reality; only the justifications shuffle.
      const { order, landedAt } = dealOrder(question.justifications.length, seed);
      return {
        ...question,
        justifications: order.map((i) => question.justifications[i] as string),
        rationales: order.map((i) => question.rationales[i] as string),
        justificationIndex: landedAt[question.justificationIndex] as number,
      };
    }

    case "numeric": {
      // The memorisable surface of a calculation question is the number itself, so
      // each encounter resolves one parameterisation from the variant table. Same
      // seed discipline as the choice deal: stable within a session and on resume,
      // different the next time the question comes back.
      const variants = question.variants;
      if (variants === undefined || variants.length === 0) return question;

      const pick = Math.floor(mulberry32(seed)() * (variants.length + 1));
      if (pick === 0) return question; // the authored original is form 0

      const variant = variants[pick - 1];
      if (variant === undefined) return question;
      return {
        ...question,
        stem: variant.stem,
        answer: variant.answer,
        explanation: variant.explanation,
        tolerance: variant.tolerance ?? question.tolerance,
        ...(variant.inputHint !== undefined || question.inputHint !== undefined
          ? { inputHint: variant.inputHint ?? question.inputHint }
          : {}),
      };
    }

    // match has no renderer; a vignette parent never reaches a session — flattening
    // replaced it with its subs, which take the cases above.
    default:
      return question;
  }
}
