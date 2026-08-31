/**
 * Application state.
 *
 * Zustand rather than Context because progress writes fire on every answer and
 * selector subscriptions keep that from re-rendering the whole tree (CLAUDE.md §3).
 * Persistence goes through src/storage, not Zustand's persist middleware, so
 * versioning and migrations stay under our control.
 */

import { create } from "zustand";

import type { LessonBlock, Question, Topic } from "../content/schema";
import {
  gradeAnswer,
  isAnswerable,
  type Confidence,
  type Grade,
  type Response,
} from "../engine/grading";
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

export interface QuizItem {
  question: Question;
  response: Response | null;
  confidence: Confidence | null;
  grade: Grade | null;
  /** Explanation shown. Set on submit, or by Space before submitting is possible. */
  revealed: boolean;
}

export interface QuizSession {
  topicId: string;
  topicTitle: string;
  items: QuizItem[];
  /** Kept alongside the questions so a confident miss can re-show the concept
   *  block it points at, without reloading the topic. */
  lessonBlocks: LessonBlock[];
  index: number;
  startedAt: number;
  finishedAt: number | null;
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

  startQuiz: (topic: Topic) => void;
  setResponse: (response: Response) => void;
  setConfidence: (confidence: Confidence) => void;
  reveal: () => void;
  submit: () => void;
  next: () => void;
  endQuiz: () => void;
}

function persist(state: ProgressState): void {
  save(state);
}

export const useApp = create<AppState>((set, get) => ({
  progress: defaultProgress(),
  storageStatus: null,
  hydrated: false,

  async hydrate() {
    const { state, status } = await load();
    applyTheme(state.settings.theme);
    set({ progress: state, storageStatus: status, hydrated: true });
    // Write straight back on a fresh boot so a "last backed up" reminder and the
    // createdAt date have something to anchor to.
    if (status.kind === "fresh") persist(state);
  },

  setTheme(theme) {
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, theme },
    };
    applyTheme(theme);
    set({ progress });
    persist(progress);
  },

  toggleTheme() {
    get().setTheme(get().progress.settings.theme === "dark" ? "light" : "dark");
  },

  setSessionLength(sessionLength) {
    const progress = { ...get().progress, settings: { ...get().progress.settings, sessionLength } };
    set({ progress });
    persist(progress);
  },

  setDailyGoal(dailyGoalMinutes) {
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, dailyGoalMinutes },
    };
    set({ progress });
    persist(progress);
  },

  session: null,

  startQuiz(topic) {
    set({
      session: {
        topicId: topic.id,
        topicTitle: topic.title,
        lessonBlocks: topic.lesson,
        // M1 asks every question in file order. M2 replaces this with the session
        // composer: due reviews, weak areas and new material mixed to a time budget.
        items: topic.questions.map((question) => ({
          question,
          response: null,
          confidence: null,
          grade: null,
          revealed: false,
        })),
        index: 0,
        startedAt: Date.now(),
        finishedAt: null,
      },
    });
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
    set((s) =>
      patchCurrent(s, (item) => {
        if (item.grade !== null) return item; // already submitted; ignore a repeat Enter
        if (!isAnswerable(item.question, item.response)) return item;
        return {
          ...item,
          grade: gradeAnswer(item.question, item.response),
          revealed: true,
        };
      }),
    );
  },

  next() {
    const session = get().session;
    if (!session) return;

    if (session.index >= session.items.length - 1) {
      set({ session: { ...session, finishedAt: Date.now() } });
      return;
    }
    set({ session: { ...session, index: session.index + 1 } });
  },

  endQuiz() {
    void flush();
    set({ session: null });
  },
}));

function patchCurrent(
  state: AppState,
  patch: (item: QuizItem) => QuizItem,
): Partial<AppState> {
  const session = state.session;
  if (!session) return {};
  const current = session.items[session.index];
  if (!current) return {};

  const items = session.items.slice();
  items[session.index] = patch(current);
  return { session: { ...session, items } };
}

/* ---- selectors ---- */

export const selectCurrentItem = (s: AppState): QuizItem | null =>
  s.session?.items[s.session.index] ?? null;

/** Scalar selectors only. A selector returning a fresh object would re-render on
 *  every store change, because Zustand v5 has no default equality check. */
export const selectAnsweredCount = (s: AppState): number =>
  s.session?.items.filter((i) => i.grade !== null).length ?? 0;

export const selectTotalCount = (s: AppState): number => s.session?.items.length ?? 0;
