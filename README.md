# Alts Academy

A local-first, gamified self-study app for investment fundamentals and alternatives-industry
knowledge. Built for study in 5–20 minute fragments, with spaced repetition, confidence-weighted
answering, and mastery tracking that resumes exactly where you left off.

Runs entirely in the browser. No accounts, no backend, no telemetry, no network calls at runtime.
Progress lives in your browser's local storage and can be exported to a JSON file at any time.

---

## Status

**Complete — M0 through M7.** 86 topics across eleven domains, 563 questions, 262 glossary terms.

See [CLAUDE.md](./CLAUDE.md) for the architecture, content schema, and engine design. The milestone
table at the bottom of that file is the progress tracker.

---

## What it does

- **Lessons then questions.** Each topic is a short lesson — concept, the intuition behind it, a
  worked example, how it goes wrong, what to ask a manager — followed by six to eight questions of
  ascending difficulty. Seven question types, including numeric, true/false-with-justification, and
  chart reading.
- **Every answer carries a confidence tag**, and that tag decides when the question comes back. Sure
  and wrong is treated as the most useful mistake there is: the interval resets and the concept is
  re-taught rather than the answer just being marked.
- **Spaced repetition** (SM-2 behind a pluggable interface) with mastery per topic and per domain,
  decayed by recency — the numbers describe what you would remember today, not what you once read.
- **Gamified without being farmable.** XP only on the first answer of a scheduled question per day,
  scaled by difficulty and calibration; a streak day needs both the minutes goal and a real review.
- **Glossary** of every specialist term, defined in plain English first, with a popover at the point
  of use and a two-way drill mode.
- **Mock exams** per domain: gated on mastery, timed on the wall clock, marked only on submission,
  then handed back question by question with the explanations.
- **A dashboard** of accuracy over time, how well-calibrated your confidence turns out to be, and
  what is due in the next seven days.
- **Export and import** to a JSON file, with a quiet nudge when it has been a while.

---

## Using it offline

The build is static files with **no network calls at runtime** — no fonts, no analytics, no APIs.
Asset paths are relative, so `dist/` works three ways:

```bash
npm run build
```

- **Open `dist/index.html` directly** from the file system.
- **Copy `dist/` onto any static host**, at the root or in a subdirectory. Routing is hash-based, so
  no rewrite rules are needed.
- **Serve it locally**: `python -m http.server` from inside `dist/`.

Progress lives in `localStorage` under `alts-academy:*`, so it is per-browser and per-origin. Moving
machines, or clearing site data, means exporting first — **Progress → Your data → Export**. Every
schema change ships with a tested migration, and the state being replaced by an import is kept under
a separate key as a safety net.

---

## Prerequisites

Node.js 24.20.0 (see [.nvmrc](./.nvmrc)). This machine has it as a portable extract at
`%LOCALAPPDATA%\node`, on the user PATH — no admin install required. If `node -v` fails, restart the
shell so the PATH change is picked up.

## Getting started

```bash
npm install
npm run dev
```

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server, with content hot-reload |
| `npm run build` | Static build to `dist/` — host it anywhere, or open it locally |
| `npm test` | Unit tests: scheduler, mastery, XP, streaks, exams, analytics, storage migrations |
| `npm run content:check` | Validate every content file against the schema |
| `npm run content:audit` | Prose and authoring checks the schema cannot express |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run verify` | All of the above, in order — the gate every milestone passes |

---

## Adding content

Drop a JSON file into `content/{domain}/`. That is the whole procedure — no components to edit. The
dev server picks it up and regenerates the content index. `npm run content:check` will tell you if
anything is malformed, if a prerequisite or glossary term does not resolve, or if answer rationales
are misaligned.

Glossary terms are defined once, in `content/glossary/{domain}.json`, and referenced from lesson
prose as `[[term-slug]]`. Topic files cannot redefine a term, so definitions cannot drift.

---

## Disclaimer

This is an unofficial personal study aid with **no affiliation to, endorsement by, or connection
with CFA Institute or CAIA Association**. All lessons, questions, explanations and definitions are
written from scratch. Nothing here reproduces or paraphrases either body's curriculum, learning
outcome statements, or exam materials.

Items whose formulas, conventions or figures have not been independently verified are flagged in the
app's **Review Queue** — check those against a primary source before relying on them.
