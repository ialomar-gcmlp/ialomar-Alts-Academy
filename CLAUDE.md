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

### Glossary drill — `engine/glossary.ts`

Terms are drilled in both directions, because recognising a word and producing it are different
skills: `term-to-meaning` and `meaning-to-term`, each on its own schedule under
`term:{slug}:{t2m|m2t}`.

- **Only terms already met in a lesson are drilled.** Opening a topic marks every `[[slug]]` in it as
  seen. Drilling a word the user has never been shown is a trick question, not a test. The one
  exception is a brand-new install, which falls back to unseen terms rather than refusing to drill.
- **Distractors come from the same domain first.** Picking a definition out of three unrelated ones is
  trivial; the useful discrimination is against neighbouring concepts, which is where the confusion
  actually lives.
- **Generation is seeded** (`src/lib/rng.ts`), never `Math.random`. A re-render that reshuffled the
  options would move the answer index out from under the user.
- Drills earn XP under the same rules as questions and count as reviews for the streak — a glossary
  review is a real review. Only the scheduling state lives elsewhere.
- "Known" on the glossary page means a drill interval has passed a week, not that it was right once.

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
on a question → `needsReteach`, so the next encounter re-teaches rather than just asking again.

**The guessing cap limits growth; it never claws back an earned interval.** Clamping a long interval
down to the 7-day cap would let a *correct* answer reduce mastery, which breaks the invariant below.
`min(computed, max(cap, currentInterval))` is the form that holds.

### Mastery — `engine/mastery.ts`

Topic mastery ∈ [0,1] is the **geometric mean** of three components, each weighted by question
difficulty:

| Component | Meaning |
|---|---|
| coverage | share of the topic's questions answered correctly at least once |
| retention | share of attempted questions whose *last* answer passed, discounted by age (30-day half-life) |
| stability | mean interval the scheduler has reached, against a 21-day target |

Geometric, not an average, because the three are not substitutes: averaging would let a topic look
two-thirds mastered having been answered once yesterday and never revisited, which is exactly the
state "mastered" must exclude. A zero anywhere is a zero overall.

Domain mastery is topic mastery weighted by question count, counting untouched topics as zero.

**Invariant: evaluated at one instant, a correct answer can never lower mastery.** Every component is
individually non-decreasing on a pass. `mastery.test.ts` checks it directly and by brute force over
400 pseudo-random answers with a fixed seed.

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

Rules, all of them anti-farming:

- a wrong answer earns **nothing**, at any confidence
- a question pays out **at most once per day** — checked against the answer log, not a separate
  ledger, so there is no second source of truth. An earlier *miss* on the same day does not block a
  later payout, or the incentive would be to avoid retrying what you got wrong.
- multiplied by difficulty (1.0 at difficulty 1 → 2.5 at 5) and by confidence
  (confident 1.0, unsure 0.7, **guessing 0.3** — XP tracks knowledge, and being right by luck is not
  knowledge)
- `+15` for reviving something previously missed
- past 300 XP in a day, further awards are discounted to a quarter rather than blocked

Ten levels with titles describing what the user can do, not invented ranks — see `LEVELS` in
`engine/constants.ts`. Level 1 Orientation → level 10 Investment Committee Ready.

### Streaks — `engine/streak.ts`

A day counts only if BOTH hold: the goal minutes were met **and** ≥1 scheduled review was completed.
The second half is what stops a streak being kept by only ever reading new material — which is why
`DailyAggregate` carries a `reviews` count.

Two freeze days per calendar month. **Freezes are spent only if they save the streak**: if the gap is
wider than the remaining allowance can bridge, the streak breaks and the allowance is left untouched.
Spending two freezes on a three-day gap would waste them for nothing. Frozen days are persisted, so
the streak is reproducible rather than recomputed differently on each load.

### Badges — `engine/badges.ts`

Mastery milestones and calibration accuracy only. **Nothing for time spent or volume** — a test
asserts that 500 answers with nothing learned earns zero badges.

Two are deliberately hard to game:
- *Well Calibrated* requires 90%+ confident accuracy **and** that doubt was admitted on ≥10% of all
  answers, so it cannot be won by tagging everything Confident.
- *Knows the Gaps* requires that answers tagged Guessing were usually **wrong**, which is what honest
  self-assessment looks like.

Domain badges need `MIN_TOPICS_FOR_DOMAIN_BADGE` (3) topics in the domain. Without that guard, a
domain holding one topic awards the domain badge *before* the single-topic one, which reads as broken —
it did, on first run.

Once earned, a badge is never revoked. A mastery figure dipping after a fortnight away should not take
an achievement with it.

### Required test coverage

`npm test` must cover: the full grade table above, interval floor/ceiling, the confident-wrong reset,
adaptive step-down after two misses, mastery monotonicity (a correct answer never lowers mastery),
domain rollup weighting, session budget never overflowing, interleave spread, XP anti-farming (the
same item twice in a day yields XP once), streak + freeze logic, and every storage migration.

Write the test that tries to **break** the rule, not the one that confirms it works. The XP and badge
suites are mostly attempts to farm them; the mastery suite includes a brute-force monotonicity check
over 400 seeded pseudo-random answers. Both the guessing-cap bug and the domain-badge ordering bug
were found that way rather than by reading the code.

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
  schemaVersion: 5,
  questions:    Record<questionId, QuestionState>,   // scheduling state — the real record
  topics:       Record<topicId, { attempts, lastStudiedAt }>,   // facts only
  termsSeen:    Record<slug, timestamp>,             // terms met in a lesson
  termDrills:   Record<"term:{slug}:{t2m|m2t}", QuestionState>,
  events:       AnswerEvent[],                       // bounded ring, 5000 / 18 months
  daily:        Record<isoDate, DailyAggregate>,     // permanent; carries reviews + xp
  gamification: { xp, badges: [{id, earnedAt}], frozenDays: [dayKey] },
  settings:     { theme, sessionLength, dailyGoalMinutes, validateContentInProd, effects },
  meta:         { createdAt, lastExportAt }
}
```

**`termDrills` is deliberately separate from `questions`.** A drill belongs to no topic,
so mixing the two would inflate the topic review queue with items `startReviewSession`
cannot build, and would muddle topic mastery. A test asserts drills never land in
`questions`.

Still to come: `activeSession` (M6), as a version bump with a tested migration.

XP is accumulated rather than derived, unlike mastery. It has to be: the answer log it would be
derived from is deliberately trimmed, so deriving it would mean the user's total quietly falling as
old answers aged out.

**Mastery is NOT stored, and neither are domains.** Both are derived from question
state on every render by `src/state/selectors.ts`. There is no cache, so there is no
way for the number on screen to disagree with the data behind it — a whole class of bug
removed for a cost of one pass over a few thousand small objects. Only facts that
cannot be recomputed get persisted.

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

**Colourful and adult — REVISED 2026-08-31 at the user's request.** The original brief asked for a
restrained palette and no animation. After using the app the user asked for the opposite: *"I have
ADHD, so adding more color or attention grabbing elements that make the experience more fun."* That
instruction supersedes the earlier one. What did NOT change: no purple-gradient generic-AI-app look,
no sound ever, and nothing childish.

The colour system has two layers, and the distinction is the whole design:

1. **Reading surfaces stay quiet.** Warm stone neutrals, one teal accent, lesson prose on plain
   surface. A wall of colour behind body text is harder to read, not easier.
2. **Structure and reward are loud.** Every domain owns a validated hue that appears on its cards,
   headings, skill-tree nodes and progress bars; every lesson block type has its own colour and
   icon; XP is gold, streaks are flame orange, and both animate when they move.

- All colour, spacing and type tokens in `src/styles/tokens.css`. Light and dark come from **one**
  token set (`class` strategy). No hard-coded hex values in components.
- **Domain colours flow through `--d`,** set once per element by `domainStyle(domain)` and read by
  the `.d-*` classes. Never build a class or var name at runtime: `text-${domain}` compiles to
  nothing and `var(--d-${domain})` is ungreppable. `src/ui/domain.ts` writes all eleven out longhand.
- **Colour is never the only signal.** Every domain colour appears next to that domain's name and
  its two-letter monogram; correct/incorrect carry an icon as well as a hue. The palette passes the
  dataviz CVD checks, and the provenance note in `tokens.css` records the numbers.
- Figures use `font-variant-numeric: tabular-nums` so columns of numbers line up.
- **Motion:** interface transitions ≤140ms. The reward layer (XP bursts, streak flicker, score
  count-up, confetti on a clean sweep) may move for up to ~1.1s. Two independent off switches, both
  honoured: `prefers-reduced-motion`, and Calm mode in Settings which puts `.calm` on `<html>`.
  Calm mode keeps every colour and every number and stops all movement. No sound, ever.
- Nothing in the reward layer is load-bearing. Switch it all off and the app states the same facts.
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

### House style — APPROVED, do not drift

After reviewing 27 topics the user said: *"I like the way you've structured explanations and quiz
questions. Continue that style moving forward."* That is the only content feedback given across
M1-M5, so it is the specification rather than one option among several. What follows is that
structure written down explicitly, so a later session can reproduce it without guessing.

**Lesson block sequence.** Not every topic needs all of these, and this is the order they go in:

| Block | Job |
|---|---|
| `concept` — what it is | Plain definition, then *name the mechanism*. Open with a concrete situation where useful ("A company agrees to be bought for $50 a share...") rather than an abstract definition. |
| `concept` — the return driver | One block doing nothing but answering "where does the money come from?" Bold the answer as a single sentence. |
| `intuition` | The counterintuitive point, stated explicitly and in bold. This is the block that earns the topic. If there is nothing surprising to say, the topic is not finished. |
| `formula` | Only where an equation genuinely helps. `plainReading` reads it aloud in words for someone who cannot parse notation. |
| `example` | Numbered `walkthrough`, real numbers, ending on a **sanity check the reader can reuse** ("if your annuity factor exceeds n, you have made a mistake") or a "read that carefully" beat that lands the point. |
| `table` | Environments (helps / hurts / why), or a comparison of measures. Three columns, verdict in the middle. |
| `concept` — how it blows up | Named failure modes, each a **bold lead-in** then two or three sentences. Naming them is the point — the reader should be able to recall the list. |
| `pitfall` | One specific misconception, with the reason it is tempting. |
| `onTheJob` | **Specific questions to ask a manager**, bold-led, with what a good and a bad answer look like. Not general advice. |
| `keyTakeaways` | Exactly 4 items, each a complete claim that stands alone. No "understand X" phrasing. |

**Question set.** Six to eight per topic, ascending difficulty (aim 1-2 → 4), at least two types:

- **Numeric first** wherever there is arithmetic. Verify every answer in Python before writing it.
- **Every rationale diagnoses.** A wrong-answer rationale names the *misconception* and why it is
  tempting — never "this is incorrect". A miss should teach as much as a hit. The correct rationale
  opens "Correct." then restates the mechanism.
- **One `tfj` per topic**, targeting a specific plausible misconception, with distractor
  justifications that are wrong for *interesting* reasons (over-correction, right conclusion via
  wrong reasoning).
- **`strategyId` or `chartRead`** where the topic supports it — a described return pattern or a
  chart, not a definition in disguise.
- **The last one or two are difficulty 4 and framed on the job**, using the manager-diligence voice.
- **`explanation` adds something the rationales did not** — the generalisable lesson, or the link to
  another topic. It is not a summary of the correct rationale.

**Voice.** Direct, unhedged, second person where natural. State the uncomfortable version of a fact
rather than the diplomatic one ("their good record and their eventual loss have the same cause").
Assume no jargon: mark up every specialist term on first use. Never write "it is important to note".

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
| M2 | Scheduler + mastery engine, with tests | done |
| M3 | XP, levels, streaks, badges, skill tree | done |
| M4 | Glossary popovers, global page, drill mode | done |
| M5 | Content build-out, one domain per batch, validated, pause between batches | **in progress** — see inventory below |
| M6 | Mock exams, analytics, export/import, session resume | |
| M7 | Polish: mobile, keyboard, accessibility, empty states, error handling | |

Working software over completeness at every milestone. A great app with 20 topics beats a broken one
with 200. Keep this table's Status column current.


### M5 content inventory

One domain per batch, validated, pause between batches. Keep this current.

| Domain | Topics | Status |
|---|---|---|
| quantitative-methods | 10 | **done** — tvm-01/02, npv-01, ret-01, stat-01, dist-01, prob-01, bayes-01, hyp-01, reg-01 |
| economics | 8 | **DONE** — curve-01 (seeded in M1) + gdp, inflation, monetary, fiscal, cycle, fx, indicators |
| alternatives | 19 | **DONE** — 11 hedge fund strategies (lse, emn, merger, macro, cta, event, distressed, convert, firv, statarb, multistrat) + 8 private markets (pe-01 buyout, pe-02 growth, vc, pc, re, infra, realassets, fof) |
| financial-statement-analysis | 7 | **DONE** — statements, cashflow, ebitda, workingcapital, ratios, debt, earningsquality (one worked company throughout) |
| corporate-issuers | 6 | **DONE** — capitalstructure, wacc, allocation, governance, ma, issuance |
| equity-valuation | 5 | **DONE** — dcf, multiples, quality, comparables, privatemarks |
| fixed-income | 6 | **DONE** — bonds, duration, credit, forwards, floating, securitisation |
| derivatives | 0 | not started — delta, gamma, implied volatility, vega defined |
| fund-structures | 8 | **DONE** — gplp-01, fees-01, waterfall-01, hwm-01, calls-01, liquidity-01, sideletters-01, subline-01 |
| portfolio-risk | 0 | not started |
| ethics | 0 | not started |

### Authoring a batch — two hard-won rules

**Verify the arithmetic before writing it.** Every numeric answer in the quant batch was computed in
Python first and the result pasted into the content, never typed from memory. Two figures were wrong
on first attempt and would otherwise have shipped.

**Scan for unmarked jargon at the end of every batch.** The brief is explicit that every piece of
specialist language must be defined at point of use, and prose written at speed does not comply on its
own. The alternatives batch shipped its first draft using *repo*, *haircut*, *indenture*, *seniority*,
*capital structure*, *implied volatility*, *carry*, *on-the-run*, *pod* and *fulcrum security* without
markup — 15 terms then had to be added and marked up in a follow-up pass. Cheaper to scan as you go:

```bash
python -c "import io,glob,re;[print(f,[c for c in ['repo','haircut','indenture','seniority','carry','pod','basis point'] if re.search(r''+c+r'',re.sub(r'\[\[[a-z0-9-]+(\|[^\]]+)?\]\]','',io.open(f,encoding='utf-8').read()),re.I)]) for f in glob.glob('content/*/*.json')]"
```

Note the orphan check in `content:check` catches the reverse error (a term defined but never
referenced) but cannot catch this one — undefined jargon in prose is invisible to it, because there is
no markup to resolve.

**Watch for duplicate JSON keys.** Two topics shipped a lesson block with `"id"` written twice.
`json.load` silently keeps the last and Zod parses it happily. Scan with
`json.load(..., object_pairs_hook=...)` after each batch.

**Define AND mark up in the same pass.** A term defined but never referenced fails `content:check`
as an orphan; a term used but never defined is invisible to it. Batch 3 hit both directions in one
sitting — 29 undefined slugs, then two orphans from terms defined without a corresponding markup edit.
Do the glossary additions and the markup edits together, then run `content:check` before anything else.

**Drive the rendered page, not just the validators.** Batch 4 passed `content:check`, `content:audit`,
`typecheck` and 249 tests while printing raw `**` asterisks onto the lesson page: the markup parser
resolved glossary terms before emphasis, so `**Tier 2 — [[preferred-return]].**` matched neither
pattern and leaked. A second case — italic nested inside bold — had been live since batch 3. Both are
invisible to every check that does not look at the DOM. The sweep that found them is cheap enough to
repeat every batch:

```js
// in the browser console, with npm run dev running
for (const id of ids) { location.hash = '#/topic/' + id; await wait(250);
  const t = document.querySelector('article').innerText;
  if (/\*/.test(t) || /\[\[/.test(t)) console.log(id); }
```

**A bare `[[slug]]` renders the slug with spaces for hyphens, which is wrong for acronyms.**
`[[dpi]]` printed "dpi" and `[[j-curve]]` printed "j curve" — 46 occurrences across 38 topics before
anyone looked. Write the alias: `[[dpi|DPI]]`. `content:audit` now warns on any bare reference whose
rendered form differs from the glossary term's own name.

**Run a structural audit after each batch, on top of `content:check`.** The schema cannot catch a
misaligned `answerIndex`, because every index in range is structurally valid. This does:

```bash
npm run content:audit
```

It checks that the rationale at `answerIndex` actually reads as the correct one. That class of bug
shipped once in M1 and is invisible to both the schema and a casual read.

Commit messages: `M{n}: {what}`.
