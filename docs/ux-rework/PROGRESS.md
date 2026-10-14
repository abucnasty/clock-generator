# UX rework: progress ledger

The orchestrator updates this file after every step (see `ORCHESTRATOR.md`). Its updates to the owner come from here.

**Status values:**

| Status | Meaning |
|---|---|
| `todo` | not started |
| `spec` | the spec is being drafted or reviewed |
| `impl` | being implemented |
| `evidence` | going through the evidence gate |
| `review` | the code review and the UX audit are running |
| `fix-1`, `fix-2` | fix rounds 1 and 2 |
| `blocked` | waiting on a checkpoint |
| `merged` | merged into the phase branch |
| `carried` | moved to a later phase |
| `dropped` | the owner decided against it |

## Current state

- **Phase:** 1 (started 2026-10-14)
- **Branch:** `feat/ux-rework-p1` (from `feat/ux-rework` at c8896e2)
- **Open checkpoints:** none

## Phase 1: stop the harm, quick wins

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Never offer a stale blueprint | opus | impl | | | Spec final 2026-10-14 |
| 1.2 | Header usable at every width | sonnet | spec | | | Spec final; waits for 1.1 (shares `App.tsx`, `WorkflowBar.tsx`, `ConfigImportExport.tsx`) |
| 1.3 | Undo snackbar for destructive actions | sonnet | spec | | | |
| 1.4 | Disabled actions say what is missing | opus | spec | | | Spec final; moved up (9 files). After 1.1 and 1.2; not alongside 1.3, 1.5 |
| 1.5 | Messages above the footer; quieter Ko-fi | opus | spec | | | Spec final; moved up (9 files). After 1.1 and 1.2 |
| 1.6 | Make the clock pick explainable | opus | spec | | | Spec final. After 1.1; not alongside 1.7, 1.10 |
| 1.7 | "Search deeper" button | opus | spec | | | Spec final; moved up (8 files). Waits for 1.1; not alongside 1.3, 1.4, 1.6 |
| 1.8 | Fix the dangerous expert bugs | opus | impl | | | Moved up from sonnet: the spec touches about 12 files. Runs alongside 1.1 |
| 1.9 | One number per entity, everywhere | opus | spec | | | Id question answered 2026-10-14: renumber on delete, drop `next_ids` |
| 1.10 | Readable numbers and units | sonnet | spec | | | |
| 1.11 | Accessibility basics | sonnet | spec | | | |
| 1.12 | Glossary and copy pass | sonnet | spec | | | Checkpoint: glossary approval |
| 1.13 | Enable mode shown on the row | sonnet | impl | | | Third slot, alongside 1.1 and 1.8. Wire the forced-ALWAYS note after 1.8 merges |
| 1.14 | Warning colour apart from the brand orange | opus | spec | | | Spec final; moved up (7 files). After 1.1 and 1.2; not alongside 1.4, 1.5 |

## Phase 2: newcomer-first structure

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| 2.1 | First visit and the way in | opus | todo | | | |
| 2.2 | Sidecar mod changes | opus | todo | | | Checkpoint: owner tries it in Factorio 2.1 |
| 2.3 | Fold Validate into Generate | opus | todo | | | |
| 2.4 | Ask the belt question | sonnet | todo | | | |
| 2.5 | Results lead with the answer | opus | todo | | | Checkpoint: install steps reviewed |
| 2.6 | Wake windows view | opus | todo | | | |
| 2.7 | Factorio GUI grammar pass | opus | todo | | | |
| 2.8 | In-game item names | sonnet | todo | | | |
| 2.9 | Half-width layout | sonnet | todo | | | |
| 2.10 | Developer timelines: light fixes | sonnet | todo | | | |
| 2.11 | Diagram readability | sonnet | todo | | | |

## Phase 3: expert depth

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| 3.1 | Rule editor upgrades | opus | todo | | | |
| 3.2 | Editing at scale | opus | todo | | | |
| 3.3 | Cancel, and keep the results | opus | todo | | | |
| 3.4 | Build library and share links | opus | todo | | | |

## Decisions log

Owner decisions made after the plan was written, and every change to `PLAN.md`, with the date.

- 2026-10-14: The orchestrator runs on Opus 5.5. Code review of the items implemented on `opus` uses Fable 5.1.
- 2026-10-14: 1.9, the id question: the owner chose the recommendation. Delete renumbers the remaining ids of its kind
  and remaps every reference; the UI-only `next_ids` and `retireId` go, and old saved forms that carry `next_ids` still
  load (the field is ignored).
- 2026-10-14: The owner allowed specs to be drafted ahead without limit; implementation stays at two items at once with
  no file in common. `ORCHESTRATOR.md` ("The loop for each plan item") is updated to say so.
- 2026-10-14: The owner raised the implementation cap from two items at once to three (still no file in common).
- 2026-10-14: 1.8 runs alongside 1.1 (no file in common), ahead of 1.2 and 1.3, which share files with 1.1.

## Open questions

- **Merge 1.5 before 1.3? (asked 2026-10-14).** 1.3's Undo snackbar would use 1.5's `notify()`. With the plan's order
  (1.3 first), 1.3 builds its own snackbar and 1.5 moves it a week later. Recommendation: 1.1, 1.2, 1.5, then 1.3.

## Follow-ups

Minor and nit findings, and anything noticed outside an item's scope.

- 1.13: after 1.8 and 1.13 both merge, update the "Configure Enable Control" selectors in `capture-expert-bugs.mjs`.
- 1.13: the Diagram node chips (`InserterFlowNode.tsx`, `EntityFlowNode.tsx`, `InserterConfigPanel.tsx`) still show
  the raw mode, and B7's "Show only overridden" filter is not built. For 2.11.
- 1.6: left to later items: B12's "Not picked because" column, B14's sorting and sticky tabs.
- 1.4: all Recipe inputs are labelled just "Recipe", so a jump to one announces only that. For 1.11.
- 1.14: the no-recovery, unstable and deadlock-risk warnings put no words on the Copy button (only the colour, icon,
  tooltip and snackbar). For the 1.12 glossary pass.
- 1.14 → 1.11: a `#fca300` focus ring is 1.55:1 on the yellow fill; draw it with an offset on the dark surface.
- 1.14 → 2.7: a warning-state yellow Copy replaces the green next-step button rather than sitting beside it.
- 1.7: a "found N fewer wake-ups" comparison after a deeper search needs the previous run kept. For 3.3.

## Retros

One section per phase, written at the phase end.
