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
  flushSync,
  load,
  save,
  type Effects,
  type LoadStatus,
  type ProgressState,
  type Theme,
} from "../storage";
import type { SavedSession, SessionLength } from "../storage/progressSchema";
import {
  bankSpan,
  isResumable,
  resume as resumeClockAt,
  split,
  startClock,
  type ActiveClock,
} from "../engine/activeTime";
import { fromSaved, savedTopicIds, toSaved } from "./sessionPersist";

/**
 * Time credited to a question comes from src/engine/activeTime.ts, which pauses when
 * the tab is hidden and caps any single span. It replaced a blunt 300-second-per-
 * question ceiling in M6; the cap is now per uninterrupted span rather than per
 * question, so a genuinely long question is credited and an abandoned tab is not.
 */

export type SessionMode = "learn" | "review" | "drill" | "exam";

export interface QuizItem {
  question: Question;
  topicId: string;
  response: Response | null;
  confidence: Confidence | null;
  grade: Grade | null;
  revealed: boolean;
  /** Active milliseconds credited to this question, banked as the session moves on. */
  activeMs: number;
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
  /** Set for a mock exam, so the attempt is recorded against the right domain. */
  examDomain: string | null;
  items: QuizItem[];
  /** Lesson blocks available for post-miss re-reads, keyed by topic. */
  lessonBlocks: Record<string, LessonBlock[]>;
  index: number;
  startedAt: number;
  finishedAt: number | null;
  /** Badges earned during this session, to announce at the end. */
  badgesEarned: EarnedBadge[];
  /** Active-time clock. Runs while the tab is visible and the session is unfinished. */
  clock: ActiveClock;
}

export interface SessionSpec {
  mode: SessionMode;
  title: string;
  topicId: string | null;
  examDomain?: string | null;
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

  /* ---- session resume (M6) ---- */

  /** Bank the running span and stop the clock — called when the tab is hidden. */
  pauseSession: () => void;
  /** Start the clock again — called when the tab becomes visible. */
  resumeSession: () => void;
  /** Rebuild the saved session into a live one. Returns false if it could not be used. */
  resumeSaved: () => Promise<boolean>;
  /** Throw away the saved session without resuming it. */
  discardSaved: () => void;
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
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, theme },
    };
    applyTheme(theme);
    set({ progress });
    save(progress);
  },

  toggleTheme() {
    get().setTheme(get().progress.settings.theme === "dark" ? "light" : "dark");
  },

  setEffects(effects) {
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, effects },
    };
    applyEffects(effects);
    set({ progress });
    save(progress);
  },

  toggleEffects() {
    get().setEffects(
      get().progress.settings.effects === "calm" ? "full" : "calm",
    );
  },

  setSessionLength(sessionLength) {
    const progress = {
      ...get().progress,
      settings: { ...get().progress.settings, sessionLength },
    };
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

    const session: QuizSession = {
      mode: spec.mode,
      title: spec.title,
      topicId: spec.topicId,
      examDomain: spec.examDomain ?? null,
      lessonBlocks: spec.lessonBlocks,
      items: spec.items.map((item) => ({
        question: item.question,
        topicId: item.topicId,
        response: null,
        confidence: null,
        grade: null,
        revealed: false,
        activeMs: 0,
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
      clock: startClock(now),
    };

    set({ session, progress: persistSession(get().progress, session, now) });
  },

  startTopicQuiz(topic) {
    get().beginSession({
      mode: "learn",
      title: topic.title,
      topicId: topic.id,
      // M1/M2 ask every question in file order. The time-budgeted composer that
      // mixes due reviews, weak areas and new material arrives in M6.
      items: topic.questions.map((question) => ({
        question,
        topicId: topic.id,
      })),
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
          .filter(
            (id): id is string =>
              id !== undefined && manifestTopic(id) !== undefined,
          ),
      ),
    ];

    const topics = await Promise.all(topicIds.map((id) => loadTopic(id)));

    const items: { question: Question; topicId: string }[] = [];
    const lessonBlocks: Record<string, LessonBlock[]> = {};

    for (const topic of topics) {
      lessonBlocks[topic.id] = topic.lesson;
      for (const question of topic.questions) {
        if (wanted.has(question.id))
          items.push({ question, topicId: topic.id });
      }
    }

    // Preserve the caller's ordering (most overdue first), not file order.
    const rank = new Map(questionIds.map((id, i) => [id, i]));
    items.sort(
      (a, b) => (rank.get(a.question.id) ?? 0) - (rank.get(b.question.id) ?? 0),
    );

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
      pool = drillPool(terms, {
        seen,
        drills: progress.termDrills,
        now,
        allowUnseen: true,
      });
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
        drill: {
          slug: item.slug,
          domain: item.term.domain,
          direction: item.direction,
        },
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

    // Bank the span that belongs to this question. The clock keeps running: the
    // explanation the user is about to read is part of the session's active time,
    // and it gets credited to the next question when they advance.
    const { banked, clock } = split(session.clock, now);
    const itemActiveMs = item.activeMs + banked;
    const seconds = Math.round(itemActiveMs / 1000);

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
        activeMs: itemActiveMs,
        scheduled: result.state,
        xpAwarded: result.xp.total,
        xpSkipped: result.xp.skipped,
      };

      // Drills are not resumable, so no snapshot is written for them.
      set({
        progress: result.progress,
        session: { ...session, items: drillItems, clock },
      });
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
      activeMs: itemActiveMs,
      scheduled,
      xpAwarded: xp.total,
      xpSkipped: xp.skipped,
    };

    const updated: QuizSession = {
      ...session,
      items,
      clock,
      badgesEarned: [...session.badgesEarned, ...badges],
    };

    // Snapshot with the answer included, so a tab closed on the explanation screen
    // resumes on the next question rather than re-asking this one.
    set({ progress: persistSession(progress, updated, now), session: updated });
  },

  next() {
    const state = get();
    const session = state.session;
    if (!session) return;

    const now = Date.now();

    if (session.index >= session.items.length - 1) {
      // Finished. Bank the last span, then clear the snapshot — a result screen is
      // not work in progress, and leaving it would offer to resume a done session.
      const finished: QuizSession = {
        ...bankCurrentSpan(session, now, true),
        finishedAt: now,
      };
      set({ progress: clearSavedSession(state.progress), session: finished });
      void flush();
      return;
    }

    // The span so far belongs to the question being left behind.
    const banked = bankCurrentSpan(session, now, false);
    const advanced: QuizSession = { ...banked, index: banked.index + 1 };
    set({
      progress: persistSession(state.progress, advanced, now),
      session: advanced,
    });
  },

  endQuiz() {
    const state = get();
    // Leaving mid-session deliberately KEEPS the snapshot: that is exactly the case
    // resume exists for. Only finishing clears it.
    if (state.session !== null && state.session.finishedAt === null) {
      const now = Date.now();
      const paused = bankCurrentSpan(state.session, now, true);
      set({ progress: persistSession(state.progress, paused, now) });
    }
    void flush();
    set({ session: null });
  },

  /* ---- session resume ---- */

  pauseSession() {
    const session = get().session;
    if (!session || session.finishedAt !== null) return;
    const now = Date.now();
    const paused = bankCurrentSpan(session, now, true);
    // Persist on hide as well as on answer: a tab closed from a hidden state never
    // gets another event, so this is the last chance to record the time.
    set({
      progress: persistSession(get().progress, paused, now),
      session: paused,
    });

    // Written synchronously, not left to the debounce. The storage module has its own
    // visibilitychange flush, but it was registered first and therefore already ran
    // with the PRE-pause state — so a debounced write here would be lost with the tab.
    flushSync();
  },

  resumeSession() {
    const session = get().session;
    if (!session || session.finishedAt !== null) return;
    set({
      session: { ...session, clock: resumeClockAt(session.clock, Date.now()) },
    });
  },

  async resumeSaved() {
    const state = get();
    const saved = state.progress.activeSession;
    if (saved === null) return false;
    if (!isResumable(saved.savedAt, Date.now())) {
      state.discardSaved();
      return false;
    }

    // Load every topic the snapshot references, then rebuild from ids.
    const topicIds = savedTopicIds(saved).filter(
      (id) => manifestTopic(id) !== undefined,
    );
    const topics = await Promise.all(topicIds.map((id) => loadTopic(id)));

    const byId = new Map<string, Question>();
    const lessonBlocks: Record<string, LessonBlock[]> = {};
    for (const topic of topics) {
      lessonBlocks[topic.id] = topic.lesson;
      for (const question of topic.questions) byId.set(question.id, question);
    }

    const rebuilt = fromSaved(
      saved,
      (id) => byId.get(id),
      lessonBlocks,
      (id) => get().progress.questions[id]?.needsReteach ?? false,
    );

    if (rebuilt === null) {
      get().discardSaved();
      return false;
    }

    set({
      session: {
        ...rebuilt.session,
        clock: resumeClockAt(rebuilt.session.clock, Date.now()),
      },
    });
    return true;
  },

  discardSaved() {
    const progress = clearSavedSession(get().progress);
    set({ progress });
  },
}));

/**
 * Bank the span in progress against the question currently on screen.
 *
 * Every transition that ends a span has to do this, not just answering: if a pause
 * banked time into the session clock alone, the question's own dwell would lose it,
 * and the per-question seconds passed to the scheduler would under-report every
 * time the tab was hidden. Crediting here keeps one invariant true —
 *
 *   sum(items[].activeMs) === clock.accumulatedMs
 *
 * — which is what makes the session total and the question times agree.
 *
 * `stop: true` leaves the clock paused; `false` starts the next span immediately.
 */
function bankCurrentSpan(
  session: QuizSession,
  now: number,
  stop: boolean,
): QuizSession {
  const { items, clock } = bankSpan(
    session.clock,
    session.items,
    session.index,
    now,
    stop,
  );
  return { ...session, items, clock };
}

/**
 * Write the session snapshot into progress and save.
 *
 * Returns the new progress rather than setting it, so the caller can apply it in the
 * same `set` as the session and never render a state where the two disagree.
 *
 * A drill produces no snapshot, and must not clear one belonging to a real session
 * the user has half-finished — hence the early return rather than writing null.
 */
function persistSession(
  progress: ProgressState,
  session: QuizSession,
  now: number,
): ProgressState {
  const saved = toSaved(session, now);
  if (saved === null) return progress;

  const next: ProgressState = { ...progress, activeSession: saved };
  save(next);
  return next;
}

/** Drop the snapshot. Used on finish and on explicit discard. */
function clearSavedSession(progress: ProgressState): ProgressState {
  if (progress.activeSession === null) return progress;
  const next: ProgressState = { ...progress, activeSession: null };
  save(next);
  return next;
}

/** The saved session, if there is one recent enough to offer. */
export function selectResumableSession(s: AppState): SavedSession | null {
  const saved = s.progress.activeSession;
  if (saved === null) return null;
  return isResumable(saved.savedAt, Date.now()) ? saved : null;
}

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

/* ---- selectors: scalars and stable references only ---- */

export const selectCurrentItem = (s: AppState): QuizItem | null =>
  s.session?.items[s.session.index] ?? null;

export const selectAnsweredCount = (s: AppState): number =>
  s.session?.items.filter((i) => i.grade !== null).length ?? 0;

export const selectTotalCount = (s: AppState): number =>
  s.session?.items.length ?? 0;

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
