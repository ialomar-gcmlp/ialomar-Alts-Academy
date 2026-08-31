/**
 * Markup tests.
 *
 * Worth covering now because the content validator and the renderer both depend on
 * this module agreeing with itself: if referencedSlugs sees a term that parseInline
 * does not render, the validator passes and the reader taps a dead word.
 */

import { describe, expect, it } from "vitest";

import { paragraphs, parseInline, parseProse, referencedSlugs, stripMarkup } from "./markup";

describe("parseProse", () => {
  it("splits text and terms in order", () => {
    expect(parseProse("The [[discount-rate]] shrinks it.")).toEqual([
      { kind: "text", text: "The " },
      { kind: "term", slug: "discount-rate", display: "discount rate" },
      { kind: "text", text: " shrinks it." },
    ]);
  });

  it("uses custom display text when given", () => {
    expect(parseProse("[[basis-point|basis points]]")).toEqual([
      { kind: "term", slug: "basis-point", display: "basis points" },
    ]);
  });

  it("handles a term at the very start and end", () => {
    const out = parseProse("[[alpha]] versus [[beta]]");
    expect(out.map((s) => s.kind)).toEqual(["term", "text", "term"]);
  });

  it("leaves text with no markup untouched", () => {
    expect(parseProse("plain sentence")).toEqual([{ kind: "text", text: "plain sentence" }]);
  });

  it("does not treat a single bracket pair as a term", () => {
    expect(parseProse("[not-a-term]")).toEqual([{ kind: "text", text: "[not-a-term]" }]);
  });
});

describe("referencedSlugs", () => {
  it("finds every slug, including repeats", () => {
    expect(referencedSlugs("[[alpha]] and [[beta]] and [[alpha]]")).toEqual([
      "alpha",
      "beta",
      "alpha",
    ]);
  });

  it("agrees with parseProse about what counts as a term", () => {
    // The invariant that keeps the validator and the renderer honest.
    const text = "A [[yield-curve]] plus [[basis-point|bps]] and a stray [bracket].";
    const fromParse = parseProse(text)
      .filter((s) => s.kind === "term")
      .map((s) => s.slug);
    expect(referencedSlugs(text)).toEqual(fromParse);
  });
});

describe("parseInline", () => {
  it("resolves bold and italic alongside terms", () => {
    expect(parseInline("**Net** is *longs* minus [[net-exposure]]")).toEqual([
      { kind: "text", text: "Net", emphasis: ["strong"] },
      { kind: "text", text: " is " },
      { kind: "text", text: "longs", emphasis: ["em"] },
      { kind: "text", text: " minus " },
      { kind: "term", slug: "net-exposure", display: "net exposure" },
    ]);
  });

  it("prefers bold over italic for a doubled asterisk", () => {
    expect(parseInline("**bold**")).toEqual([
      { kind: "text", text: "bold", emphasis: ["strong"] },
    ]);
  });

  it("leaves an unmatched asterisk as literal text", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
  });

  // Regression: this shipped rendering "**Tier 2 - [[preferred-return]].**" with the
  // asterisks printed on the page, because terms were parsed before emphasis and the
  // bold pattern could not span the term markup. The house style is built on bold
  // lead-ins, so this collision is routine.
  it("resolves a term inside bold, and marks it bold", () => {
    expect(parseInline("**Tier 2 - [[preferred-return]].**")).toEqual([
      { kind: "text", text: "Tier 2 - ", emphasis: ["strong"] },
      {
        kind: "term",
        slug: "preferred-return",
        display: "preferred return",
        emphasis: ["strong"],
      },
      { kind: "text", text: ".", emphasis: ["strong"] },
    ]);
  });

  it("resolves a term inside italic", () => {
    expect(parseInline("*a [[gate]] applies*")).toEqual([
      { kind: "text", text: "a ", emphasis: ["em"] },
      { kind: "term", slug: "gate", display: "gate", emphasis: ["em"] },
      { kind: "text", text: " applies", emphasis: ["em"] },
    ]);
  });

  it("carries a display alias through emphasis", () => {
    expect(parseInline("**[[basis-point|bps]]**")).toEqual([
      { kind: "term", slug: "basis-point", display: "bps", emphasis: ["strong"] },
    ]);
  });

  // Regression: "**when commodities *are* the inflation**" rendered with its
  // asterisks visible, because the bold pattern could not span the inner italic.
  it("nests italic inside bold", () => {
    expect(parseInline("**when it *is* the thing**")).toEqual([
      { kind: "text", text: "when it ", emphasis: ["strong"] },
      { kind: "text", text: "is", emphasis: ["strong", "em"] },
      { kind: "text", text: " the thing", emphasis: ["strong"] },
    ]);
  });

  it("nests a term inside italic inside bold", () => {
    expect(parseInline("**a *[[gate]]* applies**")).toEqual([
      { kind: "text", text: "a ", emphasis: ["strong"] },
      { kind: "term", slug: "gate", display: "gate", emphasis: ["strong", "em"] },
      { kind: "text", text: " applies", emphasis: ["strong"] },
    ]);
  });

  it("leaves terms outside emphasis unemphasised", () => {
    expect(parseInline("[[gate]] and **stop**")).toEqual([
      { kind: "term", slug: "gate", display: "gate" },
      { kind: "text", text: " and " },
      { kind: "text", text: "stop", emphasis: ["strong"] },
    ]);
  });
});

describe("paragraphs", () => {
  it("splits on blank lines and trims", () => {
    expect(paragraphs("one\n\ntwo\n\n\nthree")).toEqual(["one", "two", "three"]);
  });

  it("keeps a single newline inside a paragraph", () => {
    expect(paragraphs("one\ntwo")).toEqual(["one\ntwo"]);
  });

  it("drops empty input", () => {
    expect(paragraphs("   ")).toEqual([]);
  });
});

describe("stripMarkup", () => {
  it("produces readable plain text", () => {
    expect(stripMarkup("**Net** [[net-exposure]] and [[basis-point|bps]]")).toBe(
      "Net net exposure and bps",
    );
  });
});
