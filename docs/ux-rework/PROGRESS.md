# UX rework: progress ledger

The orchestrator updates this file after every step (see [ORCHESTRATOR.md](ORCHESTRATOR.md)). Its updates to the owner
come from here.

**Links:**
- **Docs:** [PLAN.md](PLAN.md) · [ORCHESTRATOR.md](ORCHESTRATOR.md) · [specs/](specs/) ·
  [capture/README.md](capture/README.md)
- **Review:** [SYNTHESIS.md](review/SYNTHESIS.md) · [A-newcomer.md](review/A-newcomer.md) ·
  [B-power-user.md](review/B-power-user.md) · [C-visual-a11y.md](review/C-visual-a11y.md) · [BRIEF.md](review/BRIEF.md)
- **GitHub:** [feat/ux-rework](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework) ·
  [feat/ux-rework-p1](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p1) ·
  [child PRs into feat/ux-rework-p1](https://github.com/abucnasty/clock-generator/pulls?q=is%3Apr+base%3Afeat%2Fux-rework-p1) ·
  [phase PRs into feat/ux-rework](https://github.com/abucnasty/clock-generator/pulls?q=is%3Apr+base%3Afeat%2Fux-rework)
- In the item tables, the item number opens its spec, and the PR column links the child PR once it is open.

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
- **Branch:** [`feat/ux-rework-p1`](https://github.com/abucnasty/clock-generator/tree/feat/ux-rework-p1) (from `feat/ux-rework` at c8896e2)
- **Open checkpoints:** none

## Phase 1: stop the harm, quick wins

| Item (spec) | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [1.1](specs/1.1-stale-results.md) | Never offer a stale blueprint | opus | impl | | | Spec final 2026-10-14 |
| [1.2](specs/1.2-header.md) | Header usable at every width | sonnet | spec | | | Spec final; waits for 1.1 (shares `App.tsx`, `WorkflowBar.tsx`, `ConfigImportExport.tsx`) |
| [1.3](specs/1.3-undo.md) | Undo snackbar for destructive actions | opus | spec | | | Spec final; moved up (7 files). After 1.5 (uses `notify()`) and 1.8 (`serializeConfig`) |
| [1.4](specs/1.4-first-problem.md) | Disabled actions say what is missing | opus | spec | | | Spec final; moved up (9 files). After 1.1 and 1.2; not alongside 1.3, 1.5 |
| [1.5](specs/1.5-messages-footer.md) | Messages above the footer; quieter Ko-fi | opus | spec | | | Spec final; moved up (9 files). After 1.1 and 1.2 |
| [1.6](specs/1.6-recommended-clock.md) | Make the clock pick explainable | opus | spec | | | Spec final. After 1.1; not alongside 1.7, 1.10 |
| [1.7](specs/1.7-search-deeper.md) | "Search deeper" button | opus | spec | | | Spec final; moved up (8 files). Waits for 1.1; not alongside 1.3, 1.4, 1.6 |
| [1.8](specs/1.8-expert-bugs.md) | Fix the dangerous expert bugs | opus | impl | | | Moved up from sonnet: the spec touches about 12 files. Runs alongside 1.1 |
| [1.9](specs/1.9-renumber.md) | One number per entity, everywhere | opus | spec | | | Spec final (about 24 files). After 1.8 and 1.13. Id question answered 2026-10-14 |
| [1.10](specs/1.10-numbers-units.md) | Readable numbers and units | opus | spec | | | Spec final; moved up (10 files). Next free slot (no file in common with 1.1, 1.8, 1.13) |
| [1.11](specs/1.11-a11y-basics.md) | Accessibility basics | opus + sonnet | spec | | | Spec final; two PRs: A foundation (opus), B names (sonnet). Late in the phase |
| [1.12](specs/1.12-glossary-copy.md) | Glossary and copy pass | sonnet | spec | | | Glossary approved 2026-10-14. Part A (copy fixes) after 1.8; Part B last in the phase |
| [1.13](specs/1.13-enable-chip.md) | Enable mode shown on the row | sonnet | review | | | Evidence verified (tests 80/80, build re-run; shots checked). Code review on opus, UX audit on sonnet. Wire the forced-ALWAYS note after 1.8 merges |
| [1.14](specs/1.14-warning-colour.md) | Warning colour apart from the brand orange | opus | spec | | | Spec final; moved up (7 files). After 1.1 and 1.2; not alongside 1.4, 1.5 |

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

Owner decisions made after the plan was written, and every change to [PLAN.md](PLAN.md), with the date.

- 2026-10-14: The orchestrator runs on Opus 5.5. Code review of the items implemented on `opus` uses Fable 5.1.
- 2026-10-14: 1.9, the id question: the owner chose the recommendation. Delete renumbers the remaining ids of its kind
  and remaps every reference; the UI-only `next_ids` and `retireId` go, and old saved forms that carry `next_ids` still
  load (the field is ignored).
- 2026-10-14: The owner allowed specs to be drafted ahead without limit; implementation stays at two items at once with
  no file in common. [ORCHESTRATOR.md](ORCHESTRATOR.md) ("The loop for each plan item") is updated to say so.
- 2026-10-14: The owner raised the implementation cap from two items at once to three (still no file in common).
- 2026-10-14: The owner gave the orchestrator the call on implementation and merge order. [ORCHESTRATOR.md](ORCHESTRATOR.md) says so.
- 2026-10-14: Order change from the plan's "1.1 to 1.3 first": 1.5 goes before 1.3, so the Undo snackbar is built
  once on 1.5's `notify()`. Planned order for the shared-file chain: 1.1 → 1.2 → 1.5 → 1.3 → 1.4 → 1.14; 1.6 and 1.7
  after 1.1 (1.10 before 1.6); 1.9 after 1.8.
- 2026-10-14: The owner approved the 1.12 glossary, question by question; the answers are in
  [specs/1.12-glossary-copy.md](specs/1.12-glossary-copy.md) ("Owner's glossary decisions"). Changes from the proposal:
  "jammed" (output blocked) and "starved" (input runs out) are two words, not one "jam". "Wake-up" is provisional: the
  owner will write a strict definition after a separate experiment, and updating the definitions is then the first
  task.
- 2026-10-14: [PLAN.md](PLAN.md) 2.5 gains the Terms popover (the owner's glossary decision).
- 2026-10-14: 1.8 runs alongside 1.1 (no file in common), ahead of 1.2 and 1.3, which share files with 1.1.

## Open questions

None.

## Follow-ups

Minor and nit findings, and anything noticed outside an item's scope.

- 1.13: after 1.8 and 1.13 both merge, update the "Configure Enable Control" selectors in `capture/capture-expert-bugs.mjs` (on 1.8's branch until it merges).
- 1.13: the Diagram node chips ([InserterFlowNode.tsx](../../clock-generator-ui/src/components/InserterFlowNode.tsx), [EntityFlowNode.tsx](../../clock-generator-ui/src/components/EntityFlowNode.tsx), [InserterConfigPanel.tsx](../../clock-generator-ui/src/components/InserterConfigPanel.tsx)) still show
  the raw mode, and B7's "Show only overridden" filter is not built. For 2.11.
- 1.6: left to later items: B12's "Not picked because" column, B14's sorting and sticky tabs.
- 1.4: all Recipe inputs are labelled just "Recipe", so a jump to one announces only that. For 1.11.
- 1.14: the no-recovery, unstable and deadlock-risk warnings put no words on the Copy button (only the colour, icon,
  tooltip and snackbar). For the 1.12 glossary pass.
- 1.14 → 1.11: a `#fca300` focus ring is 1.55:1 on the yellow fill; draw it with an offset on the dark surface.
- 1.14 → 2.7: a warning-state yellow Copy replaces the green next-step button rather than sitting beside it.
- 1.10: one duration format (BlueprintOutput vs the timelines); right-aligned Insights columns; unrounded rates in the
  engine error at [plan-run.ts:1332-1333](../../clock-generator/src/crafting/plan/plan-run.ts#L1332-L1333); select-all on focus and silent fallbacks (B27); A16's live "per copy ·
  machine max" line.
- 1.9 → 1.3: whichever of the two merges second adds "the ones after it were renumbered" to a delete's Undo message.
- 1.12: [OverridesForm.tsx:80](../../clock-generator-ui/src/components/OverridesForm.tsx#L80) says "per output inserter" for Force Output Swings, while the note and
  [validate-config.ts](../../clock-generator/src/crafting/plan/validate-config.ts) sum over the output machine's inserters.
- 1.11 → 3.2: WCAG 2.5.7, the List's drag reorder needs a single-pointer alternative (e.g. Move up/down).
- 1.11 → Phase 2 retro: WCAG 1.4.10 Reflow at 320px conflicts with the owner's Widths decision.
- 1.11: the out-of-date plan's `opacity: 0.45` plus `pointer-events: none` (C21); hover-only override help (1.12).
- Tooling: `npm run knip` reports `scripts/*.mjs` as unused when run inside `.claude/worktrees/`; it passes on the main
  checkout. Judge knip on the main checkout or CI.
- Tooling: Playwright's ES module resolution ignores `NODE_PATH`; copy a capture script into `/tmp/ux-capture` to run it.
- 1.13 → 1.9: the AUTO tooltip gets its noun by parsing the label (`enableRuleLabel.ts`, `entityLabel.replace(/ \d+$/,
  '')`). When 1.9 changes the labels, pass `entityType: 'inserter' | 'drill'` instead. The 290px AUTO tooltip also
  covers the next row while open (`placement="top"` is an option).
- 1.13: the capture README doesn't mention `SAMPLES_DIR`.
- 1.7: a "found N fewer wake-ups" comparison after a deeper search needs the previous run kept. For 3.3.

## Retros

One section per phase, written at the phase end.
