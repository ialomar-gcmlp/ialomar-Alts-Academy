# Alts Academy — M0 Plan

## Context

You are a first-year analyst at an alternative asset manager with strong motivation and limited
background depth, studying in 5–20 minute fragments during the workday and occasional 45-minute
evening blocks. You may sit for CFA or CAIA and want content that serves both. Nothing exists yet —
this is a greenfield build of a local-first, gamified self-study web app that teaches investment
fundamentals and alternatives-industry knowledge, tracks mastery, and resumes exactly where you
left off.

The intended outcome of M0: a technical plan you have approved, a `CLAUDE.md` that keeps future
sessions consistent, and an initialized git repo. **No application code in M0.**

### Environment finding (resolved)

This machine has git 2.55 and Python 3.13.14 but **no Node.js, no npm, no WSL**, and you are not a
local administrator. `registry.npmjs.org` and `nodejs.org` are both reachable. Current Node LTS is
**v24.20.0 "Krypton"** (bundles npm 11.19.0). Node is a build-time developer tool only — the shipped
app remains static files with no network calls, per your constraints.

### Decisions locked with you

| Decision | Choice |
|---|---|
| Toolchain | Portable Node LTS `.zip` into `%LOCALAPPDATA%\node`, user PATH, no admin |
| Repo location | New sibling folder `C:\Users\ialomar\Downloads\alts-academy` (name changeable) |
| Glossary | Global glossary files are canonical; topics reference terms by slug; topics may not redefine |
| Scheduler | SM-2 + confidence weighting, behind a pluggable `Scheduler` interface (FSRS later, no call-site changes) |

---

## Step 0 — Node, before anything else

You run this once (I won't download installers on your behalf). It fetches the official Node LTS zip,
extracts to your user profile, and adds it to your user PATH. Uninstall = delete the folder.

```bash
powershell -NoProfile -Command "$v='v24.20.0'; $dest=\"$env:LOCALAPPDATA\node\"; $zip=\"$env:TEMP\node-$v.zip\"; Invoke-WebRequest \"https://nodejs.org/dist/$v/node-$v-win-x64.zip\" -OutFile $zip; Expand-Archive $zip -DestinationPath $env:TEMP -Force; if (Test-Path $dest) { Remove-Item $dest -Recurse -Force }; Move-Item \"$env:TEMP\node-$v-win-x64\" $dest; [Environment]::SetEnvironmentVariable('PATH', \"$dest;\" + [Environment]::GetEnvironmentVariable('PATH','User'), 'User'); & \"$dest\node.exe\" --version"
```

Then **restart this session** so the new PATH is picked up, and I verify with `node -v` / `npm -v`.

---

## Stack

Your preference was right. Where I refine it, the reason is in the table.

| Layer | Choice | Justification |
|---|---|---|
| Build | Vite + React 19 + TypeScript | As briefed. `npm run dev`, `npm run build` → static `dist/`. |
| Styling | Tailwind v4 via `@tailwindcss/vite` | v4 is CSS-first (`@theme` in CSS), no `tailwind.config.js`. Design tokens live in one CSS file. |
| Validation | Zod v4 | Required by brief. Single source of truth for content shape; TS types via `z.infer`. |
| State | Zustand | **Added.** Progress writes fire on every answer; React Context would re-render the whole tree each time. Selector subscriptions avoid that. ~1KB. Persistence stays in our own storage module, not Zustand's `persist`, so we control versioning/migrations. |
| Routing | **No dependency** — ~40-line hash router in `src/lib/hashRouter.ts` | react-router is ~10KB + large API for ~8 views. Hash routing also means the built app works from `file://` and any static host with zero rewrite rules. |
| Formulas | KaTeX, **lazy-loaded** via dynamic `import()` | Only real option for rendering the `latex` fields. Vendored by Vite so it stays offline. Code-split so it costs nothing on pages without formulas. |
| Charts | **No dependency** — hand-rolled SVG in `src/ui/charts/` | Recharts/Chart.js are 100KB+. Chart-read questions need full control of generated series anyway. Colors follow the local `dataviz` skill palette rules. |
| Tests | Vitest | Shares the Vite config; no separate transform setup. Tests target pure logic (scheduler, mastery, session composer, XP, migrations), not components — keeps deps minimal. |
| Fonts | System UI stack + `tabular-nums` for figures | Zero downloads, native feel, offline. |

Total runtime dependencies: `react`, `react-dom`, `zustand`, `zod`, `katex`. Everything else is dev-only.

**Not using GCM branding.** This is a personal study tool; firm brand assets are firm property and your
brief bars firm material from the repo.

---

## Folder structure

```
alts-academy/
  CLAUDE.md  README.md  .gitignore  .nvmrc
  package.json  index.html  vite.config.ts  tsconfig.json  vitest.config.ts
  content/
    manifest.json                      # GENERATED — do not hand-edit
    glossary/{domain}.json             # canonical term definitions
    {domain}/{topic-id}.json           # one topic per file
  scripts/
    validate-content.ts                # Zod over every content file + cross-file checks
    build-manifest.ts                  # regenerates content/manifest.json
  src/
    main.tsx  App.tsx
    content/    schema.ts  loader.ts  glossary.ts  types.ts
    engine/     scheduler.ts  mastery.ts  session.ts  grading.ts  xp.ts  streak.ts  badges.ts  unlock.ts
    storage/    index.ts  localStorageAdapter.ts  migrations.ts  progressSchema.ts
    state/      store.ts  selectors.ts
    ui/         primitives/  blocks/  questions/  charts/
    views/      Home  Session  SkillTree  Glossary  Analytics  Settings  ReviewQueue  MockExam
    lib/        hashRouter.ts  time.ts  rng.ts  keyboard.ts
    styles/     tokens.css  index.css
```

**Adding a topic = dropping one JSON file into `content/{domain}/`.** A small Vite plugin watches
`content/**` and regenerates `manifest.json` in dev; `npm run content:build` does it for production.
The app eagerly loads only the manifest (ids, titles, prereqs, estMinutes, question counts, tags) and
lazy-loads topic bodies on demand — so the skill tree and session planner can reason over 200 topics
without pulling ~3MB of lesson text on first paint.

---

## Content schema (refinements to yours, all additive)

Your schema is the base. Changes I want, each with a reason:

1. **`schemaVersion`** on every content file — lets content migrate, not just progress.
2. **`whyWrong` → `rationales: string[]`, one entry per choice, length must equal `choices`.**
   Your version ("Why A is wrong", "Why B is wrong", "Why D is wrong") is ambiguous about indexing
   once the answer isn't C. Aligned-by-index means the app can show *"why the one you picked is
   wrong"* next to the choice you actually picked, and a build check enforces the length.
3. **Lesson block types** — keep `concept` / `formula` / `example` / `onTheJob`, add:
   `intuition` (the *why*, required at least once per topic), `pitfall` (common mistake),
   `analogy`, `table` (ratio lists, indicator release calendars), `chart` (generated series + caption),
   `keyTakeaways` (string[], reused in session recaps and post-miss re-reads).
4. **Glossary** — terms live only in `content/glossary/{domain}.json`:
   `{ slug, term, plain, formal, seeAlso[], domain }`. Lesson and explanation prose marks terms
   inline as `[[discount-rate]]`, rendered as a popover: plain English first, formal second, related
   terms third. `validate-content.ts` fails on unresolved slugs, duplicate slugs across domains, and
   orphan terms defined but never referenced. Definitions structurally cannot drift.
5. **Question types** — Zod discriminated union on `type`, one renderer + one grader per type in a
   registry, so a new type is a new file and never a change to the session UI:
   `mcq`, `numeric` (`answer`, `tolerance`, `toleranceType: 'abs'|'rel'`, `unit`),
   `tfj` (true/false + required justification pick), `match` (term↔definition pairs),
   `vignette` (shared stem + `exhibits[]` + `subQuestions[]`, CFA item-set style),
   `strategyId` (return pattern/trade → identify the strategy), `chartRead` (seeded series spec + question).
6. **`needsReview` at item level as well as topic level**, plus an optional `reviewNote` explaining
   what to verify. Both surface on `/review-queue` with the file path so you can go check it.
7. **`estSeconds`** optional per question; falls back to a per-type default used by the session composer.

---

## Learning engine

**Scheduler** (`engine/scheduler.ts`) — SM-2 behind `interface Scheduler { grade(state, outcome): state }`.
Confidence maps to grade:

| Outcome | Grade | Effect |
|---|---|---|
| confident + correct | 5 | full interval growth |
| unsure + correct | 3 | short interval; still schedules a review |
| guessing + correct | 3 | interval growth capped — a lucky guess isn't mastery |
| unsure/guessing + wrong | 1 | soft lapse |
| **confident + wrong** | 0 | interval reset, resurfaces same or next session, **triggers concept re-read** |

Two consecutive misses on a question → adaptive difficulty drops back a level within the topic and
re-teaches the linked concept block rather than just marking it wrong. Interval floor 10 min
(same-session resurface), initial ceiling 180 days.

**Mastery** (`engine/mastery.ts`) — topic mastery 0–1 from coverage (share of questions with ≥1
correct rep) × recency-decayed retention × normalized stability, difficulty-weighted. Domain mastery
= topic mastery weighted by question count. Unlock: topic opens when every prereq ≥ 0.6. Boss exam
unlocks at domain mastery ≥ 0.7 with ≥ 80% of topics started. All thresholds in one constants file.

**Session composer** (`engine/session.ts`) — the "never leave me mid-question" rule: budget in
seconds, items added only while the *next whole item* still fits, so the clock gates starting an
item, never truncating one. Mix table by length lives in `sessionPolicy.ts`:

| Length | Due reviews | Weak areas | New material | Interleave |
|---|---|---|---|---|
| 5 min | 100% (or 1 micro-lesson if nothing due) | — | — | — |
| 10 min | 60% | 20% | 20% | — |
| 20 min | 40% | 20% | 30% | 10% |
| 45 min | 30% | 20% | 35% | 15% (incl. one vignette) |

Interleaving pulls across domains, not just the last topic studied. Modes: Learn New, Review Due,
Weak Areas, Mock Exam, Glossary Drill — plus the single "Start studying" button that picks for you.

**Anti-farming XP** (`engine/xp.ts`) — XP only on the *first* answer of a scheduled item per day,
scaled by difficulty × calibration multiplier, bonus for reviving a previously-missed item, zero for
re-answering something already answered today, daily soft cap with diminishing returns. A streak day
counts only if you hit the goal minutes **and** completed ≥1 scheduled review.

Unit tests are required for scheduler, mastery, session composer, XP/streak, and every storage migration.

---

## Persistence

`storage/index.ts` exposes a **Promise-based** interface from day one, backed by localStorage. Async
now means the IndexedDB adapter is a drop-in later with zero call-site changes.

Volume math: ~200 topics × 8 questions ≈ 1,600 question states × ~200B ≈ 320KB — comfortable. The
raw answer log is the risk (50/day × 365 × ~120B ≈ 2MB/yr), so it's **bounded to a rolling 5,000
events / 18 months with daily aggregates** kept permanently for long-run analytics. Writes are
debounced ~250ms and force-flushed on `visibilitychange` and `pagehide`, so closing the tab
mid-session loses nothing.

**Progress schema versioning** — `{ schemaVersion: n, ... }` with an ordered migration chain, each
migration unit-tested. Before migrating, the pre-migration blob is stashed as `progress.backup.v{n}`
so a bad migration is recoverable. A *newer-than-known* version refuses to write and warns rather
than corrupting history.

**Session resume** — `activeSession` (queue, index, answers, accumulated active-time, startedAt)
persists after every answer; on load, a session under 12h old offers Resume. Elapsed time is
accumulated active-time, not wall-clock, and pauses on `visibilitychange`.

**Export/import** — download as JSON via data URL (no dep); import validates then confirms with a
summary ("replaces 1,234 answers spanning 2026-01-01 → 2026-08-31"). `lastExportAt` drives a discreet
"last backed up" nudge after 14 days or 100 new answers.

---

## UI/UX

Neutral slate scale + one restrained accent, desaturated correct/incorrect colors that don't shout
across an open-plan desk. Light/dark from a single token set in `tokens.css` (`class` strategy).
Transitions capped at 120ms opacity/transform; `prefers-reduced-motion` honored; no sound.

Keyboard: `1–9` select, `Enter` submit/advance, `Space` reveal explanation, `C/U/G` confidence,
`/` glossary search, `Esc` pause, `?` shortcuts overlay — via one `useHotkeys` hook with a scope
stack so views don't fight each other. Real `<button>` elements, `aria-live` for feedback, focus
managed on advance. Responsive to phone width.

Footer on every page: unofficial personal study tool, no affiliation with CFA Institute or CAIA
Association.

---

## Content integrity rules (into CLAUDE.md)

- All questions, explanations and definitions written from scratch. **No reproduction, close
  paraphrase, or approximation** of CFA Institute or CAIA Association curriculum text, learning
  outcome statements, or past exam items.
- Every formula ships with intuition — the *why*, not just the expression.
- Any formula, convention, or figure I'm not fully confident in gets `needsReview: true` + a
  `reviewNote`, and appears on `/review-queue`. **Flag, never guess.**
- No firm data, no proprietary information, nothing confidential — ever, anywhere in the repo.
- Every specialist term defined in plain English at point of use, via the global glossary.

---

## Milestones (stop for your review after each; git commit at each)

| # | Deliverable |
|---|---|
| **M0** | This plan, `CLAUDE.md`, `.gitignore`, `README.md`, git initialized + first commit. No app code. |
| **M1** | Skeleton: Vite app, content loader + Zod validation + `validate-content.ts`, one lesson → quiz → result flow end to end, and **three excellent seeded topics** — `quant-tvm-01` (Present Value / Future Value), `econ-curve-01` (Yield curve shapes and what they signal), `alts-lse-01` (Long/Short Equity). Plus the glossary terms those three need. This is where you judge content quality. |
| **M2** | Scheduler + mastery engine, with Vitest coverage of the grade table, adaptive difficulty, and mastery monotonicity. |
| **M3** | Gamification: XP, levels with titles, streak + 2 freezes/month, badges, skill tree map. |
| **M4** | Glossary system: inline popovers, searchable global page, Glossary Drill both directions. |
| **M5** | Content build-out, **one domain per batch, validated and paused between batches** — quant → economics → FSA → corporate issuers → equity → fixed income → derivatives → **alternatives (deepest)** → fund structures → portfolio/risk → ethics. |
| **M6** | Mock exams (timed, per-domain, threshold-gated), analytics dashboard incl. calibration and 7-day review forecast, export/import, session resume. |
| **M7** | Polish: mobile, keyboard, accessibility, empty states, error handling. |

M5 targets ~20 excellent topics before breadth — a great app with 20 topics over a broken one with 200.

---

## Verification

**M0:** `git log` shows one commit; `CLAUDE.md` exists; no files under `src/`.

**Every milestone after:**
```bash
npm run content:check && npm test && npm run build
```
- `content:check` — Zod over every content file, plus cross-file checks (prereq ids resolve, no
  prereq cycles, glossary slugs resolve, `rationales.length === choices.length`, no orphan terms).
- `npm test` — Vitest on engine + migrations.
- `npm run build` — clean static output.

**Manual, per milestone:** `npm run dev`, then drive the actual flow — pick a 5-minute session,
answer with each confidence tag, kill the tab mid-question, reopen and confirm it resumes on the same
question with elapsed time intact. I'll verify in the browser with the Browser pane and report what I
see rather than asserting it works.

**Offline check at M7:** build, serve `dist/` with `python -m http.server`, load once, disconnect the
network, confirm every view still functions and no request leaves the machine (DevTools network tab).
