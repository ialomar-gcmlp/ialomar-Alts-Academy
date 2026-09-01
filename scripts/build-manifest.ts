/**
 * Regenerate content/manifest.json.
 *
 * The manifest is the only content the app loads eagerly: enough to draw the skill
 * tree and plan a session, with none of the lesson prose. Generated, gitignored,
 * never hand-edited.
 *
 * Run directly (`npm run content:build`) or via the Vite plugin in vite.config.ts.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { CONTENT_SCHEMA_VERSION, type Manifest } from "../src/content/schema";
import { schedulableCount } from "../src/content/flatten";
import { CONTENT_DIR, loadContent, topicQuestionSeconds, type LoadedContent } from "./lib/content-fs";
import { dim, reportProblems, yellow } from "./lib/report";

export function toManifest(loaded: LoadedContent): Manifest {
  return {
    schemaVersion: CONTENT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    glossaryCount: loaded.terms.size,
    topics: loaded.topics
      .map(({ topic, file }) => ({
        id: topic.id,
        domain: topic.domain,
        title: topic.title,
        summary: topic.summary,
        level: topic.level,
        prereqs: topic.prereqs,
        estMinutes: topic.estMinutes,
        examRelevance: topic.examRelevance,
        // Schedulable questions: vignette subs count, their parent does not. Using
        // collectQuestionIds here would add one per vignette and cap coverage below 1.
        questionCount: schedulableCount(topic.questions),
        questionSeconds: topicQuestionSeconds(topic),
        tags: [...new Set(topic.questions.flatMap((q) => q.tags))].sort(),
        needsReview: topic.needsReview || topic.questions.some((q) => q.needsReview === true),
        file,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/**
 * Write the manifest. Invalid topics are excluded by loadContent (they never parse),
 * so the manifest always describes content the app can actually render — a broken
 * file makes a topic disappear rather than crashing the app at runtime.
 */
export function writeManifest(): { manifest: Manifest; loaded: LoadedContent } {
  const loaded = loadContent();
  const manifest = toManifest(loaded);
  writeFileSync(
    join(CONTENT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { manifest, loaded };
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { manifest, loaded } = writeManifest();
  console.log(
    `content/manifest.json — ${manifest.topics.length} topic(s), ${manifest.glossaryCount} term(s) ${dim(
      `(${manifest.topics.reduce((n, t) => n + t.questionCount, 0)} questions)`,
    )}`,
  );
  if (loaded.problems.length > 0) {
    reportProblems(loaded.problems);
    console.log(
      `\n${yellow("!")} ${loaded.problems.length} problem(s) — manifest written, but run ${dim("npm run content:check")} and fix them.`,
    );
  }
}
