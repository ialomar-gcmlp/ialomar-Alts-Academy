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
      { kind: "strong", text: "Net" },
      { kind: "text", text: " is " },
      { kind: "em", text: "longs" },
      { kind: "text", text: " minus " },
      { kind: "term", slug: "net-exposure", display: "net exposure" },
    ]);
  });

  it("prefers bold over italic for a doubled asterisk", () => {
    expect(parseInline("**bold**")).toEqual([{ kind: "strong", text: "bold" }]);
  });

  it("leaves an unmatched asterisk as literal text", () => {
    expect(parseInline("5 * 3 = 15")).toEqual([{ kind: "text", text: "5 * 3 = 15" }]);
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
