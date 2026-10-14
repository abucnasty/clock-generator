# UX review brief: Factorio Clock Generator

You are one of three UX designers reviewing the Factorio Clock Generator website independently. You will not see
the other reviews and they will not see yours. Your persona and lens are in the message that sent you here.

## The product

A web tool for Factorio players. The player describes a build (machines, inserters, belts, chests, drills and the rate
it should make). The tool simulates it tick by tick, works out when each inserter has to be enabled, and gives a
blueprint of decider combinators that clock the inserters, so the build makes exactly its target rate with as few
inserter wake-ups as it can. It lists the clocks it could make ("potential clocks"), says which hold the rate and
recover from a backpressure loss, and selects one. A companion Factorio mod (the "sidecar") can export a build from the
game, which the site imports with "Paste from Factorio".

Read the root `README.md` and `CHANGELOG.md` (in `/Users/abucnasty/dev/factorio-scripts`) for product intent.

## Your evidence

1. **Screenshots** of the live site (version 0.9.0, 1440x900 plus a 390px-wide pass), in
   the shots folder the capture scripts wrote (see `docs/ux-rework/capture/README.md`).
   Start with `INDEX.md` there: it lists every file, what it shows and the action that produced it, plus any steps the
   capture script could not perform. Open the PNGs with the Read tool (it renders images). Long pages are cut into
   slices (`-partNofM`). `.aria.yml` files are accessibility-tree snapshots of the same states.
2. **The source**: `/Users/abucnasty/dev/factorio-scripts/clock-generator-ui/src/` (React 19 + MUI 7). `App.tsx` lays
   out the page; `components/` holds the forms, the workflow bar, the results workspace, the timelines and the
   diagram. Read code to understand states the screenshots do not show (errors, empty states, tooltips, copy, modals,
   keyboard handling). Do not review code quality; review what the code makes the player experience.

## Rules

- **Read-only.** Do not edit, create or delete any file anywhere. Do not run the app, git, npm or a browser. Read
  files and images only.
- **Be brutally honest.** No compliment sandwiches, no hedging, no filler praise. If something is confusing, odd,
  ugly, slow or hostile, say so in plain words and say who it loses and at what moment. Assume the author wants the
  hard truth, not reassurance.
- **Be specific.** Every finding cites evidence: a screenshot file name, and/or `path:line` in the source. Quote the
  actual on-screen text when the copy is the problem.
- **Propose a concrete change** for every problem: what it should say, where it should go, what it should do. "Improve
  clarity" is not a proposal.
- Stay in your lens, but if you see something outside it that is severe, include it.

## Report format (return this as your final message, in Markdown)

### 1. Gut reaction
3 to 5 sentences, in the first person as your persona, on first contact with the site.

### 2. Top 5 changes I'd make tomorrow
Ranked. One short paragraph each: the problem, the change, why it matters most.

### 3. All findings
A table with the columns:
`#` · `What's confusing or odd` · `Who it hurts` · `Severity` (blocker / major / minor / nit) · `Proposed change` ·
`Effort` (S / M / L) · `Evidence` (screenshot and/or path:line)

Aim for 15 to 30 findings. Order by severity.

### 4. What I'd cut or hide
Things that should not be on the default path at all.

### 5. What already works
At most 3 bullets, and only if genuinely earned. Zero is acceptable.

### 6. Open questions for the author
Things you could not judge without knowing the author's intent or the players.
