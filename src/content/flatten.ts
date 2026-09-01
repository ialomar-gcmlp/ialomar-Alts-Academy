/**
 * Vignettes flatten into their sub-questions; nothing downstream sees the parent.
 *
 * A vignette (CFA-style item set) is one case — stem plus exhibits — with several
 * linked questions. The obvious representation, one quiz item with a compound
 * response, was rejected because it fights everything already built:
 *
 *  - **Scheduling.** The scheduler tracks one state per question id. As one item,
 *    missing sub-question 3 of 4 would reschedule the whole case; flattened, only
 *    the missed sub comes back — carrying the case with it for context.
 *  - **Grading and XP.** Every sub is an mcq or numeric, which the graders, XP rules
 *    and renderers already handle. Flattening means zero new response kinds.
 *  - **Exams.** `composeExam` picks question ids; subs participate individually.
 *
 * What the subs share — the case — travels alongside as `VignetteContext`, the same
 * pattern `QuizItem.drill` already uses for glossary drills. The parent's id never
 * becomes a schedulable question: it exists for authoring and uniqueness checks only.
 */

import type { Question } from "./schema";
import { DEFAULT_QUESTION_SECONDS, estimateReadSeconds } from "./timing";

/** One exhibit as authored: prose, a small table, or a generated chart. */
export type VignetteExhibit = Extract<Question, { type: "vignette" }>["exhibits"][number];

export interface VignetteContext {
  /** The parent vignette's id — groups siblings and keys the case panel. */
  id: string;
  stem: string;
  exhibits: VignetteExhibit[];
  /** 1-based position of this sub within the case, for "Question 2 of 4". */
  index: number;
  total: number;
}

export interface FlatQuestion {
  /** Always a renderable type (mcq or numeric for subs) — never "vignette". */
  question: Question;
  /** The case this question belongs to, or null for a standalone question. */
  vignette: VignetteContext | null;
}

/** Words a reader must get through before the first sub-question makes sense. */
function caseReadSeconds(stem: string, exhibits: VignetteExhibit[]): number {
  const text = [
    stem,
    ...exhibits.map((ex) => {
      if (ex.kind === "text") return `${ex.title} ${ex.body}`;
      if (ex.kind === "table") return `${ex.title} ${ex.rows.flat().join(" ")}`;
      // A chart is read, not counted in words — charge a flat glance.
      return ex.title;
    }),
  ].join(" ");
  return estimateReadSeconds(text);
}

/**
 * Expand vignettes; pass everything else through.
 *
 * Each sub becomes a complete standalone Question: it keeps its own id, stem,
 * explanation and answer fields, and inherits from the parent what the schema only
 * stores once — difficulty, tags, the linked concept block, and any review flag.
 *
 * Time budgeting: the first sub of a case carries the cost of reading the case, on
 * top of its own answering time. Without this, a session composer would treat four
 * vignette subs as four cheap questions and blow its budget on the reading.
 */
export function flattenQuestions(questions: readonly Question[]): FlatQuestion[] {
  return questions.flatMap((q): FlatQuestion[] => {
    if (q.type !== "vignette") return [{ question: q, vignette: null }];

    const context = {
      id: q.id,
      stem: q.stem,
      exhibits: q.exhibits,
      total: q.subQuestions.length,
    };
    const readSeconds = caseReadSeconds(q.stem, q.exhibits);

    return q.subQuestions.map((sub, i): FlatQuestion => {
      const inherited = {
        difficulty: q.difficulty,
        tags: q.tags,
        ...(q.concept !== undefined && { concept: q.concept }),
        ...(q.needsReview !== undefined && { needsReview: q.needsReview }),
        ...(q.reviewNote != null && { reviewNote: q.reviewNote }),
        estSeconds:
          DEFAULT_QUESTION_SECONDS[sub.type] + (i === 0 ? readSeconds : 0),
      };

      return {
        question:
          sub.type === "mcq"
            ? { ...inherited, ...sub }
            : { ...inherited, ...sub },
        vignette: { ...context, index: i + 1 },
      };
    });
  });
}

/**
 * Ids the scheduler can hold state for — vignette subs, never the parent.
 *
 * Distinct from `collectQuestionIds` (walk.ts), which lists every id including the
 * parent for uniqueness checking. Using that list to count questions would inflate
 * a topic's questionCount by one per vignette and break mastery's coverage share.
 */
export function schedulableCount(questions: readonly Question[]): number {
  return questions.reduce(
    (n, q) => n + (q.type === "vignette" ? q.subQuestions.length : 1),
    0,
  );
}

/**
 * Keep siblings of one case adjacent, preserving first-encounter order otherwise.
 *
 * A review session sorts by dueness, which can interleave two subs of the same case
 * with other topics' questions — forcing the user to re-read the case twice in one
 * sitting. Grouping is a presentation choice, not a scheduling one: dueness decides
 * WHAT is in the session, this only tidies the order it is met in.
 */
export function groupVignetteSiblings(items: readonly FlatQuestion[]): FlatQuestion[] {
  const out: FlatQuestion[] = [];
  const seen = new Set<string>();

  for (const item of items) {
    const caseId = item.vignette?.id;
    if (caseId === undefined) {
      out.push(item);
      continue;
    }
    if (seen.has(caseId)) continue; // already emitted with its first sibling
    seen.add(caseId);
    // Emit every sibling present in the list, in case order.
    out.push(
      ...items
        .filter((other) => other.vignette?.id === caseId)
        .sort((a, b) => (a.vignette?.index ?? 0) - (b.vignette?.index ?? 0)),
    );
  }

  return out;
}
