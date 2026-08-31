/**
 * Application state.
 *
 * Zustand rather than Context because progress writes fire on every answer and
 * selector subscriptions keep that from re-rendering the whole tree (CLAUDE.md §3).
 * Persistence goes through src/storage, not Zustand's persist middleware, so
 * versioning and migrations stay under our control.
 *
 * IMPORTANT: Zustand v5 has no default equality check. Never write a selector that
 * returns a fresh object or array — select one value, or one action, at a time.
 */

import { create } from "zustand";

import { glossary, loadTopic, manifestTopic } from "../content/loader";
import type { LessonBlock, Question, Topic } from "../content/schema";
import {
  gradeAnswer,
  isAnswerable,
  type Confidence,
  type Grade,
  type Response,
} from "../engine/grading";
import type { EarnedBadge } from "../engine/badges";
import { recordAnswer } from "../engine/record";
import {
  DRILL_DIFFICULTY,
  buildDrill,
  drillPool,
  recordDrillAnswer,
  type DrillDirection,
  type DrillItem,
} from "../engine/glossary";
import { badgeContextFor, pendingFreezes } from "./selectors";
import type { QuestionState } from "../engine/scheduler";
import {
  applyEffects,
  applyTheme,
  defaultProgress,
  flush,
  load,
  save,
  type Effects,
  type LoadStatus,
  type ProgressState,
  type Theme,
} from "../storage";
import type { SessionLength } from "../storage/progressSchema";

/**
 * Upper bound on the time credited to one question. Without it, a tab left open over
 * lunch would report a forty-minute answer and wreck the daily minutes figure.
 * Proper active-time tracking arrives with session resume in M6.
 */
const MAX_SECONDS_PER_QUESTION = 300;

export type SessionMode = "learn" | "review" | "drill";

export interface QuizItem {
  question: Question;
  topicId: string;
  response: Response | null;
  confidence: Confidence | null;
  grade: Grade | null;
  revealed: boolean;
  /** When this question was first shown, for the time credited to it. */
  shownAt: number | null;
  /** Scheduling state after submitting — drives "comes back in ..." in the UI. */
  scheduled: QuestionState | null;
  /** True when the scheduler had flagged this for re-teaching before we asked it. */
  wasFlaggedForReteach: boolean;
  /** XP this answer earned. 0 is a real outcome, not a missing value. */
  xpAwarded: number;
  /** Set when the award was suppressed, so the UI can say why it was zero. */
  xpSkipped: "incorrect" | "already-earned-today" | null;
  /** Present on glossary drills; routes recording to the term store. */
  drill: { slug: string; domain: string; direction: DrillDirection } | null;
}

export interface QuizSession {
  mode: SessionMode;
  title: string;
  /** Set for a single-topic session; null for a mixed review. */
  topicId: string | null;
  items: QuizItem[];
  /** Lesson blocks available for post-miss re-reads, keyed by topic. */
  lessonBlocks: Record<string, LessonBlock[]>;
  index: number;
  startedAt: number;
  finishedAt: number | null;
  /** Badges earned during this session, to announce at the end. */
  badgesEarned: EarnedBadge[];
}

export interface SessionSpec {
  mode: SessionMode;
  title: string;
  topicId: string | null;
  items: {
    question: Question;
    topicId: string;
    drill?: { slug: string; domain: string; direction: DrillDirection };
  }[];
  lessonBlocks: Record<string, LessonBlock[]>;
}

interface AppState {
  /* ---- persisted ---- */
  progress: ProgressState;
  storageStatus: LoadStatus | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setEffects: (effects: Effects) => void;
  toggleEffects: () => void;
  setSessionLength: (minutes: SessionLength) => void;
  setDailyGoal: (minutes: number) => void;

  /* ---- transient quiz session ---- */
  session: QuizSession | null;

  beginSession: (spec: SessionSpec) => void;
  startTopicQuiz: (topic: Topic) => void;
  startReviewSession: (questionIds: string[]) => Promise<number>;
  startDrillSession: (count: number) => number;
  markTermsSeen: (slugs: string[]) => void;
  setResponse: (response: Response) => void;
  setConfidence: (confidence: Confidence) => void;
  reveal: () => void;
  submit: () => void;
  next: () => void;
  endQuiz: () => void;
}

export const useApp = create<AppState>((set, get) => ({
  progress: defaultProgress(),
  storageStatus: null,
  hydrated: false,

  async hydrate() {
    const { state, status } = await load();
    applyTheme(state.settings.theme);
    applyEffects(state.settings.effects);

    // Spend freeze days on boot, so a streak survives a gap the user was away for.
    // freezesToApply only returns days when the allowance covers the whole gap.
    const freezes = pendingFreezes(state, Date.now());
    const progress =
      freezes.length === 0
        ? state
        : {
            ...state,
            gamification: {
              ...state.gamification,
              frozenDays: [...state.gamification.frozenDays, ...freezes],
            },
          };

    set({ progress, storageStatus: status, hydrated: true });
    if (status.kind === "fresh" || freezes.length > 0) save(progress);
  },

  setTheme(theme) {
    const progress = { ...get().progress, settings: { ...get().progress.settings, theme } };
    applyTheme(theme);
    set({ progress });
    save(progress);
  },

  toggleTheme() {
    get().setTheme(get().progress.settings.theme === "dark" ? "light" : "dark");
  },

  setEffects(effects) {
    const progress = { ...get().progress, settings: { ...get().progress.settings, effects } };
    applyEffects(effects);
    set({ progress });
    save(progress);
  },

  toggleEffects() {
    get().setEffects(get().progress.settings.effects === "calm" ? "full" : "calm");
  },

  setSessionLength(sessionLength) {
    const progress = { ...get().progress, settings: { ...get().progress.settings, sessionLength } };
    set({ progress });
    save(progress);
  },

  setDailyGoal(dailyGoalMinutes) {
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, dailyGoalMinutes },
    };
    set({ progress });
    save(progress);
  },

  session: null,

  beginSession(spec) {
    const now = Date.now();
    const states = get().progress.questions;

    set({
      session: {
        mode: spec.mode,
        title: spec.title,
        topicId: spec.topicId,
        lessonBlocks: spec.lessonBlocks,
        items: spec.items.map((item, i) => ({
          question: item.question,
          topicId: item.topicId,
          response: null,
          confidence: null,
          grade: null,
          revealed: false,
          // Only the first item is on screen; the rest get stamped on arrival.
          shownAt: i === 0 ? now : null,
          scheduled: null,
          wasFlaggedForReteach: states[item.question.id]?.needsReteach ?? false,
          xpAwarded: 0,
          xpSkipped: null,
          drill: item.drill ?? null,
        })),
        index: 0,
        startedAt: now,
        finishedAt: null,
        badgesEarned: [],
      },
    });
  },

  startTopicQuiz(topic) {
    get().beginSession({
      mode: "learn",
      title: topic.title,
      topicId: topic.id,
      // M1/M2 ask every question in file order. The time-budgeted composer that
      // mixes due reviews, weak areas and new material arrives in M6.
      items: topic.questions.map((question) => ({ question, topicId: topic.id })),
      lessonBlocks: { [topic.id]: topic.lesson },
    });
  },

  /**
   * Build a mixed review from due question ids. Returns how many questions were
   * actually assembled — ids whose content has since changed or been removed are
   * skipped rather than crashing the session.
   */
  async startReviewSession(questionIds) {
    const wanted = new Set(questionIds);
    const topicIds = [
      ...new Set(
        questionIds
          .map((id) => get().progress.questions[id]?.topicId)
          .filter((id): id is string => id !== undefined && manifestTopic(id) !== undefined),
      ),
    ];

    const topics = await Promise.all(topicIds.map((id) => loadTopic(id)));

    const items: { question: Question; topicId: string }[] = [];
    const lessonBlocks: Record<string, LessonBlock[]> = {};

    for (const topic of topics) {
      lessonBlocks[topic.id] = topic.lesson;
      for (const question of topic.questions) {
        if (wanted.has(question.id)) items.push({ question, topicId: topic.id });
      }
    }

    // Preserve the caller's ordering (most overdue first), not file order.
    const rank = new Map(questionIds.map((id, i) => [id, i]));
    items.sort((a, b) => (rank.get(a.question.id) ?? 0) - (rank.get(b.question.id) ?? 0));

    if (items.length === 0) return 0;

    get().beginSession({
      mode: "review",
      title: "Review",
      topicId: null,
      items,
      lessonBlocks,
    });
    return items.length;
  },

  /**
   * Build a glossary drill. Synchronous: the glossary is loaded eagerly, so no topic
   * bodies are needed. Returns how many questions were assembled — 0 when nothing is
   * eligible, which the caller turns into a message rather than an empty session.
   */
  startDrillSession(count) {
    const progress = get().progress;
    const now = Date.now();
    const terms = [...glossary.values()];

    const seen = new Set(Object.keys(progress.termsSeen));
    let pool = drillPool(terms, { seen, drills: progress.termDrills, now });

    // If the user has barely read anything yet, fall back to unseen terms rather
    // than refusing to drill at all.
    if (pool.length === 0) {
      pool = drillPool(terms, { seen, drills: progress.termDrills, now, allowUnseen: true });
    }

    // Seeded on the day, so re-entering the same drill does not reshuffle mid-set.
    const items = buildDrill(pool, terms, count, Math.floor(now / 60_000));
    if (items.length === 0) return 0;

    get().beginSession({
      mode: "drill",
      title: "Glossary drill",
      topicId: null,
      items: items.map((item) => ({
        question: drillToQuestion(item),
        topicId: item.term.domain,
        drill: { slug: item.slug, domain: item.term.domain, direction: item.direction },
      })),
      lessonBlocks: {},
    });
    return items.length;
  },

  /** Mark terms as met. Only writes when something is genuinely new. */
  markTermsSeen(slugs) {
    const progress = get().progress;
    const now = Date.now();

    const additions: Record<string, number> = {};
    for (const slug of slugs) {
      if (progress.termsSeen[slug] === undefined) additions[slug] = now;
    }
    if (Object.keys(additions).length === 0) return;

    const next = {
      ...progress,
      termsSeen: { ...progress.termsSeen, ...additions },
    };
    set({ progress: next });
    save(next);
  },

  setResponse(response) {
    set((s) => patchCurrent(s, (item) => ({ ...item, response })));
  },

  setConfidence(confidence) {
    set((s) => patchCurrent(s, (item) => ({ ...item, confidence })));
  },

  reveal() {
    set((s) => patchCurrent(s, (item) => ({ ...item, revealed: true })));
  },

  submit() {
    const state = get();
    const session = state.session;
    if (!session) return;

    const item = session.items[session.index];
    if (!item) return;
    if (item.grade !== null) return; // already submitted; ignore a repeated Enter
    if (item.confidence === null) return; // confidence is required before grading
    if (!isAnswerable(item.question, item.response)) return;

    const grade = gradeAnswer(item.question, item.response);
    const now = Date.now();
    const seconds = Math.min(
      MAX_SECONDS_PER_QUESTION,
      Math.max(0, (now - (item.shownAt ?? now)) / 1000),
    );

    // Glossary drills schedule against termDrills, not questions, so they never
    // enter the topic review queue. Same XP rules, same daily aggregate.
    if (item.drill !== null) {
      const result = recordDrillAnswer(
        state.progress,
        {
          drillId: item.question.id,
          slug: item.drill.slug,
          domain: item.drill.domain,
          correct: grade.correct,
          confidence: item.confidence,
          seconds,
        },
        now,
      );

      const drillItems = session.items.slice();
      drillItems[session.index] = {
        ...item,
        grade,
        revealed: true,
        scheduled: result.state,
        xpAwarded: result.xp.total,
        xpSkipped: result.xp.skipped,
      };

      set({ progress: result.progress, session: { ...session, items: drillItems } });
      save(result.progress);
      return;
    }

    // Everything persisted flows through one pure function, so the scheduling and
    // bookkeeping path is the same one the tests exercise.
    const {
      progress,
      state: scheduled,
      xp,
      badges,
    } = recordAnswer(
      state.progress,
      {
        questionId: item.question.id,
        topicId: item.topicId,
        difficulty: item.question.difficulty,
        correct: grade.correct,
        confidence: item.confidence,
        seconds,
      },
      now,
      { badgeContext: (p) => badgeContextFor(p, now) },
    );

    const items = session.items.slice();
    items[session.index] = {
      ...item,
      grade,
      revealed: true,
      scheduled,
      xpAwarded: xp.total,
      xpSkipped: xp.skipped,
    };

    set({
      progress,
      session: {
        ...session,
        items,
        badgesEarned: [...session.badgesEarned, ...badges],
      },
    });
    save(progress);
  },

  next() {
    const session = get().session;
    if (!session) return;

    if (session.index >= session.items.length - 1) {
      set({ session: { ...session, finishedAt: Date.now() } });
      void flush();
      return;
    }

    const nextIndex = session.index + 1;
    const items = session.items.slice();
    const upcoming = items[nextIndex];
    if (upcoming && upcoming.shownAt === null) {
      items[nextIndex] = { ...upcoming, shownAt: Date.now() };
    }

    set({ session: { ...session, index: nextIndex, items } });
  },

  endQuiz() {
    void flush();
    set({ session: null });
  },
}));

function patchCurrent(state: AppState, patch: (item: QuizItem) => QuizItem): Partial<AppState> {
  const session = state.session;
  if (!session) return {};
  const current = session.items[session.index];
  if (!current) return {};

  const items = session.items.slice();
  items[session.index] = patch(current);
  return { session: { ...session, items } };
}

/* ---- selectors: scalars and stable references only ---- */

export const selectCurrentItem = (s: AppState): QuizItem | null =>
  s.session?.items[s.session.index] ?? null;

export const selectAnsweredCount = (s: AppState): number =>
  s.session?.items.filter((i) => i.grade !== null).length ?? 0;

export const selectTotalCount = (s: AppState): number => s.session?.items.length ?? 0;

export const selectXp = (s: AppState): number => s.progress.gamification.xp;

export const selectSessionXp = (s: AppState): number =>
  s.session?.items.reduce((n, i) => n + i.xpAwarded, 0) ?? 0;

/**
 * Adapt a generated drill into the Question shape the session UI already renders.
 *
 * Deliberately not run through the content Zod schema: these are generated, not
 * authored, and their ids are namespaced (`term:slug:t2m`) precisely so they can
 * never be mistaken for content.
 */
function drillToQuestion(item: DrillItem): Question {
  const isTermToMeaning = item.direction === "term-to-meaning";

  return {
    id: item.id,
    type: "mcq",
    difficulty: DRILL_DIFFICULTY,
    tags: ["glossary", item.direction],
    stem: isTermToMeaning
      ? `What does **${item.term.term}** mean?`
      : `Which term means this?

"${item.term.plain}"`,
    choices: item.choices,
    answerIndex: item.answerIndex,
    rationales: item.rationales,
    explanation: isTermToMeaning
      ? `**${item.term.term}** — ${item.term.plain}

More formally: ${item.term.formal}`
      : `That is **${item.term.term}**.

More formally: ${item.term.formal}`,
  };
}
