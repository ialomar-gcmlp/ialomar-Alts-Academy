/**
 * App shell: header, route switch, footer.
 *
 * Routing is the hand-rolled hash router (src/lib/hashRouter.ts), so this builds to
 * static files that work from file:// or any static host with no rewrite rules.
 */

import { useEffect } from "react";

import { useRoute, navigate } from "./lib/hashRouter";
import { installFlushHandlers } from "./storage";
import { level, streak } from "./state/selectors";
import { useApp } from "./state/store";
import { GlossaryPage } from "./views/GlossaryPage";
import { Home } from "./views/Home";
import { ReviewQueue } from "./views/ReviewQueue";
import { Session } from "./views/Session";
import { Progress } from "./views/Progress";
import { Topic } from "./views/Topic";
import { EmptyState } from "./ui/primitives";

const NAV = [
  { path: "", label: "Topics" },
  { path: "progress", label: "Progress" },
  { path: "glossary", label: "Glossary" },
  { path: "review-queue", label: "Review queue" },
] as const;

function Header() {
  const route = useRoute();
  const theme = useApp((s) => s.progress.settings.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const active = route.segments[0] ?? "";

  return (
    <header className="border-b border-border-base bg-surface">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
        <a
          href="#/"
          className="shrink-0 whitespace-nowrap text-[15px] font-semibold tracking-tight text-fg"
          onClick={(e) => {
            e.preventDefault();
            navigate("");
          }}
        >
          Alts Academy
        </a>
        <StatusChip />
        </div>

        {/* Scrolls rather than wraps on a narrow phone, so the brand and the nav
            never collapse into each other. */}
        <nav className="-mx-1 flex items-center gap-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {NAV.map((entry) => {
            const isActive = active === entry.path;
            return (
              <button
                key={entry.path}
                type="button"
                onClick={() => navigate(entry.path)}
                aria-current={isActive ? "page" : undefined}
                className={`shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[13px] ${
                  isActive
                    ? "bg-accent-soft font-medium text-accent"
                    : "text-fg-muted hover:bg-surface-2 hover:text-fg"
                }`}
              >
                {entry.label}
              </button>
            );
          })}

          <button
            type="button"
            onClick={toggleTheme}
            className="ml-1 shrink-0 rounded-md px-2.5 py-1.5 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg"
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

/** Level and streak, at a glance. Clicking goes to the full picture. */
function StatusChip() {
  const progress = useApp((s) => s.progress);
  const info = level(progress);
  const streakInfo = streak(progress, Date.now());

  if (progress.gamification.xp === 0 && streakInfo.current === 0) return null;

  return (
    <button
      type="button"
      onClick={() => navigate("progress")}
      title={`Level ${info.level} — ${info.title}`}
      className="hidden shrink-0 items-center gap-2 rounded-md px-2 py-1 text-[12px] text-fg-muted hover:bg-surface-2 hover:text-fg sm:flex"
    >
      <span className="tnum">Lv {info.level}</span>
      <span aria-hidden className="text-fg-subtle">·</span>
      <span className="tnum">{progress.gamification.xp.toLocaleString()} XP</span>
      {streakInfo.current > 0 && (
        <>
          <span aria-hidden className="text-fg-subtle">·</span>
          <span className={`tnum ${streakInfo.todayQualified ? "text-correct" : ""}`}>
            {streakInfo.current}d
          </span>
        </>
      )}
    </button>
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
      return <Session />;
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

  useEffect(() => {
    void hydrate();
    return installFlushHandlers();
  }, [hydrate]);

  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <StorageNotice />
      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-8 sm:py-10">
        {/* Held back one tick so the persisted theme applies before content paints. */}
        {hydrated ? <Routes /> : null}
      </main>
      <Footer />
    </div>
  );
}
