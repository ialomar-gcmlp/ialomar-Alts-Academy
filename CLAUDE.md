# CLAUDE.md — Alts Academy

Local-first, offline, gamified self-study app for investment fundamentals and alternatives-industry
knowledge. Single user. No accounts, no backend, no telemetry, no runtime network calls.

This file is the contract. Read it before touching anything. If a decision here is wrong, change it
here first, then change the code.

---

## 1. Non-negotiables

1. **No firm data.** No GCM Grosvenor material, no proprietary or confidential information, no client
   or manager names from work, no firm branding. Ever, anywhere in this repo.
2. **No licensed curriculum text.** Nothing in this repo may reproduce, closely paraphrase, or
   approximate CFA Institute or CAIA Association curriculum text, learning outcome statements, or
   past exam items. All prose, questions, explanations and definitions are written from scratch.
   Every page carries a footer stating this is an unofficial personal study tool with no affiliation
   to either body.
3. **Offline at runtime.** No `fetch` to any external origin in `src/`. Everything ships in the bundle.
4. **Content is data, not code.** Adding a topic means dropping one JSON file into `content/{domain}/`.
   If adding content requires editing a component, the design is broken — fix the design.
5. **Flag, never guess.** Any formula, convention, market figure, or release-calendar detail you are
   not fully confident in gets `needsReview: true` plus a `reviewNote` saying what to verify. It
   surfaces on `/review-queue`. A confidently wrong lesson is worse than a flagged one.
6. **Progress is sacred.** Never ship a change that can wipe or corrupt saved progress. Schema
   changes go through a tested migration with a pre-migration backup.

---

## 2. Environment

Node is **not** installed machine-wide on this laptop and the user has no local admin. Node LTS
v24.20.0 lives as a portable extract at:

```
%LOCALAPPDATA%\node\node.exe        (added to the user PATH)
```

If `node -v` fails in a fresh shell, the PATH change has not been picked up — the session must be
restarted, not worked around. Do not attempt a machine-wide install.

Also available: git 2.55, Python 3.13 (used only for `python -m http.server` when smoke-testing the
built `dist/` offline). No WSL.

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server. Watches `content/**` and regenerates the manifest. |
| `npm run build` | Static output to `dist/`. |
| `npm run preview` | Serve the built output. |
| `npm test` | Vitest, engine + migrations. |
| `npm run content:check` | Zod validation + cross-file integrity checks over all content. |
| `npm run content:build` | Regenerate `content/manifest.json`. |
| `npm run verify` | `content:check && test && build` — run before every commit. |

---

## 3. Stack and why

Runtime dependencies are limited to five. Adding a sixth requires a written justification in this file.

| Layer | Choice | Why |
|---|---|---|
| Build | Vite + React 19 + TypeScript | Fast dev, static output, hostable anywhere. |
| Styling | Tailwind v4 via `@tailwindcss/vite` | CSS-first config, no `tailwind.config.js`. All tokens in `src/styles/tokens.css`. |
| Validation | Zod v4 | Single source of truth for content shape. TS types derived via `z.infer` — never hand-write a type Zod already describes. |
| State | Zustand | Progress writes fire on every answer; Context would re-render the whole tree each time. Selector subscriptions prevent that. Persistence is **our** storage module, not Zustand `persist`, so we own versioning. **v5 has no default equality check: never return a fresh object from a selector.** Select one value or one action at a time. |
| Formulas | KaTeX, lazy `import()` | Only credible LaTeX renderer. Bundled, so it stays offline. Code-split so formula-free pages don't pay for it. |
| Routing | **none** — `src/lib/hashRouter.ts` | ~40 lines. Hash routing means the build works from `file://` and any static host with zero rewrite rules. react-router is 10KB and a large API for 8 views. |
| Charts | **none** — `src/ui/charts/` | Hand-rolled SVG. Chart-read questions need full control of the series anyway. Colors follow the `dataviz` skill palette rules. |
| Tests | Vitest | Shares the Vite config. Targets pure logic, not components. |
| Fonts | System UI stack, `tabular-nums` for figures | Zero downloads, native feel, offline. |

Dev-only additions: **tsx**, so `scripts/*.ts` can import the exact same Zod schema the app
uses. Without it the validator would need a duplicate schema, which defeats the point of having
one source of truth.

No GCM branding. This is a personal study tool; firm brand assets are firm property.

### Known non-issue

Vite's native config loader warns that `vite.config.ts` and `scripts/*` import without file
extensions. It is a forward-compatibility notice about a future Vite default, not a fault. Adding
`.ts` to those imports only (leaving `src/` extensionless) would be worse — inconsistent import
style across the codebase. Revisit when that default actually lands.

---

## 4. Directory map

```
alts-academy/
  CLAUDE.md  README.md  .gitignore  .nvmrc
  package.json  index.html  vite.config.ts  tsconfig.json  vitest.config.ts
  content/
    manifest.json                 # GENERATED. Never hand-edit.
    glossary/{domain}.json        # canonical term definitions — the ONLY place terms are defined
    {domain}/{topic-id}.json      # one topic per file
  scripts/
    validate-content.ts           # Zod + cross-file checks; exits non-zero on any failure
    build-manifest.ts             # regenerates content/manifest.json
  src/
    main.tsx  App.tsx
    content/    schema.ts  loader.ts  glossary.ts  types.ts
    engine/     scheduler.ts  mastery.ts  session.ts  sessionPolicy.ts  grading.ts
                xp.ts  streak.ts  badges.ts  unlock.ts  constants.ts
    storage/    index.ts  localStorageAdapter.ts  migrations.ts  progressSchema.ts
    state/      store.ts  selectors.ts
    ui/         primitives/  blocks/  questions/  charts/
    views/      Home  Session  SkillTree  Glossary  Analytics  Settings  ReviewQueue  MockExam
    lib/        hashRouter.ts  time.ts  rng.ts  keyboard.ts
    styles/     tokens.css  index.css
```

**Loading strategy.** The app eagerly loads only `content/manifest.json` (ids, titles, domains,
prereqs, estMinutes, question counts, tags, examRelevance) and lazy-loads topic bodies on demand. At
200 topics the bodies are ~3MB — the skill tree and session planner must never need them.

### Domain slugs (fixed)

`quantitative-methods`, `economics`, `financial-statement-analysis`, `corporate-issuers`,
`equity-valuation`, `fixed-income`, `derivatives`, `alternatives`, `fund-structures`,
`portfolio-risk`, `ethics`

### Topic id convention

`{prefix}-{subject}-{nn}` — e.g. `quant-tvm-01`, `econ-curve-01`, `alts-lse-01`,
`funds-waterfall-01`. Prefixes: `quant`, `econ`, `fsa`, `corp`, `eq`, `fi`, `deriv`, `alts`,
`funds`, `pm`, `eth`. **Ids are permanent** — progress is keyed on them. Never renumber.

---

## 5. Content schema

Authoritative definition lives in `src/content/schema.ts` (Zod). This section is the human-readable
mirror; if they disagree, the Zod schema wins and this section gets fixed.

### Topic file

```json
{
  "schemaVersion": 1,
  "id": "quant-tvm-01",
  "domain": "quantitative-methods",
  "title": "Present Value and Future Value",
  "summary": "One plain-English line for cards and the skill tree. No jargon.",
  "level": "foundation",
  "prereqs": [],
  "estMinutes": 6,
  "examRelevance": ["CFA-L1", "CAIA-L1"],
  "lesson": [],
  "questions": [],
  "needsReview": false,
  "reviewNote": null
}
```

- `level`: `"foundation" | "core" | "advanced"`
- `prereqs`: topic ids. Must resolve. Must not create a cycle. Both checked by `content:check`.
- `examRelevance`: subset of `["CFA-L1","CFA-L2","CAIA-L1","CAIA-L2","practical"]`. `"practical"`
  means it matters on the job even if neither exam tests it — use it freely, the day job counts.
- `estMinutes`: honest read time for the lesson only. Question time is computed separately.

### Lesson blocks

Discriminated union on `type`. One renderer per type in `src/ui/blocks/`.

| type | fields | notes |
|---|---|---|
| `concept` | `body` | Core exposition. Plain English. |
| `intuition` | `body` | The *why*. **At least one required per topic** — enforced by `content:check`. |
| `formula` | `latex`, `plainReading`, `variables[]?` | `plainReading` reads the formula aloud in words. `variables` is `{symbol, meaning}[]`. |
| `example` | `body`, `walkthrough[]` | Worked, with numbers. Each `walkthrough` entry is one step. |
| `onTheJob` | `body` | How this shows up in an analyst's actual work. Aim for one per topic. |
| `pitfall` | `body` | The mistake people actually make. |
| `analogy` | `body` | Optional. Only if it genuinely clarifies. |
| `table` | `caption`, `headers[]`, `rows[][]` | Ratio lists, indicator release calendars, strategy comparisons. |
| `chart` | `caption`, `series`, `annotation?` | Seeded spec via `lib/rng.ts` so the chart is identical every render. |
| `keyTakeaways` | `items[]` | 2–4 items. Reused in session recaps and post-miss re-reads. Put it last. |

### Questions

Discriminated union on `type`. One renderer + one grader per type, registered in
`src/ui/questions/registry.ts`. **Adding a question type must never require editing the Session view.**

Common fields: `id` (permanent, `{topicId}-q{n}`), `type`, `difficulty` (1–5), `tags[]`,
`explanation`, `needsReview?`, `reviewNote?`, `estSeconds?`, `concept?` (id of the lesson block to
re-read after a confident miss).

| type | shape |
|---|---|
| `mcq` | `stem`, `choices[]`, `answerIndex`, `rationales[]` |
| `numeric` | `stem`, `answer`, `tolerance`, `toleranceType: "abs"\|"rel"`, `unit?` |
| `tfj` | `stem`, `isTrue`, `justifications[]`, `justificationIndex`, `rationales[]` |
| `match` | `instruction`, `pairs[]` as `{left, right}` |
| `vignette` | `stem`, `exhibits[]`, `subQuestions[]` (each an `mcq` or `numeric`) |
| `strategyId` | `description`, `choices[]`, `answerIndex`, `rationales[]` — return pattern or trade, name the strategy |
| `chartRead` | `series`, `stem`, `choices[]`, `answerIndex`, `rationales[]` |

**`rationales` is one entry per choice, index-aligned, same length as `choices`.** The correct
choice's entry says why it is right; the others say why they are wrong. This lets the UI show why
*the option the user picked* was wrong. `content:check` enforces the length. This deliberately
replaces a `whyWrong` array of "why A/B/D is wrong", which is ambiguous once the answer index moves.

### Glossary — canonical, one definition per term

Terms are defined **only** in `content/glossary/{domain}.json`. A topic file may not define a term.

```json
{
  "schemaVersion": 1,
  "domain": "quantitative-methods",
  "terms": [
    {
      "slug": "discount-rate",
      "term": "discount rate",
      "plain": "The rate you use to shrink a future dollar down to what it is worth today.",
      "formal": "The required rate of return used to convert future cash flows to present value.",
      "seeAlso": ["required-return", "hurdle-rate"]
    }
  ]
}
```

Prose in any `body`, `stem`, `explanation`, or `plainReading` marks a term as `[[discount-rate]]`,
rendered as an inline link opening a popover: **plain English first, formal second, related terms
third**. `content:check` fails on: unresolved slug, duplicate slug across domains, unresolved
`seeAlso`, and orphan terms (defined but never referenced anywhere).

Rule of thumb: **the first time a specialist word appears in a topic, it is marked up.** The user has
said to assume no jargon knowledge. Err toward over-marking.

### Inline markup — the complete list

Content prose is data, not markdown and not HTML. `src/content/markup.ts` is the only parser, and
it supports exactly three constructs, plus blank-line paragraph breaks:

| Markup | Renders as |
|---|---|
| `[[term-slug]]` / `[[term-slug\|words]]` | glossary popover trigger |
| `**bold**` | the load-bearing phrase in a paragraph |
| `*italic*` | light emphasis |

Nothing else is interpreted, so content can never inject markup into the app. Emphasis and terms do
not nest — a term inside `**bold**` renders as plain bold text, and content is authored to avoid it.

**Do not use `[[...]]` for a topic id.** It is glossary-term markup only; a topic id in it fails
`content:check` as an unresolved slug. Cross-topic links are not a feature yet.

---

## 6. Learning engine

All thresholds and magic numbers live in `src/engine/constants.ts`. No numeric literals scattered
through engine logic.

### Scheduler — `engine/scheduler.ts`

SM-2 behind `interface Scheduler { next(state: QuestionState, outcome: Outcome): QuestionState }`, so
FSRS can be swapped in later without touching a single call site. Confidence is part of the grade,
not a side channel:

| Confidence + result | Grade | Effect |
|---|---|---|
| confident + correct | 5 | full interval growth |
| unsure + correct | 3 | short interval; **still schedules a review** |
| guessing + correct | 3 | interval growth **capped** — a lucky guess is not mastery |
| guessing + wrong | 1 | soft lapse |
| unsure + wrong | 1 | soft lapse |
| **confident + wrong** | 0 | interval reset, resurfaces this or next session, **triggers a re-read of the linked `concept` block** |

Interval floor 10 minutes (same-session resurface). Initial ceiling 180 days. Two consecutive misses
on a question → adaptive difficulty steps **down** within the topic and re-teaches, rather than just
marking it wrong.

### Mastery — `engine/mastery.ts`

Topic mastery ∈ [0,1] from coverage (share of the topic's questions with ≥1 correct rep) ×
recency-decayed retention × normalized stability, weighted by question difficulty. Domain mastery is
topic mastery weighted by question count.

Gates: a topic unlocks when **every** prereq is ≥ 0.6. A domain boss exam unlocks at domain mastery
≥ 0.7 **and** ≥ 80% of its topics started.

### Session composer — `engine/session.ts`, policy in `sessionPolicy.ts`

Budget is in seconds. An item is added only while the **next whole item** still fits. The clock gates
*starting* an item and never truncates one — this is the "never leave me mid-question" requirement and
it is not negotiable. Running long drops planned items; running short tops up from due reviews.

| Length | Due reviews | Weak areas | New | Interleave |
|---|---|---|---|---|
| 5 min | 100% (or one micro-lesson if nothing is due) | — | — | — |
| 10 min | 60% | 20% | 20% | — |
| 20 min | 40% | 20% | 30% | 10% |
| 45 min | 30% | 20% | 35% | 15% (include one vignette) |

Default per-type seconds when `estSeconds` is absent: `mcq` 45, `numeric` 75, `tfj` 45, `match` 60,
`chartRead` 90, `strategyId` 60, `vignette` 240. Interleaving pulls **across** domains, never just the
last topic studied.

Modes: Learn New, Review Due, Weak Areas, Mock Exam, Glossary Drill — plus one "Start studying"
button that chooses for the user.

### XP — `engine/xp.ts`. Reward retention, not clicking.

XP accrues **only** on the first answer of a scheduled item per day, scaled by difficulty × a
calibration multiplier, with a bonus for correctly answering something previously missed. Zero XP for
re-answering anything already answered today. Daily soft cap with diminishing returns above it.

A streak day counts only if the user hits the goal minutes **and** completes ≥1 scheduled review.
Two freeze days per calendar month, auto-applied to the first qualifying missed day.

### Required test coverage

`npm test` must cover: the full grade table above, interval floor/ceiling, the confident-wrong reset,
adaptive step-down after two misses, mastery monotonicity (a correct answer never lowers mastery),
domain rollup weighting, session budget never overflowing, interleave spread, XP anti-farming (the
same item twice in a day yields XP once), streak + freeze logic, and every storage migration.

---

## 7. Storage and progress

`src/storage/index.ts` exposes a **Promise-based** interface backed by localStorage. Async from day
one means an IndexedDB adapter is a drop-in later with zero call-site changes. Nothing outside
`src/storage/` may touch `localStorage` directly.

Volume: ~1,600 question states ≈ 320KB, fine. The raw answer log is the risk (~2MB/yr), so it is
**bounded to a rolling 5,000 events / 18 months**, with permanent daily aggregates for long-run
analytics. Writes debounce ~250ms and force-flush on `visibilitychange` and `pagehide`.

### Progress schema

```
{
  schemaVersion: number,
  questions:    Record<questionId, QuestionState>,   // scheduling state
  topics:       Record<topicId, TopicState>,          // rolled-up mastery, lastStudied
  domains:      Record<domainId, DomainState>,
  events:       AnswerEvent[],                        // bounded ring
  daily:        Record<isoDate, DailyAggregate>,      // permanent
  gamification: { xp, level, streak, freezesUsed, badges[] },
  activeSession: ActiveSession | null,
  settings:     { sessionLength, dailyGoalMinutes, theme, validateContentInProd },
  meta:         { lastExportAt, createdAt }
}
```

### Migration rules

Ordered chain, one function per version step, **each with its own test**. Before migrating, stash the
pre-migration blob at `progress.backup.v{n}`. A stored version *newer* than the code knows about must
**refuse to write** and show a warning — never silently coerce.

### Session resume

`activeSession` persists after every answer: queue, index, answers so far, accumulated **active**
time, startedAt. On load, a session under 12h old offers Resume on the same question. Elapsed time is
accumulated active-time, not wall-clock, and pauses on `visibilitychange` — so a tab left open over
lunch does not burn the session budget.

---

## 8. UI conventions

Calm and adult. Neutral slate scale plus one restrained accent. **No purple gradients, no glow, no
generic-AI-app look.** Correct/incorrect colors are desaturated enough not to shout across an
open-plan desk.

- All color, spacing and type tokens in `src/styles/tokens.css`. Light and dark come from **one**
  token set (`class` strategy). No hard-coded hex values in components.
- Figures use `font-variant-numeric: tabular-nums` so columns of numbers line up.
- Transitions ≤120ms, opacity/transform only. `prefers-reduced-motion` honored. No sound, ever.
- Keyboard is a first-class input, not an add-on: `1–9` select, `Enter` submit/advance, `Space`
  reveal explanation, `C`/`U`/`G` confidence, `/` glossary search, `Esc` pause, `?` shortcuts overlay.
  One `useHotkeys` hook with a scope stack — views must not register competing global listeners.
- Real `<button>` elements, `aria-live` for answer feedback, focus moved deliberately on advance.
- Responsive down to 360px.

### Two rules the glossary popover imposes on everything else

Both of these were bugs found by running the app, not by reading it. They will recur if forgotten.

1. **A glossary trigger is a `<button>`, so prose containing terms must never be rendered inside
   another control.** A `<button>` inside a `<button>` is invalid HTML and swallows the click. Use
   `<Inline text={...} interactive={false} />` inside a control — it keeps the underline and adds a
   native tooltip. This is why answer rationales render as a sibling *below* the choice button
   rather than inside it, which also means their terms stay fully interactive.
2. **The popover panel renders through a portal to `document.body`.** Prose is wrapped in `<p>`, and
   a panel of `<div>`/`<p>` nested inside a `<p>` is invalid HTML that browsers silently reflow.

Related: decide popover placement from *available space* in one pass. The obvious
measure-the-panel-then-reposition approach feeds its own state back into its own effect and trips
React's "Maximum update depth exceeded".
- Every page footer: unofficial personal study tool, no affiliation with CFA Institute or CAIA
  Association.

---

## 9. Authoring content — checklist per topic

Before a topic file is considered done:

- [ ] Has at least one `intuition` block. The *why* is present, not just the mechanics.
- [ ] Has an `onTheJob` block a first-year analyst at an alts firm would recognize.
- [ ] Every specialist term is marked `[[slug]]` on first appearance and exists in the glossary.
- [ ] Ends with `keyTakeaways` (2–4 items).
- [ ] 6–10 questions spanning ≥3 difficulty levels and ≥2 question types.
- [ ] Every `mcq`/`tfj`/`strategyId`/`chartRead` has `rationales` aligned to `choices`.
- [ ] Every wrong-answer rationale explains the *misconception*, not just "this is incorrect".
- [ ] Anything uncertain carries `needsReview: true` + a specific `reviewNote`.
- [ ] `prereqs` point at topics that genuinely must come first — not a wish list.
- [ ] Written from scratch. Nothing traceable to licensed curriculum material.
- [ ] `npm run content:check` passes.

Alternatives is the deepest domain — it is the user's day job. Each hedge fund strategy is its own
topic and must cover: the return driver, typical exposures, what environment helps or hurts it, and
**how it can blow up**.

---

## 10. Milestones and git

Commit at the end of each milestone, then stop for review. Run `npm run verify` before every commit.

| # | Deliverable | Status |
|---|---|---|
| M0 | Plan, `CLAUDE.md`, repo initialized. No app code. | done |
| M1 | Content loader + validation, one lesson → quiz → result flow, three seeded topics: `quant-tvm-01`, `econ-curve-01`, `alts-lse-01` | done |
| M2 | Scheduler + mastery engine, with tests | |
| M3 | XP, levels, streaks, badges, skill tree | |
| M4 | Glossary popovers, global page, drill mode | |
| M5 | Content build-out, one domain per batch, validated, pause between batches | |
| M6 | Mock exams, analytics, export/import, session resume | |
| M7 | Polish: mobile, keyboard, accessibility, empty states, error handling | |

Working software over completeness at every milestone. A great app with 20 topics beats a broken one
with 200. Keep this table's Status column current.

Commit messages: `M{n}: {what}`.
