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
- **Open checkpoints:** 1.9 the id question (asked 2026-10-14)

## Phase 1: stop the harm, quick wins

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Never offer a stale blueprint | opus | impl | | | Spec final 2026-10-14 |
| 1.2 | Header usable at every width | sonnet | spec | | | Spec final; waits for 1.1 (shares `App.tsx`, `WorkflowBar.tsx`, `ConfigImportExport.tsx`) |
| 1.3 | Undo snackbar for destructive actions | sonnet | todo | | | |
| 1.4 | Disabled actions say what is missing | sonnet | todo | | | |
| 1.5 | Messages above the footer; quieter Ko-fi | sonnet | todo | | | |
| 1.6 | Make the clock pick explainable | opus | todo | | | |
| 1.7 | "Search deeper" button | sonnet | todo | | | |
| 1.8 | Fix the dangerous expert bugs | sonnet | todo | | | |
| 1.9 | One number per entity, everywhere | opus | blocked | | | Checkpoint: the id question (see Open questions) |
| 1.10 | Readable numbers and units | sonnet | todo | | | |
| 1.11 | Accessibility basics | sonnet | todo | | | |
| 1.12 | Glossary and copy pass | sonnet | todo | | | Checkpoint: glossary approval |
| 1.13 | Enable mode shown on the row | sonnet | todo | | | |
| 1.14 | Warning colour apart from the brand orange | sonnet | todo | | | |

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

## Open questions

- **1.9, the id question (asked 2026-10-14).** `git log -S retireId` finds one commit, ece7f65 "Keep the ids of removed
  entities from being given to new ones" (2026-10-14, chore/cleanup). It added the UI-only `next_ids` to
  `ConfigFormData`, so a new entity never reuses a removed one's id that a reference might still hold.
  `formDataToConfig` strips `next_ids`, so exports, the engine, the sidecar and the recorder never see it; only the
  saved form in localStorage carries it. Renumbering with full remapping (like `reorderWithIdReassignment`) removes the
  reason for it, provided delete first unsets every reference to the removed entity (it already does for machines,
  belts and chests via `unsetInserterEndsAt`). Recommendation: renumber on delete and drop `next_ids` (ignore it when
  reading old saved forms).

## Follow-ups

Minor and nit findings, and anything noticed outside an item's scope.

## Retros

One section per phase, written at the phase end.
