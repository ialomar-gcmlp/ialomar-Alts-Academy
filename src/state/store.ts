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

import { loadTopic, manifestTopic } from "../content/loader";
import type { LessonBlock, Question, Topic } from "../content/schema";
import {
  gradeAnswer,
  isAnswerable,
  type Confidence,
  type Grade,
  type Response,
} from "../engine/grading";
import { recordAnswer } from "../engine/record";
import type { QuestionState } from "../engine/scheduler";
import {
  applyTheme,
  defaultProgress,
  flush,
  load,
  save,
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

export type SessionMode = "learn" | "review";

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
}

export interface SessionSpec {
  mode: SessionMode;
  title: string;
  topicId: string | null;
  items: { question: Question; topicId: string }[];
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
  setSessionLength: (minutes: SessionLength) => void;
  setDailyGoal: (minutes: number) => void;

  /* ---- transient quiz session ---- */
  session: QuizSession | null;

  beginSession: (spec: SessionSpec) => void;
  startTopicQuiz: (topic: Topic) => void;
  startReviewSession: (questionIds: string[]) => Promise<number>;
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
    set({ progress: state, storageStatus: status, hydrated: true });
    if (status.kind === "fresh") save(state);
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
        })),
        index: 0,
        startedAt: now,
        finishedAt: null,
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

    // Everything persisted flows through one pure function, so the scheduling and
    // bookkeeping path is the same one the tests exercise.
    const { progress, state: scheduled } = recordAnswer(
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
    );

    const items = session.items.slice();
    items[session.index] = { ...item, grade, revealed: true, scheduled };

    set({ progress, session: { ...session, items } });
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
