/**
 * Shared UI primitives. No hard-coded colours — everything comes from the tokens
 * in src/styles/tokens.css (CLAUDE.md §8).
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost";

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md font-medium " +
  "disabled:opacity-40 disabled:cursor-not-allowed select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover",
  secondary:
    "bg-surface text-fg border border-border-strong hover:bg-surface-2",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
};

const buttonSizes = {
  sm: "text-sm px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-5 py-2.5",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof buttonSizes;
}) {
  return (
    <button
      className={`${buttonBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Surfaces
 * ------------------------------------------------------------------ */

export function Card({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-lg border border-border-base bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "correct" | "incorrect" | "flag";
}) {
  const tones = {
    neutral: "bg-surface-2 text-fg-muted border-border-base",
    accent: "bg-accent-soft text-accent border-transparent",
    correct: "bg-correct-soft text-correct border-transparent",
    incorrect: "bg-incorrect-soft text-incorrect border-transparent",
    flag: "bg-flag-soft text-flag border-transparent",
  } as const;

  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide border ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * A labelled aside — used for lesson block types that deserve visual separation
 * (intuition, pitfall, on-the-job) without turning the page into a rainbow.
 */
export function Callout({
  label,
  tone = "neutral",
  children,
}: {
  label: string;
  tone?: "neutral" | "accent" | "flag";
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-l-border-strong",
    accent: "border-l-accent",
    flag: "border-l-flag",
  } as const;

  const labelTones = {
    neutral: "text-fg-subtle",
    accent: "text-accent",
    flag: "text-flag",
  } as const;

  return (
    <aside className={`border-l-2 pl-4 ${tones[tone]}`}>
      <div
        className={`mb-1 text-[11px] font-semibold uppercase tracking-wider ${labelTones[tone]}`}
      >
        {label}
      </div>
      {children}
    </aside>
  );
}

/** A keyboard hint. The app is keyboard-first, so these appear throughout. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-border-strong bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
      {children}
    </kbd>
  );
}

export function PageTitle({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {eyebrow !== undefined && (
        <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-accent">
          {eyebrow}
        </div>
      )}
      <h1 className="text-2xl font-semibold tracking-tight text-fg sm:text-3xl">{title}</h1>
      {children !== undefined && (
        <div className="mt-2 max-w-measure text-fg-muted">{children}</div>
      )}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-medium text-fg">{title}</p>
      {children !== undefined && <div className="mt-2 text-sm text-fg-muted">{children}</div>}
    </Card>
  );
}
