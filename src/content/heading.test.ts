/**
 * Section headings on concept and intuition blocks.
 *
 * Headings are rendered as plain text (no Inline), so [[term]] markup in one would
 * print literally and silently skip glossary validation — the schema must refuse it.
 */

import { describe, expect, it } from "vitest";

import { lessonBlockSchema } from "./schema";

describe("lesson block headings", () => {
  it("accepts a concept with a heading and one without", () => {
    expect(
      lessonBlockSchema.safeParse({ type: "concept", heading: "Key risks", body: "b" }).success,
    ).toBe(true);
    expect(lessonBlockSchema.safeParse({ type: "concept", body: "b" }).success).toBe(true);
  });

  it("accepts an intuition heading that replaces the generic callout label", () => {
    expect(
      lessonBlockSchema.safeParse({
        type: "intuition",
        heading: "Why the rate risk moves to the borrower",
        body: "b",
      }).success,
    ).toBe(true);
  });

  it("rejects [[term]] markup in headings — they bypass Inline and the glossary walk", () => {
    expect(
      lessonBlockSchema.safeParse({ type: "concept", heading: "About [[duration]]", body: "b" })
        .success,
    ).toBe(false);
    expect(
      lessonBlockSchema.safeParse({ type: "intuition", heading: "Why [[gamma]] pays", body: "b" })
        .success,
    ).toBe(false);
  });
});
