/**
 * Infographic blocks: schema shape and — the regression that actually matters —
 * prose walking.
 *
 * walk.ts's block switch is not exhaustiveness-checked, so a diagram field left out
 * of collectProse silently skips glossary validation AND can make a term look
 * orphaned. These tests pin every prose field of every kind to the walker's output.
 */

import { describe, expect, it } from "vitest";

import { infographicSpecSchema, lessonBlockSchema, type LessonBlock } from "./schema";
import { collectProse } from "./walk";
import type { Topic } from "./schema";

const specs = {
  equation: {
    kind: "equation",
    terms: [
      { label: "Bond eq-t1", sublabel: "sub eq-t1", icon: "coins", bullets: ["eq bullet [[hurdle-rate]]"] },
      { label: "Call option eq-t2" },
      { label: "Convertible eq-t3" },
    ],
    operators: ["+", "="],
    result: "eq result line",
  },
  steps: {
    kind: "steps",
    steps: [
      { label: "step one label", detail: "step one detail", icon: "coins" },
      { label: "step two label", detail: "step two detail" },
    ],
  },
  facts: {
    kind: "facts",
    tiles: [
      { label: "tile a label", detail: "tile a detail", icon: "shield" },
      { label: "tile b label", stat: "20–40%" },
    ],
  },
  spectrum: {
    kind: "spectrum",
    points: [
      { label: "point vc", sublabel: "earlier stage" },
      { label: "point ge", highlight: true },
      { label: "point buyout" },
    ],
  },
  comparison: {
    kind: "comparison",
    columns: [
      { title: "col see", bullets: ["col see bullet"], mark: "check" },
      { title: "col miss", bullets: ["col miss bullet"], mark: "cross" },
    ],
  },
  cycle: {
    kind: "cycle",
    stages: [
      { label: "cyc one", detail: "cyc one detail" },
      { label: "cyc two" },
      { label: "cyc three" },
    ],
  },
  stack: {
    kind: "stack",
    layers: [
      { label: "layer capital", sublabel: "layer capital sub" },
      { label: "layer pref", emphasis: true },
    ],
    axis: "paid first → paid last",
  },
} as const;

function block(spec: unknown): LessonBlock {
  return lessonBlockSchema.parse({
    type: "infographic",
    id: "test-diagram",
    caption: "the caption",
    spec,
    annotation: "the annotation",
  });
}

/** A minimal topic shell around one lesson block, for collectProse. */
function topicWith(blocks: LessonBlock[]): Topic {
  return {
    schemaVersion: 1,
    id: "quant-tvm-01",
    domain: "quantitative-methods",
    title: "T",
    summary: "S",
    level: "CFA-L1",
    prereqs: [],
    estMinutes: 5,
    tags: ["t"],
    lesson: blocks,
    questions: [],
  } as unknown as Topic;
}

describe("infographic schema", () => {
  it("accepts every kind", () => {
    for (const spec of Object.values(specs)) {
      expect(infographicSpecSchema.safeParse(spec).success).toBe(true);
    }
  });

  it("rejects an equation whose operators do not fit between its terms", () => {
    const bad = { ...specs.equation, operators: ["+"] };
    const out = infographicSpecSchema.safeParse(bad);
    expect(out.success).toBe(false);
  });

  it("rejects unknown kinds and empty collections", () => {
    expect(infographicSpecSchema.safeParse({ kind: "pie" }).success).toBe(false);
    expect(infographicSpecSchema.safeParse({ kind: "steps", steps: [] }).success).toBe(false);
    expect(
      infographicSpecSchema.safeParse({ kind: "spectrum", points: [{ label: "a" }] }).success,
    ).toBe(false);
  });

  it("accepts a comparison column carrying a mini chart spec", () => {
    const withChart = {
      kind: "comparison",
      columns: [
        {
          title: "without",
          bullets: ["rises and falls"],
          spec: {
            kind: "line",
            xLabels: ["a", "b"],
            series: [{ name: "s", values: [1, 2] }],
          },
        },
        { title: "with", bullets: ["flat"] },
      ],
    };
    expect(infographicSpecSchema.safeParse(withChart).success).toBe(true);
  });
});

describe("infographic prose walking", () => {
  it("walks every prose field of every kind — the silent-gap regression", () => {
    // If any of these disappear from collectProse, glossary refs inside diagrams stop
    // being validated and the orphan-term check misfires. This is the test that makes
    // the non-exhaustive walk switch safe to live with.
    const expected: Record<string, string[]> = {
      equation: ["Bond eq-t1", "sub eq-t1", "eq bullet [[hurdle-rate]]", "Call option eq-t2", "eq result line"],
      steps: ["step one label", "step one detail", "step two detail"],
      facts: ["tile a label", "tile a detail", "tile b label"],
      spectrum: ["point vc", "earlier stage", "point ge"],
      comparison: ["col see", "col see bullet", "col miss bullet"],
      cycle: ["cyc one", "cyc one detail", "cyc three"],
      stack: ["layer capital", "layer capital sub", "layer pref"],
    };

    for (const [kind, texts] of Object.entries(expected)) {
      const prose = collectProse(topicWith([block(specs[kind as keyof typeof specs])])).map(
        (f) => f.text,
      );
      for (const text of texts) {
        expect(prose, `${kind}: "${text}" must be walked`).toContain(text);
      }
      // Caption and annotation ride along for every kind.
      expect(prose).toContain("the caption");
      expect(prose).toContain("the annotation");
    }
  });
});
