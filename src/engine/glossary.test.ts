/**
 * Glossary drill tests.
 *
 * The things that would silently ruin a drill: options reshuffling between renders
 * (so the answer index no longer points at the answer), drilling a term the user has
 * never met, and the correct answer being findable without knowing anything — for
 * instance if distractors always came from a different domain.
 */

import { describe, expect, it } from "vitest";

import { DAY_MS } from "./constants";
import {
  DRILL_CHOICES,
  DRILL_DIRECTIONS,
  buildDrill,
  buildDrillItem,
  drillId,
  drillPool,
  recordDrillAnswer,
  termProgress,
  type IndexedTerm,
} from "./glossary";
import { sm2Scheduler, type QuestionState } from "./scheduler";
import { dayKey, defaultProgress } from "../storage/progressSchema";

const T0 = Date.UTC(2026, 5, 15, 12, 0, 0);

const term = (slug: string, domain = "quantitative-methods"): IndexedTerm => ({
  slug,
  term: slug.replace(/-/g, " "),
  plain: `Plain meaning of ${slug}.`,
  formal: `Formal definition of ${slug}.`,
  seeAlso: [],
  domain,
});

const quantTerms = ["present-value", "future-value", "discount-rate", "compounding", "ease"].map(
  (s) => term(s),
);
const altTerms = ["net-exposure", "gross-exposure", "short-selling"].map((s) =>
  term(s, "alternatives"),
);
const allTerms = [...quantTerms, ...altTerms];

const scheduled = (id: string, dueAt: number, over: Partial<QuestionState> = {}): QuestionState => ({
  ...sm2Scheduler.create(id, "quantitative-methods", 2, T0),
  dueAt,
  ...over,
});

describe("drillId", () => {
  it("namespaces drills so they cannot collide with content question ids", () => {
    expect(drillId("discount-rate", "term-to-meaning")).toBe("term:discount-rate:t2m");
    expect(drillId("discount-rate", "meaning-to-term")).toBe("term:discount-rate:m2t");
  });

  it("gives the two directions distinct ids, so each is scheduled separately", () => {
    const ids = DRILL_DIRECTIONS.map((d) => drillId("x", d));
    expect(new Set(ids).size).toBe(2);
  });
});

describe("drillPool", () => {
  const seen = new Set(["present-value", "future-value", "discount-rate"]);

  it("excludes terms never met in a lesson", () => {
    // Drilling a word the user has never been shown is just a trick question.
    const pool = drillPool(allTerms, { seen, drills: {}, now: T0 });
    expect(pool.map((t) => t.slug)).toEqual([...seen]);
  });

  it("includes unseen terms only when explicitly allowed", () => {
    const pool = drillPool(allTerms, { seen, drills: {}, now: T0, allowUnseen: true });
    expect(pool.length).toBe(allTerms.length);
    // Seen ones still come first.
    expect(pool.slice(0, 3).map((t) => t.slug)).toEqual([...seen]);
  });

  it("puts due drills first, most overdue leading", () => {
    const drills = {
      [drillId("future-value", "term-to-meaning")]: scheduled("a", T0 - DAY_MS),
      [drillId("present-value", "term-to-meaning")]: scheduled("b", T0 - 5 * DAY_MS),
    };
    const pool = drillPool(allTerms, { seen, drills, now: T0 });
    expect(pool.slice(0, 2).map((t) => t.slug)).toEqual(["present-value", "future-value"]);
  });

  it("skips drills scheduled for the future", () => {
    const drills = {
      [drillId("present-value", "term-to-meaning")]: scheduled("a", T0 + 10 * DAY_MS),
      [drillId("present-value", "meaning-to-term")]: scheduled("b", T0 + 10 * DAY_MS),
    };
    const pool = drillPool(allTerms, { seen, drills, now: T0 });
    // Already drilled and not due, so it is neither due nor fresh.
    expect(pool.map((t) => t.slug)).not.toContain("present-value");
  });

  it("returns nothing when nothing has been seen", () => {
    expect(drillPool(allTerms, { seen: new Set(), drills: {}, now: T0 })).toEqual([]);
  });
});

describe("buildDrillItem", () => {
  it("puts the right answer at the index it claims", () => {
    for (const direction of DRILL_DIRECTIONS) {
      for (let seed = 0; seed < 50; seed++) {
        const item = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, direction, seed);
        if (!item) throw new Error("expected an item");

        const expected =
          direction === "term-to-meaning" ? item.term.plain : item.term.term;
        expect(item.choices[item.answerIndex]).toBe(expected);
      }
    }
  });

  it("is deterministic for a given seed", () => {
    // If this drifted, a re-render would reshuffle the options under the user.
    const a = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "term-to-meaning", 7);
    const b = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "term-to-meaning", 7);
    expect(a).toEqual(b);
  });

  it("produces different orderings for different seeds", () => {
    const orders = new Set(
      Array.from({ length: 20 }, (_, seed) =>
        buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "term-to-meaning", seed)?.choices.join("|"),
      ),
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it("offers exactly four distinct choices", () => {
    const item = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "term-to-meaning", 3);
    expect(item?.choices).toHaveLength(DRILL_CHOICES);
    expect(new Set(item?.choices).size).toBe(DRILL_CHOICES);
  });

  it("prefers distractors from the same domain", () => {
    // Picking a definition out of three unrelated ones is trivially easy; the useful
    // discrimination is against neighbouring concepts.
    const item = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "meaning-to-term", 5);
    if (!item) throw new Error("expected an item");

    const quantWords = new Set(quantTerms.map((t) => t.term));
    const fromQuant = item.choices.filter((c) => quantWords.has(c)).length;
    expect(fromQuant).toBe(DRILL_CHOICES);
  });

  it("falls back to other domains when a domain is too small", () => {
    const small = [term("only-one", "ethics"), ...quantTerms];
    const item = buildDrillItem(small[0] as IndexedTerm, small, "term-to-meaning", 1);
    expect(item?.choices).toHaveLength(DRILL_CHOICES);
  });

  it("has one rationale per choice, matching the content contract", () => {
    const item = buildDrillItem(quantTerms[0] as IndexedTerm, allTerms, "term-to-meaning", 9);
    expect(item?.rationales).toHaveLength(item?.choices.length ?? 0);
  });

  it("returns null when there are too few terms for four choices", () => {
    expect(buildDrillItem(quantTerms[0] as IndexedTerm, quantTerms.slice(0, 2), "term-to-meaning", 1)).toBeNull();
  });
});

describe("buildDrill", () => {
  it("alternates directions so both are always exercised", () => {
    const items = buildDrill(quantTerms, allTerms, 4, 1);
    expect(items.map((i) => i.direction)).toEqual([
      "term-to-meaning",
      "meaning-to-term",
      "term-to-meaning",
      "meaning-to-term",
    ]);
  });

  it("never returns more than the pool holds", () => {
    expect(buildDrill(quantTerms.slice(0, 2), allTerms, 10, 1)).toHaveLength(2);
  });

  it("returns nothing when the glossary is too small to build a question", () => {
    expect(buildDrill(quantTerms, quantTerms.slice(0, 3), 5, 1)).toEqual([]);
  });

  it("is deterministic for a given seed", () => {
    expect(buildDrill(quantTerms, allTerms, 4, 42)).toEqual(buildDrill(quantTerms, allTerms, 4, 42));
  });
});

describe("recordDrillAnswer", () => {
  const drill = {
    drillId: drillId("discount-rate", "term-to-meaning"),
    slug: "discount-rate",
    domain: "quantitative-methods",
    correct: true,
    confidence: "confident" as const,
    seconds: 8,
  };

  it("schedules the drill and stores it apart from question state", () => {
    const { progress, state } = recordDrillAnswer(defaultProgress(), drill, T0);

    expect(state.reps).toBe(1);
    expect(progress.termDrills[drill.drillId]).toBeDefined();
    // The important separation: drills must not appear in the topic review queue.
    expect(progress.questions).toEqual({});
  });

  it("awards XP under the same rules as a question", () => {
    const { progress, xp } = recordDrillAnswer(defaultProgress(), drill, T0);
    expect(xp.total).toBeGreaterThan(0);
    expect(progress.gamification.xp).toBe(xp.total);
  });

  it("does not pay the same drill twice in a day", () => {
    const first = recordDrillAnswer(defaultProgress(), drill, T0);
    const second = recordDrillAnswer(first.progress, drill, T0 + 60_000);
    expect(second.xp.total).toBe(0);
    expect(second.progress.gamification.xp).toBe(first.xp.total);
  });

  it("counts toward the day's minutes and confidence tallies", () => {
    const { progress } = recordDrillAnswer(defaultProgress(), drill, T0);
    const day = progress.daily[dayKey(T0)];
    expect(day).toMatchObject({
      answered: 1,
      correct: 1,
      seconds: 8,
      byConfidence: { confident: { correct: 1, total: 1 } },
    });
  });

  it("counts as a review once the drill has come due, so it can carry a streak day", () => {
    // A glossary review is a real review — that is the whole point of the mode.
    const first = recordDrillAnswer(defaultProgress(), drill, T0);
    expect(first.wasReview).toBe(false);

    const due = first.progress.termDrills[drill.drillId]?.dueAt ?? T0;
    const second = recordDrillAnswer(first.progress, drill, due + 1000);
    expect(second.wasReview).toBe(true);
    expect(second.progress.daily[dayKey(due + 1000)]?.reviews).toBe(1);
  });

  it("keeps the two directions on independent schedules", () => {
    const forward = recordDrillAnswer(defaultProgress(), drill, T0);
    const backward = recordDrillAnswer(forward.progress, {
      ...drill,
      drillId: drillId("discount-rate", "meaning-to-term"),
    }, T0);

    expect(Object.keys(backward.progress.termDrills)).toHaveLength(2);
  });

  it("does not mutate the progress it was given", () => {
    const before = defaultProgress();
    const snapshot = JSON.stringify(before);
    recordDrillAnswer(before, drill, T0);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe("termProgress", () => {
  const base = { termsSeen: {}, termDrills: {} };

  it("reports a term never met", () => {
    expect(termProgress("x", base, T0).status).toBe("unseen");
  });

  it("reports a term seen but not drilled", () => {
    const p = { ...base, termsSeen: { x: T0 } };
    const info = termProgress("x", p, T0);
    expect(info.status).toBe("seen");
    expect(info.seenAt).toBe(T0);
  });

  it("reports a drilled term", () => {
    const state = sm2Scheduler.next(
      sm2Scheduler.create(drillId("x", "term-to-meaning"), "d", 2, T0),
      { correct: true, confidence: "confident" },
      T0,
    );
    const p = { termsSeen: { x: T0 }, termDrills: { [drillId("x", "term-to-meaning")]: state } };
    expect(termProgress("x", p, T0).status).toBe("drilled");
  });

  it("marks a term shaky when it is mostly being missed", () => {
    let state = sm2Scheduler.create(drillId("x", "term-to-meaning"), "d", 2, T0);
    for (let i = 0; i < 3; i++) {
      state = sm2Scheduler.next(state, { correct: false, confidence: "unsure" }, T0 + i * DAY_MS);
    }
    const p = { termsSeen: { x: T0 }, termDrills: { [drillId("x", "term-to-meaning")]: state } };
    expect(termProgress("x", p, T0).status).toBe("shaky");
  });

  it("only calls a term known once it has survived a real gap", () => {
    // Right once is not "known"; the interval has to have stretched.
    let state = sm2Scheduler.create(drillId("x", "term-to-meaning"), "d", 2, T0);
    let now = T0;
    for (let i = 0; i < 4; i++) {
      state = sm2Scheduler.next(state, { correct: true, confidence: "confident" }, now);
      now += state.intervalDays * DAY_MS;
    }
    const p = { termsSeen: { x: T0 }, termDrills: { [drillId("x", "term-to-meaning")]: state } };
    const info = termProgress("x", p, T0);
    expect(info.intervalDays).toBeGreaterThanOrEqual(7);
    expect(info.status).toBe("known");
  });

  it("aggregates attempts across both directions", () => {
    const make = (correct: boolean) =>
      sm2Scheduler.next(sm2Scheduler.create("id", "d", 2, T0), { correct, confidence: "confident" }, T0);
    const p = {
      termsSeen: { x: T0 },
      termDrills: {
        [drillId("x", "term-to-meaning")]: make(true),
        [drillId("x", "meaning-to-term")]: make(false),
      },
    };
    const info = termProgress("x", p, T0);
    expect(info.attempts).toBe(2);
    expect(info.correct).toBe(1);
  });

  it("counts how many directions are due right now", () => {
    const overdue = scheduled("id", T0 - DAY_MS, { totalCount: 1, correctCount: 1, lastGrade: 5 });
    const p = {
      termsSeen: { x: T0 },
      termDrills: {
        [drillId("x", "term-to-meaning")]: overdue,
        [drillId("x", "meaning-to-term")]: overdue,
      },
    };
    expect(termProgress("x", p, T0).dueCount).toBe(2);
  });
});
