/**
 * Content schema — the authoritative definition of what a topic file may contain.
 *
 * CLAUDE.md §5 mirrors this in prose. If the two disagree, THIS FILE WINS and the
 * prose gets fixed. TypeScript types are derived from these schemas via z.infer —
 * never hand-write a type that Zod already describes.
 *
 * Cross-file rules (prereqs resolve, no cycles, glossary slugs resolve, no orphan
 * terms) live in scripts/validate-content.ts, because they need every file at once.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ *
 * Vocabulary
 * ------------------------------------------------------------------ */

export const DOMAINS = [
  "quantitative-methods",
  "economics",
  "financial-statement-analysis",
  "corporate-issuers",
  "equity-valuation",
  "fixed-income",
  "derivatives",
  "alternatives",
  "fund-structures",
  "portfolio-risk",
  "ethics",
] as const;

export const DOMAIN_LABELS: Record<Domain, string> = {
  "quantitative-methods": "Quantitative Methods",
  economics: "Economics",
  "financial-statement-analysis": "Financial Statement Analysis",
  "corporate-issuers": "Corporate Issuers & Governance",
  "equity-valuation": "Equity & Valuation",
  "fixed-income": "Fixed Income",
  derivatives: "Derivatives",
  alternatives: "Alternative Investments",
  "fund-structures": "Fund Structures & Terms",
  "portfolio-risk": "Portfolio Management & Risk",
  ethics: "Ethics & Professional Conduct",
};

export const domainSchema = z.enum(DOMAINS);
export const levelSchema = z.enum(["foundation", "core", "advanced"]);
export const examRelevanceSchema = z.enum([
  "CFA-L1",
  "CFA-L2",
  "CAIA-L1",
  "CAIA-L2",
  "practical",
]);

/** Topic ids are permanent — progress is keyed on them. See CLAUDE.md §4. */
export const topicIdSchema = z
  .string()
  .regex(/^[a-z]+(-[a-z0-9]+)+-\d{2}$/, "topic id must look like 'quant-tvm-01'");

export const questionIdSchema = z
  .string()
  .regex(
    // The optional letter suffix is for vignette sub-questions (q9a..q9d), keeping
    // the parent's number visible wherever the id appears — analytics, the review
    // queue, an exam breakdown — so siblings are recognisable as one case.
    /^[a-z]+(-[a-z0-9]+)+-\d{2}-q\d+[a-z]?$/,
    "question id must look like 'quant-tvm-01-q1' (or 'quant-tvm-01-q1a' for a vignette sub)",
  );

export const termSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "term slug must be lower-kebab-case");

/** Prose that may contain [[glossary-slug]] markup. */
const proseSchema = z.string().min(1);

/* ------------------------------------------------------------------ *
 * Charts
 *
 * Authored, explicit values only — a chart-read question must render
 * identically every time it is asked, or the answer stops being stable.
 * ------------------------------------------------------------------ */

export const chartSpecSchema = z
  .object({
    kind: z.enum(["line", "bar"]),
    xLabels: z.array(z.string().min(1)).min(2),
    series: z
      .array(
        z.object({
          name: z.string().min(1),
          values: z.array(z.number()).min(2),
        }),
      )
      .min(1)
      .max(4),
    yLabel: z.string().optional(),
    yUnit: z.string().optional(),
    /** Force the y-axis to include zero. Default true for bars, false for lines. */
    zeroBaseline: z.boolean().optional(),
  })
  .refine(
    (c) => c.series.every((s) => s.values.length === c.xLabels.length),
    "every series must have exactly one value per x label",
  );

/* ------------------------------------------------------------------ *
 * Lesson blocks
 * ------------------------------------------------------------------ */

/** Optional stable id so a question can point at the block to re-read after a miss. */
const blockIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  .optional();

export const lessonBlockSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("concept"), id: blockIdSchema, body: proseSchema }),

  /** The *why*. At least one required per topic — enforced on the topic schema below. */
  z.object({ type: z.literal("intuition"), id: blockIdSchema, body: proseSchema }),

  z.object({
    type: z.literal("formula"),
    id: blockIdSchema,
    latex: z.string().min(1),
    /** Reads the formula aloud in words, for someone who cannot yet parse notation. */
    plainReading: proseSchema,
    variables: z
      .array(z.object({ symbol: z.string().min(1), meaning: proseSchema }))
      .optional(),
  }),

  z.object({
    type: z.literal("example"),
    id: blockIdSchema,
    body: proseSchema,
    walkthrough: z.array(proseSchema).min(1),
  }),

  z.object({ type: z.literal("onTheJob"), id: blockIdSchema, body: proseSchema }),
  z.object({ type: z.literal("pitfall"), id: blockIdSchema, body: proseSchema }),
  z.object({ type: z.literal("analogy"), id: blockIdSchema, body: proseSchema }),

  z.object({
    type: z.literal("table"),
    id: blockIdSchema,
    caption: z.string().min(1),
    headers: z.array(z.string().min(1)).min(2),
    rows: z.array(z.array(z.string())).min(1),
  }),

  z.object({
    type: z.literal("chart"),
    id: blockIdSchema,
    caption: z.string().min(1),
    spec: chartSpecSchema,
    annotation: proseSchema.optional(),
  }),

  z.object({
    type: z.literal("keyTakeaways"),
    id: blockIdSchema,
    items: z.array(proseSchema).min(2).max(4),
  }),
]);

/* ------------------------------------------------------------------ *
 * Questions
 * ------------------------------------------------------------------ */

const questionBase = {
  id: questionIdSchema,
  difficulty: z.number().int().min(1).max(5),
  tags: z.array(z.string().min(1)).min(1),
  explanation: proseSchema,
  /** id of the lesson block to re-surface after a confident miss (CLAUDE.md §6). */
  concept: z.string().optional(),
  estSeconds: z.number().int().min(10).max(600).optional(),
  needsReview: z.boolean().optional(),
  reviewNote: z.string().min(1).nullish(),
};

/**
 * `rationales` is index-aligned with `choices`: entry i explains choice i,
 * including why the correct one is correct. This replaces a "why A/B/D is wrong"
 * list, which becomes ambiguous the moment the answer index moves. The alignment
 * lets the UI show the user why *the option they picked* was wrong.
 */
const choiceBlock = {
  choices: z.array(proseSchema).min(2).max(6),
  answerIndex: z.number().int().min(0),
  rationales: z.array(proseSchema).min(2).max(6),
};

type ChoiceShaped = { choices: unknown[]; answerIndex: number; rationales: unknown[] };

function checkChoiceAlignment(q: ChoiceShaped, ctx: z.RefinementCtx): void {
  if (q.rationales.length !== q.choices.length) {
    ctx.addIssue({
      code: "custom",
      path: ["rationales"],
      message: `rationales must have exactly one entry per choice (${q.choices.length} choices, ${q.rationales.length} rationales)`,
    });
  }
  if (q.answerIndex >= q.choices.length) {
    ctx.addIssue({
      code: "custom",
      path: ["answerIndex"],
      message: `answerIndex ${q.answerIndex} is out of range for ${q.choices.length} choices`,
    });
  }
}

const mcqSchema = z
  .object({ ...questionBase, type: z.literal("mcq"), stem: proseSchema, ...choiceBlock })
  .superRefine(checkChoiceAlignment);

/**
 * An alternate parameterisation of a numeric question: same skeleton, fresh figures.
 *
 * The stem, answer and explanation travel together because the house style walks the
 * computation with the actual numbers — an explanation for the wrong figures would be
 * worse than none. Tolerance and hint fall back to the base question's.
 *
 * Every variant's answer is verified in Python before it is written, exactly like the
 * base question's (CLAUDE.md §9). That is why these are authored tables rather than
 * runtime formulas: no math engine in the app to get wrong, and no unverifiable figure
 * anywhere in the content.
 */
const numericVariantSchema = z.object({
  stem: proseSchema,
  answer: z.number(),
  explanation: proseSchema,
  tolerance: z.number().min(0).optional(),
  inputHint: z.string().optional(),
});

const numericSchema = z.object({
  ...questionBase,
  type: z.literal("numeric"),
  stem: proseSchema,
  answer: z.number(),
  /** Absolute units, or a fraction of the answer when toleranceType is "rel". */
  tolerance: z.number().min(0),
  toleranceType: z.enum(["abs", "rel"]),
  unit: z.string().optional(),
  /** Shown under the input, e.g. "answer in years, to 1 decimal place". */
  inputHint: z.string().optional(),
  /**
   * Alternate figures, one picked per encounter (engine/prepare.ts) so the number
   * itself stops being memorisable. One question id, one scheduling state — only the
   * parameterisation changes. Deliberately NOT on vignette sub-questions: their
   * figures are fixed by the case's exhibits.
   */
  variants: z.array(numericVariantSchema).min(1).max(5).optional(),
});

/** True/false where picking the right verdict is not enough — the reason must be right too. */
const tfjSchema = z
  .object({
    ...questionBase,
    type: z.literal("tfj"),
    stem: proseSchema,
    isTrue: z.boolean(),
    justifications: z.array(proseSchema).min(2).max(6),
    justificationIndex: z.number().int().min(0),
    rationales: z.array(proseSchema).min(2).max(6),
  })
  .superRefine((q, ctx) =>
    checkChoiceAlignment(
      { choices: q.justifications, answerIndex: q.justificationIndex, rationales: q.rationales },
      ctx,
    ),
  );

const matchSchema = z.object({
  ...questionBase,
  type: z.literal("match"),
  instruction: proseSchema,
  pairs: z.array(z.object({ left: proseSchema, right: proseSchema })).min(3).max(8),
});

/** Return pattern or trade described → name the strategy. Tagged separately from mcq
 *  so analytics can report on strategy recognition specifically. */
const strategyIdSchema = z
  .object({
    ...questionBase,
    type: z.literal("strategyId"),
    description: proseSchema,
    ...choiceBlock,
  })
  .superRefine(checkChoiceAlignment);

const chartReadSchema = z
  .object({
    ...questionBase,
    type: z.literal("chartRead"),
    spec: chartSpecSchema,
    stem: proseSchema,
    ...choiceBlock,
  })
  .superRefine(checkChoiceAlignment);

/** CFA-style item set: one stem plus exhibits, several linked sub-questions. */
const vignetteSubSchema = z.discriminatedUnion("type", [
  z
    .object({
      id: questionIdSchema,
      type: z.literal("mcq"),
      stem: proseSchema,
      explanation: proseSchema,
      ...choiceBlock,
    })
    .superRefine(checkChoiceAlignment),
  z.object({
    id: questionIdSchema,
    type: z.literal("numeric"),
    stem: proseSchema,
    explanation: proseSchema,
    answer: z.number(),
    tolerance: z.number().min(0),
    toleranceType: z.enum(["abs", "rel"]),
    unit: z.string().optional(),
    inputHint: z.string().optional(),
  }),
]);

const vignetteSchema = z.object({
  ...questionBase,
  type: z.literal("vignette"),
  stem: proseSchema,
  exhibits: z
    .array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("text"), title: z.string().min(1), body: proseSchema }),
        z.object({
          kind: z.literal("table"),
          title: z.string().min(1),
          headers: z.array(z.string().min(1)).min(2),
          rows: z.array(z.array(z.string())).min(1),
        }),
        z.object({ kind: z.literal("chart"), title: z.string().min(1), spec: chartSpecSchema }),
      ]),
    )
    .default([]),
  subQuestions: z.array(vignetteSubSchema).min(2).max(6),
});

export const questionSchema = z.union([
  mcqSchema,
  numericSchema,
  tfjSchema,
  matchSchema,
  strategyIdSchema,
  chartReadSchema,
  vignetteSchema,
]);

/** Question types with a renderer + grader implemented today. Content may only use these;
 *  validate-content.ts enforces it, so authored content can never outrun the UI. */
export const IMPLEMENTED_QUESTION_TYPES = [
  "mcq",
  "numeric",
  "tfj",
  "strategyId",
  "chartRead",
  "vignette",
] as const;

/* ------------------------------------------------------------------ *
 * Topic file
 * ------------------------------------------------------------------ */

export const CONTENT_SCHEMA_VERSION = 1;

export const topicSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    id: topicIdSchema,
    domain: domainSchema,
    title: z.string().min(1).max(90),
    /** One line for cards and the skill tree. Plain English, no jargon. */
    summary: z.string().min(1).max(200),
    level: levelSchema,
    prereqs: z.array(topicIdSchema),
    estMinutes: z.number().int().min(2).max(45),
    examRelevance: z.array(examRelevanceSchema).min(1),
    lesson: z.array(lessonBlockSchema).min(2),
    questions: z.array(questionSchema).min(1),
    needsReview: z.boolean().default(false),
    reviewNote: z.string().min(1).nullish(),
  })
  .superRefine((t, ctx) => {
    // The "understand why, not memorise" requirement, made structural.
    if (!t.lesson.some((b) => b.type === "intuition")) {
      ctx.addIssue({
        code: "custom",
        path: ["lesson"],
        message: "every topic needs at least one 'intuition' block — the why, not just the mechanics",
      });
    }

    // Question ids must be namespaced under the topic, or progress keys collide.
    t.questions.forEach((q, i) => {
      if (!q.id.startsWith(`${t.id}-q`)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "id"],
          message: `question id must start with '${t.id}-q'`,
        });
      }
    });

    const ids = t.questions.map((q) => q.id);
    const dupe = ids.find((id, i) => ids.indexOf(id) !== i);
    if (dupe !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["questions"],
        message: `duplicate question id '${dupe}'`,
      });
    }

    if (t.prereqs.includes(t.id)) {
      ctx.addIssue({ code: "custom", path: ["prereqs"], message: "a topic cannot require itself" });
    }

    // A `concept` pointer that goes nowhere silently disables the post-miss re-read.
    const blockIds = new Set(t.lesson.map((b) => b.id).filter((v): v is string => Boolean(v)));
    t.questions.forEach((q, i) => {
      if (q.concept !== undefined && !blockIds.has(q.concept)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "concept"],
          message: `concept '${q.concept}' does not match any lesson block id in this topic`,
        });
      }
    });
  });

/* ------------------------------------------------------------------ *
 * Glossary file — the ONLY place a term may be defined (CLAUDE.md §5)
 * ------------------------------------------------------------------ */

export const glossaryTermSchema = z.object({
  slug: termSlugSchema,
  term: z.string().min(1),
  /** Plain English, shown FIRST. Written for someone who has never met the word. */
  plain: z.string().min(1),
  /** The precise version, shown second. */
  formal: z.string().min(1),
  seeAlso: z.array(termSlugSchema).default([]),
  needsReview: z.boolean().optional(),
  reviewNote: z.string().min(1).nullish(),
});

export const glossaryFileSchema = z
  .object({
    schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
    domain: domainSchema,
    terms: z.array(glossaryTermSchema).min(1),
  })
  .superRefine((f, ctx) => {
    const slugs = f.terms.map((t) => t.slug);
    const dupe = slugs.find((s, i) => slugs.indexOf(s) !== i);
    if (dupe !== undefined) {
      ctx.addIssue({ code: "custom", path: ["terms"], message: `duplicate term slug '${dupe}'` });
    }
  });

/* ------------------------------------------------------------------ *
 * Manifest — GENERATED by scripts/build-manifest.ts. Never hand-edited.
 *
 * The app loads this eagerly and topic bodies lazily, so the skill tree and
 * session planner can reason over every topic without pulling ~3MB of prose.
 * ------------------------------------------------------------------ */

export const manifestTopicSchema = z.object({
  id: topicIdSchema,
  domain: domainSchema,
  title: z.string(),
  summary: z.string(),
  level: levelSchema,
  prereqs: z.array(topicIdSchema),
  estMinutes: z.number(),
  examRelevance: z.array(examRelevanceSchema),
  questionCount: z.number().int(),
  /** Sum of estSeconds (or per-type defaults) — the session composer budgets with this. */
  questionSeconds: z.number().int(),
  tags: z.array(z.string()),
  needsReview: z.boolean(),
  file: z.string(),
});

export const manifestSchema = z.object({
  schemaVersion: z.literal(CONTENT_SCHEMA_VERSION),
  generatedAt: z.string(),
  topics: z.array(manifestTopicSchema),
  glossaryCount: z.number().int(),
});

/* ------------------------------------------------------------------ *
 * Derived types
 * ------------------------------------------------------------------ */

export type Domain = (typeof DOMAINS)[number];
export type Level = z.infer<typeof levelSchema>;
export type ExamRelevance = z.infer<typeof examRelevanceSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;
export type LessonBlock = z.infer<typeof lessonBlockSchema>;
export type LessonBlockType = LessonBlock["type"];
export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question["type"];
export type ImplementedQuestionType = (typeof IMPLEMENTED_QUESTION_TYPES)[number];
export type VignetteSubQuestion = z.infer<typeof vignetteSubSchema>;
export type Topic = z.infer<typeof topicSchema>;
export type GlossaryTerm = z.infer<typeof glossaryTermSchema>;
export type GlossaryFile = z.infer<typeof glossaryFileSchema>;
export type ManifestTopic = z.infer<typeof manifestTopicSchema>;
export type Manifest = z.infer<typeof manifestSchema>;
