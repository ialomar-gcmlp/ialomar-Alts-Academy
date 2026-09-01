/**
 * Read and cross-validate every content file on disk.
 *
 * Shared by `npm run content:check`, `npm run content:build`, and the Vite dev
 * plugin, so all three agree on what "valid" means. Per-file shape checks live in
 * src/content/schema.ts; this module owns the checks that need every file at once.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  DOMAINS,
  IMPLEMENTED_QUESTION_TYPES,
  glossaryFileSchema,
  topicSchema,
  type Domain,
  type GlossaryTerm,
  type Topic,
} from "../../src/content/schema";
import { flattenQuestions } from "../../src/content/flatten";
import { referencedSlugs } from "../../src/content/markup";
import { collectProse } from "../../src/content/walk";
import { questionSeconds } from "../../src/content/timing";

export const REPO_ROOT = resolve(fileURLToPath(import.meta.url), "../../..");
export const CONTENT_DIR = join(REPO_ROOT, "content");
export const GLOSSARY_DIR = join(CONTENT_DIR, "glossary");

export interface Problem {
  file: string;
  path?: string;
  message: string;
}

export interface LoadedTopic {
  topic: Topic;
  /** Repo-relative, forward-slashed — used in the manifest and the review queue. */
  file: string;
}

export interface LoadedContent {
  topics: LoadedTopic[];
  terms: Map<string, GlossaryTerm & { domain: Domain; file: string }>;
  problems: Problem[];
}

const rel = (abs: string): string => relative(REPO_ROOT, abs).split("\\").join("/");

function readJson(file: string): { ok: true; value: unknown } | { ok: false; message: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(file, "utf8")) };
  } catch (err) {
    return { ok: false, message: `not valid JSON — ${(err as Error).message}` };
  }
}

function listJson(dir: string): string[] {
  try {
    if (!statSync(dir).isDirectory()) return [];
  } catch {
    return [];
  }
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => join(dir, f));
}

export function loadContent(): LoadedContent {
  const problems: Problem[] = [];
  const topics: LoadedTopic[] = [];
  const terms = new Map<string, GlossaryTerm & { domain: Domain; file: string }>();

  /* ---------------- glossary ---------------- */

  for (const abs of listJson(GLOSSARY_DIR)) {
    const file = rel(abs);
    const read = readJson(abs);
    if (!read.ok) {
      problems.push({ file, message: read.message });
      continue;
    }

    const parsed = glossaryFileSchema.safeParse(read.value);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        problems.push({ file, path: issue.path.join("."), message: issue.message });
      }
      continue;
    }

    for (const term of parsed.data.terms) {
      const existing = terms.get(term.slug);
      if (existing) {
        problems.push({
          file,
          path: term.slug,
          message: `term '${term.slug}' is already defined in ${existing.file} — a term may be defined exactly once (CLAUDE.md §5)`,
        });
        continue;
      }
      terms.set(term.slug, { ...term, domain: parsed.data.domain, file });
    }
  }

  /* ---------------- topics ---------------- */

  for (const domain of DOMAINS) {
    for (const abs of listJson(join(CONTENT_DIR, domain))) {
      const file = rel(abs);
      const read = readJson(abs);
      if (!read.ok) {
        problems.push({ file, message: read.message });
        continue;
      }

      const parsed = topicSchema.safeParse(read.value);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          problems.push({ file, path: issue.path.join("."), message: issue.message });
        }
        continue;
      }

      const topic = parsed.data;

      if (topic.domain !== domain) {
        problems.push({
          file,
          path: "domain",
          message: `declares domain '${topic.domain}' but sits in content/${domain}/`,
        });
      }
      if (!file.endsWith(`/${topic.id}.json`)) {
        problems.push({
          file,
          path: "id",
          message: `filename must match the topic id — expected ${topic.id}.json`,
        });
      }

      topics.push({ topic, file });
    }
  }

  /* ---------------- cross-file ---------------- */

  const byId = new Map<string, LoadedTopic>();
  for (const lt of topics) {
    const existing = byId.get(lt.topic.id);
    if (existing) {
      problems.push({
        file: lt.file,
        path: "id",
        message: `duplicate topic id '${lt.topic.id}' — also in ${existing.file}`,
      });
      continue;
    }
    byId.set(lt.topic.id, lt);
  }

  // Prereqs must resolve, and the graph must be acyclic or the skill tree deadlocks.
  for (const { topic, file } of topics) {
    for (const [i, p] of topic.prereqs.entries()) {
      if (!byId.has(p)) {
        problems.push({ file, path: `prereqs[${i}]`, message: `prereq '${p}' does not exist` });
      }
    }
  }
  for (const cycle of findCycles(byId)) {
    const head = cycle[0];
    if (head === undefined) continue;
    problems.push({
      file: byId.get(head)?.file ?? head,
      path: "prereqs",
      message: `prerequisite cycle: ${cycle.join(" -> ")} -> ${head}`,
    });
  }

  // Content may not use a question type the UI cannot render yet.
  const implemented = new Set<string>(IMPLEMENTED_QUESTION_TYPES);
  for (const { topic, file } of topics) {
    topic.questions.forEach((q, i) => {
      if (!implemented.has(q.type)) {
        problems.push({
          file,
          path: `questions[${i}].type`,
          message: `question type '${q.type}' has no renderer yet — implemented types: ${IMPLEMENTED_QUESTION_TYPES.join(", ")}`,
        });
      }
    });
  }

  // Every [[slug]] must resolve, or the reader taps a term and gets nothing.
  const referenced = new Set<string>();
  for (const { topic, file } of topics) {
    for (const { path, text } of collectProse(topic)) {
      for (const slug of referencedSlugs(text)) {
        referenced.add(slug);
        if (!terms.has(slug)) {
          problems.push({
            file,
            path,
            message: `[[${slug}]] is not defined in content/glossary/ — define it once there`,
          });
        }
      }
    }
  }

  for (const term of terms.values()) {
    for (const [i, slug] of term.seeAlso.entries()) {
      if (!terms.has(slug)) {
        problems.push({
          file: term.file,
          path: `${term.slug}.seeAlso[${i}]`,
          message: `seeAlso '${slug}' is not a defined term`,
        });
      }
    }
  }

  // Orphans are a smell in both directions: either the prose forgot to mark the term
  // up, or the term should not exist. Only enforced once some topics exist.
  if (topics.length > 0) {
    for (const term of terms.values()) {
      if (!referenced.has(term.slug)) {
        problems.push({
          file: term.file,
          path: term.slug,
          message: `term '${term.slug}' is defined but never referenced as [[${term.slug}]] in any topic`,
        });
      }
    }
  }

  return { topics, terms, problems };
}

/** Depth-first cycle detection over the prereq graph. Returns each cycle once. */
function findCycles(byId: Map<string, LoadedTopic>): string[][] {
  const WHITE = 0,
    GREY = 1,
    BLACK = 2;
  const colour = new Map<string, number>();
  const cycles: string[][] = [];
  const stack: string[] = [];

  const visit = (id: string): void => {
    colour.set(id, GREY);
    stack.push(id);
    for (const next of byId.get(id)?.topic.prereqs ?? []) {
      if (!byId.has(next)) continue; // missing prereq already reported
      const c = colour.get(next) ?? WHITE;
      if (c === WHITE) visit(next);
      else if (c === GREY) cycles.push(stack.slice(stack.indexOf(next)));
    }
    stack.pop();
    colour.set(id, BLACK);
  };

  for (const id of byId.keys()) {
    if ((colour.get(id) ?? WHITE) === WHITE) visit(id);
  }
  return cycles;
}

/** Total expected seconds for a topic's questions — what the session composer budgets with. */
export function topicQuestionSeconds(topic: Topic): number {
  // Flattened, so a vignette costs its subs plus the case reading (charged to the
  // first sub by flattenQuestions) rather than one flat default.
  return flattenQuestions(topic.questions).reduce(
    (sum, flat) => sum + questionSeconds(flat.question),
    0,
  );
}
