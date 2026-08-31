/**
 * Human-readable time formatting.
 *
 * Kept deliberately plain — the point of telling the user when a question returns is
 * reassurance that the scheduler is working, so "tomorrow" beats "in 1 day" and
 * nothing here needs to be precise to the minute.
 */

import { DAY_MS, MINUTE_MS, HOUR_MS } from "../engine/constants";

/** "in 10 minutes", "tomorrow", "in 3 weeks". Used after answering a question. */
export function formatDueIn(dueAt: number, now: number): string {
  const ms = dueAt - now;
  if (ms <= 0) return "again shortly";

  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? "" : "s"}`;

  const hours = Math.round(ms / HOUR_MS);
  if (hours < 24) return `in ${hours} hour${hours === 1 ? "" : "s"}`;

  const days = Math.round(ms / DAY_MS);
  if (days === 1) return "tomorrow";
  if (days < 14) return `in ${days} days`;

  const weeks = Math.round(days / 7);
  if (weeks < 9) return `in ${weeks} weeks`;

  const months = Math.round(days / 30);
  return `in ${months} month${months === 1 ? "" : "s"}`;
}

/** "3 days ago", "just now". Used for last-studied and last-backed-up lines. */
export function formatAgo(then: number, now: number): string {
  const ms = now - then;
  if (ms < 2 * MINUTE_MS) return "just now";

  const minutes = Math.round(ms / MINUTE_MS);
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.round(ms / HOUR_MS);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;

  const days = Math.round(ms / DAY_MS);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

export function formatMinutes(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute";
  return `${minutes} min`;
}
