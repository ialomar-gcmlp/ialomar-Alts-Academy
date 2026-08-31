/**
 * `npm run content:check` — validate every content file, exit non-zero on any problem.
 *
 * Checks performed:
 *   per file    (src/content/schema.ts) — shape, ranges, rationale/choice alignment,
 *               at least one `intuition` block, question-id namespacing, concept pointers
 *   cross file  (scripts/lib/content-fs.ts) — duplicate ids, prereqs resolve, no prereq
 *               cycles, filename matches id, domain matches folder, every [[slug]] resolves,
 *               no duplicate or orphan glossary terms, no unimplemented question types
 *
 * Also reports the review queue (items flagged needsReview) as information, not failure —
 * flagged content is correct behaviour under CLAUDE.md §1.5, not an error.
 */

import { pathToFileURL } from "node:url";

import { loadContent } from "./lib/content-fs";
import { bold, dim, green, red, reportProblems, yellow } from "./lib/report";

function main(): number {
  const { topics, terms, problems } = loadContent();

  const questionCount = topics.reduce((n, t) => n + t.topic.questions.length, 0);
  console.log(
    `${bold("content:check")}  ${topics.length} topic(s), ${questionCount} question(s), ${terms.size} glossary term(s)`,
  );

  if (problems.length > 0) {
    reportProblems(problems);
    console.log(`\n${red(`FAILED — ${problems.length} problem(s)`)}`);
    return 1;
  }

  // Review queue: not a failure. These are the items the user needs to verify.
  const flagged: string[] = [];
  for (const { topic, file } of topics) {
    if (topic.needsReview) {
      flagged.push(`${file}  ${dim(topic.reviewNote ?? "topic flagged")}`);
    }
    for (const q of topic.questions) {
      if (q.needsReview === true) {
        flagged.push(`${file}  ${q.id}  ${dim(q.reviewNote ?? "question flagged")}`);
      }
    }
  }
  for (const term of terms.values()) {
    if (term.needsReview === true) {
      flagged.push(`${term.file}  ${term.slug}  ${dim(term.reviewNote ?? "term flagged")}`);
    }
  }

  if (flagged.length > 0) {
    console.log(`\n${yellow(`${flagged.length} item(s) flagged for your review:`)}`);
    for (const line of flagged) console.log(`  - ${line}`);
    console.log(dim("\n  These appear on the app's Review Queue page. Verify before relying on them."));
  }

  console.log(`\n${green("OK")}`);
  return 0;
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) process.exit(main());
