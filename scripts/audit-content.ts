/**
 * `npm run content:audit` — checks the authoring checklist that the schema cannot.
 *
 * `content:check` proves content is structurally valid. This proves it is *good*:
 * the questions the Zod schema has no opinion about but CLAUDE.md §9 does.
 *
 * The headline check is answer alignment. A misaligned `answerIndex` is invisible to
 * the schema — every index in range is structurally valid — and invisible to a casual
 * read, because the question still renders and still grades. It just grades the wrong
 * option as correct. That bug shipped once in M1, which is why this file exists.
 *
 * FAILURES block; WARNINGS are advisory, because the checklist is a standard to aim
 * at rather than a hard gate (a two-question topic is thin, not broken).
 */

import { pathToFileURL } from "node:url";

import type { Question, Topic } from "../src/content/schema";
import { loadContent } from "./lib/content-fs";
import { bold, dim, green, red, yellow } from "./lib/report";

interface Finding {
  file: string;
  where: string;
  message: string;
}

/** The correct rationale should say so. Anything else means the index may be wrong. */
const CORRECT_PREFIX = /^(Correct|Yes)\b/;

function choicesOf(q: Question): { options: string[]; answerIndex: number } | null {
  switch (q.type) {
    case "mcq":
    case "strategyId":
    case "chartRead":
      return { options: q.choices, answerIndex: q.answerIndex };
    case "tfj":
      return { options: q.justifications, answerIndex: q.justificationIndex };
    default:
      return null;
  }
}

function auditTopic(topic: Topic, file: string): { failures: Finding[]; warnings: Finding[] } {
  const failures: Finding[] = [];
  const warnings: Finding[] = [];

  const fail = (where: string, message: string): void => {
    failures.push({ file, where, message });
  };
  const warn = (where: string, message: string): void => {
    warnings.push({ file, where, message });
  };

  /* ---- per question ---- */
  for (const q of topic.questions) {
    const choice = choicesOf(q);

    if (choice) {
      const rationale = (q as { rationales?: string[] }).rationales?.[choice.answerIndex];
      if (rationale !== undefined && !CORRECT_PREFIX.test(rationale)) {
        fail(
          q.id,
          `rationale at answerIndex ${choice.answerIndex} does not begin "Correct" — the index may point at a wrong answer: ${JSON.stringify(rationale.slice(0, 70))}`,
        );
      }

      // Two identical options make one of them unanswerable.
      const seen = new Map<string, number>();
      choice.options.forEach((opt, i) => {
        const key = opt.trim().toLowerCase();
        const first = seen.get(key);
        if (first !== undefined) fail(q.id, `choices ${first} and ${i} are identical`);
        else seen.set(key, i);
      });

      // A rationale that begins "Correct" on a wrong option reads as a contradiction.
      const rationales = (q as { rationales?: string[] }).rationales ?? [];
      rationales.forEach((r, i) => {
        if (i !== choice.answerIndex && CORRECT_PREFIX.test(r)) {
          fail(q.id, `rationale ${i} begins "Correct" but ${i} is not the answer`);
        }
      });
    }

    if (q.type === "numeric" && q.tolerance === 0) {
      warn(q.id, "numeric tolerance is 0 — any rounding by the user will be marked wrong");
    }

    // A pointer into the lesson is what makes the post-miss re-read work.
    if (q.difficulty >= 3 && q.concept === undefined) {
      warn(q.id, `difficulty ${q.difficulty} but no 'concept' pointer, so a confident miss cannot re-teach`);
    }
  }

  /* ---- per topic (CLAUDE.md §9) ---- */
  const blocks = topic.lesson.map((b) => b.type);

  if (!blocks.includes("onTheJob")) {
    warn("lesson", "no 'onTheJob' block — the checklist asks for one per topic");
  }
  if (blocks.at(-1) !== "keyTakeaways") {
    warn("lesson", "'keyTakeaways' should be the last block");
  }

  const difficulties = new Set(topic.questions.map((q) => q.difficulty));
  if (difficulties.size < 3) {
    warn("questions", `only ${difficulties.size} difficulty level(s) — the checklist asks for 3+`);
  }

  const types = new Set(topic.questions.map((q) => q.type));
  if (types.size < 2) {
    warn("questions", `only ${types.size} question type(s) — the checklist asks for 2+`);
  }

  if (topic.questions.length < 6) {
    warn("questions", `${topic.questions.length} questions — the checklist asks for 6-10`);
  }
  if (topic.questions.length > 10) {
    warn("questions", `${topic.questions.length} questions — the checklist caps at 10`);
  }

  return { failures, warnings };
}

function main(): number {
  const { topics, problems } = loadContent();

  if (problems.length > 0) {
    console.log(
      `${yellow("!")} ${problems.length} schema problem(s) — run ${dim("npm run content:check")} first. Auditing what parsed.`,
    );
  }

  const failures: Finding[] = [];
  const warnings: Finding[] = [];

  for (const { topic, file } of topics) {
    const result = auditTopic(topic, file);
    failures.push(...result.failures);
    warnings.push(...result.warnings);
  }

  console.log(`${bold("content:audit")}  ${topics.length} topic(s)`);

  const show = (list: Finding[], label: string, colour: (s: string) => string): void => {
    if (list.length === 0) return;
    console.log(`\n${colour(label)}`);
    for (const f of list) {
      console.log(`  ${f.file}  ${dim(f.where)}  ${f.message}`);
    }
  };

  show(failures, `${failures.length} failure(s)`, red);
  show(warnings, `${warnings.length} warning(s)`, yellow);

  if (failures.length > 0) {
    console.log(`\n${red("FAILED")}`);
    return 1;
  }

  console.log(
    warnings.length === 0
      ? `\n${green("OK")} — checklist clean`
      : `\n${green("OK")} — no failures, ${warnings.length} advisory warning(s)`,
  );
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) process.exit(main());
