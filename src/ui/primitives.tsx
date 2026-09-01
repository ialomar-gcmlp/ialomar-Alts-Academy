/**
 * Shared UI primitives. No hard-coded colours — everything comes from the tokens
 * in src/styles/tokens.css (CLAUDE.md §8).
 *
 * The progress primitives here (Ring, Pips, Meter) all take a `color` that is a CSS
 * var reference, so a topic's own domain hue flows through them. They are the reason
 * the app can be colourful without any component knowing a hex value.
 */

import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

import { Icon, type IconName } from "./icons";

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type ButtonVariant = "primary" | "secondary" | "ghost" | "vivid" | "danger";

const buttonBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold press " +
  "disabled:opacity-40 disabled:cursor-not-allowed select-none";

const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-sm",
  // The one loud button in the app, for the action that starts a session.
  vivid:
    "text-accent-fg shadow-sm bg-[linear-gradient(105deg,var(--p-accent),var(--p-accent-bright))] " +
    "hover:brightness-110",
  secondary: "bg-surface text-fg border border-border-strong hover:bg-surface-2",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
  // Reserved for actions that destroy data. Only the import confirmation uses it, and
  // it should stay that way — a warning colour on an ordinary button teaches the user
  // to ignore it.
  danger: "bg-incorrect text-white hover:brightness-110 shadow-sm",
};

const buttonSizes = {
  sm: "text-sm px-3 py-1.5",
  md: "text-sm px-4 py-2",
  lg: "text-base px-5 py-2.5",
  xl: "text-[17px] px-6 py-3",
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
  style,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <div
      style={style}
      className={`rounded-xl border border-border-base bg-surface shadow-card ${className}`}
    >
      {children}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
  style,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "correct" | "incorrect" | "flag" | "domain" | "xp";
  style?: CSSProperties;
}) {
  const tones = {
    neutral: "bg-surface-2 text-fg-muted border-border-base",
    accent: "bg-accent-soft text-accent border-transparent",
    correct: "bg-correct-soft text-correct border-transparent",
    incorrect: "bg-incorrect-soft text-incorrect border-transparent",
    flag: "bg-flag-soft text-flag border-transparent",
    // Reads --d off the element, so one badge component covers all eleven domains.
    domain: "d-tint d-text border-transparent",
    xp: "bg-xp/12 text-xp border-transparent",
  } as const;

  return (
    <span
      style={style}
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/** A domain's two-letter monogram in its own colour. Identity without words. */
export function Monogram({
  code,
  size = 34,
  style,
  className = "",
}: {
  code: string;
  size?: number;
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ ...style, width: size, height: size }}
      className={`d-tint-strong d-text inline-flex shrink-0 items-center justify-center rounded-lg text-[12px] font-bold tracking-wide ${className}`}
    >
      {code}
    </span>
  );
}

/**
 * A labelled aside — used for lesson block types that deserve visual separation.
 * Each tone is a different colour and a different icon, so the reader can tell at a
 * glance which mode a block is in without reading the label.
 */
export function Callout({
  label,
  tone = "neutral",
  icon,
  children,
}: {
  label: string;
  tone?: "neutral" | "accent" | "flag" | "incorrect" | "domain";
  icon?: IconName;
  children: ReactNode;
}) {
  const tones = {
    neutral: "border-l-border-strong bg-surface-2/50",
    accent: "border-l-accent bg-accent-soft/40",
    flag: "border-l-flag bg-flag-soft/40",
    incorrect: "border-l-incorrect bg-incorrect-soft/40",
    domain: "d-border bg-transparent",
  } as const;

  const labelTones = {
    neutral: "text-fg-subtle",
    accent: "text-accent",
    flag: "text-flag",
    incorrect: "text-incorrect",
    domain: "d-text",
  } as const;

  return (
    <aside className={`my-6 rounded-r-lg border-l-[3px] py-1 pl-4 pr-3 ${tones[tone]}`}>
      <div
        className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider ${labelTones[tone]}`}
      >
        {icon !== undefined && <Icon name={icon} size={13} />}
        {label}
      </div>
      {children}
    </aside>
  );
}

/** A keyboard hint. The app is keyboard-first, so these appear throughout. */
export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-current/25 bg-black/5 px-1.5 py-0.5 font-mono text-[11px] opacity-80">
      {children}
    </kbd>
  );
}

export function PageTitle({
  eyebrow,
  title,
  children,
  style,
  accent = false,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  style?: CSSProperties;
  /** Colour the eyebrow with the element's --d rather than the app accent. */
  accent?: boolean;
}) {
  return (
    <header className="mb-8" style={style}>
      {eyebrow !== undefined && (
        <div
          className={`mb-1.5 text-xs font-bold uppercase tracking-widest ${accent ? "d-text" : "text-accent"}`}
        >
          {eyebrow}
        </div>
      )}
      <h1 className="text-[26px] font-bold leading-tight tracking-tight text-fg sm:text-[32px]">
        {title}
      </h1>
      {children !== undefined && (
        <div className="mt-2 max-w-measure text-fg-muted">{children}</div>
      )}
    </header>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <Card className="p-8 text-center">
      <p className="font-semibold text-fg">{title}</p>
      {children !== undefined && <div className="mt-2 text-sm text-fg-muted">{children}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------ *
 * Progress primitives
 * ------------------------------------------------------------------ */

/**
 * A circular progress dial. Used for level, mastery and session score.
 *
 * Drawn with two SVG circles and a dash offset — no library, and it animates by
 * transitioning `stroke-dashoffset`, so a mastery change reads as movement rather
 * than as a number that was suddenly different.
 */
export function Ring({
  value,
  size = 44,
  thickness = 4,
  color = "var(--p-accent)",
  track = "var(--p-surface-2)",
  children,
  className = "",
}: {
  /** 0-1. Values outside are clamped rather than drawn wrong. */
  value: number;
  size?: number;
  thickness?: number;
  color?: string;
  track?: string;
  children?: ReactNode;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={thickness}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          // A round cap on a zero-length arc draws a dot, which reads as "a little
          // progress" when the honest answer is none.
          strokeLinecap={clamped === 0 ? "butt" : "round"}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped)}
          style={{ transition: "stroke-dashoffset 600ms cubic-bezier(0.34,1.2,0.64,1)" }}
        />
      </svg>
      {children !== undefined && (
        <span className="absolute inset-0 flex items-center justify-center">{children}</span>
      )}
    </div>
  );
}

/** A horizontal bar. `sweep` sends a light across it once, for a value that just moved. */
export function Meter({
  value,
  color = "var(--p-accent)",
  height = 6,
  sweep = false,
  className = "",
}: {
  value: number;
  color?: string;
  height?: number;
  sweep?: boolean;
  className?: string;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className={`overflow-hidden rounded-full bg-surface-2 ${className}`}
      style={{ height }}
      role="presentation"
    >
      <div
        className={`h-full rounded-full ${sweep ? "bar-sweep" : ""}`}
        style={{
          width: `${pct}%`,
          background: color,
          transition: "width 500ms cubic-bezier(0.34,1.2,0.64,1)",
        }}
      />
    </div>
  );
}

/**
 * `answered` exists for exams, which must not leak whether a question went well
 * before the paper is marked. Everywhere else the dots carry the outcome.
 */
export type PipState = "correct" | "wrong" | "current" | "todo" | "answered";

/**
 * One dot per question in a session.
 *
 * A percentage bar tells you how far through you are; this tells you how far through
 * you are AND how it has gone AND exactly how many are left, which is the thing that
 * makes a set feel finishable.
 */
export function Pips({ states }: { states: PipState[] }) {
  const styles: Record<PipState, string> = {
    correct: "bg-correct",
    wrong: "bg-incorrect",
    current: "bg-accent scale-125 ring-3 ring-accent/25",
    todo: "bg-border-strong/60",
    answered: "bg-fg-subtle",
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-hidden>
      {states.map((state, i) => (
        <span
          key={i}
          className={`h-2 w-2 rounded-full transition-all ${styles[state]}`}
        />
      ))}
    </div>
  );
}

/** A number with a label, sized to be read across a desk. */
export function StatTile({
  label,
  value,
  sub,
  icon,
  color,
  style,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: IconName;
  color?: string;
  style?: CSSProperties;
}) {
  return (
    <Card className="p-4" style={style}>
      <div
        className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
        style={{ color: color ?? "var(--p-fg-subtle)" }}
      >
        {icon !== undefined && <Icon name={icon} size={13} />}
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-fg tnum">{value}</div>
      {sub !== undefined && <div className="mt-0.5 text-[12.5px] text-fg-subtle">{sub}</div>}
    </Card>
  );
}
