/**
 * Question renderers — one per implemented type, dispatched from a registry.
 *
 * The Session view knows nothing about question types: it renders <QuestionView>
 * and reads the grade. Adding a type means adding a renderer here plus a grader in
 * src/engine/grading.ts (CLAUDE.md §5).
 */

import { useEffect, useRef } from "react";

import type { Question } from "../../content/schema";
import { parseNumericInput, type Grade, type Response } from "../../engine/grading";
import { Chart } from "../charts/Chart";
import { Inline, Prose } from "../Prose";

export interface QuestionProps {
  question: Question;
  response: Response | null;
  grade: Grade | null;
  onRespond: (response: Response) => void;
  /** Submit from within the renderer (Enter in the numeric field). */
  onSubmit: () => void;
}

/* ------------------------------------------------------------------ *
 * Shared choice list
 * ------------------------------------------------------------------ */

function choiceState(
  index: number,
  selected: number | null,
  grade: Grade | null,
): "idle" | "selected" | "correct" | "wrong" | "muted" {
  if (grade === null) return selected === index ? "selected" : "idle";
  if (index === grade.correctIndex) return "correct";
  if (index === selected) return "wrong";
  return "muted";
}

const CHOICE_STYLES = {
  idle: "border-border-base bg-surface hover:border-border-strong hover:bg-surface-2",
  selected: "border-accent bg-accent-soft",
  correct: "border-correct bg-correct-soft",
  wrong: "border-incorrect bg-incorrect-soft",
  muted: "border-border-base bg-surface opacity-55",
} as const;

const MARKER_STYLES = {
  idle: "border-border-strong text-fg-subtle",
  selected: "border-accent bg-accent text-accent-fg",
  correct: "border-correct bg-correct text-accent-fg",
  wrong: "border-incorrect bg-incorrect text-accent-fg",
  muted: "border-border-strong text-fg-subtle",
} as const;

function ChoiceList({
  choices,
  rationales,
  selected,
  grade,
  onPick,
  labelPrefix = "",
}: {
  choices: string[];
  rationales: string[];
  selected: number | null;
  grade: Grade | null;
  onPick: (index: number) => void;
  labelPrefix?: string;
}) {
  const locked = grade !== null;

  return (
    <ul className="space-y-2">
      {choices.map((choice, i) => {
        const state = choiceState(i, selected, grade);
        // After grading, show the rationale for the correct answer and for the one
        // the user actually picked — the index alignment in the schema is what makes
        // "why the option you chose is wrong" possible.
        const rationale =
          locked && (state === "correct" || state === "wrong") ? rationales[i] : undefined;

        return (
          <li
            key={i}
            className={`overflow-hidden rounded-lg border ${CHOICE_STYLES[state]}`}
          >
            <button
              type="button"
              disabled={locked}
              onClick={() => onPick(i)}
              aria-pressed={selected === i}
              className={`flex w-full items-start gap-3 px-3.5 py-3 text-left ${locked ? "cursor-default" : ""}`}
            >
              <span
                aria-hidden
                className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[12px] font-semibold tnum ${MARKER_STYLES[state]}`}
              >
                {state === "correct" ? "✓" : state === "wrong" ? "✕" : `${labelPrefix}${i + 1}`}
              </span>
              {/* Non-interactive terms: a glossary popover trigger is a <button>, and
                  nesting one inside this button would be invalid HTML and swallow
                  the click. The rationale below is outside the button, so its terms
                  stay fully interactive. */}
              <span className="flex-1 leading-relaxed">
                <Inline text={choice} interactive={false} />
              </span>
            </button>

            {rationale !== undefined && (
              <div
                className={`px-3.5 pb-3 pl-[3.4rem] text-[13.5px] leading-relaxed ${state === "correct" ? "text-correct" : "text-incorrect"}`}
              >
                <Inline text={rationale} />
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Per-type renderers
 * ------------------------------------------------------------------ */

function MultipleChoice({ question, response, grade, onRespond }: QuestionProps) {
  if (question.type !== "mcq" && question.type !== "strategyId" && question.type !== "chartRead") {
    return null;
  }

  const selected = response?.kind === "choice" ? response.choiceIndex : null;

  return (
    <div>
      {question.type === "chartRead" && <Chart spec={question.spec} ariaLabel={question.stem} />}

      <div className="mb-5">
        {question.type === "strategyId" ? (
          <>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
              Identify the strategy
            </div>
            <Prose text={question.description} className="text-[15px]" />
          </>
        ) : (
          <Prose text={question.stem} className="text-[17px] leading-relaxed" />
        )}
      </div>

      <ChoiceList
        choices={question.choices}
        rationales={question.rationales}
        selected={selected}
        grade={grade}
        onPick={(choiceIndex) => onRespond({ kind: "choice", choiceIndex })}
      />
    </div>
  );
}

function NumericEntry({ question, response, grade, onRespond, onSubmit }: QuestionProps) {
  // Hooks before the type guard, so hook order never depends on the question type.
  const inputRef = useRef<HTMLInputElement>(null);
  const locked = grade !== null;

  useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [locked, question.id]);

  if (question.type !== "numeric") return null;

  const raw = response?.kind === "numeric" ? response.raw : "";

  return (
    <div>
      <div className="mb-5">
        <Prose text={question.stem} className="text-[17px] leading-relaxed" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {question.unit !== undefined && question.unit === "$" && (
          <span className="text-fg-muted">$</span>
        )}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          disabled={locked}
          value={raw}
          onChange={(e) =>
            onRespond({
              kind: "numeric",
              raw: e.target.value,
              value: parseNumericInput(e.target.value),
            })
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onSubmit();
            }
          }}
          className={`w-44 rounded-md border bg-surface px-3 py-2 text-lg tnum outline-none disabled:opacity-70 ${
            locked
              ? grade.correct
                ? "border-correct text-correct"
                : "border-incorrect text-incorrect"
              : "border-border-strong focus:border-accent"
          }`}
          aria-label="Your answer"
        />
        {question.unit !== undefined && question.unit !== "$" && (
          <span className="text-fg-muted">{question.unit}</span>
        )}
      </div>

      {question.inputHint !== undefined && !locked && (
        <p className="mt-2 text-[13px] text-fg-subtle">{question.inputHint}</p>
      )}

      {locked && !grade.correct && (
        <p className="mt-3 text-[15px]">
          <span className="text-fg-muted">Correct answer: </span>
          <span className="font-semibold text-correct tnum">
            {question.answer}
            {question.unit !== undefined && question.unit !== "$" ? ` ${question.unit}` : ""}
          </span>
        </p>
      )}
    </div>
  );
}

function TrueFalseJustified({ question, response, grade, onRespond }: QuestionProps) {
  if (question.type !== "tfj") return null;

  const current = response?.kind === "tfj" ? response : { isTrue: null, justificationIndex: null };
  const locked = grade !== null;

  const setVerdict = (isTrue: boolean): void =>
    onRespond({ kind: "tfj", isTrue, justificationIndex: current.justificationIndex });

  const setJustification = (justificationIndex: number): void =>
    onRespond({ kind: "tfj", isTrue: current.isTrue, justificationIndex });

  const verdictStyle = (value: boolean): string => {
    if (!locked) {
      return current.isTrue === value
        ? "border-accent bg-accent-soft text-fg"
        : "border-border-base bg-surface hover:border-border-strong";
    }
    if (value === question.isTrue) return "border-correct bg-correct-soft text-correct";
    if (current.isTrue === value) return "border-incorrect bg-incorrect-soft text-incorrect";
    return "border-border-base bg-surface opacity-55";
  };

  return (
    <div>
      <div className="mb-5">
        <Prose text={question.stem} className="text-[17px] leading-relaxed" />
      </div>

      <div className="mb-6">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          Your verdict
        </div>
        <div className="flex gap-2">
          {[true, false].map((value) => (
            <button
              key={String(value)}
              type="button"
              disabled={locked}
              onClick={() => setVerdict(value)}
              className={`rounded-lg border px-5 py-2 font-medium ${verdictStyle(value)} ${locked ? "cursor-default" : ""}`}
            >
              {value ? "True" : "False"}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-fg-subtle">
          And because —
        </div>
        <ChoiceList
          choices={question.justifications}
          rationales={question.rationales}
          selected={current.justificationIndex}
          grade={grade}
          onPick={setJustification}
        />
      </div>

      {locked && (
        <p className="mt-4 text-[13.5px] text-fg-muted">
          Both halves must be right: the verdict alone is a coin flip, so this type only
          counts the answer correct when the reasoning matches too.
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Registry
 * ------------------------------------------------------------------ */

const RENDERERS: Partial<Record<Question["type"], (props: QuestionProps) => React.ReactNode>> = {
  mcq: MultipleChoice,
  strategyId: MultipleChoice,
  chartRead: MultipleChoice,
  numeric: NumericEntry,
  tfj: TrueFalseJustified,
};

/** How many number keys this question responds to, for the keyboard layer. */
export function choiceCount(question: Question): number {
  switch (question.type) {
    case "mcq":
    case "strategyId":
    case "chartRead":
      return question.choices.length;
    case "tfj":
      return question.justifications.length;
    default:
      return 0;
  }
}

export function QuestionView(props: QuestionProps) {
  const Renderer = RENDERERS[props.question.type];

  if (!Renderer) {
    // content:check blocks unimplemented types from shipping, so this is a guard.
    return (
      <div className="rounded-lg border border-flag bg-flag-soft p-4 text-[14px] text-flag">
        No renderer for question type <code>{props.question.type}</code>. Run{" "}
        <code>npm run content:check</code>.
      </div>
    );
  }

  return <Renderer {...props} />;
}
