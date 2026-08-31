/**
 * Walk every prose field in a topic.
 *
 * Used by the content validator to find [[glossary-slug]] references and by the
 * manifest builder for word counts. Kept here rather than in scripts/ so that
 * adding a lesson-block or question type forces one update in one place — if a new
 * type's prose is not walked, its glossary terms silently stop being validated.
 */

import type { Topic } from "./schema";

export interface ProseField {
  /** Dotted path for error messages, e.g. "questions[2].rationales[1]". */
  path: string;
  text: string;
}

export function collectProse(topic: Topic): ProseField[] {
  const out: ProseField[] = [];
  const push = (path: string, text: string | undefined | null): void => {
    if (typeof text === "string" && text.length > 0) out.push({ path, text });
  };

  topic.lesson.forEach((block, i) => {
    const at = `lesson[${i}]:${block.type}`;
    switch (block.type) {
      case "concept":
      case "intuition":
      case "onTheJob":
      case "pitfall":
      case "analogy":
        push(at, block.body);
        break;
      case "formula":
        push(`${at}.plainReading`, block.plainReading);
        block.variables?.forEach((v, j) => push(`${at}.variables[${j}].meaning`, v.meaning));
        break;
      case "example":
        push(`${at}.body`, block.body);
        block.walkthrough.forEach((s, j) => push(`${at}.walkthrough[${j}]`, s));
        break;
      case "table":
        push(`${at}.caption`, block.caption);
        block.rows.forEach((row, j) =>
          row.forEach((cell, k) => push(`${at}.rows[${j}][${k}]`, cell)),
        );
        break;
      case "chart":
        push(`${at}.caption`, block.caption);
        push(`${at}.annotation`, block.annotation);
        break;
      case "keyTakeaways":
        block.items.forEach((s, j) => push(`${at}.items[${j}]`, s));
        break;
    }
  });

  topic.questions.forEach((q, i) => {
    const at = `questions[${i}]:${q.id}`;
    push(`${at}.explanation`, q.explanation);

    switch (q.type) {
      case "mcq":
      case "chartRead":
        push(`${at}.stem`, q.stem);
        q.choices.forEach((c, j) => push(`${at}.choices[${j}]`, c));
        q.rationales.forEach((r, j) => push(`${at}.rationales[${j}]`, r));
        break;
      case "strategyId":
        push(`${at}.description`, q.description);
        q.choices.forEach((c, j) => push(`${at}.choices[${j}]`, c));
        q.rationales.forEach((r, j) => push(`${at}.rationales[${j}]`, r));
        break;
      case "numeric":
        push(`${at}.stem`, q.stem);
        break;
      case "tfj":
        push(`${at}.stem`, q.stem);
        q.justifications.forEach((c, j) => push(`${at}.justifications[${j}]`, c));
        q.rationales.forEach((r, j) => push(`${at}.rationales[${j}]`, r));
        break;
      case "match":
        push(`${at}.instruction`, q.instruction);
        q.pairs.forEach((p, j) => {
          push(`${at}.pairs[${j}].left`, p.left);
          push(`${at}.pairs[${j}].right`, p.right);
        });
        break;
      case "vignette":
        push(`${at}.stem`, q.stem);
        q.exhibits.forEach((ex, j) => {
          if (ex.kind === "text") push(`${at}.exhibits[${j}].body`, ex.body);
          if (ex.kind === "table")
            ex.rows.forEach((row, k) =>
              row.forEach((cell, l) => push(`${at}.exhibits[${j}].rows[${k}][${l}]`, cell)),
            );
        });
        q.subQuestions.forEach((sq, j) => {
          push(`${at}.subQuestions[${j}].stem`, sq.stem);
          push(`${at}.subQuestions[${j}].explanation`, sq.explanation);
          if (sq.type === "mcq") {
            sq.choices.forEach((c, k) => push(`${at}.subQuestions[${j}].choices[${k}]`, c));
            sq.rationales.forEach((r, k) => push(`${at}.subQuestions[${j}].rationales[${k}]`, r));
          }
        });
        break;
    }
  });

  return out;
}

/** All question ids in a topic, including vignette sub-questions (each is separately scheduled). */
export function collectQuestionIds(topic: Topic): string[] {
  return topic.questions.flatMap((q) =>
    q.type === "vignette" ? [q.id, ...q.subQuestions.map((s) => s.id)] : [q.id],
  );
}
