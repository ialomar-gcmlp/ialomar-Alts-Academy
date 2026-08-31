# Alts Academy

A local-first, gamified self-study app for investment fundamentals and alternatives-industry
knowledge. Built for study in 5–20 minute fragments, with spaced repetition, confidence-weighted
answering, and mastery tracking that resumes exactly where you left off.

Runs entirely in the browser. No accounts, no backend, no telemetry, no network calls at runtime.
Progress lives in your browser's local storage and can be exported to a JSON file at any time.

---

## Status

**M0 — plan and conventions complete. No application code yet.**

See [CLAUDE.md](./CLAUDE.md) for the architecture, content schema, and engine design. The milestone
table at the bottom of that file is the live progress tracker.

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
| `npm test` | Unit tests for the scheduler, mastery math, and storage migrations |
| `npm run content:check` | Validate every content file against the schema |
| `npm run verify` | `content:check && test && build` |

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
