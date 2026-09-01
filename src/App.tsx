/**
 * App shell: header, route switch, footer.
 *
 * Routing is the hand-rolled hash router (src/lib/hashRouter.ts), so this builds to
 * static files that work from file:// or any static host with no rewrite rules.
 */

import { useEffect, useState } from "react";

import { useRoute, navigate } from "./lib/hashRouter";
import { useHotkeys } from "./lib/keyboard";
import { installFlushHandlers } from "./storage";
import { level, streak } from "./state/selectors";
import { useApp } from "./state/store";
import { Exams } from "./views/Exams";
import { GlossaryPage } from "./views/GlossaryPage";
import { Home } from "./views/Home";
import { ReviewQueue } from "./views/ReviewQueue";
import { Session } from "./views/Session";
import { Progress } from "./views/Progress";
import { Topic } from "./views/Topic";
import { EmptyState, Kbd, Ring } from "./ui/primitives";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { Icon } from "./ui/icons";

const NAV = [
  { path: "", label: "Topics" },
  { path: "progress", label: "Progress" },
  { path: "exams", label: "Exams" },
  { path: "glossary", label: "Glossary" },
  { path: "review-queue", label: "Review queue" },
] as const;

function Header() {
  const route = useRoute();
  const theme = useApp((s) => s.progress.settings.theme);
  const effects = useApp((s) => s.progress.settings.effects);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const toggleEffects = useApp((s) => s.toggleEffects);
  const active = route.segments[0] ?? "";

  return (
    <header className="sticky top-0 z-30 border-b border-border-base bg-surface/95 backdrop-blur">
      {/* Wraps to two rows on a phone — brand and status first, nav underneath.
          At 375px the single-row version had the level ring sitting on top of the
          nav pills. */}
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2 sm:px-5 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <a
            href="#/"
            className="flex shrink-0 items-center gap-2 whitespace-nowrap text-[15px] font-bold tracking-tight text-fg"
            onClick={(e) => {
              e.preventDefault();
              navigate("");
            }}
          >
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[linear-gradient(135deg,var(--p-accent),var(--p-accent-bright))] text-accent-fg">
              <Icon name="layers" size={16} />
            </span>
            Alts Academy
          </a>
          <StatusBar />
        </div>

        {/* Scrolls rather than wraps on a narrow phone, so the brand and the nav
            never collapse into each other. */}
        <nav className="-mx-1 order-last flex w-full items-center gap-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] sm:order-none sm:w-auto sm:pb-0 [&::-webkit-scrollbar]:hidden">
          {NAV.map((entry) => {
            const isActive = active === entry.path;
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => navigate(entry.path)}
                aria-current={isActive ? "page" : undefined}
                className={`tap shrink-0 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[13px] font-medium ${
                  isActive
                    ? "bg-accent text-accent-fg shadow-sm"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {entry.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={toggleEffects}
            className={`tap ml-1 shrink-0 rounded-lg px-2 py-1.5 ${effects === "calm" ? "text-fg-subtle hover:bg-surface-2" : "text-xp hover:bg-surface-2"}`}
            aria-label={effects === "calm" ? "Turn animations on" : "Calm mode: turn animations off"}
            title={effects === "calm" ? "Calm mode is on — click for animations" : "Animations on — click for calm mode"}
          >
            <Icon name="spark" size={15} />
          </button>

          <button
            type="button"
            onClick={toggleTheme}
            className="tap shrink-0 rounded-lg px-2.5 py-1.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
          >
            {theme === "dark" ? "Light" : "Dark"}
          </button>
        </nav>
      </div>
    </header>
  );
}

/**
 * Level, XP and streak, always on screen.
 *
 * These used to be hidden below the `sm` breakpoint and behind a zero check. They
 * are the running total of everything the app is for, so now they are visible from
 * the first answer and on a phone: momentum you cannot see does not motivate anyone.
 */
function StatusBar() {
  const progress = useApp((s) => s.progress);
  const info = level(progress);
  const streakInfo = streak(progress, Date.now());
  const xp = progress.gamification.xp;

  return (
    <button
      type="button"
      onClick={() => navigate("progress")}
      title={`Level ${info.level} — ${info.title}`}
      className="tap flex shrink-0 items-center gap-2.5 rounded-lg px-1.5 py-1 hover:bg-surface-2"
    >
      <Ring value={info.progress} size={26} thickness={3} color="var(--p-accent)">
        <span className="text-[10px] font-bold text-fg tnum">{info.level}</span>
      </Ring>

      <span className="flex items-center gap-1 text-[12.5px] font-semibold text-xp tnum">
        <Icon name="bolt" size={12} />
        {xp.toLocaleString()}
      </span>

      <span
        className={`flex items-center gap-1 text-[12.5px] font-semibold tnum ${
          streakInfo.current > 0 ? "text-streak" : "text-fg-subtle"
        }`}
      >
        <Icon
          name="flame"
          size={13}
          className={streakInfo.todayQualified ? "flame-live" : ""}
        />
        {streakInfo.current}
      </span>
    </button>
  );
}

/**
 * Keyboard reference, on `?`.
 *
 * The app is keyboard-first, which is only true if the keys are discoverable. This is
 * the one place they are written down, so it has to stay in step with what the views
 * actually bind — the comment on each row names the view that owns the key.
 */
const SHORTCUTS: { keys: string[]; what: string; where: string }[] = [
  { keys: ["1", "…", "9"], what: "Pick an answer", where: "In a question" },
  { keys: ["T", "F"], what: "True or false", where: "In a true/false question" },
  { keys: ["C"], what: "Tag confident", where: "In a question" },
  { keys: ["U"], what: "Tag unsure", where: "In a question" },
  { keys: ["G"], what: "Tag guessing", where: "In a question" },
  { keys: ["Enter"], what: "Check the answer, then move on", where: "In a question" },
  { keys: ["Space"], what: "Reveal the explanation", where: "In a question" },
  { keys: ["Esc"], what: "Leave the set", where: "In a question" },
  { keys: ["Enter"], what: "Start the questions", where: "On a topic" },
  { keys: ["Enter"], what: "Back to where you came from", where: "On a result" },
  { keys: ["/"], what: "Jump to search", where: "In the glossary" },
  { keys: ["?"], what: "This list", where: "Anywhere" },
];

function ShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/40 p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border-base bg-surface p-5 shadow-card"
        // Clicks inside must not dismiss it, or selecting text closes the dialog.
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-[16px] font-bold text-fg">Keyboard</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[13px] text-fg-muted underline decoration-dotted underline-offset-2 hover:text-fg"
          >
            Close <Kbd>Esc</Kbd>
          </button>
        </div>

        <table className="w-full text-left text-[13.5px]">
          <tbody>
            {SHORTCUTS.map((row, i) => (
              <tr key={i} className="border-t border-border-base first:border-t-0">
                <td className="whitespace-nowrap py-1.5 pr-3 align-top">
                  {row.keys.map((key, k) =>
                    key === "…" ? (
                      <span key={k} className="px-0.5 text-fg-subtle">
                        …
                      </span>
                    ) : (
                      <Kbd key={k}>{key}</Kbd>
                    ),
                  )}
                </td>
                <td className="py-1.5 pr-3 align-top text-fg">{row.what}</td>
                <td className="py-1.5 align-top text-[12.5px] text-fg-subtle">{row.where}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-border-base">
      <div className="mx-auto max-w-5xl px-5 py-6 text-[12px] leading-relaxed text-fg-subtle">
        <p className="max-w-measure">
          An unofficial personal study tool with no affiliation to, endorsement by, or
          connection with CFA Institute or CAIA Association. All lessons, questions and
          definitions are written from scratch. Items not independently verified are listed
          on the{" "}
          <button
            type="button"
            onClick={() => navigate("review-queue")}
            className="underline decoration-dotted underline-offset-2 hover:text-fg-muted"
          >
            review queue
          </button>
          .
        </p>
      </div>
    </footer>
  );
}

function StorageNotice() {
  const status = useApp((s) => s.storageStatus);
  if (status === null) return null;

  if (status.kind === "unavailable") {
    return (
      <Banner tone="flag">
        Browser storage is unavailable, so settings and progress will not be remembered
        this session. Private browsing mode is the usual cause.
      </Banner>
    );
  }

  if (status.kind === "refused") {
    return (
      <Banner tone="flag">
        Saved progress was written by a newer version of this app (schema v{status.found},
        this build supports v{status.supported}). Nothing has been changed or overwritten —
        update the app to read it.
      </Banner>
    );
  }

  if (status.kind === "corrupt") {
    return (
      <Banner tone="flag">
        Saved progress could not be read ({status.detail}). A copy has been kept and the
        app has started fresh.
      </Banner>
    );
  }

  return null;
}

function Banner({ tone, children }: { tone: "flag"; children: React.ReactNode }) {
  const tones = { flag: "border-flag bg-flag-soft text-flag" } as const;
  return (
    <div className={`mx-auto mt-4 max-w-5xl px-5`}>
      <p className={`rounded-md border px-3.5 py-2.5 text-[13px] leading-relaxed ${tones[tone]}`}>
        {children}
      </p>
    </div>
  );
}

function Routes() {
  const route = useRoute();
  const [head, param] = route.segments;

  switch (head) {
    case undefined:
      return <Home />;
    case "topic":
      return param === undefined ? <NotFound /> : <Topic id={param} />;
    case "quiz":
      return param === undefined ? <NotFound /> : <Session topicId={param} />;
    case "review":
    case "drill":
    case "exam":
      return <Session />;
    case "exams":
      return <Exams />;
    case "progress":
      return <Progress />;
    case "glossary":
      return <GlossaryPage />;
    case "review-queue":
      return <ReviewQueue />;
    default:
      return <NotFound />;
  }
}

function NotFound() {
  return (
    <EmptyState title="Nothing here.">
      <button
        type="button"
        onClick={() => navigate("")}
        className="underline decoration-dotted underline-offset-2"
      >
        Back to topics
      </button>
    </EmptyState>
  );
}

export function App() {
  const hydrate = useApp((s) => s.hydrate);
  const hydrated = useApp((s) => s.hydrated);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    void hydrate();
    return installFlushHandlers();
  }, [hydrate]);

  // Registered at the shell so `?` works on every page. Escape is claimed here only
  // while the overlay is open, so a session keeps it the rest of the time.
  useHotkeys({ "?": () => setShowShortcuts((open) => !open) });
  useHotkeys({ Escape: () => setShowShortcuts(false) }, showShortcuts);

  return (
    <div className="flex min-h-dvh flex-col">
      {/* First tab stop: the nav is seven controls deep, and a keyboard user should
          not have to walk it on every page change. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-fg"
      >
        Skip to content
      </a>

      <Header />
      <StorageNotice />

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-10">
        {/* Held back one tick so the persisted theme applies before content paints. */}
        {hydrated ? (
          <ErrorBoundary>
            <Routes />
          </ErrorBoundary>
        ) : null}
      </main>

      <Footer />

      {showShortcuts && <ShortcutsOverlay onClose={() => setShowShortcuts(false)} />}
    </div>
  );
}
