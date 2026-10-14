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
| [1.1](specs/1.1-stale-results.md) | Never offer a stale blueprint | opus | merged | [#147](https://github.com/abucnasty/clock-generator/pull/147) | 1 | Code review Fable PASS, UX audit opus PASS (A5, B1, C5 fixed); cheap minors fixed before merge. CI green |
| [1.2](specs/1.2-header.md) | Header usable at every width | sonnet | merged | [#149](https://github.com/abucnasty/clock-generator/pull/149) | 2 | Code review opus PASS; UX audit FIX (focus under the header, 2.4.11) then PASS after round 1; a one-line minor in round 2. CI green |
| [1.3](specs/1.3-undo.md) | Undo snackbar for destructive actions | opus | impl | | | Bundle with 1.5 (1.5 first in the branch) |
| [1.4](specs/1.4-first-problem.md) | Disabled actions say what is missing | opus | spec | | | Bundle with 1.14 |
| [1.5](specs/1.5-messages-footer.md) | Messages above the footer; quieter Ko-fi | opus | impl | | | Bundle with 1.3 (`feat/ux-rework-p1-messages-undo`), started after 1.2 merged, with a capture writer |
| [1.6](specs/1.6-recommended-clock.md) | Make the clock pick explainable | opus | impl | | | Bundle with 1.7, alongside 1.2 |
| [1.7](specs/1.7-search-deeper.md) | "Search deeper" button | opus | impl | | | Bundle with 1.6, alongside 1.2 |
| [1.8](specs/1.8-expert-bugs.md) | Fix the dangerous expert bugs | opus | merged | [#148](https://github.com/abucnasty/clock-generator/pull/148) | 1 | Round 0: code review Fable PASS, UX audit FIX (prompt contrast). Round 1: both opus PASS. Minors fixed before merge. CI green |
| [1.9](specs/1.9-renumber.md) | One number per entity, everywhere | opus | fix-1 | | 1 | Code review and UX audit (opus) both FIX: the dimmed Transfer Plan still works from the keyboard and now hits the wrong inserter after a delete; the 720 row wraps to 3 lines. B4 fixed |
| [1.10](specs/1.10-numbers-units.md) | Readable numbers and units | opus | merged | [#146](https://github.com/abucnasty/clock-generator/pull/146) | 1 | Code review Fable PASS, UX audit opus PASS; cheap minors fixed before merge. CI green |
| [1.11](specs/1.11-a11y-basics.md) | Accessibility basics | opus + sonnet | spec | | | Spec final; two PRs: A foundation (opus), B names (sonnet). Late in the phase |
| [1.12](specs/1.12-glossary-copy.md) | Glossary and copy pass | sonnet | spec | | | Glossary approved 2026-10-14. Part A (copy fixes) after 1.8; Part B last in the phase |
| [1.13](specs/1.13-enable-chip.md) | Enable mode shown on the row | sonnet | merged | [#145](https://github.com/abucnasty/clock-generator/pull/145) | 1 | Code review opus, UX audit sonnet: FIX, then PASS/PASS. CI green. Forced-ALWAYS wiring moves to 1.9 |
| [1.14](specs/1.14-warning-colour.md) | Warning colour apart from the brand orange | opus | spec | | | Bundle with 1.4 |

## Phase 2: newcomer-first structure

| Item | Title | Implementer | Status | PR | Rounds | Notes |
|---|---|---|---|---|---|---|
| [2.1](specs/2.1-first-visit.md) | First visit and the way in | opus | spec | | | Spec final; counts as two units. After 2.2, 1.5 + 1.3 and 1.4. Uses 2.2's `suggestedTargetOf` |
| [2.2](specs/2.2-sidecar.md) | Sidecar mod changes | opus | spec | | | Spec final. Goes first in Phase 2. Checkpoint: owner runs the in-game steps in the spec |
| [2.3](specs/2.3-validate-into-generate.md) | Fold Validate into Generate | opus | spec | | | Spec final. After 1.4 + 1.14 and 1.6 + 1.7; before 2.4. Closes the 1.1 "Generate again" and Validate-crash follow-ups |
| [2.4](specs/2.4-belt-question.md) | Ask the belt question | opus | spec | | | Spec final; moved up (13 files). After 2.3 |
| [2.5](specs/2.5-results-answer.md) | Results lead with the answer | opus | spec | | | Spec final; two PRs (A answer + install steps first; B details). After 2.6. Checkpoint: install steps reviewed in game. Subtick book bug refuted |
| [2.6](specs/2.6-wake-windows.md) | Wake windows view | opus | spec | | | Spec final (11 files, no engine change). Before 2.5. Wake-up wording provisional |
| [2.7](specs/2.7-gui-grammar.md) | Factorio GUI grammar pass | opus | spec | | | Spec final; two PRs (A tokens and roles after 2.3 and 2.5 A; B layout after 2.1 and 2.4, before 2.9) |
| [2.8](specs/2.8-item-names.md) | In-game item names | opus + sonnet | spec | | | Spec final; about 42 files, two PRs (2.8a opus: dump, names, pickers; 2.8b sonnet: text sites, late) |
| [2.9](specs/2.9-half-width.md) | Half-width layout | sonnet | spec | | | Spec final. After 2.1-2.7, before 2.10 and 2.11 |
| [2.10](specs/2.10-timelines.md) | Developer timelines: light fixes | sonnet | spec | | | Spec final. After 1.14 |
| [2.11](specs/2.11-diagram.md) | Diagram readability | opus | spec | | | Spec final; moved up (12 files). After 1.9 |

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
- 2026-10-14: The owner asked the orchestrator to stay responsive and to delegate mechanical steps (check runs, PR,
  CI wait and merge, rebases) to background agents. [ORCHESTRATOR.md](ORCHESTRATOR.md) "Staying responsive" says how.
- 2026-10-14: The owner asked for stale branches to be removed as the work goes. [ORCHESTRATOR.md](ORCHESTRATOR.md)
  "Staying responsive" has the branch sweep.
- 2026-10-14: The owner moved every code review to `opus`, replacing Fable 5.1 for the items implemented on `opus`.
  The first-round reviews of 1.1, 1.8 and 1.10 ran on Fable; every review from now on, re-reviews included, runs on
  `opus`.
- 2026-10-14: To speed the work up, the owner approved three changes, now in [ORCHESTRATOR.md](ORCHESTRATOR.md):
  bundles (1.5 + 1.3, 1.4 + 1.14, 1.6 + 1.7), items that share files may run at once (each merges the phase branch and
  resolves its conflicts), and lighter evidence (a shared capture helper, "before" shots only where the review has
  none, no re-capture after a minors-only fix round). [PLAN.md](PLAN.md) "Child PRs" notes the bundles. Fast mode is
  off limits (the owner).
- 2026-10-14: The owner asked for an agent that suggests process improvements. [ORCHESTRATOR.md](ORCHESTRATOR.md)
  "Process coach": a read-only `opus` agent run after every third merge, at each phase end, and on request; the owner
  approves any change it suggests. Its brief is in the role briefs (no `.claude/agents` file, so nothing outlives the
  rework).
- 2026-10-14: Process coach run 1. The owner approved its suggestions 1-4, and gave the orchestrator the call on future
  coach suggestions (asking only when unsure or when a suggestion lowers the bar). Applied in
  [ORCHESTRATOR.md](ORCHESTRATOR.md): faster capture in `lib.mjs`; four units at once (a 20+ file item counts as two); a
  `sonnet` capture writer alongside each implementer; contrast and accessible names in the evidence gate. The
  orchestrator also applied suggestion 5: Phase 2 specs are drafted now, 2.2 and 2.5 go first in Phase 2 so the owner's
  in-game checks overlap other work, and `capture.mjs` is kept working as items merge.
- 2026-10-14: The owner asked for distinct agent names. Agent descriptions now follow `<item> <role>: <topic>`
  ([ORCHESTRATOR.md](ORCHESTRATOR.md) "Staying responsive").
- 2026-10-14: The rounded clock's non-integer decider constant (`decider-combinator.ts:82`, e.g. `signal-clock <
  90.947…` for a clock labelled as rounded to 90): the owner chose to leave it as a known issue for after the rework.
- 2026-10-14: 1.8 runs alongside 1.1 (no file in common), ahead of 1.2 and 1.3, which share files with 1.1.

## Open questions

None.

## Follow-ups

Minor and nit findings, and anything noticed outside an item's scope.

- 1.13 → 1.9: wire `forcedAlways={inserter._forced_always}` in `InsertersForm` and add capture step 7 of
  `capture-enable-chip.mjs` (1.13 merged before 1.8).
- 1.13: after 1.8 merges, update the "Configure Enable Control" selectors in `capture/capture-expert-bugs.mjs` (on 1.8's branch until it merges).
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
- Tooling: `capture.mjs` `generate()` and `validate()` wait on `innerText` for "Generating..." / "Validating...", but MUI
  upper-cases button text, so the waits end at once. Use `textContent`.
- Tooling: under the dev server, React StrictMode runs MUI's dialog focus trap twice, so an `autoFocus` button may not
  hold focus. Check dialog focus on a `vite preview` build.
- 1.10 → 1.12 Part B: "Overload Multiplier" and the overload tooltip in `MachineFactsAccordion.tsx` while the diagram
  says "insertion limit"; one number, two names.
- 1.10 → 2.11: the diagram node line is `#666` at about 8.8px on `#232323` (about 2.7:1), failing 1.4.3. Use
  `text.secondary` and at least 0.7rem. Also one precision for craft ticks (facts 5.224, node 5.2).
- 1.10 → 1.6: Rate cells still read "240.00"; use `formatNumberText`.
- 1.10 → 1.11: the full-value `title` doubles as the accessible description on fields with no helper text.
- 1.1 → 2.3: the banner, dialog and tooltip say "Generate again", but after an edit Generate stays disabled until
  Validate. When 2.3 removes that gate, check these strings hold. 1.4 shows "Validate the build first" meanwhile.
- 1.1: the stale banner's `role="alert"` is inserted while Results is hidden, so it is rarely announced; consider
  dropping the live role (1.11).
- 1.1: after start-up, an uncaught worker crash during a Validate (no generation on screen) is now ignored, so
  Validate could stay pending. Rare; also cover a pending Validate in the `onerror` guard (Phase 3 cancel item, or 2.3).
- 1.8: the X in `EnableControlModal` has no accessible name, unlike `EntityEditDialog`'s (1.11).
- 1.8: wrapping the dialogs in fragments re-indented `EntityEditDialog.tsx` and `EnableControlModal.tsx`; expect
  merge care in 1.3, 1.12 and 3.2.
- 1.8 → 2.3 or later: the Transfer Plan has no per-row "keeps your Clocked rule" note on an excluded inserter that kept
  its own rule, and the rule isn't checked against the new clock period.
- 1.8 → 2.7: the new footer Save and the modal Save are filled orange, not green.
- 1.8 → 3.2: the diagram's inserter dialog is Save/Cancel; machine, belt, chest and drill dialogs still apply live.
- 1.8 → 1.12: the Transfer Plan chip tooltip says "its inserters are set to ALWAYS", true only for inserters whose
  items are all excluded.
- 1.8 → 1.11: "Unsaved changes" has no live region; the modal's "Clear Override" is 3.0:1 on #474747.
- 1.2 → 1.4: `handleValidate`'s smooth scroll stops short because the page grows while Validate runs. Scroll after the
  check completes, or instantly; `--app-header-height` gives the margin.
- 1.2 → 2.9: at 390 the Configure view scrolls sideways (459px) because of the "limit: 15" chip. Pre-existing.
- 2.11: a saved `near_lane` can go invisible if a belt's lanes later hold the same item.
- 1.2 → 1.12: in the ⋮ menu "Import Config" sits next to "Paste from Factorio"; consider "Import config file…".
- 1.2: the logo's alt text "Logo" says nothing (1.11).
- 2.8: the pickers list mod and hidden entries (746 recipes, recycling and `ee-*`); engine prose keeps ids.
- 2.2: Esc or E on the sidecar's copy popup closes the main window and orphans the popup (existing quirk).
- Final PR: open the built 0.8.0 sidecar zip in game once more (2.2's owner steps 4 to 6).
- 2.7 found contrast failures in today's theme: green hover 3.98:1, error text 3.0-4.4:1 on cards and dialogs, input
  outlines and switch tracks 2.1-2.6:1, an orange Undo on MUI's snackbar 1.96:1, empty filter slots 1.46:1. 2.7 PR A
  fixes them; 1.5's snackbar and 1.3's Undo should not ship the 1.96:1 combination (checked in their evidence gate).
- Engine guard: in `alternatives.ts` (around line 483) clear `modulo_blueprint`/`modulo_schedule` in the subtick spread,
  with a test that every `-subtick` alternative exports a single blueprint. Changes no current output.
- 1.9 → 1.11: dnd-kit's reorder announcements read the `_uuid`; the row isn't a named group.
- 1.9: `useInserterValidation` keeps the previous config's issues for a moment after a delete, so a fix applied then can
  use old ids. Compare the issues to the config key, or check `machine_id` when applying.
- After the rework (owner, 2026-10-14): a rounded clock's decider gets a non-integer constant
  (`clock-generator/src/blueprints/entity/decider-combinator.ts:82`, `clock(period)` with no `Math.floor`). Check in
  game and fix in the engine.
- 1.7: a "found N fewer wake-ups" comparison after a deeper search needs the previous run kept. For 3.3.

## Retros

One section per phase, written at the phase end.
