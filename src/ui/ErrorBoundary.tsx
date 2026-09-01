/**
 * The last line of defence.
 *
 * Without this, one bad render blanks the page and the user is left with a white
 * screen and no idea whether their progress survived. In an app whose entire history
 * lives in this browser's storage, that is the worst possible failure.
 *
 * So the fallback does two things beyond apologising:
 *
 *  1. **Offers the export.** It reads the stored blob directly rather than going
 *     through the store, because the store is exactly what might be broken. If the
 *     bytes are in localStorage, the user can get them out.
 *
 *  2. **Shows the error.** This is a personal tool with no bug tracker; the stack is
 *     the only diagnostic there is, and hiding it helps nobody.
 *
 * Deliberately a class component: `getDerivedStateFromError` has no hook equivalent.
 */

import { Component, type ErrorInfo, type ReactNode } from "react";

import { exportFilename } from "../storage/transfer";

const PROGRESS_KEY = "alts-academy:progress";

interface State {
  error: Error | null;
  info: ErrorInfo | null;
  saved: string | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: null, saved: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Logged as well as rendered: the console keeps the full stack with source maps.
    console.error("Alts Academy crashed:", error, info.componentStack);
    this.setState({ info });
  }

  /**
   * Export straight from storage.
   *
   * Not via the store or `serializeExport`: this path has to work when the reason we
   * are here is that something in the app's own state is malformed. Wrapping the raw
   * blob in the same envelope keeps the file importable.
   */
  private readonly rescue = (): void => {
    try {
      const raw = window.localStorage.getItem(PROGRESS_KEY);
      if (raw === null) {
        this.setState({ saved: "There is no saved progress in this browser to export." });
        return;
      }

      const now = Date.now();
      const envelope = `{"format":"alts-academy-progress","schemaVersion":${
        (JSON.parse(raw) as { schemaVersion?: number }).schemaVersion ?? 0
      },"exportedAt":${JSON.stringify(new Date(now).toISOString())},"progress":${raw}}`;

      const url = URL.createObjectURL(new Blob([envelope], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(now);
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);

      this.setState({ saved: `Saved ${exportFilename(now)} to your downloads.` });
    } catch (err) {
      this.setState({
        saved: `Could not export: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  override render(): ReactNode {
    const { error, info, saved } = this.state;
    if (error === null) return this.props.children;

    return (
      <div className="mx-auto max-w-2xl px-5 py-12">
        <h1 className="text-[26px] font-bold tracking-tight text-fg">
          Something in the app broke.
        </h1>
        <p className="mt-3 max-w-measure text-[15px] leading-relaxed text-fg-muted">
          Your progress has not been touched — it is still in this browser's storage, and
          nothing here writes to it. Save a copy before reloading if you want to be
          certain of it.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.rescue}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-accent-fg hover:bg-accent-hover"
          >
            Export my progress
          </button>
          <button
            type="button"
            onClick={() => {
              // Home rather than a plain reload: the crash may belong to the route.
              window.location.hash = "#/";
              window.location.reload();
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-border-strong bg-surface px-4 py-2 text-sm font-semibold text-fg hover:bg-surface-2"
          >
            Reload the home page
          </button>
        </div>

        {saved !== null && (
          <p className="mt-4 rounded-md border border-correct bg-correct-soft px-3.5 py-2.5 text-[13px] text-correct">
            {saved}
          </p>
        )}

        <details className="mt-8" open>
          <summary className="cursor-pointer text-[13px] font-semibold text-fg-muted">
            What went wrong
          </summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border-base bg-surface-2 p-3 text-[12px] leading-relaxed text-fg-muted">
            {error.name}: {error.message}
            {error.stack === undefined ? "" : `\n\n${error.stack}`}
            {info?.componentStack == null ? "" : `\n\nComponent stack:${info.componentStack}`}
          </pre>
        </details>
      </div>
    );
  }
}
