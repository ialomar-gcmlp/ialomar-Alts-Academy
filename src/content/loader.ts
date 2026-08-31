/**
 * Content loading.
 *
 * The manifest is imported eagerly — it is small and every view needs it. Topic
 * bodies are loaded lazily and cached, so the skill tree and session planner never
 * pull lesson prose they are not going to show (CLAUDE.md §4).
 *
 * Load-time validation runs in dev by default: a malformed topic should fail loudly
 * while authoring, and never silently render half a lesson. In production it is off
 * unless forced, because the content was already validated at build time.
 */

import manifestJson from "../../content/manifest.json";
import {
  glossaryFileSchema,
  manifestSchema,
  topicSchema,
  type GlossaryTerm,
  type Manifest,
  type ManifestTopic,
  type Topic,
} from "./schema";

/* ------------------------------------------------------------------ *
 * Manifest
 * ------------------------------------------------------------------ */

function parseManifest(): Manifest {
  const parsed = manifestSchema.safeParse(manifestJson);
  if (!parsed.success) {
    // Unrecoverable: without a manifest there is no app. Surface it immediately
    // rather than letting every view fail in its own confusing way.
    throw new Error(
      `content/manifest.json is invalid — run \`npm run content:build\`.\n${parsed.error.issues
        .map((i) => `  ${i.path.join(".")}: ${i.message}`)
        .join("\n")}`,
    );
  }
  return parsed.data;
}

export const manifest: Manifest = parseManifest();

export const topicsById: ReadonlyMap<string, ManifestTopic> = new Map(
  manifest.topics.map((t) => [t.id, t]),
);

export function manifestTopic(id: string): ManifestTopic | undefined {
  return topicsById.get(id);
}

/* ------------------------------------------------------------------ *
 * Topic bodies — lazy, cached
 * ------------------------------------------------------------------ */

const VALIDATE_AT_LOAD = import.meta.env.DEV;

// Vite turns this into a map of path -> dynamic import, so each topic becomes its
// own chunk and none are fetched until asked for. The glossary directory has to be
// excluded explicitly: it also matches content/*/*.json, and being both statically
// and dynamically imported would stop the topic chunks splitting cleanly.
const topicModules = import.meta.glob<{ default: unknown }>([
  "../../content/*/*.json",
  "!../../content/glossary/*.json",
]);

const cache = new Map<string, Topic>();
const inFlight = new Map<string, Promise<Topic>>();

function moduleKeyFor(file: string): string | undefined {
  // Manifest stores repo-relative paths ("content/economics/econ-curve-01.json");
  // the glob keys are relative to this file.
  const suffix = file.replace(/^content\//, "");
  return Object.keys(topicModules).find((k) => k.endsWith(`/${suffix}`));
}

export async function loadTopic(id: string): Promise<Topic> {
  const cached = cache.get(id);
  if (cached) return cached;

  const existing = inFlight.get(id);
  if (existing) return existing;

  const entry = topicsById.get(id);
  if (!entry) throw new Error(`Unknown topic '${id}'. It is not in the content manifest.`);

  const key = moduleKeyFor(entry.file);
  const importer = key === undefined ? undefined : topicModules[key];
  if (!importer) throw new Error(`Topic '${id}' is in the manifest but ${entry.file} is missing.`);

  const promise = importer()
    .then((mod) => {
      const raw = mod.default;
      if (!VALIDATE_AT_LOAD) return raw as Topic;

      const parsed = topicSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `${entry.file} failed schema validation:\n${parsed.error.issues
            .map((i) => `  ${i.path.join(".")}: ${i.message}`)
            .join("\n")}`,
        );
      }
      return parsed.data;
    })
    .then((topic) => {
      cache.set(id, topic);
      inFlight.delete(id);
      return topic;
    })
    .catch((err: unknown) => {
      inFlight.delete(id);
      throw err;
    });

  inFlight.set(id, promise);
  return promise;
}

/* ------------------------------------------------------------------ *
 * Glossary
 *
 * Small enough to load eagerly, and worth it: terms are referenced from every
 * lesson, question stem and explanation, so a lazy glossary would mean a popover
 * that stalls on first tap.
 * ------------------------------------------------------------------ */

const glossaryModules = import.meta.glob<{ default: unknown }>("../../content/glossary/*.json", {
  eager: true,
});

export interface IndexedTerm extends GlossaryTerm {
  domain: string;
}

function buildGlossary(): Map<string, IndexedTerm> {
  const out = new Map<string, IndexedTerm>();

  for (const [path, mod] of Object.entries(glossaryModules)) {
    const parsed = glossaryFileSchema.safeParse(mod.default);
    if (!parsed.success) {
      if (VALIDATE_AT_LOAD) {
        console.error(
          `[glossary] ${path} failed validation:`,
          parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        );
      }
      continue;
    }
    for (const term of parsed.data.terms) {
      // Duplicates are a build-time error (content:check); last write wins here so a
      // duplicate degrades to a wrong definition rather than a crash.
      out.set(term.slug, { ...term, domain: parsed.data.domain });
    }
  }

  return out;
}

export const glossary: ReadonlyMap<string, IndexedTerm> = buildGlossary();

export function lookupTerm(slug: string): IndexedTerm | undefined {
  return glossary.get(slug);
}
