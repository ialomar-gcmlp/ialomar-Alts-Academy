/**
 * Badges.
 *
 * The brief was specific: badges are for mastery milestones and calibration
 * accuracy, NOT for time spent. So there is nothing here for hours logged, answers
 * attempted, or days in a row — the streak already covers persistence, and rewarding
 * volume twice would undo the point of the XP rules.
 *
 * The calibration badges are the interesting ones. "Well Calibrated" deliberately
 * requires that you sometimes admit uncertainty, so it cannot be won by tagging
 * everything Confident; and "Knows the Gaps" rewards being *usually wrong when you
 * said you were guessing", which is what honest self-assessment actually looks like.
 *
 * Once earned, a badge is never revoked. A mastery figure dipping after a fortnight
 * away should not take an achievement with it.
 */

import type { Domain } from "../content/schema";
import { PASS_GRADE, type QuestionState } from "./scheduler";
import type { AnswerEvent } from "../storage/progressSchema";

export interface BadgeContext {
  topics: { topicId: string; domain: Domain; mastery: number; started: boolean }[];
  /** `topicCount` guards the domain badges — see MIN_TOPICS_FOR_DOMAIN_BADGE. */
  domains: { domain: Domain; mastery: number; topicCount: number }[];
  questions: QuestionState[];
  events: readonly AnswerEvent[];
}

/**
 * A domain badge should mean "a whole area is hanging together". With only one or two
 * topics authored in a domain, domain mastery is just topic mastery wearing a hat —
 * and it would award the domain badge BEFORE the single-topic one, which reads as
 * broken. This guard keeps the claim honest while the content is still growing.
 */
export const MIN_TOPICS_FOR_DOMAIN_BADGE = 3;

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  /** What it takes, in one line, shown while still locked. */
  requirement: string;
  earned: (ctx: BadgeContext) => boolean;
}

/* ------------------------------------------------------------------ *
 * Helpers over the answer log
 * ------------------------------------------------------------------ */

function confidentStats(events: readonly AnswerEvent[]): { correct: number; total: number } {
  let correct = 0;
  let total = 0;
  for (const e of events) {
    if (e.c !== "confident") continue;
    total += 1;
    if (e.ok) correct += 1;
  }
  return { correct, total };
}

function guessStats(events: readonly AnswerEvent[]): { wrong: number; total: number } {
  let wrong = 0;
  let total = 0;
  for (const e of events) {
    if (e.c !== "guessing") continue;
    total += 1;
    if (!e.ok) wrong += 1;
  }
  return { wrong, total };
}

/** Share of answers where the user admitted some doubt. */
function humilityRate(events: readonly AnswerEvent[]): number {
  if (events.length === 0) return 0;
  return events.filter((e) => e.c !== "confident").length / events.length;
}

/** Questions missed at some point that have since been got right and stayed right. */
function recoveredCount(questions: QuestionState[]): number {
  return questions.filter(
    (q) => q.lapses >= 1 && q.reps >= 2 && q.lastGrade !== null && q.lastGrade >= PASS_GRADE,
  ).length;
}

const bestTopicMastery = (ctx: BadgeContext): number =>
  ctx.topics.reduce((max, t) => Math.max(max, t.mastery), 0);

/** Best mastery among domains large enough for the claim to mean something. */
const bestDomainMastery = (ctx: BadgeContext): number =>
  ctx.domains
    .filter((d) => d.topicCount >= MIN_TOPICS_FOR_DOMAIN_BADGE)
    .reduce((max, d) => Math.max(max, d.mastery), 0);

/* ------------------------------------------------------------------ *
 * Definitions
 * ------------------------------------------------------------------ */

export const BADGES: readonly BadgeDefinition[] = [
  {
    id: "groundwork",
    name: "Groundwork",
    description: "You have one topic genuinely under control.",
    requirement: "Reach 60% mastery in any topic",
    earned: (ctx) => bestTopicMastery(ctx) >= 0.6,
  },
  {
    id: "solid-ground",
    name: "Solid Ground",
    description: "A topic you could be questioned on without preparing.",
    requirement: "Reach 85% mastery in any topic",
    earned: (ctx) => bestTopicMastery(ctx) >= 0.85,
  },
  {
    id: "breadth",
    name: "Breadth",
    description: "Three topics held at once, not one at a time.",
    requirement: "Reach 60% mastery in three topics",
    earned: (ctx) => ctx.topics.filter((t) => t.mastery >= 0.6).length >= 3,
  },
  {
    id: "halfway-in",
    name: "Halfway In",
    description: "A whole domain is starting to hang together.",
    requirement: "Reach 50% mastery across any domain of 3+ topics",
    earned: (ctx) => bestDomainMastery(ctx) >= 0.5,
  },
  {
    id: "domain-authority",
    name: "Domain Authority",
    description: "An entire domain at a level you can rely on.",
    requirement: "Reach 80% mastery across any domain of 3+ topics",
    earned: (ctx) => bestDomainMastery(ctx) >= 0.8,
  },
  {
    id: "day-job",
    name: "Day Job",
    description: "Alternatives is the part that pays the bills. This says you know it.",
    requirement: "Reach 70% mastery across Alternative Investments (3+ topics)",
    earned: (ctx) => {
      const alts = ctx.domains.find((d) => d.domain === "alternatives");
      if (!alts || alts.topicCount < MIN_TOPICS_FOR_DOMAIN_BADGE) return false;
      return alts.mastery >= 0.7;
    },
  },
  {
    id: "well-calibrated",
    name: "Well Calibrated",
    description:
      "When you say you are sure, you are right — and you still admit doubt when you have it.",
    requirement:
      "25+ confident answers at 90%+ accuracy, with doubt admitted on at least 10% of all answers",
    earned: (ctx) => {
      const { correct, total } = confidentStats(ctx.events);
      if (total < 25) return false;
      if (correct / total < 0.9) return false;
      // Without this clause the badge is won by never admitting uncertainty.
      return humilityRate(ctx.events) >= 0.1;
    },
  },
  {
    id: "knows-the-gaps",
    name: "Knows the Gaps",
    description:
      "When you say you are guessing, you usually are. Knowing what you do not know is the harder half.",
    requirement: "15+ answers tagged Guessing, of which 70%+ were indeed wrong",
    earned: (ctx) => {
      const { wrong, total } = guessStats(ctx.events);
      return total >= 15 && wrong / total >= 0.7;
    },
  },
  {
    id: "sure-footed",
    name: "Sure Footed",
    description: "Fifty answers without once being confidently wrong.",
    requirement: "50 consecutive answers with no confident miss",
    earned: (ctx) => {
      const last = ctx.events.slice(-50);
      if (last.length < 50) return false;
      return !last.some((e) => e.c === "confident" && !e.ok);
    },
  },
  {
    id: "second-time-sticks",
    name: "Second Time Sticks",
    description: "Ten questions you got wrong, went back to, and now hold.",
    requirement: "Recover 10 previously-missed questions and keep them right",
    earned: (ctx) => recoveredCount(ctx.questions) >= 10,
  },
];

export const badgeById = new Map(BADGES.map((b) => [b.id, b]));

/* ------------------------------------------------------------------ *
 * Evaluation
 * ------------------------------------------------------------------ */

export interface EarnedBadge {
  id: string;
  earnedAt: number;
}

/**
 * Badges newly earned by this state. Already-earned ids are never re-evaluated, so a
 * badge cannot be lost — and the result is only the *new* ones, which is what the
 * end-of-session summary wants to announce.
 */
export function newlyEarned(
  ctx: BadgeContext,
  already: readonly EarnedBadge[],
  now: number,
): EarnedBadge[] {
  const have = new Set(already.map((b) => b.id));
  return BADGES.filter((b) => !have.has(b.id) && b.earned(ctx)).map((b) => ({
    id: b.id,
    earnedAt: now,
  }));
}
