/**
 * Grading — pure, synchronous, no React.
 *
 * One grader per question type, dispatched on `type`. Adding a question type means
 * adding a case here and a renderer in src/ui/questions/, never touching the session
 * flow (CLAUDE.md §5).
 */

import type { Question } from "../content/schema";

export const CONFIDENCE_LEVELS = ["confident", "unsure", "guessing"] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

export const CONFIDENCE_LABELS: Record<Confidence, string> = {
  confident: "Confident",
  unsure: "Unsure",
  guessing: "Guessing",
};

/** What the user submitted. Shape depends on the question type. */
export type Response =
  | { kind: "choice"; choiceIndex: number }
  | { kind: "numeric"; value: number | null; raw: string }
  | { kind: "tfj"; isTrue: boolean | null; justificationIndex: number | null };

export interface Grade {
  correct: boolean;
  /** Index into `rationales` for the option the user actually picked, when applicable. */
  pickedRationaleIndex: number | null;
  /** Index of the correct option, when the type has one. */
  correctIndex: number | null;
  /** Set when the answer could not be graded because the response was incomplete. */
  incomplete: boolean;
}

const incompleteGrade: Grade = {
  correct: false,
  pickedRationaleIndex: null,
  correctIndex: null,
  incomplete: true,
};

/** True when the user has supplied enough to submit. Drives the Submit button. */
export function isAnswerable(question: Question, response: Response | null): boolean {
  if (response === null) return false;

  switch (question.type) {
    case "mcq":
    case "strategyId":
    case "chartRead":
      return response.kind === "choice" && response.choiceIndex >= 0;
    case "numeric":
      return response.kind === "numeric" && response.value !== null && Number.isFinite(response.value);
    case "tfj":
      // Both halves are required: getting true/false right by luck should not count.
      return (
        response.kind === "tfj" && response.isTrue !== null && response.justificationIndex !== null
      );
    default:
      return false;
  }
}

export function gradeAnswer(question: Question, response: Response | null): Grade {
  if (!isAnswerable(question, response) || response === null) return incompleteGrade;

  switch (question.type) {
    case "mcq":
    case "strategyId":
    case "chartRead": {
      if (response.kind !== "choice") return incompleteGrade;
      return {
        correct: response.choiceIndex === question.answerIndex,
        pickedRationaleIndex: response.choiceIndex,
        correctIndex: question.answerIndex,
        incomplete: false,
      };
    }

    case "numeric": {
      if (response.kind !== "numeric" || response.value === null) return incompleteGrade;
      return {
        correct: withinTolerance(response.value, question.answer, question.tolerance, question.toleranceType),
        pickedRationaleIndex: null,
        correctIndex: null,
        incomplete: false,
      };
    }

    case "tfj": {
      if (response.kind !== "tfj" || response.isTrue === null || response.justificationIndex === null) {
        return incompleteGrade;
      }
      // Both the verdict and the reason must be right. A correct verdict with the
      // wrong reason is not knowledge, and this is why the type exists.
      const verdictRight = response.isTrue === question.isTrue;
      const reasonRight = response.justificationIndex === question.justificationIndex;
      return {
        correct: verdictRight && reasonRight,
        pickedRationaleIndex: response.justificationIndex,
        correctIndex: question.justificationIndex,
        incomplete: false,
      };
    }

    default:
      // match and vignette have no renderer yet; content:check blocks them from
      // reaching here, so this is a guard rather than a path.
      return incompleteGrade;
  }
}

export function withinTolerance(
  value: number,
  answer: number,
  tolerance: number,
  type: "abs" | "rel",
): boolean {
  if (!Number.isFinite(value)) return false;
  const allowed = type === "rel" ? Math.abs(answer) * tolerance : tolerance;
  // Guard against floating point landing a hair outside an exact-boundary answer.
  return Math.abs(value - answer) <= allowed + Number.EPSILON * Math.max(1, Math.abs(answer));
}

/**
 * Parse a typed numeric answer tolerantly: strip currency symbols, thousands
 * separators, percent signs and whitespace. The user is doing mental arithmetic in a
 * five-minute gap; failing them for typing "5,955.08" would be perverse.
 */
export function parseNumericInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/[$€£,\s%]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}
